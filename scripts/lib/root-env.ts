/**
 * The repo-root .env is the local master copy of every credential (gitignored).
 * Shared values use plain names (RESEND_API_KEY); per-service values are prefixed
 * with the service, e.g. INTAKE__BETTERSTACK_SOURCE_TOKEN. See docs/CONFIGURATION.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export const ROOT_ENV_PATH = new URL('../../.env', import.meta.url);

export const SERVICES = ['intake', 'figure-mock', 'chase', 'email'] as const;
export type Service = (typeof SERVICES)[number];

/** figure-mock → FIGURE_MOCK__ */
export const servicePrefix = (service: string) => `${service.toUpperCase().replace(/-/g, '_')}__`;

export function readRootEnv(): Record<string, string> {
  if (!existsSync(ROOT_ENV_PATH)) return {};
  return parseEnv(readFileSync(ROOT_ENV_PATH, 'utf8')) as Record<string, string>;
}

/** Insert or replace keys in place, keeping comments and ordering of everything else. */
export function upsertRootEnv(values: Record<string, string>, sectionComment?: string): void {
  const lines = existsSync(ROOT_ENV_PATH) ? readFileSync(ROOT_ENV_PATH, 'utf8').split('\n') : [];
  const pending = new Map(Object.entries(values));

  const updated = lines.map((line) => {
    const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (key && pending.has(key)) {
      const value = pending.get(key)!;
      pending.delete(key);
      return `${key}=${formatValue(value)}`;
    }
    return line;
  });

  if (pending.size > 0) {
    while (updated.length > 0 && updated.at(-1) === '') updated.pop();
    updated.push('');
    if (sectionComment) updated.push(`# ${sectionComment}`);
    for (const [key, value] of pending) updated.push(`${key}=${formatValue(value)}`);
  }
  writeFileSync(ROOT_ENV_PATH, `${updated.join('\n').replace(/\n*$/, '')}\n`, { mode: 0o600 });
}

/**
 * Single-quote values a shell `source` would misread (spaces, <, >, $). Single quotes are
 * literal in both node:util parseEnv and POSIX shells, so both read the same value.
 */
function formatValue(value: string): string {
  if (/^[\w@.:/+=,%-]*$/.test(value)) return value;
  if (value.includes("'")) throw new Error('.env values must not contain single quotes');
  return `'${value}'`;
}

export function requireVar(env: Record<string, string>, key: string): string {
  const value = env[key];
  if (!value) {
    console.error(`Missing ${key} in the repo-root .env`);
    process.exit(1);
  }
  return value;
}
