import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../signature-utils';
import { verifyRevenueCatRequest } from './revenuecat-auth';

const SECRET = 'rc_test_shared_secret';
const T = 1_760_000_000;
const now = new Date(T * 1000);
const body = Buffer.from('{"event":{"id":"evt-1"}}');

function sign(secret: string, t: number, raw: Buffer = body): string {
  const signed = Buffer.concat([Buffer.from(`${t}.`), raw]);
  return `t=${t},v1=${hmacSha256Hex(secret, signed)}`;
}

describe('verifyRevenueCatRequest authorization mode', () => {
  it('accepts an equal Authorization header, case-insensitive name', () => {
    expect(verifyRevenueCatRequest(body, { Authorization: SECRET }, [SECRET], now)).toEqual({
      ok: true,
    });
  });

  it('accepts a match against any configured secret', () => {
    expect(verifyRevenueCatRequest(body, { authorization: 'b' }, ['a', 'b'], now).ok).toBe(true);
  });

  it('rejects a different value', () => {
    expect(verifyRevenueCatRequest(body, { authorization: 'nope' }, [SECRET], now)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  it('rejects a different length and a prefix of the secret', () => {
    const result = verifyRevenueCatRequest(
      body,
      { authorization: SECRET.slice(0, 5) },
      [SECRET],
      now,
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('reports a missing or empty header', () => {
    const expected = { ok: false, reason: 'missing_signature' };
    expect(verifyRevenueCatRequest(body, {}, [SECRET], now)).toEqual(expected);
    expect(verifyRevenueCatRequest(body, { authorization: '' }, [SECRET], now)).toEqual(expected);
  });

  it('rejects everything when no secrets are configured', () => {
    expect(verifyRevenueCatRequest(body, { authorization: SECRET }, [], now).ok).toBe(false);
  });
});

describe('verifyRevenueCatRequest HMAC mode', () => {
  const headers = (signature: string) => ({ 'X-RevenueCat-Webhook-Signature': signature });

  it('accepts a valid signature', () => {
    expect(verifyRevenueCatRequest(body, headers(sign(SECRET, T)), [SECRET], now).ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = Buffer.from('{"event":{"id":"evt-2"}}');
    const result = verifyRevenueCatRequest(tampered, headers(sign(SECRET, T)), [SECRET], now);
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a wrong secret', () => {
    expect(verifyRevenueCatRequest(body, headers(sign('other', T)), [SECRET], now).ok).toBe(false);
  });

  it('rejects a stale timestamp and accepts the tolerance edge', () => {
    const stale = verifyRevenueCatRequest(body, headers(sign(SECRET, T - 301)), [SECRET], now);
    expect(stale).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
    expect(verifyRevenueCatRequest(body, headers(sign(SECRET, T - 300)), [SECRET], now).ok).toBe(
      true,
    );
  });

  it('reports a malformed header', () => {
    const result = verifyRevenueCatRequest(body, headers('garbage'), [SECRET], now);
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('does not fall back to Authorization when the signature is invalid', () => {
    const result = verifyRevenueCatRequest(
      body,
      { authorization: SECRET, 'x-revenuecat-webhook-signature': sign('other', T) },
      [SECRET],
      now,
    );
    expect(result.ok).toBe(false);
  });
});
