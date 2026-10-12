export function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}
