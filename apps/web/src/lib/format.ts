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

const FILE_SIZE_UNITS = ['KB', 'MB', 'GB'] as const;

/** 812 → "812 bytes", 48_300 → "47 KB", 2_400_000 → "2.3 MB" (1 KB = 1,024 bytes). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    const whole = Math.max(0, Math.round(Number.isFinite(bytes) ? bytes : 0));
    return `${whole} ${whole === 1 ? 'byte' : 'bytes'}`;
  }
  let value = bytes;
  let unit: (typeof FILE_SIZE_UNITS)[number] = 'KB';
  for (const next of FILE_SIZE_UNITS) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  // One decimal below 10 ("2.3 MB"), whole numbers above ("47 KB"), no trailing ".0".
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${unit}`;
}

/** "3:04:05 PM" (Lead Events happen seconds apart). */
export function formatTime(iso: string, { timeZone }: FormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-US', { timeStyle: 'medium', timeZone }).format(new Date(iso));
}
