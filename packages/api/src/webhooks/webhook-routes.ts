import { and, eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PROVIDER_NAMES } from '@payscope/provider-adapters/provider-name';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import { pgErrorCode } from '../db/pg-errors';
import { providerConnectionsTable } from '../db/schema/providers';
import { ApiHttpError } from '../http-error';
import { findAdapter } from '../providers/adapter-registry';
import { identifyEvent, ingestVerifiedEvent } from './ingest-event';

export const WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;

const JSON_CONTENT_TYPE = /^application\/(?:[\w.-]+\+)?json(?:\s*;.*)?$/i;
const CHECK_VIOLATION = '23514';

const params = z.object({ provider: z.enum(PROVIDER_NAMES), connectionId: z.uuid() });

function singleValueHeaders(raw: Record<string, string | string[] | undefined>) {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(raw)) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

function parseJsonObject(raw: Buffer): object | undefined {
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

type Options = { db: Db; cipher: CredentialsCipher; adapters: AdapterRegistry };

export const webhookRoutes: FastifyPluginCallbackZod<Options> = (
  app,
  { db, cipher, adapters },
  done,
) => {
  const parseOpts = { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT_BYTES } as const;
  const keepRaw = (_request: unknown, body: Buffer, parsed: (err: null, body: Buffer) => void) =>
    parsed(null, body);
  app.addContentTypeParser('application/json', parseOpts, keepRaw);
  app.addContentTypeParser(JSON_CONTENT_TYPE, parseOpts, keepRaw);

  app.post(
    '/webhooks/:provider/:connectionId',
    {
      bodyLimit: WEBHOOK_BODY_LIMIT_BYTES,
      schema: {
        params,
        response: { 200: z.object({ received: z.literal(true), duplicate: z.boolean() }) },
      },
    },
    async (request) => {
      const { provider, connectionId } = request.params;
      const notFound = () => new ApiHttpError(404, 'NOT_FOUND', 'Webhook endpoint not found');
      const adapter = findAdapter(adapters, provider);
      if (!adapter || !Buffer.isBuffer(request.body)) throw notFound();
      const rawBody = request.body;

      const [connection] = await db
        .select({
          orgId: providerConnectionsTable.orgId,
          status: providerConnectionsTable.status,
          ciphertext: providerConnectionsTable.credentialsCiphertext,
        })
        .from(providerConnectionsTable)
        .where(
          and(
            eq(providerConnectionsTable.id, connectionId),
            eq(providerConnectionsTable.provider, provider),
          ),
        )
        .limit(1);
      if (!connection || connection.status === 'disabled') throw notFound();

      const secrets = connection.ciphertext
        ? cipher.decrypt(connection.ciphertext, connectionId).webhookSecrets
        : [];
      const now = new Date();
      const verification = await adapter.verifyWebhook(
        { rawBody, headers: singleValueHeaders(request.headers), receivedAt: now },
        secrets,
        now,
      );
      if (!verification.ok) {
        request.log.warn(
          { provider, connectionId, reason: verification.reason },
          'webhook signature rejected',
        );
        throw new ApiHttpError(400, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature invalid', {
          reason: verification.reason,
        });
      }

      const payload = parseJsonObject(rawBody);
      if (!payload) {
        throw new ApiHttpError(
          400,
          'WEBHOOK_PAYLOAD_INVALID',
          'Webhook payload must be a JSON object',
        );
      }

      let identity;
      try {
        identity = identifyEvent(adapter, payload, verification.occurredAt, now);
      } catch (err) {
        if (err instanceof ApiHttpError) {
          request.log.warn({ provider, connectionId, code: err.code }, 'webhook payload rejected');
        }
        throw err;
      }

      try {
        return {
          received: true as const,
          ...(await ingestVerifiedEvent(db, {
            orgId: connection.orgId,
            connectionId,
            provider,
            providerEventId: verification.providerEventId,
            payload,
            identity,
          })),
        };
      } catch (err) {
        if (pgErrorCode(err) === CHECK_VIOLATION) {
          throw new ApiHttpError(413, 'PAYLOAD_TOO_LARGE', 'Webhook payload too large');
        }
        throw err;
      }
    },
  );

  done();
};
