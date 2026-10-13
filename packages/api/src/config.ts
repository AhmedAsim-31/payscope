import { z } from 'zod';
import { decodeCredentialsKey } from './crypto/credentials-cipher';

const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    SUPABASE_URL: z.url(),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    SUPABASE_JWKS_URL: z.url().optional(),
    CORS_ORIGIN: z.string().min(1).optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CREDENTIALS_ENCRYPTION_KEY: z
      .string()
      .refine((v) => decodeCredentialsKey(v) !== undefined, {
        error: 'must be base64 that decodes to 32 bytes',
      })
      .optional(),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.CORS_ORIGIN !== undefined, {
    path: ['CORS_ORIGIN'],
    error: 'required in production',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.CREDENTIALS_ENCRYPTION_KEY !== undefined, {
    path: ['CREDENTIALS_ENCRYPTION_KEY'],
    error: 'required in production',
  });

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  corsOrigins: string[];
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  trustProxy: boolean;
  supabaseUrl: string;
  jwksUrl: string;
  jwtIssuer: string;
  jwtAudience: string;
  databaseUrl: string;
  dbPoolMax: number;
  credentialsKey: Buffer | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Invalid environment configuration: ${keys.join(', ')}`);
  }
  const e = result.data;
  const supabaseBase = e.SUPABASE_URL.replace(/\/+$/, '');
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
    supabaseUrl: supabaseBase,
    jwksUrl: e.SUPABASE_JWKS_URL ?? `${supabaseBase}/auth/v1/.well-known/jwks.json`,
    jwtIssuer: `${supabaseBase}/auth/v1`,
    jwtAudience: 'authenticated',
    databaseUrl: e.DATABASE_URL,
    dbPoolMax: e.DB_POOL_MAX,
    credentialsKey: e.CREDENTIALS_ENCRYPTION_KEY
      ? decodeCredentialsKey(e.CREDENTIALS_ENCRYPTION_KEY)
      : undefined,
  };
}
