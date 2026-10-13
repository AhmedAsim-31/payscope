import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function globalSetup() {
  execFileSync(
    'pnpm',
    ['exec', 'tsx', '--env-file=../../.env.local', 'src/seed/seed-cli.ts', '--reset'],
    {
      cwd: fileURLToPath(new URL('../api', import.meta.url)),
      stdio: 'inherit',
    },
  );
}
