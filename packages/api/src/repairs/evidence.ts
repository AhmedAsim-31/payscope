import { z } from 'zod';

const evidenceSchema = z.record(z.string(), z.unknown());

export function evidenceString(evidence: unknown, key: string): string | undefined {
  const parsed = evidenceSchema.safeParse(evidence);
  const value = parsed.success ? parsed.data[key] : undefined;
  return typeof value === 'string' ? value : undefined;
}
