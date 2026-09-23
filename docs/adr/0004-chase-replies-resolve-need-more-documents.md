# Chase replies resolve Need More Documents through one Document Review

Refines ADR-0003. The soft-pull Prequal Decision is still immutable, but Need More Documents is no longer terminal: a borrower replies to the Chase email with documents, and one **Document Review** by Figure turns the Lead into Approved or Rejected, followed by one **Outcome Notice** email. Replies arrive through Cloudflare Email Routing (our MX for linkerclaw.ai) at `reply+<chase_id>@linkerclaw.ai`, handled by an Email Worker that forwards provider-neutral metadata to Lead Intake. The Lead aggregate owns acceptance: a reply counts only if Cloudflare's own Authentication-Results says `dmarc=pass`, the From address is the borrower's, and there is at least one attachment. Any attachment counts as submitting all requested documents.

## Considered Options

- **Resend Inbound** (webhook + API): rejected. Cloudflare is already our mail server, and reading Resend's verdicts would need a full-access Resend key in the email service.
- **Match attachments to document types by filename**: rejected for now. It guesses wrong often and needs multi-round chasing. Revisit with a real document upload (P0 next phase).
- **Re-run the soft pull when documents arrive**: rejected. It keeps ADR-0003's rule that a soft pull happens once; the review is a distinct, single step.

## Consequences

- New Lead status `documents_received`, and new steps `review` and `notify` in `nextStep()`. Replay covers them like the earlier steps.
- Attachment contents stay in the Worker and are never stored. Only filename, type, size and hash are persisted. Secure document storage is still future work.
- Replies that don't qualify are recorded as `documents.rejected` with a reason and change nothing else.
