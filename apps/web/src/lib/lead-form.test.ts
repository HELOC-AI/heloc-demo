import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  fieldErrorsFromDetails,
  validateField,
  validateLead,
  type LeadDraft,
} from './lead-form.ts';

const valid: LeadDraft = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '(415) 555-1234',
  property_state: 'CA',
  estimated_home_value: '800,000',
  mortgage_balance: '350,000',
  credit_band: '700-739',
  income_band: '150k-200k',
  purpose: 'home_improvement',
};

describe('validateLead', () => {
  it('produces the LeadInput intake expects', () => {
    expect(validateLead(valid)).toEqual({
      ok: true,
      input: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+14155551234',
        property_state: 'CA',
        estimated_home_value: 800_000,
        mortgage_balance: 350_000,
        credit_band: '700-739',
        income_band: '150k-200k',
        purpose: 'home_improvement',
      },
    });
  });

  it('accepts a paid-off home', () => {
    expect(validateLead({ ...valid, mortgage_balance: '0' }).ok).toBe(true);
  });

  it('asks for every field of an empty quiz with friendly messages', () => {
    const result = validateLead(EMPTY_DRAFT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      name: 'Enter your full name',
      email: 'Enter your email address',
      phone: 'Enter your phone number',
      property_state: 'Select the state your home is in',
      estimated_home_value: "Enter your home's estimated value",
      mortgage_balance: 'Enter your mortgage balance (0 if paid off)',
      credit_band: 'Select your credit score range',
      income_band: 'Select your annual income range',
      purpose: 'Tell us how you plan to use the funds',
    });
  });

  it.each([
    ['email', 'jane@', 'Enter a valid email'],
    ['phone', '12345', 'Enter a valid phone number'],
    ['estimated_home_value', '0', 'Home value must be greater than 0'],
    ['estimated_home_value', '1.2.3', 'Enter a dollar amount, like 350,000'],
    ['mortgage_balance', '200,000,000', 'Enter an amount under $100,000,000'],
    ['property_state', 'XX', 'Select the state your home is in'],
  ] as const)('reports an invalid %s', (field, value, message) => {
    expect(validateField({ ...valid, [field]: value }, field)).toBe(message);
  });

  it('reports nothing for a valid field while others are still empty', () => {
    expect(validateField({ ...EMPTY_DRAFT, email: 'jane@example.com' }, 'email')).toBeUndefined();
  });
});

describe('fieldErrorsFromDetails', () => {
  it('maps intake validation details onto quiz fields', () => {
    expect(
      fieldErrorsFromDetails([
        { path: 'email', message: 'Enter a valid email' },
        { path: 'email', message: 'second message is ignored' },
        { path: 'phone', message: 'Enter a valid phone number' },
        { path: '', message: 'Body must be an object' },
      ]),
    ).toEqual({
      errors: { email: 'Enter a valid email', phone: 'Enter a valid phone number' },
      rest: ['Body must be an object'],
    });
  });

  it('tolerates a malformed body', () => {
    expect(fieldErrorsFromDetails(undefined)).toEqual({ errors: {}, rest: [] });
    expect(fieldErrorsFromDetails([null, 42])).toEqual({ errors: {}, rest: [] });
  });
});
