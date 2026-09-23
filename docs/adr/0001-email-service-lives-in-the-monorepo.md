# Email service lives in the monorepo

> **Superseded** by [ADR-0005](./0005-email-service-in-its-own-repository.md): the service now lives in its own repository, as the spec requires.

The spec asks for `email-service` in its own repository. We keep it in the monorepo as `apps/email` so it shares CI, contracts, logging and deployment tooling on a one-day timeline. It is still a separate bounded context and a separately deployed service with its own key, and it may depend only on `packages/*`, never on another app. That keeps it extractable into its own repository without code changes.
