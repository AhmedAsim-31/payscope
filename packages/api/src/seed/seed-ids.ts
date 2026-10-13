import { createHash } from 'node:crypto';

const NAMESPACE = Buffer.from('6f3a1c0e5b7d4e2a9c8b1d0e4f5a6b7c', 'hex');

/** UUID v5 so every demo row id is stable across runs and machines. */
export function demoId(name: string): string {
  const hash = createHash('sha1').update(NAMESPACE).update(`payscope-demo:${name}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
