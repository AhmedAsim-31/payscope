import { createHash, timingSafeEqual } from 'node:crypto';
import { hmacSha256Hex, timingSafeEqualHex, withinTolerance } from '../signature-utils';
import type { VerificationFailureReason, WebhookRequest } from '../webhook';

export type RevenueCatAuthResult = { ok: true } | { ok: false; reason: VerificationFailureReason };

export const REVENUECAT_TOLERANCE_SECONDS = 300;

function header(headers: WebhookRequest['headers'], name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function matchesAnySecret(candidate: string, secrets: readonly string[]): boolean {
  const candidateDigest = digest(candidate);
  let matched = false;
  for (const secret of secrets) {
    if (timingSafeEqual(candidateDigest, digest(secret))) matched = true;
  }
  return matched;
}

function parseSignature(value: string): { timestamp: number; signature: string } | undefined {
  let timestamp: number | undefined;
  let signature: string | undefined;
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (key === 't' && /^\d{1,15}$/.test(v)) timestamp = Number(v);
    else if (key === 'v1' && v) signature = v;
  }
  return timestamp === undefined || signature === undefined ? undefined : { timestamp, signature };
}

function verifyHmac(
  rawBody: Buffer,
  value: string,
  secrets: readonly string[],
  now: Date,
): RevenueCatAuthResult {
  const parsed = parseSignature(value);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const signed = Buffer.concat([Buffer.from(`${parsed.timestamp}.`), rawBody]);
  let matched = false;
  for (const secret of secrets) {
    if (timingSafeEqualHex(hmacSha256Hex(secret, signed), parsed.signature)) matched = true;
  }
  if (!matched) return { ok: false, reason: 'invalid_signature' };
  if (!withinTolerance(parsed.timestamp, now, REVENUECAT_TOLERANCE_SECONDS)) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }
  return { ok: true };
}

/** Each secret is tried as both modes: a signature header, when present, must verify as HMAC; otherwise Authorization must equal a secret. */
export function verifyRevenueCatRequest(
  rawBody: Buffer,
  headers: WebhookRequest['headers'],
  secrets: readonly string[],
  now: Date,
): RevenueCatAuthResult {
  const signature = header(headers, 'x-revenuecat-webhook-signature');
  if (signature !== undefined) return verifyHmac(rawBody, signature, secrets, now);
  const authorization = header(headers, 'authorization');
  if (authorization === undefined || authorization === '') {
    return { ok: false, reason: 'missing_signature' };
  }
  return matchesAnySecret(authorization, secrets)
    ? { ok: true }
    : { ok: false, reason: 'invalid_signature' };
}
