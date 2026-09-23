# 验收清单（需求文档 §26）

> 逐项对照，附证据。证据均来自 2026-09-23 的生产环境：
> 最后一次部署时 intake、figure-mock、email 运行 `436419b`，chase 运行 `4d7e40c`，web 为 Vercel production。

## Functional

| 项                                     | 状态 | 证据                                                                                                                      |
| -------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| Borrower 可以填写并提交 Quiz           | ✅   | 浏览器彩排：在生产 web 上填写并提交，`POST /v1/leads` 返回 201，CORS 头为 `https://heloc-demo.vercel.app`                 |
| Lead 成功写入 Supabase                 | ✅   | `leads` 表里有 Lead `b1868a10-…`（`approved`）；`drizzle.__drizzle_migrations` 共 2 条                                    |
| Intake 可以调用 Figure Mock            | ✅   | 事件 `figure.requested` → `figure.*`；Better Stack 里同一个 `request_id` 横跨 intake 与 figure-mock                       |
| Figure Mock 支持 approved              | ✅   | 信用 780+ → approved，额度 $250,000（`pnpm smoke`、线上 curl）                                                            |
| Figure Mock 支持 rejected              | ✅   | 信用 <580 → `credit_below_minimum`；净值不足 → `insufficient_home_equity`                                                 |
| Figure Mock 支持 need-more-documents   | ✅   | 信用 620–739 → `income_verification`（LTV > 60% 时再加 `mortgage_statement`）                                             |
| approved 返回 Offer                    | ✅   | Offer 字段齐全：lender、amount、apr_min/max、term_months、estimated_monthly_payment、expires_at；以 contracts schema 校验 |
| need-more-documents 自动触发 Chase     | ✅   | 同一请求内依次产生 `chase.created` → `email.sent`，无人工介入                                                             |
| Chase 调用 Email Service               | ✅   | chase → email 走 `POST /v1/send`，带幂等键 `Idempotency-Key: chase:<id>` 与 Reply-To                                      |
| Email Service 通过 Resend 真实发送邮件 | ✅   | Resend 中状态 `delivered`：message `01a0ccc2-…`、`01a0ccd8-…`                                                             |
| 测试邮箱可以收到邮件                   | ✅   | `user@linkerclaw.ai` 经 Cloudflare Email Routing 转发到 Gmail，已确认收到                                                 |

## Deployment

| 项                       | 状态 | 证据                                                                                     |
| ------------------------ | ---- | ---------------------------------------------------------------------------------------- |
| Frontend 有公开 URL      | ✅   | https://heloc-demo.vercel.app（monitor `heloc-web` 为 up）                               |
| Intake 有公开 URL        | ✅   | https://intake-production-12aa.up.railway.app/health                                     |
| Figure Mock 有公开 URL   | ✅   | https://figure-mock-production.up.railway.app/health                                     |
| Chase 有公开 URL         | ✅   | https://chase-production-4070.up.railway.app/health                                      |
| Email Service 有公开 URL | ✅   | https://email-production-48c5.up.railway.app/health                                      |
| 不能依赖 localhost       | ✅   | 所有服务间调用都走 Railway 公网域名（IaC 引用 `RAILWAY_PUBLIC_DOMAIN`）；外部监控 5/5 up |

## Persistence

| 项                               | 状态 | 证据                                                                           |
| -------------------------------- | ---- | ------------------------------------------------------------------------------ |
| Supabase 使用真实 Hosted Project | ✅   | 项目 `jtamjurbiyenwkqjwlsl`（us-east-2），经 session pooler 连接               |
| Lead 可查询                      | ✅   | `GET /v1/leads/:id`；SQL `SELECT … FROM leads`                                 |
| Figure Decision 可查询           | ✅   | `figure_decisions`：`soft_pull` 与 `document_review` 两条，均含 `raw_response` |
| Chase 记录可查询                 | ✅   | `chases`：status、subject、body、email_message_id、reply_to、reply             |
| Event 可查询                     | ✅   | 按 §13.4 的 SQL 查出 10 个有序事件（按 `sequence` 排序）                       |

## Observability

| 项                             | 状态 | 证据                                                                                    |
| ------------------------------ | ---- | --------------------------------------------------------------------------------------- |
| 所有 Service 有 `/health`      | ✅   | 返回 `{status, service, version, timestamp}`，intake 另有 `checks.db`                   |
| Better Stack 配置 Uptime       | ✅   | 5 个 monitor + 状态页 https://heloc-demo-status.betteruptime.com                        |
| Better Stack 能查看 Logs       | ✅   | 5 个 source（含 email-inbound）；看板 **HELOC operations**                              |
| Better Stack 能查看 Errors     | ✅   | 4 个 Errors 应用；注入的异常已确认出现在 `heloc-figure-mock`                            |
| 配置至少一个 Alert Destination | ✅   | 邮件发往 `simonarthur2012@gmail.com`；两次演练的事故时间线都记录了 “Sent an email to …” |

## Operations

| 项                          | 状态 | 证据                                                                                                                  |
| --------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| README 完整                 | ✅   | [README](../README.md)                                                                                                |
| RUNBOOK 完整                | ✅   | [RUNBOOK](./RUNBOOK.md)：部署、环境变量、Replay、故障、恢复、告警、演练                                               |
| 环境变量有说明              | ✅   | [RUNBOOK §2](./RUNBOOK.md)、[CONFIGURATION](./CONFIGURATION.md)；CI 的 `check:env` 保证 `.env.example` 与 schema 一致 |
| 支持 Replay                 | ✅   | 结果页 Try again 与 API 都已验证；断点续跑，不重复发信                                                                |
| Common Failure Modes 有说明 | ✅   | [RUNBOOK §4](./RUNBOOK.md) 覆盖需求要求的 6 类，另加回信、并发、CORS                                                  |

## 超出需求的部分

- 借款人**直接回复邮件补材料** → Figure 审核材料 → 结果邮件（ADR-0004），邮件内有一键回复按钮
- DDD 分层并由 lint 强制；379+ 个自动化测试（含 4 个服务真实 HTTP 串联的 e2e）
- 基础设施即代码：Railway IaC、Better Stack 监控 / 告警 / 看板 / 状态页脚本；secret 统一由 `env-sync` 分发
- 每 6 小时运行的线上冒烟（GitHub Actions，不发邮件）
