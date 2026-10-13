import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

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
    });
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
});
