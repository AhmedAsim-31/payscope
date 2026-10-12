import { createHmac, timingSafeEqual } from 'node:crypto';

const HEX_PATTERN = /^(?:[0-9a-f]{2})*$/i;

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !HEX_PATTERN.test(a) || !HEX_PATTERN.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function withinTolerance(
  timestampSeconds: number,
  now: Date,
  toleranceSeconds: number,
): boolean {
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }
  return Math.abs(Math.floor(now.getTime() / 1000) - timestampSeconds) <= toleranceSeconds;
}
