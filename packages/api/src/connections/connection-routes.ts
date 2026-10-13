import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PROVIDER_NAMES } from '@payscope/provider-adapters/provider-name';
import {
  MAX_WEBHOOK_SECRETS,
  type Credentials,
  type CredentialsCipher,
} from '../crypto/credentials-cipher';
import { audited, auditContext } from '../audit/audit-log';
import type { Db } from '../db/client';
import { rethrowPgError } from '../db/pg-errors';
import { providerConnectionsTable } from '../db/schema/providers';
import { ApiHttpError } from '../http-error';
import { currentOrg } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { entitlementMapSchema } from './entitlement-map';
import { connectionViewSchema, toConnectionView, type ConnectionRow } from './connection-view';
import { assertSandboxApiKey } from './sandbox-key-guard';

const MAX_LISTED_CONNECTIONS = 100;

const secretField = z.string().min(1).max(512);

const createBody = z.object({
  provider: z.enum(PROVIDER_NAMES),
  mode: z.enum(['sandbox', 'simulation']),
  displayName: z.string().trim().min(1).max(100),
  externalAccountId: z.string().trim().min(1).max(200),
  webhookSecrets: z.array(secretField).max(MAX_WEBHOOK_SECRETS).optional(),
  apiKey: secretField.optional(),
});

const patchBody = z
  .object({
    webhookSecret: secretField.optional(),
    apiKey: secretField.optional(),
    entitlementMap: entitlementMapSchema.optional(),
  })
  .refine(
    (b) =>
      b.webhookSecret !== undefined || b.apiKey !== undefined || b.entitlementMap !== undefined,
    { error: 'webhookSecret, apiKey or entitlementMap is required' },
  );

const orgParams = z.object({ orgId: z.uuid() });
const connectionParams = z.object({ orgId: z.uuid(), connectionId: z.uuid() });

const viewColumns = {
  id: providerConnectionsTable.id,
  provider: providerConnectionsTable.provider,
  mode: providerConnectionsTable.mode,
  status: providerConnectionsTable.status,
  displayName: providerConnectionsTable.displayName,
  externalAccountId: providerConnectionsTable.externalAccountId,
  credentialsCiphertext: providerConnectionsTable.credentialsCiphertext,
  entitlementMap: providerConnectionsTable.entitlementMap,
  lastVerifiedAt: providerConnectionsTable.lastVerifiedAt,
  createdAt: providerConnectionsTable.createdAt,
  updatedAt: providerConnectionsTable.updatedAt,
};

type Options = { db: Db; cipher: CredentialsCipher };

