import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      port: 3001,
      host: '0.0.0.0',
      corsOrigins: ['http://localhost:3000'],
      logLevel: 'info',
      trustProxy: false,
    });
  });

  it('parses overrides', () => {
    const config = loadConfig({
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
    expect(() => loadConfig({ API_PORT: 'not-a-port' })).toThrow(/API_PORT/);
    expect(() => loadConfig({ API_PORT: 'not-a-port' })).not.toThrow(/not-a-port/);
  });

  it('requires CORS_ORIGIN in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGIN/);
  });
});
