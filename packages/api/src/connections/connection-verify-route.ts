import { and, eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import { audited, auditContext } from '../audit/audit-log';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import { providerConnectionsTable } from '../db/schema/providers';
import { ApiHttpError } from '../http-error';
import { sanitizeError } from '../jobs/job-errors';
import { currentOrg } from '../orgs/request-context';
import { requireOrg } from '../orgs/require-org';
import { findAdapter } from '../providers/adapter-registry';
import { BASE_URLS } from '../reconciliation/provider-checks';
import { connectionViewSchema, toConnectionView } from './connection-view';
import { viewColumns } from './connection-routes';

type Options = {
  db: Db;
  cipher: CredentialsCipher;
  adapters: AdapterRegistry;
  fetch?: typeof fetch;
};

const params = z.object({ orgId: z.uuid(), connectionId: z.uuid() });

export const connectionVerifyRoute: FastifyPluginCallbackZod<Options> = (
  app,
  { db, cipher, adapters, fetch: fetchImpl = fetch },
  done,
) => {
  app.decorateRequest('org', undefined);
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.rateLimitByMethod());

  app.post(
    '/api/v1/orgs/:orgId/connections/:connectionId/verify',
    {
      preHandler: [requireOrg(db, 'connections:manage'), app.rateLimitFor('credentialTest')],
      schema: { params, response: { 200: connectionViewSchema } },
    },
    async (request) => {
      const orgId = currentOrg(request).id;
      const { connectionId } = request.params;
      const base = {
        ...auditContext(request),
        action: 'connection.verify',
        targetType: 'connection',
        targetId: connectionId,
      };
      const [connection] = await db
        .select({
          provider: providerConnectionsTable.provider,
          mode: providerConnectionsTable.mode,
          ciphertext: providerConnectionsTable.credentialsCiphertext,
        })
        .from(providerConnectionsTable)
        .where(
          and(
            eq(providerConnectionsTable.id, connectionId),
            eq(providerConnectionsTable.orgId, orgId),
          ),
        )
        .limit(1);
      if (!connection) throw new ApiHttpError(404, 'NOT_FOUND', 'Connection not found');

      const reject = (status: number, code: string, message: string) =>
        audited<never>(db, base, () => Promise.reject(new ApiHttpError(status, code, message)));
      if (connection.mode === 'simulation') {
        return reject(
          409,
          'SIMULATED_CONNECTION',
          'Simulated connections have no provider account',
        );
      }
      const adapter = findAdapter(adapters, connection.provider);
      if (!adapter?.validateCredentials) {
        return reject(422, 'VALIDATION_UNSUPPORTED', 'This provider has no credential check');
      }
      const apiKey = connection.ciphertext
        ? cipher.decrypt(connection.ciphertext, connectionId).apiKey
        : undefined;
      if (!apiKey) return reject(422, 'NO_API_KEY', 'Add an API key before testing');

      // The provider call runs outside the transaction so a slow provider cannot hold a connection.
      const lastError = await adapter
        .validateCredentials({
          credentials: { apiKey },
          baseUrl: BASE_URLS[connection.provider],
          fetch: fetchImpl,
        })
        .then(
          () => null,
          (err: unknown) => sanitizeError(err),
        );
      const now = new Date();
      return audited(db, base, async (tx) => {
        const [row] = await tx
          .update(providerConnectionsTable)
          .set({
            status: lastError ? 'error' : 'active',
            lastError,
            ...(lastError ? {} : { lastVerifiedAt: now }),
            updatedAt: now,
          })
          .where(
            and(
              eq(providerConnectionsTable.id, connectionId),
              eq(providerConnectionsTable.orgId, orgId),
            ),
          )
          .returning(viewColumns);
        if (!row) throw new ApiHttpError(404, 'NOT_FOUND', 'Connection not found');
        return {
          value: toConnectionView(row, cipher),
          resultingState: { status: row.status, verified: lastError === null },
        };
      });
    },
  );

  done();
};
