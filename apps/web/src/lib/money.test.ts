import { describe, expect, it } from 'vitest';
import { availableEquity, formatMoneyInput, parseMoney, sanitizeMoneyInput } from './money.ts';

describe('parseMoney', () => {
  it.each([
    ['800,000', 800_000],
    ['800000', 800_000],
    ['$1,250,000', 1_250_000],
    [' 0 ', 0],
    ['350,000.50', 350_000.5],
  ])('parses %j', (raw, expected) => {
    expect(parseMoney(raw)).toBe(expected);
  });

  it('treats an empty field as missing', () => {
    expect(parseMoney('')).toBeUndefined();
    expect(parseMoney('  ')).toBeUndefined();
  });

  it.each(['abc', '1.2.3', '-5', '12.345'])('flags %j as invalid', (raw) => {
    expect(parseMoney(raw)).toBeNaN();
  });
});

describe('sanitizeMoneyInput', () => {
  it('drops anything that cannot be part of an amount', () => {
    expect(sanitizeMoneyInput('$800,000abc')).toBe('800,000');
    expect(sanitizeMoneyInput('-12.5')).toBe('12.5');
  });
});

describe('formatMoneyInput', () => {
  it('adds thousands separators', () => {
    expect(formatMoneyInput('800000')).toBe('800,000');
    expect(formatMoneyInput('1250000.5')).toBe('1,250,000.5');
  });

  it('leaves empty or unparseable input untouched', () => {
    expect(formatMoneyInput('')).toBe('');
    expect(formatMoneyInput('1.2.3')).toBe('1.2.3');
  });
});

describe('availableEquity', () => {
  it('is 85% of the home value minus the mortgage balance', () => {
    expect(availableEquity(800_000, 350_000)).toBe(330_000);
    expect(availableEquity(500_000, 0)).toBe(425_000);
  });

  it('can be negative when the Borrower owes more than 85%', () => {
    expect(availableEquity(400_000, 380_000)).toBe(-40_000);
  });

  it('is unknown until both amounts are usable', () => {
    expect(availableEquity(undefined, 1)).toBeUndefined();
    expect(availableEquity(800_000, undefined)).toBeUndefined();
    expect(availableEquity(Number.NaN, 0)).toBeUndefined();
    expect(availableEquity(0, 0)).toBeUndefined();
  });
});
