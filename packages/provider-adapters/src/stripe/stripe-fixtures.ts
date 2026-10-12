import { readFileSync } from 'node:fs';

export function loadStripeFixture(name: string): Record<string, unknown> {
  const text = readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}
