import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../signature-utils';
import { paddleAdapter } from './paddle-adapter';

const SECRET = 'pdl_ntfset_test_secret';
const NOW = new Date(1_780_000_000 * 1000);
const ts = 1_780_000_000;

const rawBody = Buffer.from(
  readFileSync(new URL('./fixtures/transaction-completed.json', import.meta.url), 'utf8'),
);
const signedHeader = (body: Buffer) =>
  `ts=${ts};h1=${hmacSha256Hex(SECRET, `${ts}:${body.toString('utf8')}`)}`;

describe('paddleAdapter', () => {
  it('verifies a webhook and returns the event id and time', async () => {
    const result = await paddleAdapter.verifyWebhook(
      { rawBody, headers: { 'Paddle-Signature': signedHeader(rawBody) }, receivedAt: NOW },
      [SECRET],
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      providerEventId: 'evt_01k00000000000000000000001',
      occurredAt: new Date('2026-10-01T10:00:06.123Z'),
    });
  });

  it('reports a missing header and a bad signature', async () => {
    expect(
      await paddleAdapter.verifyWebhook({ rawBody, headers: {}, receivedAt: NOW }, [SECRET], NOW),
    ).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
    const tampered = await paddleAdapter.verifyWebhook(
      {
        rawBody: Buffer.from('{}'),
        headers: { 'paddle-signature': signedHeader(rawBody) },
        receivedAt: NOW,
      },
      [SECRET],
      NOW,
    );
    expect(tampered).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('treats a validly signed non-envelope body as malformed', async () => {
    const body = Buffer.from('not json');
    const result = await paddleAdapter.verifyWebhook(
      { rawBody: body, headers: { 'paddle-signature': signedHeader(body) }, receivedAt: NOW },
      [SECRET],
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('declares honest capabilities', () => {
    expect(paddleAdapter.provider).toBe('paddle');
    expect(paddleAdapter.capabilities).toEqual({
      webhookVerification: 'supported_tested',
      eventNormalization: 'supported_tested',
      authoritativeFetch: 'implemented_unverified',
      credentialValidation: 'implemented_unverified',
      reconciliation: 'implemented_unverified',
      idMapping: 'unsupported',
    });
  });
});
