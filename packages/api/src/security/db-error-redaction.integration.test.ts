import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { sanitizeError } from '../jobs/job-errors';
import { LOG_SERIALIZERS } from '../logger';
import { createHarness } from '../test/identity-harness';

const DUP_MARKER = 'dup-marker@example.test';
const CAST_MARKER = 'cast-marker-value';
const harness = createHarness();
const lines: string[] = [];
let app: FastifyInstance;

async function caught(run: () => Promise<unknown>): Promise<Error> {
  const err = await run().then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof Error)) throw new Error('expected a database error');
  return err;
}

const uniqueViolation = () =>
  caught(() =>
    harness.db.transaction(async (tx) => {
      await tx.execute(sql`create temp table redaction_probe (email text unique) on commit drop`);
      await tx.execute(sql`insert into redaction_probe values (${DUP_MARKER})`);
      await tx.execute(sql`insert into redaction_probe values (${DUP_MARKER})`);
    }),
  );
const castFailure = () => caught(() => harness.db.execute(sql`select ${CAST_MARKER}::uuid`));

beforeAll(async () => {
  app = await harness.start({
    logger: undefined,
    logLevel: 'trace',
    logStream: { write: (msg) => lines.push(msg) },
  });
  app.get('/__probe/unique', async () => {
    throw await uniqueViolation();
  });
  app.get('/__probe/cast', async () => {
    throw await castFailure();
  });
});
afterAll(() => harness.stop());

describe('database error redaction', () => {
  it('keeps input values out of worker logs and stored job errors', async () => {
    const out: string[] = [];
    const logger = pino({ serializers: LOG_SERIALIZERS }, { write: (m: string) => out.push(m) });
    for (const err of [await uniqueViolation(), await castFailure()]) {
      logger.error({ err }, 'job_failed');
      out.push(sanitizeError(err));
    }
    const text = out.join('\n');
    expect(text).toContain('23505');
    expect(text).toContain('22P02');
    expect(text).not.toContain(DUP_MARKER);
    expect(text).not.toContain(CAST_MARKER);
  });

  it('keeps input values out of API logs and responses', async () => {
    for (const url of ['/__probe/unique', '/__probe/cast']) {
      const res = await app.inject({ url });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
      expect(res.body).not.toMatch(/marker/);
    }
    const logs = lines.join('\n');
    expect(logs).toContain('request failed');
    expect(logs).not.toContain(DUP_MARKER);
    expect(logs).not.toContain(CAST_MARKER);
  });
});
