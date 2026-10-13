import { hmacSha256Hex, timingSafeEqualHex, withinTolerance } from '../signature-utils';
import type { VerificationFailureReason } from '../webhook';

export type StripeSignatureResult =
  { ok: true; timestamp: Date } | { ok: false; reason: VerificationFailureReason };

type ParsedHeader = { timestamp: number; signatures: string[] };

function parseHeader(header: string): ParsedHeader | undefined {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && value) signatures.push(value);
  }
  if (timestamp === undefined || signatures.length === 0) return undefined;
  return { timestamp, signatures };
}

export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secrets: readonly string[],
  now: Date,
  toleranceSeconds = 300,
): StripeSignatureResult {
  if (!header) return { ok: false, reason: 'missing_signature' };
  const parsed = parseHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed' };

  const signedPayload = Buffer.concat([Buffer.from(`${parsed.timestamp}.`), rawBody]);
  const matched = secrets.some((secret) => {
    const expected = hmacSha256Hex(secret, signedPayload);
    return parsed.signatures.some((candidate) => timingSafeEqualHex(expected, candidate));
  });
  if (!matched) return { ok: false, reason: 'invalid_signature' };
  if (!withinTolerance(parsed.timestamp, now, toleranceSeconds)) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }
  return { ok: true, timestamp: new Date(parsed.timestamp * 1000) };
}
