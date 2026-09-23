# @heloc/email-inbound

Cloudflare Email Worker (`heloc-email-inbound`) that receives borrower replies to Chase
emails and forwards them to Lead Intake as an **Inbound Email** (see
[ADR-0004](../../docs/adr/0004-chase-replies-resolve-need-more-documents.md) and
[CONTEXT.md](./CONTEXT.md)).

## What it does

Chase emails set `Reply-To: reply+<chase_id>@linkerclaw.ai`. Cloudflare Email Routing is the MX
for linkerclaw.ai with subaddressing enabled; the routing rule for `reply@linkerclaw.ai` sends
every `reply+…@` message to this Worker, which:

1. parses the raw MIME with `postal-mime`;
2. builds an `InboundEmail` (`@heloc/contracts`): Message-ID (or `sha256:<hash of raw>`),
   bare From address, envelope recipient (keeps `+<chase_id>`), subject, Authentication
   Verdict, and metadata of real attachments only (`filename`, `content_type`, `size`,
   `sha256`; inline / Content-ID parts are skipped);
3. validates it against `inboundEmailSchema` and `POST`s it to
   `${INTAKE_API_URL}/v1/inbound-emails` (`Authorization: Bearer`, `x-request-id`, 10 s timeout).

| Intake answer                           | Worker                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| 2xx                                     | done; logs `accepted` / `reason` (`inbound.forwarded`)                         |
| 4xx (not 408/429)                       | permanent: logs at error, no retry (`inbound.rejected_by_intake`)              |
| 5xx, 408, 429, network error, timeout   | throws → temporary SMTP failure, the sender retries (`inbound.forward_failed`) |
| unparseable / not a valid Inbound Email | dropped with `inbound.invalid` (retrying can't help)                           |

`message.setReject()` (permanent SMTP error, the sender bounces) is deliberately not used — see
the comment in [`src/index.ts`](src/index.ts).

## Security model

- **Authentication Verdict comes from Cloudflare only.** The Worker uses the first (topmost)
  `Authentication-Results` header whose authserv-id is `mx.cloudflare.net`, scanning headers in
  document order. Cloudflare prepends its header above everything the sender wrote, so forged
  copies further down are ignored. `dmarc=pass|fail|none` is passed through, anything else is
  `unknown`. The DMARC `header.from` must equal the From address's domain and there must be a
  single From header, otherwise the verdict is `fail`. Pure logic and tests:
  [`src/authentication.ts`](src/authentication.ts).
- **Residual trust:** this relies on Cloudflare prepending its own verdict to every message.
  Verified in production: a test email carrying a forged
  `Authentication-Results: mx.cloudflare.net; dmarc=fail header.from=forged.example` reached the
  Worker unchanged (Cloudflare does not strip it) but below Cloudflare's real `dmarc=pass`, and the
  verdict was `pass`. The `cloudflare_verdicts` log field counts `mx.cloudflare.net` headers per
  message (normally 1; more means a sender forged one).
- **Attachment contents never leave the Worker** — only their metadata and sha256.
- **Logs carry no borrower PII:** sender domain only (never the full address), no subject, no
  filenames, no contents; addresses in the logged verdict are reduced to `*@domain`.
- Intake decides whether the reply counts (DMARC pass, From is the borrower, ≥ 1 attachment).

## Configuration

| Worker binding               | Kind                   | Source (repo-root `.env`)                   |
| ---------------------------- | ---------------------- | ------------------------------------------- |
| `INTAKE_API_URL`             | var (`wrangler.jsonc`) | —                                           |
| `INTAKE_API_KEY`             | secret                 | `INTAKE__INBOUND_API_KEY`                   |
| `BETTERSTACK_SOURCE_TOKEN`   | secret                 | `EMAIL_INBOUND__BETTERSTACK_SOURCE_TOKEN`   |
| `BETTERSTACK_INGESTING_HOST` | secret                 | `EMAIL_INBOUND__BETTERSTACK_INGESTING_HOST` |

Logs go to the Better Stack source `heloc_email_inbound` as JSON
(`{ dt, level, service: "email-inbound", event, request_id, message, ... }`) and to Workers Logs.

## Develop and deploy

```sh
pnpm --filter @heloc/email-inbound typecheck
pnpm vitest run apps/email-inbound
pnpm --filter @heloc/email-inbound build     # wrangler deploy --dry-run (bundle check)
```

Deploy (from `apps/email-inbound`; wrangler needs an API token with Workers edit rights):

```sh
export CLOUDFLARE_ACCOUNT_ID=<account-id> CLOUDFLARE_API_TOKEN=<token>
# secrets file: JSON {"INTAKE_API_KEY": "...", "BETTERSTACK_SOURCE_TOKEN": "...", "BETTERSTACK_INGESTING_HOST": "..."}
umask 077 && <write the secrets file to /tmp/secrets.json from the root .env>
pnpm exec wrangler deploy --secrets-file /tmp/secrets.json && rm /tmp/secrets.json
```

Route mail to it (once): Email Routing → linkerclaw.ai → rule `reply@linkerclaw.ai` → action
"Send to a Worker" → `heloc-email-inbound` (subaddressing must stay enabled), e.g.

```sh
cf email-routing rules list-account --zone linkerclaw.ai
cf email-routing rules update <rule-id> --zone linkerclaw.ai --body '{"name":"HELOC chase replies","enabled":true,"matchers":[{"type":"literal","field":"to","value":"reply@linkerclaw.ai"}],"actions":[{"type":"worker","value":["heloc-email-inbound"]}]}'
```
