import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { pino } from 'pino';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import { sanitizeError } from './jobs/job-errors';
import { buildApp } from './app';
import { LOG_SERIALIZERS } from './logger';

const MARKER = 'leak-marker-value';

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

function logged(err: unknown): string {
  const out: string[] = [];
  const logger = pino({ serializers: LOG_SERIALIZERS }, { write: (m: string) => out.push(m) });
  logger.error({ err }, 'failed');
  return out.join('\n') + '\n' + sanitizeError(err);
}

function jsonParseError(): Error {
  try {
    JSON.parse(MARKER);
  } catch (err) {
    if (err instanceof Error) return err;
  }
  throw new Error('expected JSON.parse to throw');
}

describe('error serialization', () => {
  it('drops messages of errors not known to be safe, keeping type and code', () => {
    const raised = pgError('P0001', `balance mismatch for ${MARKER}`);
    for (const err of [raised, new DrizzleQueryError('select 1', [], raised), new Error(MARKER)]) {
      const text = logged(err);
      expect(text).not.toContain(MARKER);
    }
    expect(logged(raised)).toContain('P0001');
  });

  it('drops unsafe cause messages such as JSON.parse body snippets', () => {
    const err = new ProviderError('permanent', 'PayPal returned invalid JSON', {
      cause: jsonParseError(),
    });
    const text = logged(err);
    expect(text).toContain('PayPal returned invalid JSON');
    expect(text).toContain('SyntaxError');
    expect(text).not.toContain(MARKER);
  });

  it('keeps messages of allow-listed SQLSTATEs', () => {
    const text = logged(pgError('23505', 'duplicate key value violates unique constraint "u"'));
    expect(text).toContain('violates unique constraint');
  });
});

describe('request serialization', () => {
  it('does not log query strings', async () => {
    const lines: string[] = [];
    const app = await buildApp({ logStream: { write: (m: string) => lines.push(m) } });
    await app.inject({ method: 'GET', url: '/healthz?q=jane%40example.com' });
    await app.close();
    const text = lines.join('');
    expect(text).toContain('incoming request');
    expect(text).not.toContain('example.com');
  });
});
