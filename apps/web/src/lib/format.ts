/** Display formatting for borrower-facing numbers and dates (en-US, USD). */

export interface FormatOptions {
  /** IANA zone; defaults to the browser's. Tests pin it for determinism. */
  timeZone?: string;
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const rate = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** $250,000 (whole dollars; cents are rounded). */
export function formatUsd(amount: number): string {
  return usd.format(amount);
}

/** "7.50% – 9.50%", or a single rate when both ends match. */
export function formatAprRange(min: number, max: number): string {
  const low = `${rate.format(min)}%`;
  return min === max ? low : `${low} – ${rate.format(max)}%`;
}

/** 360 → "30 years", 18 → "18 months", 12 → "1 year". */
export function formatTerm(months: number): string {
  if (months > 0 && months % 12 === 0) {
    const years = months / 12;
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }
  return `${months} ${months === 1 ? 'month' : 'months'}`;
}

/** "October 23, 2026" */
export function formatDate(iso: string, { timeZone }: FormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone }).format(new Date(iso));
}

/** "Sep 23, 2026, 3:04 PM" */
export function formatDateTime(iso: string, { timeZone }: FormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
}

/** "3:04:05 PM" (Lead Events happen seconds apart). */
export function formatTime(iso: string, { timeZone }: FormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-US', { timeStyle: 'medium', timeZone }).format(new Date(iso));
}
