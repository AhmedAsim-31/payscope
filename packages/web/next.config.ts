import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import { buildSecurityHeaders } from './src/lib/security-headers';

// The single env file lives at the repo root; existing process env still wins.
const rootEnvFile = resolve(process.cwd(), '../../.env.local');
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  transpilePackages: ['@payscope/shared'],
  headers() {
    const headers = buildSecurityHeaders({
      apiUrl: process.env.NEXT_PUBLIC_API_URL ?? '',
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      isProd: process.env.NODE_ENV === 'production',
    });
    return Promise.resolve([{ source: '/:path*', headers }]);
  },
};

export default nextConfig;
