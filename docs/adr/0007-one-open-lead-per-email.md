# One open application per email; repeated submissions return the earlier Lead

Since ADR-0006 every submission sends the borrower an email, so the quiz must not be usable to email an address over and over, and a double click or network retry must not create a second application. Two rules now apply to `POST /v1/leads`:

1. **One Open Lead per email.** A Lead is Open until it settles as Approved or Rejected. That includes `failed` Leads, which are resumed by Replay rather than by resubmitting, and Leads waiting for documents. The email is compared case-insensitively; subaddresses (`user+x@`) count as different emails. A submission for an email with an Open Lead gets `409 application_in_progress` and nothing is created or sent. The answer does not include the open Lead's id, so knowing someone's email doesn't reveal their application.
2. **Repeated submissions return the earlier Lead.** A request whose `Idempotency-Key` was already used returns that Lead, with `200` and `Idempotent-Replayed: true`. The same key with different answers gets `422 idempotency_key_reused`. The quiz sends one key per set of answers. Separately, the same email with identical answers within 24 hours of a settled Lead returns that Lead, which covers clients that send no key. Nothing runs again and no email is sent. Changed answers, such as "Check again with different details", start a new Lead.

The repository enforces rule 1 when it inserts a new Lead. It takes a transaction-scoped advisory lock on the lower-cased email, checks for an Open Lead, then inserts, so concurrent submissions for one email are serialised. The idempotency key is unique in `leads`.

## Considered options

- **Partial unique index on `lower(email)` for Open statuses**: rejected for now. Production already has an email with two Open Leads from before this rule, so the index can't be created without changing existing data. It could replace the lock once old Open Leads have settled or expired.
- **Answer 409 with the open Lead's id and redirect to it**: rejected. Anyone who knows an email could open that borrower's application page.
- **A 24-hour cooldown per email**: rejected. It would also block a rejected borrower from checking again with different details.

## Consequences

- An email stays blocked while its Lead waits for documents. Chase expiry (planned) will release it. A failed Lead blocks until someone replays it.
- Demos need a fresh address, or a subaddress, per run. The smoke test labels its Resend test addresses per run.
- The PGlite tests prove the check-then-insert logic, but PGlite runs one transaction at a time, so the lock's behaviour under real concurrency rests on Postgres semantics.
