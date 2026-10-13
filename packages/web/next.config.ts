import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// The single env file lives at the repo root; existing process env still wins.
const rootEnvFile = resolve(process.cwd(), '../../.env.local');
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  transpilePackages: ['@payscope/shared'],
};

export default nextConfig;
