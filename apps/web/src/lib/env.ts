/**
 * The web app's only configuration. NEXT_PUBLIC_* values are inlined at build time,
 * so they must be set in Vercel before the build runs.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/+$/,
  '',
);
