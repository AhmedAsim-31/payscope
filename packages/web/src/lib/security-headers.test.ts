import { describe, expect, it } from 'vitest';
import { buildSecurityHeaders } from './security-headers';

const origins = {
  apiUrl: 'https://api.example.test/v1',
  supabaseUrl: 'https://abc.supabase.example',
};

function headerMap(isProd: boolean) {
  return Object.fromEntries(
    buildSecurityHeaders({ ...origins, isProd }).map((h) => [h.key, h.value]),
  );
}

describe('buildSecurityHeaders', () => {
  it('sets the baseline browser hardening headers', () => {
    const h = headerMap(true);
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toContain('camera=()');
  });

  it('limits connect-src to self, the API and Supabase', () => {
    const csp = headerMap(true)['Content-Security-Policy'];
    expect(csp).toContain(
      "connect-src 'self' https://api.example.test https://abc.supabase.example wss://abc.supabase.example",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('sends HSTS only in production and allows eval only in development', () => {
    expect(headerMap(true)['Strict-Transport-Security']).toContain('max-age=');
    expect(headerMap(false)['Strict-Transport-Security']).toBeUndefined();
    expect(headerMap(false)['Content-Security-Policy']).toContain("'unsafe-eval'");
  });
});
