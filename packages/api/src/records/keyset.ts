import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { ApiHttpError } from '../http-error';

const cursorSchema = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  i: z.uuid(),
});

export type KeysetRow = { id: string; cursorTs: string };

/** Microsecond-exact text form, so the cursor never loses precision through a JS Date. */
export function cursorTsColumn(column: AnyColumn): SQL<string> {
  return sql<string>`to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

function invalidCursor() {
  return new ApiHttpError(400, 'INVALID_CURSOR', 'Cursor is invalid');
}

export function keysetAfter(
  createdAt: AnyColumn,
  id: AnyColumn,
  cursor: string | undefined,
): SQL | undefined {
  if (cursor === undefined) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const parsed = cursorSchema.safeParse(decoded);
  if (!parsed.success) throw invalidCursor();
  return sql`(${createdAt}, ${id}) < (${parsed.data.t}::timestamptz, ${parsed.data.i}::uuid)`;
}

/** Callers fetch limit + 1 rows; the extra row signals another page. */
export function toPage<R extends KeysetRow, T>(rows: R[], limit: number, map: (row: R) => T) {
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? Buffer.from(JSON.stringify({ t: last.cursorTs, i: last.id })).toString('base64url')
      : null;
  return { items: visible.map(map), nextCursor };
}

export function iso(date: Date): string {
  return date.toISOString();
}

export function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}
