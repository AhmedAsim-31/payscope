import { hmacSha256Hex, timingSafeEqualHex, withinTolerance } from '../signature-utils';
import type { VerificationFailureReason } from '../webhook';

export type PaddleSignatureResult =
  { ok: true; timestamp: number } | { ok: false; reason: VerificationFailureReason };

type ParsedHeader = { timestamp: number; signatures: string[] };

/** Paddle's SDKs default to 5s; real delivery and retries need a wider window. */
export const PADDLE_TOLERANCE_SECONDS = 300;

function parseHeader(header: string): ParsedHeader | undefined {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts' && /^\d{1,15}$/.test(value)) timestamp = Number(value);
    else if (key === 'h1' && value) signatures.push(value);
  }
  return timestamp === undefined || signatures.length === 0 ? undefined : { timestamp, signatures };
}

export function verifyPaddleSignature(
  rawBody: string | Buffer,
  header: string | undefined,
  secrets: readonly string[],
  now: Date,
  toleranceSeconds: number = PADDLE_TOLERANCE_SECONDS,
): PaddleSignatureResult {
  if (!header?.trim()) return { ok: false, reason: 'missing_signature' };
  const parsed = parseHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const signed = Buffer.concat([Buffer.from(`${parsed.timestamp}:`), Buffer.from(rawBody)]);
  let matched = false;
  for (const secret of secrets) {
    const expected = hmacSha256Hex(secret, signed);
    for (const candidate of parsed.signatures) {
      if (timingSafeEqualHex(expected, candidate)) matched = true;
    }
  }
  if (!matched) return { ok: false, reason: 'invalid_signature' };
  if (!withinTolerance(parsed.timestamp, now, toleranceSeconds)) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }
  return { ok: true, timestamp: parsed.timestamp };
}
