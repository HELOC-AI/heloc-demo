/** Lenders let a borrower draw up to 85% of the home's value, minus what they still owe. */
export const MAX_COMBINED_LTV = 0.85;
/** Smallest line Figure offers; below this the Lead is rejected for insufficient equity. */
export const MIN_LINE = 25_000;

/**
 * Parses what a borrower typed into a money field ("800,000", "$1,250,000.50", " 0 ")
 * into a number. Returns undefined for an empty field and NaN for anything unparseable,
 * so schema validation can tell "missing" from "invalid".
 */
export function parseMoney(raw: string): number | undefined {
  const cleaned = raw.replace(/[\s$,]/g, '');
  if (cleaned === '') return undefined;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/** Keeps only characters that can appear in a dollar amount while the borrower types. */
export function sanitizeMoneyInput(raw: string): string {
  return raw.replace(/[^\d,.]/g, '');
}

/** Re-renders a typed amount with thousands separators ("800000" → "800,000"). */
export function formatMoneyInput(raw: string): string {
  const value = parseMoney(raw);
  if (value === undefined || Number.isNaN(value)) return raw;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

/**
 * Equity a HELOC could draw on, per the same rule underwriting uses:
 * 0.85 × home value − mortgage balance. Undefined until both amounts are usable.
 */
export function availableEquity(homeValue?: number, mortgageBalance?: number): number | undefined {
  if (homeValue === undefined || mortgageBalance === undefined) return undefined;
  if (!Number.isFinite(homeValue) || !Number.isFinite(mortgageBalance)) return undefined;
  if (homeValue <= 0 || mortgageBalance < 0) return undefined;
  return homeValue * MAX_COMBINED_LTV - mortgageBalance;
}
