import type { IntakeConfig } from '@heloc/config';
import type { Logger } from '@heloc/logger';
import { createServer } from '@heloc/server-kit';

export const SERVICE = 'intake';

export interface AppDeps {
  config: IntakeConfig;
  logger: Logger;
  version: string;
}

export function buildApp({ logger, version }: AppDeps) {
  return createServer({ service: SERVICE, version, logger });
}
