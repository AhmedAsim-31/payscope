import { describe, expect, it } from 'vitest';
import { REDACTED, redactPayload } from './event-redaction';

describe('redactPayload', () => {
  it('masks sensitive keys at any depth and emails inside text', () => {
    const out = redactPayload({
      id: 'evt_1',
      data: { object: { receipt_email: 'a@b.test', card: { last4: '4242' }, note: 'mail x@y.io' } },
      list: [{ api_token: 't', amount: 5 }],
    });
    expect(out).toEqual({
      id: 'evt_1',
      data: { object: { receipt_email: REDACTED, card: REDACTED, note: `mail ${REDACTED}` } },
      list: [{ api_token: REDACTED, amount: 5 }],
    });
  });

  it('caps depth and total size', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 20; i++) deep = { k: deep };
    expect(JSON.stringify(redactPayload(deep))).toContain('[MAX_DEPTH]');
    const big = { rows: Array.from({ length: 5000 }, (_, i) => ({ v: `value-${i}-padding` })) };
    expect(redactPayload(big)).toMatchObject({ truncated: true });
  });
});
