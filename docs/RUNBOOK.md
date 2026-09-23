# HELOC Demo — Runbook

> 线上一切的操作手册：部署、环境变量、Replay、常见故障与恢复、监控与告警、演练。
> 设计背景见 [DEV-PLAN](./DEV-PLAN.md)、[CONFIGURATION](./CONFIGURATION.md)、[ADR](./adr)。
> **本文件不含任何 secret 值**；值在仓库根 `.env`（本地，gitignored）与 Railway / Vercel / Cloudflare 中。

---

## 0. 服务地图

| 服务                      | 公网地址                                                          | 部署在                                  | 代码                  |
| ------------------------- | ----------------------------------------------------------------- | --------------------------------------- | --------------------- |
| web（问卷 + 结果页）      | https://heloc-demo.vercel.app                                     | Vercel                                  | `apps/web`            |
| intake（Lead Intake API） | https://intake-production-12aa.up.railway.app                     | Railway `intake`                        | `apps/intake`         |
| figure-mock（预审）       | https://figure-mock-production.up.railway.app                     | Railway `figure-mock`                   | `apps/figure-mock`    |
| chase（补材料通知）       | https://chase-production-4070.up.railway.app                      | Railway `chase`                         | `apps/chase`          |
| email（邮件投递）         | https://email-production-48c5.up.railway.app                      | Railway `email`                         | `apps/email`          |
| email-inbound（收信）     | 无 HTTP 入口：Cloudflare Email Routing `reply@linkerclaw.ai` 规则 | Cloudflare Worker `heloc-email-inbound` | `apps/email-inbound`  |
| 数据库                    | Supabase 项目 `jtamjurbiyenwkqjwlsl`（us-east-2，session pooler） | Supabase                                | `apps/intake/drizzle` |

| 看哪里                                                             | 地址                                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **运维总览**（健康、可用率、告警、错误统计、待处理 Lead + Replay） | https://heloc-demo.vercel.app/ops；命令行 `pnpm ops`（见 §5.1）                              |
| 服务健康（状态页，公开）                                           | https://heloc-demo-status.betteruptime.com                                                   |
| 运维看板（错误统计、5xx、延迟、业务流水）                          | Better Stack → Dashboards → **HELOC operations**                                             |
| 告警 / 事故历史                                                    | Better Stack → Uptime → Incidents                                                            |
| 异常（堆栈）                                                       | Better Stack → Errors → `heloc-intake` / `heloc-figure-mock` / `heloc-chase` / `heloc-email` |
| 日志                                                               | Better Stack → Telemetry → Live tail，source `heloc-*`                                       |
| 邮件投递                                                           | Resend → Emails；收信 → Cloudflare → Email Routing → Activity                                |

所有服务间链路：

```text
web → intake → figure-mock（软查询 / Document Review）
            → chase → email → Resend → 借款人
借款人回信 → Cloudflare MX → email-inbound Worker → intake（/v1/inbound-emails）
```

---

## 1. 部署

**原则：合并到 `main` 即部署。** 前提是 PR 的 CI 通过（format → lint → typecheck → check:env → test → build）。

| 组件                                             | 怎么部署                                                                                      | 备注                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| intake / figure-mock / chase / email             | 合并 `main`，Railway 按 `watchPatterns` 只重建改动的服务                                      | 启动命令 `node apps/<svc>/src/main.ts`，无构建步骤            |
| 数据库迁移                                       | 随 intake 部署自动执行（Railway pre-deploy：`node apps/intake/scripts/migrate.ts`）           | 迁移失败则新版本不上线，旧版本继续服务                        |
| web                                              | 合并 `main` → Vercel 自动部署                                                                 | `NEXT_PUBLIC_API_URL` 构建时写入；改了要重新部署              |
| email-inbound Worker                             | `cd apps/email-inbound && npx wrangler deploy`（token 见 CONFIGURATION §2.8）                 | 不随 `main` 自动部署                                          |
| Railway 配置（服务、区域、非 secret 变量、引用） | 改 `.railway/railway.ts` → `railway config plan` → `railway config apply --yes`               | 变量改动会触发该服务重新部署                                  |
| Secret                                           | 改根 `.env` → `node scripts/env-sync.ts --railway` → `railway redeploy --service <svc> --yes` | 服务只在启动时读变量                                          |
| Better Stack（监控、告警、看板、状态页）         | `node scripts/setup-betterstack.ts --monitors --alerts` 与 `node scripts/setup-dashboards.ts` | 都是幂等的；`setup-dashboards.ts --verify` 先验证全部图表 SQL |

