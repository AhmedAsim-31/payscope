import { describe, expect, it } from 'vitest';
import { parsePublicEnv } from './env';

const valid = {
  NEXT_PUBLIC_API_URL: 'http://localhost:3001',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
};

describe('parsePublicEnv', () => {
  it('parses a valid environment', () => {
    expect(parsePublicEnv(valid)).toEqual(valid);
  });

  it('throws when a URL is invalid', () => {
    expect(() => parsePublicEnv({ ...valid, NEXT_PUBLIC_API_URL: 'not-a-url' })).toThrow();
  });

  it('throws when the publishable key is missing', () => {
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }),
    ).toThrow();
  });
});
