import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('writes a header row and CRLF-terminated rows', () => {
    expect(toCsv(['a', 'b'], [['1', null]])).toBe('a,b\r\n1,\r\n');
  });

  it('quotes delimiters, quotes and line breaks', () => {
    expect(toCsv(['x'], [['a,b'], ['say "hi"'], ['l1\nl2']])).toBe(
      'x\r\n"a,b"\r\n"say ""hi"""\r\n"l1\nl2"\r\n',
    );
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)'])('prefixes formula cell %j with a quote', (cell) => {
    expect(toCsv(['x'], [[cell]])).toBe(`x\r\n'${cell}\r\n`);
  });

  it('prefixes and quotes cells starting with a tab or carriage return', () => {
    expect(toCsv(['x'], [['\tcmd'], ['\rcmd']])).toBe(`x\r\n'\tcmd\r\n"'\rcmd"\r\n`);
  });
});
