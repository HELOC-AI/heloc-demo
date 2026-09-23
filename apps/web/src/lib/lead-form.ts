import { leadInputSchema, type LeadFormValues, type LeadInput } from '@heloc/contracts';
import { parseMoney } from './money.ts';

export type LeadField = keyof LeadFormValues;

/** Field order on the quiz; also decides which invalid field gets focus first. */
export const LEAD_FIELDS = [
  'name',
  'email',
  'phone',
  'property_state',
  'estimated_home_value',
  'mortgage_balance',
  'credit_band',
  'income_band',
  'purpose',
] as const satisfies readonly LeadField[];

/** What the quiz holds while the Borrower types: every control is a string. */
export type LeadDraft = Record<LeadField, string>;

export type FieldErrors = Partial<Record<LeadField, string>>;

export const EMPTY_DRAFT: LeadDraft = {
  name: '',
  email: '',
  phone: '',
  property_state: '',
  estimated_home_value: '',
  mortgage_balance: '',
  credit_band: '',
  income_band: '',
  purpose: '',
};

/** Shown when a field is empty or holds a value of the wrong kind. */
const MISSING: Record<LeadField, string> = {
  name: 'Enter your full name',
  email: 'Enter your email address',
  phone: 'Enter your phone number',
  property_state: 'Select the state your home is in',
  estimated_home_value: "Enter your home's estimated value",
  mortgage_balance: 'Enter your mortgage balance (0 if paid off)',
  credit_band: 'Select your credit score range',
  income_band: 'Select your annual income range',
  purpose: 'Tell us how you plan to use the funds',
};

/** Converts the quiz's strings into the shape leadInputSchema expects. */
export function toFormValues(draft: LeadDraft): LeadFormValues {
  return {
    ...draft,
    estimated_home_value: parseMoney(draft.estimated_home_value),
    mortgage_balance: parseMoney(draft.mortgage_balance),
  } as LeadFormValues;
}

export type ValidationResult = { ok: true; input: LeadInput } | { ok: false; errors: FieldErrors };

/** Client-side validation with the published contract, with borrower-friendly messages. */
export function validateLead(draft: LeadDraft): ValidationResult {
  const result = leadInputSchema.safeParse(toFormValues(draft));
  if (result.success) return { ok: true, input: result.data };

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (!isLeadField(field) || errors[field]) continue;
    errors[field] = friendlyMessage(field, draft[field], issue.code, issue.message);
  }
  return { ok: false, errors };
}

/** Validates a single field, e.g. on blur. */
export function validateField(draft: LeadDraft, field: LeadField): string | undefined {
  const result = validateLead(draft);
  return result.ok ? undefined : result.errors[field];
}

function friendlyMessage(field: LeadField, raw: string, code: string, message: string): string {
  if (raw.trim() === '' || code === 'invalid_type' || code === 'invalid_value') {
    if (field === 'estimated_home_value' || field === 'mortgage_balance') {
      return raw.trim() === '' ? MISSING[field] : 'Enter a dollar amount, like 350,000';
    }
    return MISSING[field];
  }
  if (code === 'too_big') {
    return field === 'estimated_home_value' || field === 'mortgage_balance'
      ? 'Enter an amount under $100,000,000'
      : 'This is too long';
  }
  // The contract already carries friendly messages for format errors (email, phone, amounts).
  return message;
}

/**
 * Maps intake's 400 `details` ([{ path, message }]) onto quiz fields. Anything that does
 * not belong to a field is returned as `rest` for a form-level message.
 */
export function fieldErrorsFromDetails(details: unknown): { errors: FieldErrors; rest: string[] } {
  const errors: FieldErrors = {};
  const rest: string[] = [];
  if (!Array.isArray(details)) return { errors, rest };
  for (const detail of details as unknown[]) {
    if (typeof detail !== 'object' || detail === null) continue;
    const { path, message } = detail as { path?: unknown; message?: unknown };
    const text = typeof message === 'string' ? message : 'Invalid value';
    const field = typeof path === 'string' ? path.split('.')[0] : undefined;
    if (isLeadField(field)) errors[field] ??= text;
    else rest.push(text);
  }
  return { errors, rest };
}

function isLeadField(value: unknown): value is LeadField {
  return typeof value === 'string' && (LEAD_FIELDS as readonly string[]).includes(value);
}
