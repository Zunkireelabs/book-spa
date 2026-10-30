import { describe, it, expect } from 'vitest';
import { toCsv } from './csvExport';

describe('toCsv', () => {
  it('quotes commas, quotes and newlines, and leaves blanks empty', () => {
    expect(toCsv([['Branch', 'Sales'], ['Lazimpat, Kathmandu', 100], ['He said "hi"', null]])).toBe('Branch,Sales\r\n"Lazimpat, Kathmandu",100\r\n"He said ""hi""",');
  });
});
