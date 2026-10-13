import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../signature-utils';
import { verifyStripeSignature } from './stripe-signature';

const SECRET = 'whsec_test_primary';
const OLD_SECRET = 'whsec_test_rotated';
const T = 1_760_000_000;
const NOW = new Date(T * 1000);
const body = Buffer.from('{"id":"evt_test_1","livemode":false}');

function sign(secret: string, t = T, payload: Buffer = body): string {
  return hmacSha256Hex(secret, Buffer.concat([Buffer.from(`${t}.`), payload]));
}

describe('verifyStripeSignature', () => {
  it('accepts a valid signature', () => {
    const result = verifyStripeSignature(body, `t=${T},v1=${sign(SECRET)}`, [SECRET], NOW);
    expect(result).toEqual({ ok: true, timestamp: new Date(T * 1000) });
  });

  it('accepts when the second configured secret (rotation) matches', () => {
    const header = `t=${T},v1=${sign(OLD_SECRET)}`;
    expect(verifyStripeSignature(body, header, [SECRET, OLD_SECRET], NOW).ok).toBe(true);
  });

  it('accepts when the second v1 matches and ignores v0 and unknown schemes', () => {
    const header = `t=${T},v1=${'a'.repeat(64)},v0=deadbeef,foo=bar,v1=${sign(SECRET)}`;
    expect(verifyStripeSignature(body, header, [SECRET], NOW).ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = `t=${T},v1=${sign(SECRET)}`;
    const result = verifyStripeSignature(Buffer.from('{"id":"evt_test_2"}'), header, [SECRET], NOW);
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects the wrong secret', () => {
    const result = verifyStripeSignature(body, `t=${T},v1=${sign('other')}`, [SECRET], NOW);
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects stale (301s) and future timestamps, accepts the 300s edge', () => {
    const header = `t=${T},v1=${sign(SECRET)}`;
    const at = (offset: number) => new Date((T + offset) * 1000);
    expect(verifyStripeSignature(body, header, [SECRET], at(300)).ok).toBe(true);
    expect(verifyStripeSignature(body, header, [SECRET], at(301))).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    });
    expect(verifyStripeSignature(body, header, [SECRET], at(-301))).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    });
  });

  it('reports a missing header', () => {
    expect(verifyStripeSignature(body, undefined, [SECRET], NOW)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
    expect(verifyStripeSignature(body, '', [SECRET], NOW).ok).toBe(false);
  });

  it.each([
    ['no t', `v1=${'a'.repeat(64)}`],
    ['no v1', `t=${T}`],
    ['only v0', `t=${T},v0=abcd`],
    ['garbage', 'not a header at all'],
    ['non-numeric t', `t=abc,v1=${'a'.repeat(64)}`],
    ['empty v1', `t=${T},v1=`],
  ])('treats %s as malformed', (_name, header) => {
    expect(verifyStripeSignature(body, header, [SECRET], NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects non-hex and wrong-length v1 without throwing', () => {
    for (const v1 of ['zz'.repeat(32), 'abc', sign(SECRET).slice(0, 62)]) {
      expect(verifyStripeSignature(body, `t=${T},v1=${v1}`, [SECRET], NOW)).toEqual({
        ok: false,
        reason: 'invalid_signature',
      });
    }
  });

  it('rejects everything when no secrets are configured', () => {
    expect(verifyStripeSignature(body, `t=${T},v1=${sign(SECRET)}`, [], NOW).ok).toBe(false);
  });

  it('verifies headers produced by the official stripe SDK', () => {
    const header = Stripe.webhooks.generateTestHeaderString({
      payload: body.toString(),
      secret: SECRET,
      timestamp: T,
    });
    expect(verifyStripeSignature(body, header, [SECRET], NOW).ok).toBe(true);
  });
});
