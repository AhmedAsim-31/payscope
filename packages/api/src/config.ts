import { z } from 'zod';
import { decodeCredentialsKey, parsePreviousKeys } from './crypto/credentials-cipher';
import { DEFAULT_RETENTION_POLICY as R, type RetentionPolicy } from './retention/retention-prune';
import { rateLimitEnvSchema, resolvePolicies, type RatePolicies } from './rate-limit/policies';

const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';
export const DEFAULT_RECONCILIATION_INTERVAL_HOURS = 24;

const retentionDays = (fallback: number) =>
  z.coerce.number().int().min(0).max(36500).default(fallback);

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
    CREDENTIALS_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(255).default(1),
    CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS: z
      .string()
      .refine((v) => parsePreviousKeys(v) !== undefined, {
        error: 'must be comma-separated version:base64 entries with 32-byte keys',
      })
      .optional(),
    RUN_WORKER_IN_PROCESS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    INTERNAL_TICK_TOKEN: z.string().min(16).optional(),
    RECONCILIATION_SCHEDULE_INTERVAL_HOURS: z.coerce
      .number()
      .int()
      .min(0)
      .max(8760)
      .default(DEFAULT_RECONCILIATION_INTERVAL_HOURS),
    RETENTION_EVENT_PAYLOAD_DAYS: retentionDays(R.eventPayloadDays),
    RETENTION_FINISHED_JOB_DAYS: retentionDays(R.finishedJobDays),
    RETENTION_IDEMPOTENCY_GRACE_DAYS: retentionDays(R.idempotencyGraceDays),
    RETENTION_SCENARIO_RUN_DAYS: retentionDays(R.scenarioRunDays),
    RETENTION_AUDIT_LOG_DAYS: retentionDays(R.auditLogDays),
    TRUST_PROXY: z
      .string()
      .regex(/^(false|[1-9]\d?)$/, 'must be "false" or a proxy hop count from 1 to 99')
      .default('false')
      .transform((v) => (v === 'false' ? false : Number(v))),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.CORS_ORIGIN !== undefined, {
    path: ['CORS_ORIGIN'],
    error: 'required in production',
  })
  .refine(
    (env) =>
      !env.CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS ||
      !parsePreviousKeys(env.CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS)?.has(
        env.CREDENTIALS_ENCRYPTION_KEY_VERSION,
      ),
    {
      path: ['CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS'],
      error: 'must not contain the active key version',
    },
  )
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
  trustProxy: false | number;
  supabaseUrl: string;
  jwksUrl: string;
  jwtIssuer: string;
  jwtAudience: string;
  databaseUrl: string;
  dbPoolMax: number;
  credentialsKey: Buffer | undefined;
  credentialsKeyVersion: number;
  credentialsPreviousKeys: Map<number, Buffer>;
  runWorkerInProcess: boolean;
  internalTickToken: string | undefined;
  reconciliationIntervalHours: number;
  retention: RetentionPolicy;
  rateLimits: RatePolicies;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  const limits = rateLimitEnvSchema.safeParse(env);
  if (!result.success || !limits.success) {
    const issues = [...(result.error?.issues ?? []), ...(limits.error?.issues ?? [])];
    const keys = [...new Set(issues.map((i) => String(i.path[0])))];
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
    credentialsKeyVersion: e.CREDENTIALS_ENCRYPTION_KEY_VERSION,
    credentialsPreviousKeys: e.CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS
      ? (parsePreviousKeys(e.CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS) ?? new Map<number, Buffer>())
      : new Map<number, Buffer>(),
    runWorkerInProcess: e.RUN_WORKER_IN_PROCESS,
    internalTickToken: e.INTERNAL_TICK_TOKEN,
    reconciliationIntervalHours: e.RECONCILIATION_SCHEDULE_INTERVAL_HOURS,
    retention: {
      eventPayloadDays: e.RETENTION_EVENT_PAYLOAD_DAYS,
      finishedJobDays: e.RETENTION_FINISHED_JOB_DAYS,
      idempotencyGraceDays: e.RETENTION_IDEMPOTENCY_GRACE_DAYS,
      scenarioRunDays: e.RETENTION_SCENARIO_RUN_DAYS,
      auditLogDays: e.RETENTION_AUDIT_LOG_DAYS,
    },
    rateLimits: resolvePolicies(limits.data),
  };
}
