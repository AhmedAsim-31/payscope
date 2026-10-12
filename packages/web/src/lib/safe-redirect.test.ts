import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it.each(['/app', '/app/settings?tab=1', '/a#b'])('keeps relative path %s', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    '//evil.com',
    'https://evil.com',
    'http://evil.com/app',
    '/\\evil.com',
    '\\\\evil.com',
    '/\t/evil.com',
    'app',
    'javascript:alert(1)',
    '',
    null,
    undefined,
  ])('falls back for %j', (value) => {
    expect(safeNextPath(value)).toBe('/app');
  });

  it('uses a custom fallback', () => {
    expect(safeNextPath('//x', '/home')).toBe('/home');
  });
});
