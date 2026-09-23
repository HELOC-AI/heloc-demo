# Email service in its own repository

Supersedes [ADR-0001](./0001-email-service-lives-in-the-monorepo.md).

The spec (§12.1, §17.2) requires the Email Service to be a separate repository, and on review that requirement stands: it is a generic Send API that other products could call, so it gets its own lifecycle. It now lives in [HELOC-AI/heloc-email-service](https://github.com/HELOC-AI/heloc-email-service) (history carried over from `apps/email`) and deploys to the same Railway service `email` from that repository's Dockerfile, keeping its domain and variables, so chase did not change.

The Email Service owns the Send API contract; heloc-demo keeps a consumer copy in `packages/contracts` and exercises it end to end against a stub that validates every request with that copy. The service carries its own small copies of the platform code it used from `packages/*` (server, auth, config, logging, error reporting) rather than sharing a published package — for one service, duplication is cheaper than a registry. Its Railway variables are still managed from heloc-demo (`.railway/railway.ts`, `env-sync --railway`), so all secrets keep one home.
