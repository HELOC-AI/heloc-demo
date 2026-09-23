# Every final outcome gets an Outcome Notice

Refines ADR-0004. The Outcome Notice used to follow only a Document Review. A borrower approved or rejected by the soft pull itself saw the result only on the result page, and once they closed the tab they had no way back to their offer. Now every Lead that reaches a final outcome gets exactly one Outcome Notice, whether that outcome came from the soft pull or from a Document Review. The notice links to the result page, which shows the offer.

`nextStep()` returns `notify` once a Lead has a final outcome (Approved or Rejected) and its notice has not been sent. So Replay, the idempotency key `notice:<id>`, failure handling (`failed_step=notify`) and the "one notice per Lead" constraint all carry over unchanged. The intake → chase request says which step settled the outcome (`basis`: `prequalification` or `document_review`), so the email wording doesn't talk about documents the borrower never sent. `basis` defaults to `document_review`, so intake and chase can be deployed in either order.

## Consequences

- `POST /v1/leads` now sends an email on the approved and rejected paths too, inside the same request (ADR-0002). If that email fails, the Lead is `failed` at `notify` and the API answers 502. The decision still stands, the result page still shows the offer, and Replay sends the notice once.
- A decided Lead whose notice is still `pending` after the stuck threshold (for example, a crash mid-send) counts as a Lead Needing Attention.
- Leads decided before this change have no notice. Replaying one sends it.
- The production smoke test now sends real outcome emails. It uses Resend's test inbox (`delivered+smoke@resend.dev`), which never bounces and doesn't affect the domain's reputation.
