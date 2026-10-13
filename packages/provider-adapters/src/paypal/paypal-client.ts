import { z } from 'zod';
import type { ProviderContext } from '../provider-context';
import { ProviderError } from '../provider-error';
import type { ProviderObjectSnapshot } from '../provider-object';
import { parsePayPalAmount } from './paypal-amount';
import { readCapped } from './paypal-http';

const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const TOKEN_SAFETY_MS = 60_000;

const TokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const CaptureSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().min(1),
  amount: z.object({ currency_code: z.string().min(1), value: z.string() }),
});

const SubscriptionSchema = z.looseObject({ id: z.string().min(1), status: z.string().min(1) });

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearPayPalTokenCache(): void {
  tokenCache.clear();
}

/** PayPal needs a client id and secret but ProviderContext carries one string, so apiKey is "clientId:clientSecret". */
function splitCredentials(ctx: ProviderContext): { clientId: string; clientSecret: string } {
  const index = ctx.credentials.apiKey.indexOf(':');
  const clientId = ctx.credentials.apiKey.slice(0, index);
  const clientSecret = ctx.credentials.apiKey.slice(index + 1);
  if (ctx.baseUrl !== SANDBOX_BASE_URL || index <= 0 || !clientSecret) {
    throw new ProviderError(
      'invalid_input',
      'PayPal adapter is sandbox-only and needs clientId:clientSecret',
    );
  }
  return { clientId, clientSecret };
}

async function send(ctx: ProviderContext, path: string, init: RequestInit): Promise<unknown> {
  let text: string;
  try {
    const response = await ctx.fetch(`${ctx.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw ProviderError.fromHttpStatus(response.status, `PayPal API returned ${response.status}`);
    }
    text = await readCapped(response, MAX_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('unavailable', 'PayPal request failed', { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProviderError('permanent', 'PayPal returned invalid JSON', { cause: error });
  }
}

function parseResponse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderError('permanent', 'Unexpected PayPal response shape', {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function accessToken(ctx: ProviderContext): Promise<string> {
  const { clientId, clientSecret } = splitCredentials(ctx);
  const key = `${clientId}:${clientSecret}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const basic = Buffer.from(key).toString('base64');
  const body = parseResponse(
    TokenSchema,
    await send(ctx, '/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    }),
  );
  tokenCache.set(key, {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000 - TOKEN_SAFETY_MS,
  });
  return body.access_token;
}

async function get(ctx: ProviderContext, path: string): Promise<unknown> {
  const token = await accessToken(ctx);
  return send(ctx, path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
}

export async function fetchPayPalPayment(
  ctx: ProviderContext,
  id: string,
): Promise<ProviderObjectSnapshot> {
  const data = parseResponse(
    CaptureSchema,
    await get(ctx, `/v2/payments/captures/${encodeURIComponent(id)}`),
  );
  const currency = data.amount.currency_code.toUpperCase();
  return {
    provider: 'paypal',
    objectId: data.id,
    status: data.status,
    amountMinor: parsePayPalAmount(data.amount.value, currency),
    currency,
    fetchedAt: new Date(),
    raw: data,
  };
}

export async function fetchPayPalSubscription(
  ctx: ProviderContext,
  id: string,
): Promise<ProviderObjectSnapshot> {
  const data = parseResponse(
    SubscriptionSchema,
    await get(ctx, `/v1/billing/subscriptions/${encodeURIComponent(id)}`),
  );
  return {
    provider: 'paypal',
    objectId: data.id,
    status: data.status,
    amountMinor: null,
    currency: null,
    fetchedAt: new Date(),
    raw: data,
  };
}

export async function validatePayPalCredentials(ctx: ProviderContext): Promise<void> {
  await accessToken(ctx);
}
