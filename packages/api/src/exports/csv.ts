const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function cell(value: string | null): string {
  if (value === null) return '';
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** RFC 4180 with CRLF rows; formula-leading cells get a quote prefix so spreadsheets treat them as text. */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | null)[])[]) {
  return [header, ...rows].map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}