**新增数据库迁移：** 改 `apps/intake/src/infrastructure/db/schema.ts` → `pnpm --filter @heloc/intake db:generate` → 提交 `drizzle/` 下的新文件。

**部署后验证：** `pnpm smoke`（本机被墙时加 `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890`），或 GitHub Actions → **Smoke (production)** → Run workflow（每 6 小时也会自动跑）。它不发邮件。

**回滚：**

- 后端：`git revert` 出问题的合并提交并推 `main`；紧急时在 Railway 服务的 Deployments 里对上一个成功版本点 Redeploy。数据库迁移只增不删，旧版本代码能在新 schema 上运行。
- web：Vercel → Deployments → 上一个版本 → Promote to Production（或 `vercel rollback`）。
- Worker：`npx wrangler rollback`。

---

## 2. 环境变量

完整说明（来源、如何生成、轮换）见 [CONFIGURATION.md](./CONFIGURATION.md)。🔒 = secret。

| 变量                                                         | 所在服务                  | 用途                                                      |
| ------------------------------------------------------------ | ------------------------- | --------------------------------------------------------- |
| `PORT` / `HOST` / `LOG_LEVEL` / `LOG_PRETTY`                 | 全部后端                  | 监听与日志（`PORT` 由 Railway 注入）                      |
| `BETTERSTACK_SOURCE_TOKEN` 🔒 / `BETTERSTACK_INGESTING_HOST` | 全部后端、Worker          | 日志投递到 Better Stack（每服务一个 source）              |
| `BETTERSTACK_ERRORS_DSN` 🔒                                  | 全部后端                  | 异常上报（Sentry SDK → Better Stack Errors）              |
| `DATABASE_URL` 🔒                                            | intake                    | Supabase Postgres（session pooler）                       |
| `FIGURE_API_URL` / `FIGURE_API_KEY` 🔒                       | intake                    | 调 figure-mock（key = figure-mock 的 `INTERNAL_API_KEY`） |
| `CHASE_API_URL` / `CHASE_API_KEY` 🔒                         | intake                    | 调 chase（key = chase 的 `INTERNAL_API_KEY`）             |
| `CORS_ORIGINS`                                               | intake                    | 允许调用 API 的前端来源                                   |
| `ALLOW_MOCK_OVERRIDE`                                        | intake                    | 是否透传 `X-Mock-Outcome` / `X-Mock-Fault`（演示用）      |
| `WEB_APP_URL`                                                | intake                    | 结果邮件里的结果页链接                                    |
| `INBOUND_API_KEY` 🔒                                         | intake                    | 收信 Worker 调 `/v1/inbound-emails` 的 key                |
| `OPS_API_KEY` 🔒                                             | intake、web（仅服务端）   | 运维读接口 `GET /v1/ops/*`（`/ops` 页面与 `pnpm ops`）    |
| `BETTERSTACK_QUERY_HOST/USERNAME/PASSWORD` 🔒                | web（仅服务端）           | `/ops` 页面查 Better Stack 的只读 SQL 连接                |
| `INTERNAL_API_KEY` 🔒                                        | figure-mock、chase、email | 校验调用方                                                |
| `MOCK_MODE`                                                  | figure-mock               | `deterministic`                                           |
| `EMAIL_SERVICE_URL` / `EMAIL_SERVICE_API_KEY` 🔒             | chase                     | 调 email（key = email 的 `INTERNAL_API_KEY`）             |
| `CHASE_REPLY_ADDRESS`                                        | chase                     | 补材料邮件的回复地址基址 `reply@linkerclaw.ai`            |
| `RESEND_API_KEY` 🔒                                          | email                     | Resend（仅发信权限）                                      |
| `EMAIL_PROVIDER` / `EMAIL_FROM`                              | email                     | `resend`；发件人 `HELOC Demo <noreply@linkerclaw.ai>`     |
| `INTAKE_API_URL` / `INTAKE_API_KEY` 🔒                       | email-inbound Worker      | 把收到的回信交给 intake                                   |
| `NEXT_PUBLIC_API_URL`                                        | web                       | intake 公网地址（构建时写入）                             |

web 的服务端 secret 用 `node scripts/env-sync.ts --vercel` 推到 Vercel production（下次部署生效）。

---

## 3. Replay

```http
POST /v1/leads/:id/replay
```

```bash
curl -X POST https://intake-production-12aa.up.railway.app/v1/leads/<lead_id>/replay
```

- **断点续跑**：从 Lead 还没完成的那一步继续，顺序为 预审 → 补材料邮件 → 材料审核 → 结果邮件。已完成的步骤不会重做（ADR-0002/0003/0004）。
  - 预审结果一旦拿到就不会再查；补材料邮件用同一个 chase id 重发，Resend 按幂等键 `chase:<id>` 去重，不会发两封；材料审核只做一次；结果邮件用幂等键 `notice:<id>`。
