import { z } from 'zod';
import { ProviderError } from '../provider-error';
import type { ProviderContext } from '../provider-context';
import type { ProviderObjectSnapshot } from '../provider-object';

const REVENUECAT_BASE_URL = 'https://api.revenuecat.com';
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024;
const CREDENTIAL_CHECK_USER_ID = 'payscope-credential-check';

const SubscriberResponseSchema = z.object({
  subscriber: z.looseObject({
    original_app_user_id: z.string().min(1),
    entitlements: z.record(z.string(), z.looseObject({ expires_date: z.string().nullable() })),
  }),
});

function assertUsable(ctx: ProviderContext): void {
  if (ctx.baseUrl !== REVENUECAT_BASE_URL) {
    throw new ProviderError('invalid_input', `RevenueCat base URL must be ${REVENUECAT_BASE_URL}`);
  }
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ProviderError('permanent', 'RevenueCat response too large');
  }
  if (!response.body) return '';
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ProviderError('permanent', 'RevenueCat response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function getJson(ctx: ProviderContext, appUserId: string, suffix = ''): Promise<unknown> {
  assertUsable(ctx);
  if (!appUserId) throw new ProviderError('invalid_input', 'RevenueCat app user id is empty');
  let response: Response;
  let text: string;
  try {
    response = await ctx.fetch(
      `${REVENUECAT_BASE_URL}/v1/subscribers/${encodeURIComponent(appUserId)}${suffix}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${ctx.credentials.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw ProviderError.fromHttpStatus(response.status, 'RevenueCat request failed');
    }
    text = await readCapped(response);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('unavailable', 'RevenueCat request failed or timed out', {
      cause: error,
    });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProviderError('permanent', 'RevenueCat returned an invalid response body', {
      cause: error,
    });
  }
}

export async function fetchRevenueCatSubscription(
  ctx: ProviderContext,
  appUserId: string,
): Promise<ProviderObjectSnapshot> {
  const parsed = SubscriberResponseSchema.safeParse(await getJson(ctx, appUserId));
  if (!parsed.success) {
    throw new ProviderError('permanent', 'RevenueCat returned an unexpected subscriber shape', {
      cause: parsed.error,
    });
  }
  const { subscriber } = parsed.data;
  const fetchedAt = new Date();
  const active = Object.values(subscriber.entitlements).some(
    ({ expires_date: expires }) => expires === null || Date.parse(expires) > fetchedAt.getTime(),
  );
  return {
    provider: 'revenuecat',
    objectId: subscriber.original_app_user_id,
    status: active ? 'active' : 'inactive',
    amountMinor: null,
    currency: null,
    fetchedAt,
    raw: subscriber,
  };
}

/** Offerings read: unlike GET /v1/subscribers/{id}, it does not create the customer it is asked about. */
export async function validateRevenueCatCredentials(ctx: ProviderContext): Promise<void> {
  await getJson(ctx, CREDENTIAL_CHECK_USER_ID, '/offerings');
}
