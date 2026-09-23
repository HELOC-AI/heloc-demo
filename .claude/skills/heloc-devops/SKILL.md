---
name: heloc-devops
description: Operate the live heloc-demo system — check health, uptime, alerts, incidents and error statistics, trace a Lead or request through the logs, replay failed Leads, deploy, roll back, rotate secrets and run the post-deploy smoke test. Use for any ops / on-call / production question about heloc-demo ("is it up?", "why did this Lead fail?", "an alert fired", "deploy this", "rotate a key", 运维, 告警, 排障, 部署).
---

# heloc-demo DevOps

Production: web on Vercel, intake / figure-mock / chase / email on Railway, Supabase Postgres,
Resend (outbound mail), Cloudflare Email Routing + Worker `heloc-email-inbound` (borrower replies),
Better Stack (uptime, logs, errors, alerts, dashboards, status page).

Full procedures live in `docs/RUNBOOK.md` — this skill is the entry point; read the relevant RUNBOOK
section before acting on anything it covers.

## Ground rules

- **Never print secrets.** Don't `cat .env`, don't echo `$*_KEY` / `$*_PASSWORD` / tokens, don't paste
  them into commands whose output you show. Load them with `set -a; . ./.env; set +a` and reference
  the variables. The repo is **public**: secret values never go into files, commits, PRs or issues.
- **Admin credentials stay local**: `BETTER_STACK_API_KEY`, `RESEND_ADMIN_API_KEY`,
  `SUPABASE_SECRET_KEY`, `SUPABASE_PASSWORD`, `BETTERSTACK_QUERY_*` live only in the root `.env`
  and are never synced to a service.
- **Read freely, confirm writes.** Anything that changes production — replay, incident ack/resolve,
  `railway config apply`, `env-sync --railway`, redeploys, rollbacks, `wrangler deploy`, the
  `setup-*.ts` scripts, SQL other than `SELECT` — needs the user's go-ahead first (state what will
  change). Never run destructive SQL (`DELETE`, `DROP`, `TRUNCATE`, `UPDATE`) on production data.
- **This machine needs a proxy** for Vercel and some Railway edges. Start each shell command that
  runs Node with `export NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 &&` (shell state
  does not carry over between commands); curl takes `-x http://127.0.0.1:7890`. CI needs neither.

## First look: `pnpm ops`

`scripts/ops.ts` shows the same data as the public page https://heloc-demo.vercel.app/ops, plus
what needs admin credentials. Start every investigation with it.

| Question                                    | Command                                                           |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Is everything up? What's alerting?          | `pnpm ops`                                                        |
| What fired recently / is still open?        | `pnpm ops alerts` (rules + Better Stack incidents)                |
| What errors, where, how often?              | `pnpm ops errors [--hours 72]`                                    |
| Which Leads are failed or stuck?            | `pnpm ops attention`                                              |
| What happened to this Lead?                 | `pnpm ops lead <lead_id>`                                         |
| Every log line for a request / Lead / chase | `pnpm ops logs <request_id\|lead_id\|chase_id> [--hours N]`       |
| Resume a failed or stuck Lead               | `pnpm ops replay <lead_id>` (asks; `--yes` after the user agreed) |
| Acknowledge / resolve an incident           | `pnpm ops incident ack\|resolve <id>` (asks)                      |
| Did the deploy work?                        | `pnpm ops smoke` (= `pnpm smoke`, sends no email)                 |

Sections degrade independently: an `unavailable:` line names the missing credential or failing
dependency — that is itself a finding.

## Common tasks

**An alert fired / a monitor is down**

1. `pnpm ops alerts` — which rule, which services, still firing?
2. `pnpm ops errors` and `pnpm ops logs <request_id>` from a top error to see the whole request.
3. Match the symptom to `docs/RUNBOOK.md` §4 (Supabase, Figure, chase, email, Resend, bad data,
   replies not advancing) and follow it. Leads that failed on the way: `pnpm ops attention` → replay
   once the dependency is back (replay resumes from the failed step and never re-sends email).
4. Acknowledge / resolve the incident only when the user wants it.

**Why didn't a borrower's reply advance their Lead?** RUNBOOK §4.7 — `pnpm ops logs <chase_id>`
shows the Worker's decision (`inbound.*` events on `email-inbound`) and intake's answer.

**Deploy** (RUNBOOK §1): merging to `main` deploys (Railway rebuilds only changed services, Vercel
rebuilds web). Watch with `railway deployment list --service <svc> --limit 3`; then `pnpm ops`
(the `version` column is the deployed commit) and `pnpm smoke`.
The Worker is manual: `cd apps/email-inbound && npx wrangler deploy` (token: CONFIGURATION §2.8).
Service logs from Railway itself: `railway logs --service <svc> --lines 200`.

**Roll back** (RUNBOOK §1): `git revert` the merge and push; in an emergency Railway → Deployments →
Redeploy the previous one; web: `vercel rollback`; Worker: `npx wrangler rollback`.

**Secrets / config** (RUNBOOK §2, §7): edit the root `.env` (`<SERVICE>__NAME` convention) →
`node scripts/env-sync.ts --railway` → `railway redeploy --service <svc> --yes`. Non-secret Railway
config is IaC in `.railway/railway.ts` (`railway config plan` before `apply`). Web server-only vars
(`/ops`): `OPS_API_KEY`, `BETTERSTACK_QUERY_HOST/USERNAME/PASSWORD` via `vercel env`.

**Monitoring definitions** (RUNBOOK §5): alert rules, dashboard queries and metric extractions live
in `packages/ops` (shared by the dashboard, `/ops` and the CLI). After changing them:
`node scripts/setup-dashboards.ts --verify`, then (with the user's OK) `setup-dashboards.ts` and
`setup-betterstack.ts --alerts`. Dashboards only read _metrics_: a new log field must be added to
`METRICS` first and only fills from then on.

**Database** (read-only by default): `railway run` or the Supabase SQL editor with `SELECT`s from
RUNBOOK §3 / §4; migrations only through intake deploys (RUNBOOK §1).

## After any change

Run `pnpm smoke` and `pnpm ops`, then tell the user what changed, what you verified, and
anything still open (firing alerts, Leads still failed, incidents left unresolved).