- **返回**：`200` 表示已恢复或本来就完成（会记一条 `lead.replayed`）；`502` 表示依赖仍不可用，`failed_step` 指出卡在哪一步；`404` 表示 Lead 不存在；`409` 表示并发 Replay，稍后重试即可。
- 结果页的 **Try again** 按钮就是调这个接口。
- 看执行链：

```sql
SELECT type, payload, created_at FROM lead_events WHERE lead_id = '<lead_id>' ORDER BY created_at, sequence;
```

批量找需要 Replay 的 Lead：

```sql
SELECT id, status, updated_at FROM leads
WHERE status IN ('failed', 'processing', 'submitted') AND updated_at < now() - interval '1 minute'
ORDER BY updated_at DESC;
```

---

## 4. 常见故障

**通用恢复流程：修复依赖 → 确认 `/health` 正常 → Replay 受影响的 Lead → 查 `lead_events`。**

### 4.1 Supabase 不可用

- **现象**：intake 的 `/health` 返回 `503 {"status":"degraded","checks":{"db":"fail"}}`；`POST /v1/leads` 返回 `500 internal_error`。
- **告警**：监控 `heloc-intake` 判定宕机，发邮件；日志告警 `heloc: errors logged`；Errors → `heloc-intake` 出现数据库异常。
- **排查**：Supabase 状态页、项目是否被暂停；`psql "$DATABASE_URL" -c 'select 1'`；看看是不是连接串或密码被改了。
- **恢复**：恢复数据库 → intake `/health` 显示 `db:ok` → 用上面的 SQL 找出停在 `processing`、`submitted`、`failed` 的 Lead 逐个 Replay。第一次写库就失败的请求没有产生 Lead，借款人需要重新提交。

### 4.2 Figure Mock 超时 / 出错

- **现象**：提交返回 `502`，`status=failed`、`failed_step=prequalify`，`error` 类似 `figure-mock: timed out after 5000ms` 或 `HTTP 503`；结果页显示 "We couldn't complete your credit check"。
- **告警**：`heloc: errors logged`（`lead.failed`）；若服务真的挂了，`heloc-figure-mock` 监控会发邮件。
- **排查**：figure-mock 的 `/health`；Railway 日志；看板里 "Errors by service" 与 "p95 response time"。
- **恢复**：服务恢复后 Replay（或在结果页点 Try again）。
- **演示触发**：提交时加请求头 `X-Mock-Fault: timeout`（超时）、`error`（503）或 `exception`（未处理异常，会出现在 Errors 里）。

### 4.3 Chase Service 不可用

- **现象**：需补材料的 Lead 返回 `502`，`failed_step=chase`，`chase.status=failed`，`error` 以 `chase:` 开头。
- **告警**：`heloc-chase` 监控；`heloc: errors logged`（`email.failed`、`lead.failed`）。
- **恢复**：chase 恢复后 Replay。补材料邮件沿用原 chase id，不会重复发送。

### 4.4 Email Service 不可用

- **现象**：同 4.3，但 `error` 里是 `email_unavailable`（chase 以 `502` 转述）。
- **告警**：`heloc-email` 监控；`heloc: HTTP 5xx responses`（chase 的 502）；`heloc: errors logged`。
- **恢复**：email 恢复后 Replay。结果邮件失败时同理，`failed_step=notify`。

### 4.5 Resend 发送失败

- **现象**：email 返回 `502 provider_error`，`details.provider_error` 是 Resend 的错误码，常见的有 `validation_error`（域名未验证 / 发件人不合法）、`daily_quota_exceeded`、`rate_limit_exceeded`、`invalid_api_key`；随后 chase 返回 502，Lead `failed_step=chase` 或 `notify`。
- **排查**：Resend → Emails / Domains（`linkerclaw.ai` 是否仍为 verified）/ API Keys。
- **特例：邮件被抑制（suppressed）**：收件地址曾经硬退信后，Resend 会**接受**请求但不投递（`last_event: suppressed`），我们这边会显示已发送。检查：`GET https://api.resend.com/emails/<email_message_id>`（需要管理员 key）。确认原因已修复后，在 Resend → Suppressions 移除该地址，再 Replay。幂等键在 24 小时内有效；超过 24 小时重发会重新投递。
- **恢复**：修复 key、配额或域名后 Replay。

### 4.6 借款人数据不合法