export const connectionRoutes: FastifyPluginCallbackZod<Options> = (app, { db, cipher }, done) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.rateLimitByMethod());

  const notFound = () => new ApiHttpError(404, 'NOT_FOUND', 'Connection not found');

  app.post(
    '/api/v1/orgs/:orgId/connections',
    {
      preHandler: [requireOrg(db, 'connections:manage'), app.rateLimitFor('credentialTest')],
      schema: { params: orgParams, body: createBody, response: { 201: connectionViewSchema } },
    },
    async (request, reply) => {
      const body = request.body;
      assertSandboxApiKey(body.provider, body.apiKey);
      const id = randomUUID();
      const { ciphertext, keyVersion } = cipher.encrypt(
        {
          webhookSecrets: body.webhookSecrets ?? [],
          ...(body.apiKey === undefined ? {} : { apiKey: body.apiKey }),
        },
        id,
      );
      return audited(
        db,
        {
          ...auditContext(request),
          action: 'connection.create',
          targetType: 'connection',
          targetId: id,
        },
        async (tx) => {
          try {
            const [row] = await tx
              .insert(providerConnectionsTable)
              .values({
                id,
                orgId: currentOrg(request).id,
                provider: body.provider,
                mode: body.mode,
                status: 'unverified',
                displayName: body.displayName,
                externalAccountId: body.externalAccountId,
                credentialsCiphertext: ciphertext,
                credentialsKeyVersion: keyVersion,
              })
              .returning(viewColumns);
            if (!row) throw new Error('connection insert returned no row');
            return {
              value: toConnectionView(row, cipher),
              resultingState: { provider: body.provider, mode: body.mode },
            };
          } catch (err) {
            return rethrowPgError(err);
          }
        },
      ).then((view) => reply.code(201).send(view));
    },
  );

  app.get(
    '/api/v1/orgs/:orgId/connections',
    {
      preHandler: requireOrg(db, 'connections:read'),
      schema: {
        params: orgParams,
        response: { 200: z.object({ connections: z.array(connectionViewSchema) }) },
      },
    },
    async (request) => {
      const rows: ConnectionRow[] = await db
        .select(viewColumns)
        .from(providerConnectionsTable)
        .where(eq(providerConnectionsTable.orgId, currentOrg(request).id))
        .orderBy(asc(providerConnectionsTable.createdAt))
        .limit(MAX_LISTED_CONNECTIONS);
      return { connections: rows.map((row) => toConnectionView(row, cipher)) };
    },
  );

  app.get(
    '/api/v1/orgs/:orgId/connections/:connectionId',
    {
      preHandler: requireOrg(db, 'connections:read'),
      schema: { params: connectionParams, response: { 200: connectionViewSchema } },
    },
    async (request) => {
      const [row] = await db
        .select(viewColumns)
        .from(providerConnectionsTable)
        .where(
          and(
            eq(providerConnectionsTable.id, request.params.connectionId),
            eq(providerConnectionsTable.orgId, currentOrg(request).id),
          ),
        )
        .limit(1);
      if (!row) throw notFound();
      return toConnectionView(row, cipher);
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/connections/:connectionId',
    {
      preHandler: [requireOrg(db, 'connections:manage'), app.rateLimitFor('credentialTest')],
      schema: {
        params: connectionParams,
        body: patchBody,
        response: { 200: connectionViewSchema },
      },
    },
    async (request) => {
      const orgId = currentOrg(request).id;
      const { connectionId } = request.params;
      const { webhookSecret, apiKey, entitlementMap } = request.body;
      const base = { ...auditContext(request), targetType: 'connection', targetId: connectionId };
      return audited(db, { ...base, action: 'connection.update' }, async (tx) => {
        const [current] = await tx
          .select({
            provider: providerConnectionsTable.provider,
            ciphertext: providerConnectionsTable.credentialsCiphertext,
            entitlementMap: providerConnectionsTable.entitlementMap,
          })
          .from(providerConnectionsTable)
          .where(
            and(
              eq(providerConnectionsTable.id, connectionId),
              eq(providerConnectionsTable.orgId, orgId),
            ),
          )
          .for('update');
        if (!current) throw notFound();
        assertSandboxApiKey(current.provider, apiKey);
        const rotatesCredentials = webhookSecret !== undefined || apiKey !== undefined;
        const existing: Credentials = current.ciphertext
          ? cipher.decrypt(current.ciphertext, connectionId)
          : { webhookSecrets: [] };
        const secrets = webhookSecret
          ? [...existing.webhookSecrets, webhookSecret]
          : existing.webhookSecrets;
        const nextApiKey = apiKey ?? existing.apiKey;
        const encrypted = rotatesCredentials
          ? cipher.encrypt(
              {
                webhookSecrets: secrets.slice(-MAX_WEBHOOK_SECRETS),
                ...(nextApiKey === undefined ? {} : { apiKey: nextApiKey }),
              },
              connectionId,
            )
          : undefined;
        const [row] = await tx
          .update(providerConnectionsTable)
          .set({
            ...(encrypted
              ? {
                  credentialsCiphertext: encrypted.ciphertext,
                  credentialsKeyVersion: encrypted.keyVersion,
                }
              : {}),
            ...(entitlementMap ? { entitlementMap } : {}),
            updatedAt: new Date(),
          })
          .where(eq(providerConnectionsTable.id, connectionId))
          .returning(viewColumns);
        if (!row) throw notFound();
        return {
          value: toConnectionView(row, cipher),
          previousState: entitlementMap ? { entitlementMap: current.entitlementMap } : null,
          resultingState: {
            ...(entitlementMap ? { entitlementMap } : {}),
            ...(webhookSecret !== undefined ? { webhookSecretRotated: true } : {}),
            ...(apiKey !== undefined ? { apiKeyRotated: true } : {}),
          },
        };
      });
    },
  );

  done();
};
