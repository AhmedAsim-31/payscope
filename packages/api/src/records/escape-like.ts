/** Escapes LIKE wildcards so user text matches literally under the default backslash escape. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
