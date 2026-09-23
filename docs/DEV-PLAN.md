# HELOC Trial Day — 开发计划

> 目标：1 个工作日内交付一条**真实部署、真实落库、真实投递、可观测、可重放**的 HELOC 申请链路。
> 配置与 Secret 设计见 [CONFIGURATION.md](./CONFIGURATION.md)。

---

## 0. 仓库

| 仓库 | 本地路径 | 内容 |
|---|---|---|
| [HELOC-AI/heloc-demo](https://github.com/HELOC-AI/heloc-demo) | `~/project/HELOC-AI` | web / intake / figure-mock / chase + 共享 packages + docs |
| [HELOC-AI/heloc-email-service](https://github.com/HELOC-AI/heloc-email-service) | `~/project/heloc-email-service` | 独立的通用邮件发送服务 |

两个仓库都是 public（Vercel Hobby 不能用 Git 集成部署组织下的私有仓库）。**不提交任何 secret。**

---

## 1. 需求分析：需要在实现前定下来的点

需求文档整体清晰，以下是文档没说清、或按原文实现会出问题的地方，及本计划的处理方式：

| # | 问题 | 处理 |
|---|---|---|
| 1 | 文档给 intake 配的是 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`，但 ORM 选的是 Drizzle —— Drizzle 需要的是 Postgres 连接串 | 只用 `DATABASE_URL`，不生成 service role key |
| 2 | Supabase 直连地址 `db.<ref>.supabase.co` 仅 IPv6，Railway 出网连不上 | 使用 **Session pooler**（`*.pooler.supabase.com:5432`） |
| 3 | Supabase 默认通过 Data API 暴露 `public` schema，拿到 anon key 即可读 leads（含 PII） | 迁移中对 4 张表 `ENABLE ROW LEVEL SECURITY` 且不建 policy |
| 4 | 前端不能直连 figure-mock，文档里的 `X-Mock-Outcome` 前端用不上 | intake 接受 `X-Mock-Outcome` 请求头并透传（`ALLOW_MOCK_OVERRIDE=true` 时才生效）；Quiz 页加一个 “Demo outcome” 下拉 |
| 5 | `credit_band >= 740` 是字符串区间，比较规则未定义 | 固定枚举：`<580`, `580-619`, `620-659`, `660-699`, `700-739`, `740-779`, `780+`，按区间下界比较 |
| 6 | Rejected 的示例原因是 `insufficient_home_equity`，但规则只看 credit | 规则先算净值：`max_line = 0.85 × home_value − mortgage_balance`，`< 25,000` → rejected(`insufficient_home_equity`)；再按 credit 判断 |
| 7 | 幂等键 `chase:{chase_id}` —— chase_id 由谁生成？chase-service 无 DB | **intake 先落 `chases` 行拿到 id**，再把 `chase_id` 传给 chase-service；chase → email 带 `Idempotency-Key: chase:{chase_id}`；email-service 透传给 Resend（Resend 原生支持 24h 幂等） |
| 8 | Replay 语义未定义 | Replay = **从断点续跑**：已有 decision 则复用；need_more_documents 且 chase 未 `sent` 则用同一 chase_id 重发；已 `sent` 则跳过。写 `lead.replayed` 事件 |
| 9 | Resend 测试发件人 `onboarding@resend.dev` 只能发给账号本人邮箱 | 优先验证一个自有域名；否则测试收件箱 = Resend 账号邮箱（见 CONFIGURATION §5） |
| 10 | 前端跨域调用 intake | intake 配 `@fastify/cors`，白名单 `CORS_ORIGINS` |
| 11 | Railway 没有原生 log drain | 各服务在进程内用 `@logtail/pino` 直接投递到 Better Stack |
| 12 | Better Stack “Errors” | 其 Error Tracking 兼容 Sentry SDK：用 `@sentry/node` + Better Stack DSN（不引入 Sentry 服务本身） |
| 13 | Common failure modes 需要演示“Figure timeout” | figure-mock 额外支持 `X-Mock-Fault: timeout \| 500`（同样由 intake 透传），用于演示 failed → replay |

事件类型在文档基础上补充：`lead.replayed`、`lead.failed`。

---

## 2. 架构要点

### 2.1 主链路（同步编排，无 MQ）

```text
POST /v1/leads
 1. Zod 校验                                → 400 (invalid borrower data)
 2. INSERT leads(status=submitted)          + event lead.created
 3. status=processing                       + event figure.requested
 4. POST figure-mock /v1/soft-pull (5s 超时, 1 次重试)
 5. INSERT figure_decisions                 + event figure.{approved|rejected|need_more_documents}
 6. status=approved | rejected | need_more_documents
 7. if need_more_documents:
      INSERT chases(status=pending)         + event chase.created
      POST chase /v1/chases {chase_id, ...} (10s 超时)
        └─ chase: TemplateComposer → POST email /v1/send (Idempotency-Key: chase:{chase_id})
             └─ email: ResendProvider.send → {message_id}
      UPDATE chases(status=sent, email_message_id, sent_at)
      status=chase_sent                     + event email.sent
 8. 任一步异常 → status=failed + event lead.failed / email.failed，返回 502 + lead_id
 9. 返回 { lead_id, status, offer? , reason?, documents? }
```

### 2.2 横切约定

- **request_id**：intake 生成（或沿用入站 `X-Request-Id`），通过 `X-Request-Id` 传给下游；所有日志带 `service / request_id / lead_id / event`。
- **服务间鉴权**：每一跳独立 `Bearer` key（详见 CONFIGURATION §3）。
- **/health**：`{status, service, version, timestamp}`，version 取 `RAILWAY_GIT_COMMIT_SHA` 前 7 位或 package version。intake 的 health 额外做 `SELECT 1`（`checks.db`）。
- **契约**：`packages/contracts` 用 Zod 定义所有跨服务请求/响应；email-service 独立仓库自带一份同构 schema（体量很小，复制优于跨仓库发包）。

### 2.3 Monorepo 结构（pnpm workspace，不引入 Turborepo）

```text
heloc-demo/
├── apps/
│   ├── web/            Next.js (App Router) + Tailwind + shadcn/ui → Vercel
│   ├── intake/         Fastify + Drizzle → Railway（pre-deploy 跑迁移）
│   ├── figure-mock/    Fastify → Railway
│   └── chase/          Fastify → Railway
├── packages/
│   ├── contracts/      Zod schema + TS 类型（Lead、SoftPull、Chase、SendEmail、Health）
│   ├── config/         loadConfig() + 每个 service 的 env schema
│   ├── logger/         pino 预设（redact、Better Stack transport）
│   └── server-kit/     Fastify 启动套件：/health、request-id、bearer auth、错误处理、Sentry
├── docs/  DEV-PLAN.md  CONFIGURATION.md  RUNBOOK.md
├── scripts/ smoke.ts   check-env-examples.ts
├── .github/workflows/ci.yml
└── pnpm-workspace.yaml / tsconfig.base.json / eslint.config.js / vitest.workspace.ts
```

后端构建：`tsup` 把 app + workspace packages 打成单个 `dist/main.js`；Railway 每个 service 用 `apps/<name>/railway.json`（config-as-code：build/start 命令、`watchPatterns`、`healthcheckPath=/health`，intake 额外 `preDeployCommand` 跑 `drizzle-kit migrate`）。

---

## 3. 数据库

4 张表（Drizzle schema 位于 `apps/intake/src/db/schema.ts`）：

| 表 | 关键字段 | 约束 / 索引 |
|---|---|---|
| `leads` | 问卷 9 个字段、`status`、`created_at`、`updated_at` | `status` 用 pg enum；金额用 `numeric(12,2)` |
| `figure_decisions` | `lead_id`、`status`、`raw_response jsonb` | FK → leads；index(lead_id, created_at) |
| `chases` | `lead_id`、`status(pending/sent/failed)`、`subject`、`body`、`email_message_id`、`sent_at` | FK；**unique(lead_id)**（一个 lead 只追一次，replay 复用） |
| `lead_events` | `lead_id`、`type`、`payload jsonb` | FK；index(lead_id, created_at) |

迁移：`drizzle-kit generate` 生成 SQL 并入库；最后一个迁移追加 `ENABLE ROW LEVEL SECURITY`。

---

## 4. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | figure-mock 决策规则（全区间表驱动）、Offer 计算、TemplateComposer 输出（快照）、状态机转换、config 校验 |
| 服务集成 | Vitest + `fastify.inject` + **PGlite**（内存 Postgres，无需 Docker/secret） | intake 三条路径；figure 超时 → failed；chase 失败 → failed → replay 成功且**只发一次**；replay 对 approved 幂等 |
| Email 服务 | Vitest + FakeProvider | 鉴权、参数校验、幂等 key 透传、provider 报错映射为 502 |
| 线上 smoke | `scripts/smoke.ts` | 打 4 个 `/health`；用 `X-Mock-Outcome` 各提交一次 lead，断言状态 |

CI（`.github/workflows/ci.yml`，PR 与 main 触发）：`pnpm install --frozen-lockfile` → lint → typecheck → test → build。无 secret。

---

## 5. 时间线（约 9 小时）

> 原则：**先打通部署骨架，再填业务**。所有外部依赖（DNS 验证、平台账号）放在最前面异步进行。

### Phase 0 — 账号与 Secret 准备（0.5h）🧑 需要你操作

- [ ] Supabase：建 Project（记下 DB 密码 → 密码管理器）
- [ ] Resend：添加域名并配 DNS（验证需要时间，先做）；建 Sending-access API key
- [ ] Railway：建 Project `heloc-demo`，连接 GitHub org `HELOC-AI`
- [ ] Vercel：连接 GitHub org
- [ ] Better Stack：注册；建 4 个 Telemetry source + 1 个 Errors application
- [ ] `openssl rand -hex 32` ×3 生成三把 `INTERNAL_API_KEY`
- [ ] 确定测试收件箱

**产出**：密码管理器里每个 provider 一个条目，值齐全。

### Phase 1 — Monorepo 脚手架（1h）

- [ ] pnpm workspace、tsconfig.base、ESLint(flat) + Prettier、Vitest workspace
- [ ] `packages/config`、`packages/logger`、`packages/server-kit`、`packages/contracts`
- [ ] GitHub Actions CI
- [ ] `heloc-email-service` 仓库脚手架（同样的 lint/test/CI 约定，自带 Dockerfile）

**验收**：`pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿，CI 在 PR 上跑通。

### Phase 2 — Walking Skeleton 上线（1h）

- [ ] 4 个后端服务只实现 `/health`，全部部署到 Railway，拿到公网域名
- [ ] 按 CONFIGURATION §2 填 Railway 变量（引用变量串起 URL 和 key）
- [ ] web 部署一个占位页到 Vercel
- [ ] Better Stack Uptime：4 个 `/health` monitor + Email alert
- [ ] GitHub Repository Variables 填 URL；`scripts/smoke.ts` 的 health 部分跑通

**验收**：5 个公网 URL 可访问，Better Stack 显示 4 个 Healthy。**这之后每次 merge main 自动部署。**

### Phase 3 — 数据层 + Figure Mock + Intake 编排（2h）

- [ ] Drizzle schema + 迁移 + RLS；Railway pre-deploy 迁移
- [ ] figure-mock：确定性规则、Offer 计算、`X-Mock-Outcome` / `X-Mock-Fault`
- [ ] intake：`POST /v1/leads`、`GET /v1/leads/:id`（含 decision、chase、events 时间线）
- [ ] 集成测试（PGlite）覆盖 approved / rejected / need-more-documents(chase 用 fake)

**验收**：线上 curl 三种 outcome，Supabase 里能看到 leads / figure_decisions / lead_events。

### Phase 4 — Chase + Email Service（1.5h）

- [ ] email-service：`POST /v1/send`、`EmailProvider` 接口、`ResendProvider`、幂等 key 透传
- [ ] chase：`POST /v1/chases`、`EmailComposer` 接口 + `TemplateComposer`（HTML + text），文档类型 → 人类可读名称映射（`income_verification` → “Proof of income”）
- [ ] intake 接入 chase；`POST /v1/leads/:id/replay` 断点续跑
- [ ] 测试：chase 失败 → failed → replay → 只发一封

**验收**：need-more-documents 线上提交后，测试邮箱真实收到邮件；`chases.email_message_id` 与 Resend 后台一致。

### Phase 5 — 前端（1.5h）

- [ ] `/`：Quiz 表单（react-hook-form + 复用 `packages/contracts` 的 Zod schema 做客户端校验），州下拉、区间下拉、金额输入；Demo outcome 下拉
- [ ] `/result/[leadId]`：按状态展示 Offer 卡片 / 拒绝原因 / 所需材料 + “邮件已发送至 …”；可选展示事件时间线
- [ ] loading / 错误态（intake 502 时展示 lead_id 便于 replay）

**验收**：在 Vercel 公网地址完成三种路径的完整演示。

### Phase 6 — 可观测性收尾（1h）

- [ ] 4 个服务日志进入 Better Stack，能按 `lead_id` / `request_id` 跨服务检索
- [ ] `@sentry/node` → Better Stack Errors，制造一次异常验证可见
- [ ] 告警：Uptime 失败、日志中 `event=email.failed` / `level=error` 触发 Email 告警

**验收**：Better Stack 能看到 Logs、Errors，Alert Destination 已配置并收到过一次测试告警。

### Phase 7 — 文档、故障演练、Demo 彩排（1h）

- [ ] `docs/RUNBOOK.md`：部署、环境变量表（引用 CONFIGURATION）、Replay、6 种 failure mode 的现象/定位/恢复
- [ ] 故障演练：`X-Mock-Fault: timeout` → failed → replay；停掉 email 服务 → failed → 恢复 → replay（确认不重复发信）
- [ ] README：架构图、URL 列表、本地开发、Demo 脚本
- [ ] 按需求文档 §25 彩排一遍（3~5 分钟），对照 §26 验收清单逐项打勾

---

## 6. 风险与预案

| 风险 | 预案 |
|---|---|
| Resend 域名 DNS 验证迟迟不过 | 退回 `onboarding@resend.dev` + Resend 账号邮箱作为测试收件箱 |
| Railway monorepo 构建识别不到 workspace 依赖 | 改用每个 app 的 Dockerfile（根目录作为 build context） |
| Supabase pooler 连接偶发断开 | postgres-js 设 `max: 5`、`idle_timeout`；/health 暴露 db 检查 |
| 时间不够 | 砍顺序：结果页事件时间线 → Sentry Errors（保留日志型告警）→ shadcn 美化 |

---

## 7. 下一阶段（不在今天范围）

与需求文档 §28 一致：文档上传（Signed URL）→ 异步队列 / 重试 / DLQ → 真实 Figure 集成 → Auth 与后台 → OpenTelemetry。
`EmailComposer` 与 `EmailProvider` 已是接口，接入 `LLMComposer` / `SESProvider` 无需改动调用方。
