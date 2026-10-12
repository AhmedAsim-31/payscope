import { z } from 'zod';
import { ProviderError } from '../provider-error';
import type { ProviderContext } from '../provider-context';
import type { ProviderObjectSnapshot } from '../provider-object';

const STRIPE_BASE_URL = 'https://api.stripe.com';
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024;

const MinorAmount = z.number().int().safe();

const PaymentIntentSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().min(1),
  amount: MinorAmount,
  amount_received: MinorAmount.nullish(),
  currency: z.string().length(3),
});

const SubscriptionSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().min(1),
  currency: z.string().length(3).nullish(),
});

function assertUsable(ctx: ProviderContext): void {
  const { apiKey } = ctx.credentials;
  if (apiKey.startsWith('sk_live_') || apiKey.startsWith('rk_live_')) {
    throw new ProviderError('invalid_input', 'Stripe live keys are not allowed');
  }
  if (ctx.baseUrl !== STRIPE_BASE_URL) {
    throw new ProviderError('invalid_input', `Stripe base URL must be ${STRIPE_BASE_URL}`);
  }
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ProviderError('permanent', 'Stripe response too large');
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
      throw new ProviderError('permanent', 'Stripe response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function stripeGet(ctx: ProviderContext, path: string): Promise<Record<string, unknown>> {
  assertUsable(ctx);
  let response: Response;
  let text: string;
  try {
    response = await ctx.fetch(`${STRIPE_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${ctx.credentials.apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw ProviderError.fromHttpStatus(response.status, `Stripe GET ${path} failed`);
    }
    text = await readCapped(response);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('unavailable', 'Stripe request failed or timed out', { cause: error });
  }
  try {
    const body: unknown = JSON.parse(text);
    return z.record(z.string(), z.unknown()).parse(body);
  } catch (error) {
    throw new ProviderError('permanent', 'Stripe returned an invalid response body', {
      cause: error,
    });
  }
}

function parseSnapshot<T extends z.ZodType>(schema: T, raw: Record<string, unknown>): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderError('permanent', 'Stripe returned an unexpected object shape');
  }
  return parsed.data;
}

export async function fetchPayment(
  ctx: ProviderContext,
  id: string,
): Promise<ProviderObjectSnapshot> {
  const raw = await stripeGet(ctx, `/v1/payment_intents/${encodeURIComponent(id)}`);
  const pi = parseSnapshot(PaymentIntentSchema, raw);
  const settled = pi.status === 'succeeded';
  return {
    provider: 'stripe',
    objectId: pi.id,
    status: pi.status,
    amountMinor: BigInt(settled ? (pi.amount_received ?? pi.amount) : pi.amount),
    currency: pi.currency.toUpperCase(),
    fetchedAt: new Date(),
    raw,
  };
}

export async function fetchSubscription(
  ctx: ProviderContext,
  id: string,
): Promise<ProviderObjectSnapshot> {
  const raw = await stripeGet(ctx, `/v1/subscriptions/${encodeURIComponent(id)}`);
  const sub = parseSnapshot(SubscriptionSchema, raw);
  return {
    provider: 'stripe',
    objectId: sub.id,
    status: sub.status,
    amountMinor: null,
    currency: sub.currency ? sub.currency.toUpperCase() : null,
    fetchedAt: new Date(),
    raw,
  };
}

export async function validateCredentials(ctx: ProviderContext): Promise<void> {
  await stripeGet(ctx, '/v1/balance');
}
