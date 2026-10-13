import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { DEFAULT_POLICIES } from './rate-limit/policies';
import { DEFAULT_RETENTION_POLICY } from './retention/retention-prune';

const SUPABASE_URL = 'https://abc.supabase.co';
const DATABASE_URL = 'postgresql://postgres@localhost:5432/payscope';
const BASE = { SUPABASE_URL, DATABASE_URL };

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(BASE)).toEqual({
      nodeEnv: 'development',
      port: 3001,
      host: '0.0.0.0',
      corsOrigins: ['http://localhost:3000'],
      logLevel: 'info',
      trustProxy: false,
      supabaseUrl: SUPABASE_URL,
      jwksUrl: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      jwtIssuer: `${SUPABASE_URL}/auth/v1`,
      jwtAudience: 'authenticated',
      databaseUrl: DATABASE_URL,
      dbPoolMax: 10,
      credentialsKeyVersion: 1,
      credentialsPreviousKeys: new Map(),
      runWorkerInProcess: true,
      reconciliationIntervalHours: 24,
      retention: DEFAULT_RETENTION_POLICY,
      rateLimits: DEFAULT_POLICIES,
    });
  });

  it('applies rate limit overrides and names bad keys', () => {
    const config = loadConfig({ ...BASE, RATE_LIMIT_CREDENTIAL_TEST_MAX: '2' });
    expect(config.rateLimits.credentialTest).toEqual({ max: 2, windowSec: 60 });
    expect(() => loadConfig({ ...BASE, RATE_LIMIT_SEARCH_WINDOW_SEC: '0' })).toThrow(
      /RATE_LIMIT_SEARCH_WINDOW_SEC/,
    );
  });

  it('parses overrides', () => {
    const config = loadConfig({
      ...BASE,
      API_PORT: '8080',
      CORS_ORIGIN: 'https://a.test, https://b.test',
      TRUST_PROXY: 'true',
      LOG_LEVEL: 'debug',
    });
    expect(config).toMatchObject({
      port: 8080,
      corsOrigins: ['https://a.test', 'https://b.test'],
      trustProxy: true,
      logLevel: 'debug',
    });
  });

  it('rejects a bad API_PORT and names the key without the value', () => {
    expect(() => loadConfig({ ...BASE, API_PORT: 'not-a-port' })).toThrow(/API_PORT/);
    expect(() => loadConfig({ ...BASE, API_PORT: 'not-a-port' })).not.toThrow(/not-a-port/);
  });

  it('requires CORS_ORIGIN in production', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production' })).toThrow(/CORS_ORIGIN/);
  });

  it('requires SUPABASE_URL', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/SUPABASE_URL/);
  });

  it('requires a postgres DATABASE_URL', () => {
    expect(() => loadConfig({ SUPABASE_URL })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ SUPABASE_URL, DATABASE_URL: 'http://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('parses DB_POOL_MAX and rejects a non-integer', () => {
    expect(loadConfig({ ...BASE, DB_POOL_MAX: '4' }).dbPoolMax).toBe(4);
    expect(() => loadConfig({ ...BASE, DB_POOL_MAX: 'x' })).toThrow(/DB_POOL_MAX/);
  });

  it('honours a SUPABASE_JWKS_URL override and trims a trailing slash', () => {
    const config = loadConfig({
      ...BASE,
      SUPABASE_URL: `${SUPABASE_URL}/`,
      SUPABASE_JWKS_URL: 'http://localhost:9999/jwks.json',
    });
    expect(config.jwksUrl).toBe('http://localhost:9999/jwks.json');
    expect(config.jwtIssuer).toBe(`${SUPABASE_URL}/auth/v1`);
  });

  it('validates CREDENTIALS_ENCRYPTION_KEY length and requires it in production', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(loadConfig({ ...BASE, CREDENTIALS_ENCRYPTION_KEY: key }).credentialsKey).toHaveLength(
      32,
    );
    expect(() =>
      loadConfig({ ...BASE, CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    const prod = { ...BASE, NODE_ENV: 'production', CORS_ORIGIN: 'https://a.test' };
    expect(() => loadConfig(prod)).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    expect(loadConfig({ ...prod, CREDENTIALS_ENCRYPTION_KEY: key }).credentialsKey).toBeDefined();
  });

  it('parses previous credential keys and rejects bad or conflicting entries', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const old = Buffer.alloc(32, 3).toString('base64');
    const rotated = {
      ...BASE,
      CREDENTIALS_ENCRYPTION_KEY: key,
      CREDENTIALS_ENCRYPTION_KEY_VERSION: '2',
    };
    const config = loadConfig({ ...rotated, CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS: `1:${old}` });
    expect(config.credentialsKeyVersion).toBe(2);
    expect([...config.credentialsPreviousKeys.keys()]).toEqual([1]);
    expect(() =>
      loadConfig({ ...rotated, CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS: `2:${old}` }),
    ).toThrow(/CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS/);
    expect(() => loadConfig({ ...rotated, CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS: old })).toThrow(
      /CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS/,
    );
  });

  it('parses worker settings and rejects a short tick token', () => {
    const config = loadConfig({
      ...BASE,
      RUN_WORKER_IN_PROCESS: 'false',
      INTERNAL_TICK_TOKEN: 'a'.repeat(16),
    });
    expect(config.runWorkerInProcess).toBe(false);
    expect(config.internalTickToken).toBe('a'.repeat(16));
    expect(
      loadConfig({ ...BASE, RECONCILIATION_SCHEDULE_INTERVAL_HOURS: '0' })
        .reconciliationIntervalHours,
    ).toBe(0);
    expect(() => loadConfig({ ...BASE, RECONCILIATION_SCHEDULE_INTERVAL_HOURS: '-1' })).toThrow(
      /RECONCILIATION_SCHEDULE_INTERVAL_HOURS/,
    );
    expect(() => loadConfig({ ...BASE, INTERNAL_TICK_TOKEN: 'short' })).toThrow(
      /INTERNAL_TICK_TOKEN/,
    );
  });

  it('reads retention periods, with 0 keeping rows forever', () => {
    const config = loadConfig({
      ...BASE,
      RETENTION_AUDIT_LOG_DAYS: '0',
      RETENTION_EVENT_PAYLOAD_DAYS: '7',
    });
    expect(config.retention).toMatchObject({ auditLogDays: 0, eventPayloadDays: 7 });
    expect(() => loadConfig({ ...BASE, RETENTION_FINISHED_JOB_DAYS: '-1' })).toThrow(
      /RETENTION_FINISHED_JOB_DAYS/,
    );
  });
});
