import type { JobLogger } from './worker';

export function createJsonLogger(): JobLogger {
  const write = (level: string) => (obj: object, msg?: string) => {
    process.stdout.write(`${JSON.stringify({ level, time: Date.now(), ...obj, msg })}\n`);
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}
