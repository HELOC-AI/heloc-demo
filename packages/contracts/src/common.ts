export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
] as const; // prettier-ignore
export type UsState = (typeof US_STATES)[number];

/** Ordered from lowest to highest. The figure mock compares bands by position. */
export const CREDIT_BANDS = [
  '<580',
  '580-619',
  '620-659',
  '660-699',
  '700-739',
  '740-779',
  '780+',
] as const;
export type CreditBand = (typeof CREDIT_BANDS)[number];

export const INCOME_BANDS = [
  '<50k',
  '50k-100k',
  '100k-150k',
  '150k-200k',
  '200k-300k',
  '300k+',
] as const;
export type IncomeBand = (typeof INCOME_BANDS)[number];

export const PURPOSES = [
  'home_improvement',
  'debt_consolidation',
  'education',
  'major_purchase',
  'emergency_fund',
  'other',
] as const;
export type Purpose = (typeof PURPOSES)[number];

/** HTTP headers shared across services (lower-case, as Node exposes them). */
export const HEADERS = {
  requestId: 'x-request-id',
  idempotencyKey: 'idempotency-key',
  mockOutcome: 'x-mock-outcome',
  mockFault: 'x-mock-fault',
} as const;
