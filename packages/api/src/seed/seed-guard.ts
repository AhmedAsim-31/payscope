export type SeedGuardEnv = {
  NODE_ENV?: string | undefined;
  SEED_ALLOW_REMOTE?: string | undefined;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function assertSeedAllowed(databaseUrl: string, env: SeedGuardEnv): void {
  if (env.NODE_ENV === 'production') throw new Error('refusing to seed when NODE_ENV=production');
  const host = new URL(databaseUrl).hostname;
  if (!LOCAL_HOSTS.has(host) && env.SEED_ALLOW_REMOTE !== 'true') {
    throw new Error(`refusing to seed remote host ${host}; set SEED_ALLOW_REMOTE=true to override`);
  }
}
