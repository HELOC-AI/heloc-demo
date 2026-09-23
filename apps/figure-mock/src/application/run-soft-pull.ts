import { evaluate, force, reviewDocuments } from '../domain/soft-pull-policy.ts';
import type {
  Outcome,
  OutcomeStatus,
  ReviewOutcome,
  ReviewOutcomeStatus,
  SoftPull,
} from '../domain/soft-pull.ts';

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

export interface RunDocumentReviewCommand {
  pull: SoftPull;
  /** Demo only: replaces the review's verdict. */
  forcedOutcome?: ReviewOutcomeStatus | undefined;
}

export function runDocumentReview(
  { pull, forcedOutcome }: RunDocumentReviewCommand,
  clock: Clock,
): ReviewOutcome {
  return reviewDocuments(pull, clock.now(), forcedOutcome);
}
