import { pino } from 'pino';
import { safeErrorMessage } from './safe-error-message';

export const LOG_REDACT = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["stripe-signature"]',
    'req.headers["paddle-signature"]',
    'req.headers["paypal-transmission-sig"]',
    'req.headers["x-revenuecat-webhook-signature"]',
  ],
  censor: '[REDACTED]',
};

// Allow-list: Postgres `detail`, `where`, `hint`, `query`, and `parameters` can all echo row values.
const SAFE_ERROR_FIELDS = [
  'code',
  'severity',
  'schema_name',
  'table_name',
  'column_name',
  'constraint_name',
  'status',
  'statusCode',
  'category',
  'reason',
] as const;
const MAX_CAUSE_DEPTH = 3;
const WITHHELD = '[message withheld]';

type SerializedError = { type: string; message: string; stack: string; [key: string]: unknown };

function serializeError(err: unknown, depth = 0): SerializedError {
  if (!(err instanceof Error)) return { type: typeof err, message: WITHHELD, stack: '' };
  const out: SerializedError = {
    type: err.name,
    message: safeErrorMessage(err) ?? WITHHELD,
    stack: (err.stack ?? '')
      .split('\n')
      .filter((line) => /^\s+at /.test(line))
      .join('\n'),
  };
  for (const field of SAFE_ERROR_FIELDS) {
    const value: unknown = Reflect.get(err, field);
    if (typeof value === 'string' || typeof value === 'number') out[field] = value;
  }
  if (err.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    out['cause'] = serializeError(err.cause, depth + 1);
  }
  return out;
}

export const LOG_SERIALIZERS = { err: (err: unknown) => serializeError(err) };

export function createLogger(level: string) {
  return pino({ level, redact: LOG_REDACT, serializers: LOG_SERIALIZERS });
}
