import { describe, expect, it } from 'vitest';
import { assertSeedAllowed } from './seed-guard';

describe('assertSeedAllowed', () => {
  it('allows localhost', () => {
    expect(() => assertSeedAllowed('postgresql://u@localhost:5432/db', {})).not.toThrow();
    expect(() => assertSeedAllowed('postgresql://u@127.0.0.1:5432/db', {})).not.toThrow();
  });

  it('refuses production even on localhost', () => {
    expect(() =>
      assertSeedAllowed('postgresql://u@localhost/db', { NODE_ENV: 'production' }),
    ).toThrow(/production/);
  });

  it('refuses remote hosts unless SEED_ALLOW_REMOTE=true', () => {
    const url = 'postgresql://u@db.example.supabase.co:5432/db';
    expect(() => assertSeedAllowed(url, {})).toThrow(/remote/);
    expect(() => assertSeedAllowed(url, { SEED_ALLOW_REMOTE: 'true' })).not.toThrow();
  });
});
