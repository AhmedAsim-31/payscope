import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const SUPABASE_URL = 'https://abc.supabase.co';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({ SUPABASE_URL })).toEqual({
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
    });
  });

  it('parses overrides', () => {
    const config = loadConfig({
      SUPABASE_URL,
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
    expect(() => loadConfig({ SUPABASE_URL, API_PORT: 'not-a-port' })).toThrow(/API_PORT/);
    expect(() => loadConfig({ SUPABASE_URL, API_PORT: 'not-a-port' })).not.toThrow(/not-a-port/);
  });

  it('requires CORS_ORIGIN in production', () => {
    expect(() => loadConfig({ SUPABASE_URL, NODE_ENV: 'production' })).toThrow(/CORS_ORIGIN/);
  });

  it('requires SUPABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/SUPABASE_URL/);
  });

  it('honours a SUPABASE_JWKS_URL override and trims a trailing slash', () => {
    const config = loadConfig({
      SUPABASE_URL: `${SUPABASE_URL}/`,
      SUPABASE_JWKS_URL: 'http://localhost:9999/jwks.json',
    });
    expect(config.jwksUrl).toBe('http://localhost:9999/jwks.json');
    expect(config.jwtIssuer).toBe(`${SUPABASE_URL}/auth/v1`);
  });
});
