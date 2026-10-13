import { Environment, Paddle } from '@paddle/paddle-node-sdk';
import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../signature-utils';
import { verifyPaddleSignature } from './paddle-signature';

const SECRET = 'pdl_ntfset_test_secret';
const BODY = '{"event_id":"evt_01k00000000000000000000001","event_type":"transaction.completed"}';
const TS = 1_780_000_000;
const NOW = new Date(TS * 1000);

const sign = (secret: string, ts = TS, body = BODY) => hmacSha256Hex(secret, `${ts}:${body}`);
const header = (...h1: string[]) => `ts=${TS};${h1.map((h) => `h1=${h}`).join(';')}`;

describe('verifyPaddleSignature', () => {
  it('accepts a valid signature', () => {
    expect(verifyPaddleSignature(BODY, header(sign(SECRET)), [SECRET], NOW)).toEqual({
      ok: true,
      timestamp: TS,
    });
  });

  it('accepts a Buffer body', () => {
    expect(verifyPaddleSignature(Buffer.from(BODY), header(sign(SECRET)), [SECRET], NOW).ok).toBe(
      true,
    );
  });

  it('accepts a rotated secret when any configured secret matches', () => {
    const result = verifyPaddleSignature(BODY, header(sign('new')), ['old', 'new'], NOW);
    expect(result.ok).toBe(true);
  });

  it('accepts when any of several h1 values matches', () => {
    const result = verifyPaddleSignature(BODY, header(sign('old'), sign('new')), ['new'], NOW);
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const result = verifyPaddleSignature(`${BODY} `, header(sign(SECRET)), [SECRET], NOW);
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects the wrong secret and an empty secret list', () => {
    expect(verifyPaddleSignature(BODY, header(sign(SECRET)), ['other'], NOW).ok).toBe(false);
    expect(verifyPaddleSignature(BODY, header(sign(SECRET)), [], NOW)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  it('rejects a stale timestamp beyond the default 300s window', () => {
    const later = new Date((TS + 301) * 1000);
    expect(verifyPaddleSignature(BODY, header(sign(SECRET)), [SECRET], later)).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    });
  });

  it('accepts a timestamp inside the window and honors a custom tolerance', () => {
    const later = new Date((TS + 299) * 1000);
    expect(verifyPaddleSignature(BODY, header(sign(SECRET)), [SECRET], later).ok).toBe(true);
    expect(verifyPaddleSignature(BODY, header(sign(SECRET)), [SECRET], later, 5).ok).toBe(false);
  });

  it('rejects a timestamp too far in the future', () => {
    const earlier = new Date((TS - 301) * 1000);
    expect(verifyPaddleSignature(BODY, header(sign(SECRET)), [SECRET], earlier)).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    });
  });

  it('reports a missing header', () => {
    for (const missing of [undefined, '', '   ']) {
      expect(verifyPaddleSignature(BODY, missing, [SECRET], NOW)).toEqual({
        ok: false,
        reason: 'missing_signature',
      });
    }
  });

  it('reports malformed headers without throwing', () => {
    const malformed = [
      'garbage',
      `ts=${TS}`,
      `h1=${sign(SECRET)}`,
      `ts=abc;h1=${sign(SECRET)}`,
      `ts=-5;h1=${sign(SECRET)}`,
      `ts=${TS};h1=`,
      ';;;',
      '=;=',
    ];
    for (const h of malformed) {
      expect(verifyPaddleSignature(BODY, h, [SECRET], NOW)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('rejects non-hex and wrong-length h1 values as invalid', () => {
    for (const bad of ['zz'.repeat(32), 'abc', sign(SECRET).slice(2)]) {
      expect(verifyPaddleSignature(BODY, header(bad), [SECRET], NOW)).toEqual({
        ok: false,
        reason: 'invalid_signature',
      });
    }
  });

  it('tolerates whitespace around header parts and uppercase hex', () => {
    const h = ` ts=${TS} ; h1=${sign(SECRET).toUpperCase()} `;
    expect(verifyPaddleSignature(BODY, h, [SECRET], NOW).ok).toBe(true);
  });
});

describe('official @paddle/paddle-node-sdk cross-check', () => {
  const paddle = new Paddle('pdl_sdbx_apikey_test', { environment: Environment.sandbox });
  const body = JSON.stringify({
    event_id: 'evt_01k00000000000000000000001',
    event_type: 'customer.created',
    occurred_at: '2026-10-01T10:00:00.000000Z',
    notification_id: 'ntf_01k00000000000000000000001',
    data: { id: 'ctm_01k00000000000000000000001', status: 'active', email: 'a@example.com' },
  });

  it('SDK accepts a header we generate', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const h = `ts=${ts};h1=${sign(SECRET, ts, body)}`;
    const event = await paddle.webhooks.unmarshal(body, SECRET, h);
    expect(event.eventId).toBe('evt_01k00000000000000000000001');
  });

  it('we accept a header the SDK validates', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const h = `ts=${ts};h1=${sign(SECRET, ts, body)}`;
    expect(await paddle.webhooks.isSignatureValid(body, SECRET, h)).toBe(true);
    expect(verifyPaddleSignature(body, h, [SECRET], new Date()).ok).toBe(true);
  });

  it('SDK and ours both reject a tampered body', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const h = `ts=${ts};h1=${sign(SECRET, ts, body)}`;
    expect(await paddle.webhooks.isSignatureValid(`${body} `, SECRET, h)).toBe(false);
    expect(verifyPaddleSignature(`${body} `, h, [SECRET], new Date()).ok).toBe(false);
  });
});
