import { describe, expect, it } from 'vitest';
import {
  formatAprRange,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatTerm,
  formatTime,
  formatUsd,
} from './format.ts';

const UTC = { timeZone: 'UTC' };

describe('formatUsd', () => {
  it('formats whole dollars', () => {
    expect(formatUsd(250_000)).toBe('$250,000');
    expect(formatUsd(2_967.6)).toBe('$2,968');
    expect(formatUsd(0)).toBe('$0');
  });
});

describe('formatAprRange', () => {
  it('shows both ends with two decimals', () => {
    expect(formatAprRange(7.5, 9.5)).toBe('7.50% – 9.50%');
  });

  it('collapses a single rate', () => {
    expect(formatAprRange(8.25, 8.25)).toBe('8.25%');
  });
});

describe('formatTerm', () => {
  it.each([
    [120, '10 years'],
    [360, '30 years'],
    [12, '1 year'],
    [18, '18 months'],
    [1, '1 month'],
  ])('%i months → %s', (months, expected) => {
    expect(formatTerm(months)).toBe(expected);
  });
});

describe('formatFileSize', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [812, '812 bytes'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [48_300, '47 KB'],
    [2_400_000, '2.3 MB'],
    [15 * 1024 * 1024, '15 MB'],
    [3 * 1024 ** 3, '3 GB'],
    [5 * 1024 ** 4, '5120 GB'],
  ])('%i bytes → %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });

  it('never shows a negative or non-finite size', () => {
    expect(formatFileSize(-5)).toBe('0 bytes');
    expect(formatFileSize(Number.NaN)).toBe('0 bytes');
  });
});

describe('dates', () => {
  const iso = '2026-10-23T15:04:05.000Z';

  it('formats a date', () => {
    expect(formatDate(iso, UTC)).toBe('October 23, 2026');
  });

  it('formats a date and time', () => {
    expect(formatDateTime(iso, UTC)).toBe('Oct 23, 2026, 3:04 PM');
  });

  it('formats a time with seconds', () => {
    expect(formatTime(iso, UTC)).toBe('3:04:05 PM');
  });
});
