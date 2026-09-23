# heloc-demo

HELOC（房屋净值信用额度）申请的端到端垂直切片，全部在线上运行：

**问卷 → Lead Intake → Figure 软查询（mock）→ 需补材料时自动 Chase 邮件 → 借款人直接回信补材料 → Figure 审核 → 结果邮件**

真实部署（Vercel + Railway）、真实落库（Supabase）、真实投递（Resend），收信走 Cloudflare Email Routing；Better Stack 负责健康检查、日志、异常、看板与告警；任何一步失败都能 Replay。

|                 | 地址                                                                            |
| --------------- | ------------------------------------------------------------------------------- |
| 问卷            | https://heloc-demo.vercel.app                                                   |
| Lead Intake API | https://intake-production-12aa.up.railway.app                                   |
| 状态页          | https://heloc-demo-status.betteruptime.com                                      |
| 运维总览        | https://heloc-demo.vercel.app/ops（健康、告警、错误统计、待处理 Lead + Replay） |
| 运维看板        | Better Stack → Dashboards → **HELOC operations**                                |

## 架构

```text
Borrower ─► web (Next.js, Vercel)
              │ POST /v1/leads · GET /v1/leads/:id · POST /v1/leads/:id/replay
              ▼
           intake (Lead aggregate, Supabase) ──► figure-mock   /v1/soft-pull · /v1/document-reviews
              │
              ├─► chase ──► email ──► Resend ──► 借款人收件箱
              │  (Chase 邮件 Reply-To: reply+<chase_id>@linkerclaw.ai，含 “Reply with documents” 按钮)
              │
              ◄── email-inbound (Cloudflare Email Worker) ◄── Cloudflare MX ◄── 借款人回信 + 附件
                   只信任 Cloudflare 自己的 DMARC 结论 · 附件内容不出 Worker

所有服务 ──► Better Stack：uptime · 状态页 · 日志 · Errors · 看板 · 告警（邮件）
                 └──► /ops 页面 与 pnpm ops（packages/ops 汇总同一份数据）
```

| 服务          | 限界上下文                   | 目录                                                                                | 部署                  |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------- | --------------------- |
| web           | —                            | `apps/web`                                                                          | Vercel                |
| intake        | Lead Intake（核心域）        | `apps/intake`                                                                       | Railway               |
| figure-mock   | Prequalification             | `apps/figure-mock`                                                                  | Railway               |
| chase         | Borrower Outreach            | `apps/chase`                                                                        | Railway               |
| email         | Email Delivery               | **独立仓库** [heloc-email-service](https://github.com/HELOC-AI/heloc-email-service) | Railway（Dockerfile） |
| email-inbound | Email Delivery（收信适配器） | `apps/email-inbound`                                                                | Cloudflare Worker     |

每个后端都分为 `domain / application / infrastructure / interface` 四层，依赖只能向内，由 ESLint 强制。共享包：`packages/contracts`（跨服务 Zod 契约）、`config`（启动时校验环境变量）、`logger`（结构化日志 + 脱敏）、`server-kit`（Fastify 基础设施）、`ops`（运维上下文：健康检查、告警规则、看板 SQL、日志查询，供 `/ops`、`pnpm ops` 与 setup 脚本共用）。

## 本地开发

需要 Node 24+（见 `.node-version`）与 pnpm 10。

```bash
pnpm install
node scripts/env-sync.ts --local   # 从仓库根 .env 生成各 app 的 .env（或手动复制各 app 的 .env.example）
pnpm dev                           # web :3000 · intake :4000 · figure-mock :4001 · chase :4002
```

chase 调用的 Email Service 在独立仓库：`git clone git@github.com:HELOC-AI/heloc-email-service.git`，在那里 `pnpm dev` 起在 :4003（默认 `EMAIL_PROVIDER=console`，只打印不发信）。

| 命令                                                                         | 作用                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm test`                                                                  | 全部测试：单元、集成（PGlite + 真实迁移）、Worker，以及 4 个服务真实 HTTP 串联的 e2e |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check`                         | 静态检查（含 DDD 分层规则）                                                          |
| `pnpm check:env`                                                             | 校验每个 app 的 `.env.example` 与 env schema 一致                                    |
| `pnpm check:contracts`                                                       | 校验 chase 使用的 Send API 契约副本与 heloc-email-service 发布的一致                 |
| `pnpm smoke`                                                                 | 对线上服务跑冒烟测试（不发邮件）                                                     |
| `pnpm ops [status\|alerts\|errors\|attention\|lead\|logs\|replay\|incident]` | 运维命令行（见 [RUNBOOK §5.1](docs/RUNBOOK.md)）                                     |

后端没有构建步骤：Node 直接运行 TypeScript（`node src/main.ts`）。

## 运维脚本

| 脚本                                                 | 作用                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `scripts/env-sync.ts --railway / --vercel / --local` | 把根 `.env` 的 secret 分发到 Railway / Vercel（web 服务端）/ 本地 |
| `scripts/setup-betterstack.ts --monitors --alerts`   | 日志 source、Errors 应用、uptime monitor、日志告警、值班接收人    |
| `scripts/setup-dashboards.ts [--verify]`             | 状态页、日志转指标字段、HELOC operations 看板                     |
| `scripts/ops.ts`（`pnpm ops`）                       | 运维总览、事故、日志追踪、Replay                                  |
| `scripts/setup-resend-domain.ts`                     | 在 Resend 验证发信域名，并写入 Cloudflare DNS                     |
| `.railway/railway.ts`                                | Railway 基础设施（`railway config apply`）                        |

## 文档

- [Demo 脚本](docs/DEMO.md) · [验收清单](docs/ACCEPTANCE.md) · [Runbook](docs/RUNBOOK.md)
- [开发计划与设计](docs/DEV-PLAN.md) · [配置与 Secret](docs/CONFIGURATION.md)
- 领域：[Context Map](CONTEXT-MAP.md) · 各服务的 `apps/*/CONTEXT.md` · [ADR](docs/adr)

Claude Code 用户：项目技能 **heloc-devops**（`.claude/skills/heloc-devops`）按 RUNBOOK 与 `pnpm ops` 执行运维操作（写操作先确认，不打印 secret）。

> 本仓库为 public：只提交变量名（`.env.example`），任何 secret 值都不入库。
