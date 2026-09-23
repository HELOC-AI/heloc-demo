import type { z } from 'zod';

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

type Env = Record<string, string | undefined>;

/**
 * Validates env against a service schema. Error messages name the variable and the
 * problem but never echo the value, so a misconfigured secret can't leak into logs.
 */
export function loadConfig<S extends z.ZodType>(schema: S, env: Env): z.output<S> {
  // Treat empty strings as unset so `FOO=` in a .env file falls back to defaults.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;
  throw new ConfigError(
    result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return issue.code === 'invalid_type' && issue.input === undefined
        ? `${key}: required`
        : `${key}: ${issue.message}`;
    }),
  );
}

/** For main.ts: print the problems and exit instead of throwing a stack trace. */
export function loadConfigOrExit<S extends z.ZodType>(
  schema: S,
  env: Env = process.env,
): z.output<S> {
  try {
    return loadConfig(schema, env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
