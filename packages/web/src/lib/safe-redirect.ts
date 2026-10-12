/** Accepts only same-origin relative paths; anything else (protocol-relative, absolute, backslash tricks) falls back. */
export function safeNextPath(next: string | null | undefined, fallback = '/app'): string {
  if (!next || !next.startsWith('/')) return fallback;
  if (next[1] === '/' || next[1] === '\\' || /\p{Cc}/u.test(next)) return fallback;
  return next;
}
