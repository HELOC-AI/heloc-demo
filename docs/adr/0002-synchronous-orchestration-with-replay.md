# Synchronous orchestration with replay instead of a queue

Lead Intake advances a Lead synchronously inside `POST /v1/leads`, calling Prequalification and then Borrower Outreach over HTTP. It persists the Lead after every step, so a failure leaves the Lead at a known step. Recovery is `POST /v1/leads/:id/replay`, which resumes from that step. Duplicate emails are prevented by an idempotency key derived from the Chase id. We chose this over a message queue or workflow engine (Kafka, Temporal, Supabase Queues) because the flow has two external steps and a single-digit request rate, so database state plus replay gives recoverability without new infrastructure. Revisit when steps become long-running or need automatic retries.

## Consequences

- The borrower waits for Figure and the Chase email inside one request. Timeouts bound it: 5s for Figure, 10s for Chase.
- There is no automatic retry. A failed Lead stays `failed` until someone replays it. The runbook covers this.
