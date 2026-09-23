# A Lead owns at most one Prequal Decision and one Chase

The Lead aggregate holds its Prequal Decision and its Chase instead of modelling them as separate aggregates. The invariants that matter all span the three: a Lead is `chase_sent` only when its Chase was sent, a Chase exists only for a Need More Documents decision, and a decision is never replaced. Keeping them in one aggregate lets one transaction enforce all of them. A decision, once obtained, is immutable: Replay never re-runs a soft pull, because a second pull could contradict the first and, against the real Figure, would query the borrower's credit again.

## Considered Options

- **Re-run the soft pull on every Replay** (multiple decisions per Lead): rejected. It is not idempotent, and a changed outcome would need rules for superseding an already-sent Chase.
- **Chase as its own aggregate**: rejected for now. There is exactly one Chase per Lead with no independent lifecycle. Split it out if Chases gain their own lifecycle, such as reminders or multiple rounds.