- **现象**：`POST /v1/leads` 返回 `400 invalid_request`，`details` 列出字段（如 `email`、`mortgage_balance`）；**不会创建 Lead**。
- **处理**：属于预期行为，前端会逐字段提示，无需恢复。若同一字段大量报 400，检查前后端 schema 是否一致（两边都用 `packages/contracts` 的 `leadInputSchema`）。

### 4.7 借款人回信了，但 Lead 没有推进

- **先看 Lead 时间线**：若有 `documents.rejected`，说明是被拒收，原因如下，不需要修复：

| reason                             | 含义                              | 处理                                                  |
| ---------------------------------- | --------------------------------- | ----------------------------------------------------- |
| `no_attachments`                   | 没带附件（嵌在正文里的图片不算）  | 让借款人重新回复并附上文件                            |
| `sender_mismatch`                  | 发件人不是问卷里填的邮箱          | 用问卷邮箱回复（**用 Gmail 演示时，问卷就填 Gmail**） |
| `not_authenticated`                | Cloudflare 判定 DMARC 未通过      | 发件域的 SPF/DKIM 配置有问题，属于发件方的问题        |
| `already_received`                 | 这个 Lead 已经收到过材料          | 预期行为                                              |
| `chase_not_sent` / `unknown_chase` | 补材料邮件还没发出 / 回复地址无效 | 核对回复地址                                          |

- **时间线里什么都没有**：看 Better Stack source `heloc-email-inbound`，事件含义如下：
  - `inbound.received`：Worker 收到了信。
  - `inbound.forwarded`：已交给 intake，附带 intake 的判定。
  - `inbound.forward_failed` / `inbound.rejected_by_intake`：没有交到 intake，同时会触发告警 `heloc: borrower reply pipeline failing`。
  - 若连 `inbound.received` 都没有，去 Cloudflare → Email Routing → Activity 查这封信是否被拒（DMARC）或路由规则没匹配上。
- **intake 挂了或 key 不对时**：intake 返回 5xx/401/403/404，Worker 会抛错，Cloudflare 以临时错误拒收，对方邮件服务器通常会持续重投数天。修好 intake 或 key 后回信会自动进来，无需人工处理。
- **审核或结果邮件失败**（`failed_step=review` 或 `notify`）：按 4.2 / 4.4 处理后 Replay。

### 4.8 其他

- **并发 Replay 返回 `409 concurrent_update`**：Lead 使用乐观锁，稍后重试即可。
- **web 调不通 intake（浏览器报 CORS）**：检查 intake 的 `CORS_ORIGINS` 与 web 的 `NEXT_PUBLIC_API_URL`（改了 web 变量要重新部署）。
- **本机打不开 `*.vercel.app` 或某些 Railway 地址**：本地网络问题（DNS 污染），走代理即可，或以 Better Stack 监控 / 状态页为准。

---

## 5. 监控与告警

| 类型     | 名称                                                  | 条件                                            | 通知           |
| -------- | ----------------------------------------------------- | ----------------------------------------------- | -------------- |
| Uptime   | `heloc-intake` / `-figure-mock` / `-chase` / `-email` | `/health` 非 2xx（intake 还检查数据库）         | 邮件 → on-call |
| Uptime   | `heloc-web`                                           | 页面不含 "HELOC"                                | 邮件 → on-call |
| 日志告警 | `heloc: errors logged`                                | 5 分钟内出现 ≥1 条 error/fatal 日志（任一服务） | 邮件 → 团队    |
| 日志告警 | `heloc: HTTP 5xx responses`                           | 5 分钟内出现 ≥1 次 5xx                          | 邮件 → 团队    |
| 日志告警 | `heloc: borrower reply pipeline failing`              | Worker 未能把回信交给 intake                    | 邮件 → 团队    |

- **接收人**：`simonarthur2012@gmail.com`（根 `.env` 的 `ALERT_EMAIL`）。Better Stack 免费版不支持升级策略，所以把这位用户设为值班人，并且团队只有这一位成员（`setup-betterstack.ts --alerts`）。
- **看板 "HELOC operations"**：
  - 错误数、5xx 数、提交数、失败数；
  - 按服务分的错误数与 5xx；
  - Top errors 表；
  - p95 延迟；
  - Lead 流水（各事件数量）；
  - 回信结果（接收 / 各拒收原因）；
  - 回信链路失败数。

  全部图表 SQL 可用 `node scripts/setup-dashboards.ts --verify` 验证。
  **注意：Better Stack 看板只能查询 metrics，不能查原始日志。** 图表用到的字段（`event`、`status`、`reply_outcome`、`error_message`、`response_time_ms`；`level` 是内置的）由脚本在每个 source 上定义为「日志转指标」，写入时提取，不回填历史。要加新图表，先在 `METRICS` 里定义字段；日志告警则用 exploration（直接查原始日志），定义在 `setup-betterstack.ts --alerts`。

