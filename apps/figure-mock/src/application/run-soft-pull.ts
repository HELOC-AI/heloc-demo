import { evaluate, force } from '../domain/soft-pull-policy.ts';
import type { Outcome, OutcomeStatus, SoftPull } from '../domain/soft-pull.ts';

export interface Clock {
  now(): Date;
}

export interface RunSoftPullCommand {
  pull: SoftPull;
  /** Demo only: replaces the rules' verdict. */
  forcedOutcome?: OutcomeStatus | undefined;
}

export function runSoftPull({ pull, forcedOutcome }: RunSoftPullCommand, clock: Clock): Outcome {
  const now = clock.now();
  return forcedOutcome ? force(pull, forcedOutcome, now) : evaluate(pull, now);
}
