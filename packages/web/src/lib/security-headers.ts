type Header = { key: string; value: string };

type Options = { apiUrl: string; supabaseUrl: string; isProd: boolean };

/** Next's inline bootstrap scripts need 'unsafe-inline' without nonces; dev React needs eval. */
export function buildSecurityHeaders({ apiUrl, supabaseUrl, isProd }: Options): Header[] {
  const api = new URL(apiUrl).origin;
  const supabase = new URL(supabaseUrl).origin;
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api} ${supabase} ${supabase.replace(/^http/, 'ws')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  const headers: Header[] = [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
  if (isProd) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains',
    });
  }
  return headers;
}
