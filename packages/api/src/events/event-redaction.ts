const SENSITIVE_KEY = /email|name|phone|address|card|last4|iban|account|token|secret/i;
const EMAIL_IN_TEXT = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g;
const MAX_DEPTH = 8;
const MAX_BYTES = 64 * 1024;

export const REDACTED = '[REDACTED]';

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return value.replace(EMAIL_IN_TEXT, REDACTED);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactValue(inner, depth + 1),
    ]),
  );
}

export function redactPayload(payload: unknown): unknown {
  const redacted = redactValue(payload, 0);
  const size = Buffer.byteLength(JSON.stringify(redacted) ?? '');
  return size > MAX_BYTES ? { truncated: true, originalRedactedBytes: size } : redacted;
}
