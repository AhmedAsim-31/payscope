import { z } from 'zod';
import type { ProviderContext } from '../provider-context';
import { ProviderError } from '../provider-error';
import type { ProviderObjectSnapshot } from '../provider-object';
import { parsePaddleMinorUnits } from './paddle-amount';

const SANDBOX_BASE_URL = 'https://sandbox-api.paddle.com';
const SANDBOX_KEY_PREFIX = 'pdl_sdbx_';
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;

const TransactionResponseSchema = z.object({
  data: z.looseObject({
    id: z.string().min(1),
    status: z.string().min(1),
    currency_code: z.string().min(1),
    details: z.looseObject({ totals: z.looseObject({ grand_total: z.string() }) }).nullish(),
  }),
});

const SubscriptionResponseSchema = z.object({
  data: z.looseObject({
    id: z.string().min(1),
    status: z.string().min(1),
    currency_code: z.string().min(1).nullish(),
  }),
});

function assertSandbox(ctx: ProviderContext): void {
  if (ctx.baseUrl !== SANDBOX_BASE_URL || !ctx.credentials.apiKey.startsWith(SANDBOX_KEY_PREFIX)) {
    throw new ProviderError('invalid_input', 'Paddle adapter is sandbox-only');
  }
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result: unknown = await reader.read();
    const value = typeof result === 'object' && result && 'value' in result ? result.value : null;
    if (!(value instanceof Uint8Array)) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ProviderError('permanent', 'Paddle response exceeded size limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function request(ctx: ProviderContext, path: string): Promise<unknown> {
  assertSandbox(ctx);
  let response: Response;
  let text: string;
  try {
    response = await ctx.fetch(`${ctx.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${ctx.credentials.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw ProviderError.fromHttpStatus(response.status, `Paddle API returned ${response.status}`);
    }
    text = await readCapped(response);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('unavailable', 'Paddle request failed', { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProviderError('permanent', 'Paddle returned invalid JSON', { cause: error });
  }
}

function parseResponse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderError('permanent', 'Unexpected Paddle response shape', {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export async function fetchPaddlePayment(
  ctx: ProviderContext,
  id: string,
): Promise<ProviderObjectSnapshot> {
  const { data } = parseResponse(
    TransactionResponseSchema,
    await request(ctx, `/transactions/${encodeURIComponent(id)}`),
  );
  return {
    provider: 'paddle',
    objectId: data.id,
    status: data.status,
    amountMinor: data.details ? parsePaddleMinorUnits(data.details.totals.grand_total) : null,
    currency: data.currency_code.toUpperCase(),
    fetchedAt: new Date(),
    raw: data,
  };
}

export async function fetchPaddleSubscription(
  ctx: ProviderContext,
  id: string,
): Promise<ProviderObjectSnapshot> {
  const { data } = parseResponse(
    SubscriptionResponseSchema,
    await request(ctx, `/subscriptions/${encodeURIComponent(id)}`),
  );
  return {
    provider: 'paddle',
    objectId: data.id,
    status: data.status,
    amountMinor: null,
    currency: data.currency_code?.toUpperCase() ?? null,
    fetchedAt: new Date(),
    raw: data,
  };
}

export async function validatePaddleCredentials(ctx: ProviderContext): Promise<void> {
  await request(ctx, '/event-types');
}