- **状态页**：https://heloc-demo-status.betteruptime.com，展示 5 个服务的实时状态与 30 天可用率。
- **日志跨服务追踪**：所有日志带 `request_id`（经 `X-Request-Id` 在服务间传递）和 `lead_id`。在 Better Stack Live tail 里按 `request_id:<id>` 搜索即可看到一次请求的全链路；命令行用 `pnpm ops logs <id>`（含归档日志）。
- **定义在哪**：告警规则、看板 SQL、日志转指标字段都在 `packages/ops`，看板、`/ops` 页面、`pnpm ops` 共用同一份；改完先 `setup-dashboards.ts --verify`，再运行两个 setup 脚本同步到 Better Stack。

### 5.1 运维总览：`/ops` 页面与 `pnpm ops`

**https://heloc-demo.vercel.app/ops**（公开、只读，唯一的写操作是对失败 Lead 点 Replay）每 30 秒刷新：

- 5 个服务的实时健康（版本、延迟、数据库检查）与状态页的 30 天可用率；
- 3 条日志告警的状态：最近 5 分钟是否命中（= 正在告警）、24 小时命中数、最后一次；
- 24 小时错误统计：错误数、5xx、提交 / 失败的 Lead、按服务按小时的错误、Top errors；
- **待处理的 Lead**：失败的，或卡在处理中超过 2 分钟的（intake `GET /v1/ops/leads`），都可直接 Replay（卡住的会先确认）。

页面服务端用只读的 Better Stack SQL 连接和 `OPS_API_KEY`，浏览器拿不到任何凭据；Better Stack 管理 token 不上 Vercel。某一块数据取不到时只有那一块显示原因。

**`pnpm ops`**（本机，读根 `.env`；被墙时加 `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890`）：

| 命令                                                        | 作用                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm ops`                                                  | 与 `/ops` 页面相同的总览                                         |
| `pnpm ops alerts`                                           | 总览 + Better Stack 最近的事故（open / acknowledged / resolved） |
| `pnpm ops errors [--hours N]`                               | 按服务按小时的错误、Top errors                                   |
| `pnpm ops attention`                                        | 待处理的 Lead                                                    |
| `pnpm ops lead <lead_id>`                                   | Lead 详情与事件时间线                                            |
| `pnpm ops logs <request_id\|lead_id\|chase_id> [--hours N]` | 所有服务里含该 id 的日志（近期 + 归档）                          |
| `pnpm ops replay <lead_id>`                                 | Replay 失败或卡住的 Lead（需确认，`--yes` 跳过）                 |
| `pnpm ops incident ack\|resolve <id>`                       | 确认 / 关闭事故（需确认）                                        |
| `pnpm ops smoke`                                            | 线上冒烟（不发邮件）                                             |

Claude Code 里有项目技能 **heloc-devops**（`.claude/skills/heloc-devops`），按上面的工具和本手册执行运维操作：只读操作直接做，写操作先确认，不打印任何 secret。

---

## 6. 演练（Drills）

| 演练            | 怎么做                                                                        | 期望                                                                                                              |
| --------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 服务宕机告警    | 临时建一个指向 `…/health/alert-drill`（会 404）的 monitor                     | 约 1 分钟内 Incidents 出现事故，时间线显示 "Sent an email to …"；**演练完删掉这个 monitor**                       |
| 错误告警 + 异常 | 提交 Lead 时带 `X-Mock-Fault: exception`                                      | Errors 出现异常；约 2 分钟内收到 `heloc: errors logged`；Lead `failed_step=prequalify` → Replay 后恢复为 approved |
| 断点续跑        | 带 `X-Mock-Fault: error` 提交 → 在结果页点 Try again                          | 从失败恢复到 approved                                                                                             |
| 回信全流程      | 用问卷邮箱回复补材料邮件（或点邮件里的 **Reply with documents**），附一个 PDF | 结果页自动变为 "You're prequalified"，收到结果邮件                                                                |
| 线上冒烟        | `pnpm smoke` / Actions → Smoke (production)                                   | 9 项全部通过                                                                                                      |

---

## 7. Secret 轮换 / 泄露

见 [CONFIGURATION §6](./CONFIGURATION.md)。要点：先在服务商那边撤销，再替换；改根 `.env` → `env-sync --railway` → 重新部署调用方与被调用方；Worker 的 secret 用 `wrangler deploy --secrets-file` 更新。
