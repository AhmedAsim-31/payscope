import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker-main.ts'],
  format: 'esm',
  fixedExtension: false,
  platform: 'node',
  target: 'node24',
  deps: { alwaysBundle: [/^@payscope\//] },
});
