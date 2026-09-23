import { describe, expect, it } from 'vitest';
import { leadInputSchema, phoneSchema } from './lead.ts';

const valid = {
  name: 'John Doe',
  email: 'john@example.com',
  phone: '+14155551234',
  property_state: 'CA',
  estimated_home_value: 800000,
  mortgage_balance: 350000,
  credit_band: '700-739',
  income_band: '150k-200k',
  purpose: 'home_improvement',
};

describe('leadInputSchema', () => {
  it('accepts the example payload from the spec', () => {
    expect(leadInputSchema.parse(valid)).toEqual(valid);
  });

  it('allows a paid-off mortgage', () => {
    expect(leadInputSchema.safeParse({ ...valid, mortgage_balance: 0 }).success).toBe(true);
  });

  it.each([
    ['email', 'not-an-email'],
    ['property_state', 'XX'],
    ['credit_band', '700+'],
    ['estimated_home_value', 0],
    ['mortgage_balance', -1],
    ['name', '   '],
  ])('rejects invalid %s', (field, value) => {
    const result = leadInputSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });
});

describe('phoneSchema', () => {
  it.each([
    ['(415) 555-1234', '+14155551234'],
    ['415.555.1234', '+14155551234'],
    ['1 415 555 1234', '+14155551234'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('normalizes %s', (input, expected) => {
    expect(phoneSchema.parse(input)).toBe(expected);
  });

  it('rejects garbage', () => {
    expect(phoneSchema.safeParse('12345').success).toBe(false);
  });
});
