import { z } from 'zod';

const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    CORS_ORIGIN: z.string().min(1).optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.CORS_ORIGIN !== undefined, {
    path: ['CORS_ORIGIN'],
    error: 'required in production',
  });

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  corsOrigins: string[];
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  trustProxy: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Invalid environment configuration: ${keys.join(', ')}`);
  }
  const e = result.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.API_PORT,
    host: e.API_HOST,
    corsOrigins: (e.CORS_ORIGIN ?? DEFAULT_CORS_ORIGIN)
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
  };
}
