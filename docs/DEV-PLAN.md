# HELOC Trial Day — 开发计划

> 目标：1 个工作日内交付一条**真实部署、真实落库、真实投递、可观测、可重放**的 HELOC 申请链路。
> 配置与 Secret 设计见 [CONFIGURATION.md](./CONFIGURATION.md)。

---

## 0. 仓库

| 仓库                                                          | 本地路径             | 内容                                                              |
| ------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| [HELOC-AI/heloc-demo](https://github.com/HELOC-AI/heloc-demo) | `~/project/HELOC-AI` | web / intake / figure-mock / chase / email + 共享 packages + docs |

单一 monorepo，public（Vercel Hobby 不能用 Git 集成部署组织下的私有仓库）。**不提交任何 secret。**

> 与需求文档差异：文档 §12.1 / §17.2 要求 email-service 独立仓库。本项目按决定放进 monorepo 的 `apps/email`，
> 但保持“独立服务”的边界：独立部署、独立 key、**只依赖 `packages/*` 的通用能力，不 import 其他 app 的代码**，
> 需要时可以原样拆出为独立仓库。

---

## 1. 需求分析：需要在实现前定下来的点

需求文档整体清晰，以下是文档没说清、或按原文实现会出问题的地方，及本计划的处理方式：

| #   | 问题                                                                                                                         | 处理                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 文档给 intake 配的是 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`，但 ORM 选的是 Drizzle —— Drizzle 需要的是 Postgres 连接串 | 只用 `DATABASE_URL`，不生成 service role key                                                                                                                                          |
| 2   | Supabase 直连地址 `db.<ref>.supabase.co` 仅 IPv6，Railway 出网连不上                                                         | 使用 **Session pooler**（`*.pooler.supabase.com:5432`）                                                                                                                               |
| 3   | Supabase 默认通过 Data API 暴露 `public` schema，拿到 anon key 即可读 leads（含 PII）                                        | 迁移中对 4 张表 `ENABLE ROW LEVEL SECURITY` 且不建 policy                                                                                                                             |
| 4   | 前端不能直连 figure-mock，文档里的 `X-Mock-Outcome` 前端用不上                                                               | intake 接受 `X-Mock-Outcome` 请求头并透传（`ALLOW_MOCK_OVERRIDE=true` 时才生效）；Quiz 页加一个 “Demo outcome” 下拉                                                                   |
| 5   | `credit_band >= 740` 是字符串区间，比较规则未定义                                                                            | 固定枚举：`<580`, `580-619`, `620-659`, `660-699`, `700-739`, `740-779`, `780+`，按区间下界比较                                                                                       |
| 6   | Rejected 的示例原因是 `insufficient_home_equity`，但规则只看 credit                                                          | 规则先算净值：`max_line = 0.85 × home_value − mortgage_balance`，`< 25,000` → rejected(`insufficient_home_equity`)；再按 credit 判断                                                  |
| 7   | 幂等键 `chase:{chase_id}` —— chase_id 由谁生成？chase-service 无 DB                                                          | **intake 先落 `chases` 行拿到 id**，再把 `chase_id` 传给 chase-service；chase → email 带 `Idempotency-Key: chase:{chase_id}`；email-service 透传给 Resend（Resend 原生支持 24h 幂等） |
| 8   | Replay 语义未定义                                                                                                            | Replay = **从断点续跑**：已有 decision 则复用；need_more_documents 且 chase 未 `sent` 则用同一 chase_id 重发；已 `sent` 则跳过。写 `lead.replayed` 事件                               |
| 9   | Resend 测试发件人 `onboarding@resend.dev` 只能发给账号本人邮箱                                                               | 优先验证一个自有域名；否则测试收件箱 = Resend 账号邮箱（见 CONFIGURATION §5）                                                                                                         |
| 10  | 前端跨域调用 intake                                                                                                          | intake 配 `@fastify/cors`，白名单 `CORS_ORIGINS`                                                                                                                                      |
| 11  | Railway 没有原生 log drain                                                                                                   | 各服务在进程内用 `@logtail/pino` 直接投递到 Better Stack                                                                                                                              |
| 12  | Better Stack “Errors”                                                                                                        | 其 Error Tracking 兼容 Sentry SDK：用 `@sentry/node` + Better Stack DSN（不引入 Sentry 服务本身）                                                                                     |
| 13  | Common failure modes 需要演示“Figure timeout”                                                                                | figure-mock 额外支持 `X-Mock-Fault: timeout \| 500`（同样由 intake 透传），用于演示 failed → replay                                                                                   |

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
- **契约**：`packages/contracts` 用 Zod 定义所有跨服务请求/响应，所有 app（含 email）共用。

### 2.3 Monorepo 结构（pnpm workspace，不引入 Turborepo）

```text
heloc-demo/
├── apps/
│   ├── web/            Next.js (App Router) + Tailwind + shadcn/ui → Vercel
│   ├── intake/         Fastify + Drizzle → Railway（pre-deploy 跑迁移）
│   ├── figure-mock/    Fastify → Railway
│   ├── chase/          Fastify → Railway
│   └── email/          Fastify + EmailProvider(Resend) → Railway
├── packages/
│   ├── contracts/      Zod schema + TS 类型（Lead、SoftPull、Chase、SendEmail、Health）
│   ├── config/         loadConfig() + 每个 service 的 env schema
│   ├── logger/         pino 预设（redact、Better Stack transport）
│   └── server-kit/     Fastify 启动套件：/health、request-id、bearer auth、错误处理、Sentry
├── docs/  DEV-PLAN.md  CONFIGURATION.md  RUNBOOK.md
├── scripts/ check-env-examples.ts   smoke.ts(Phase 2)
├── .github/workflows/ci.yml
└── pnpm-workspace.yaml / tsconfig.base.json / eslint.config.js / vitest.config.ts / .node-version
```

后端**无构建步骤**：Node 24 原生 type stripping 直接运行 `node apps/<name>/src/main.ts`（tsconfig 开 `erasableSyntaxOnly`，禁止 enum 等非可擦除语法）。workspace packages 直接导出 `src/*.ts`，Next.js 通过 `transpilePackages` 消费。
不打包也避免了 pino transport 在 bundle 后解析不到模块的问题。Node 版本由 `.node-version` 统一（CI 与 Railpack 都读它）。

Railway 全部用 **Infrastructure as Code** 描述：`.railway/railway.ts`（`railway config plan` / `railway config apply`）。
其中包含 4 个 service 的 GitHub 来源、构建/启动命令、`watchPatterns`、`/health` 健康检查、重启策略、区域（`iad`，靠近 Supabase us-east-2）、公网域名和全部非 secret 变量；
服务间的 URL / key 用类型化引用（如 `chase.env.INTERNAL_API_KEY`）。Railway 已弃用 `railway.json`（config-as-code），故不再使用。

---

### 2.4 领域设计（DDD）

> 术语以各上下文的 `CONTEXT.md` 为准，上下文关系见 [CONTEXT-MAP.md](../CONTEXT-MAP.md)，关键决策见 [docs/adr](./adr)。

#### 限界上下文

| 上下文            | 服务               | 子域类型         | 领域模型的重心                                    |
| ----------------- | ------------------ | ---------------- | ------------------------------------------------- |
| Lead Intake       | `apps/intake`      | 核心域           | `Lead` 聚合：状态机、预审结果、Chase、领域事件    |
| Prequalification  | `apps/figure-mock` | 外部系统（模拟） | 预审策略（规则 + Offer 计算），无持久化           |
| Borrower Outreach | `apps/chase`       | 支撑域           | 把 Chase 写成 Chase Message（Composer），无持久化 |
| Email Delivery    | `apps/email`       | 通用域           | Outbound Email + 可替换的 Email Provider          |

`packages/contracts` 是 **Published Language**（线上契约 DTO），不是共享领域模型：每个服务在接口层 / 防腐层把 DTO 映射为自己的领域类型。

#### 每个服务的分层（六边形）

```text
apps/<service>/src/
├── domain/            实体、值对象、聚合、领域事件、领域服务、仓储接口 —— 纯 TypeScript
├── application/       用例（命令 / 查询），定义出站端口（gateway 接口），编排领域对象
├── infrastructure/    端口实现：Drizzle 仓储、HTTP gateway（防腐层）、Resend 适配器、Composer
├── interface/http/    Fastify 路由：用 contracts 校验 DTO → 命令 → 用例 → DTO
├── app.ts             组合根：把实现注入用例（唯一知道所有层的地方）
└── main.ts            读配置、创建 logger、启动
```

依赖只能向内：`interface`、`infrastructure` → `application` → `domain`。用 ESLint `no-restricted-imports` 强制：

- `domain/` 不得 import `application/`、`infrastructure/`、`interface/`，也不得 import `fastify`、`drizzle-orm`、`zod`、`@heloc/contracts`、`@heloc/server-kit`
- `application/` 不得 import `infrastructure/`、`interface/` 以及上述框架包

#### Lead Intake：`Lead` 聚合

| 组成                                    | 类型               | 说明                                                                                                  |
| --------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `Lead`                                  | 聚合根             | `id`、`status`、`borrower`、`property`、`creditProfile`、`purpose`、`decision?`、`chase?`、待发布事件 |
| `Borrower`、`Property`、`CreditProfile` | 值对象             | 创建时校验不变量（金额非负、房价 > 0 …）                                                              |
| `PrequalDecision`                       | 值对象（判别联合） | `Approved{offer}` \| `Rejected{reason}` \| `NeedMoreDocuments{missingDocuments}`                      |
| `Offer`、`MissingDocument`              | 值对象             |                                                                                                       |
| `Chase`                                 | 聚合内实体         | `id`、`status(pending/sent/failed)`、`message?`、`emailMessageId?`、`sentAt?`                         |
| `LeadEvent`                             | 领域事件           | `lead.created` … `email.failed`、`lead.replayed`、`lead.failed`                                       |

聚合行为（每个方法守护自己的前置条件并记录事件；非法转换抛领域错误）：

| 方法                       | 前置条件                                  | 结果 / 事件                                                                                                            |
| -------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Lead.submit(input)`       | —                                         | `submitted`；`lead.created`                                                                                            |
| `startPrequalification()`  | 尚无 decision                             | `processing`；`figure.requested`                                                                                       |
| `recordDecision(decision)` | `processing`，尚无 decision               | `approved` / `rejected` / `need_more_documents`；`figure.*`                                                            |
| `openChase(chaseId)`       | decision 为 NeedMoreDocuments，尚无 Chase | Chase `pending`；`chase.created`                                                                                       |
| `markChaseSent(receipt)`   | Chase 为 `pending` / `failed`             | Chase `sent`，Lead `chase_sent`；`email.sent`                                                                          |
| `markChaseFailed(reason)`  | Chase 未 `sent`                           | Chase `failed`，Lead `failed`；`email.failed`                                                                          |
| `fail(step, reason)`       | 未到终态                                  | `failed`；`lead.failed`                                                                                                |
| `replay()`                 | —                                         | `lead.replayed`                                                                                                        |
| `nextStep()`（查询）       | —                                         | `prequalify` \| `chase` \| `done`，**由 decision / Chase 推导而非 status**，所以 `failed` 的 Lead 也知道该从哪一步继续 |

不变量（ADR-0003）：一个 Lead 至多一个 decision 且不可变；Chase 只存在于 NeedMoreDocuments 的 Lead；`chase_sent` ⇔ Chase 已发出。

应用层：

| 用例              | 流程                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SubmitLead`      | `Lead.submit` → 保存 → `AdvanceLead`                                                                                                                                                                                                |
| `ReplayLead`      | 加载 → `lead.replay()` → 保存 → `AdvanceLead`                                                                                                                                                                                       |
| `AdvanceLead`     | 循环 `lead.nextStep()`：`prequalify` → `PrequalGateway.softPull` → `recordDecision`；`chase` → `openChase`（如需）→ `ChaseGateway.send` → `markChaseSent`。**每一步后保存**；gateway 失败 → `fail` / `markChaseFailed` 后保存并返回 |
| `GetLead`（查询） | 读模型直接查询 lead + decision + chase + events，不经聚合（CQRS-lite）                                                                                                                                                              |

端口：`LeadRepository`（domain，保存聚合时在**同一事务**写入新事件到 `lead_events`）、`PrequalGateway`、`ChaseGateway`、`Clock`、`IdGenerator`（application）。
防腐层：`FigureHttpGateway` 把 Figure 的 `need-more-documents` / `documents` 翻译为 `NeedMoreDocuments` / `MissingDocument`，原始响应存入 `figure_decisions.raw_response` 供审计。
演示用的 Forced Outcome / Injected Fault 不进领域模型：接口层读取请求头，作为用例的 `PrequalScenario` 选项透传给 gateway。

#### 其他上下文

| 上下文            | domain                                                                                                                                            | application                                           | infrastructure                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Prequalification  | `SoftPullPolicy`（规则：Available Equity 不足 → rejected；按 Credit Band → approved / need-more-documents）、`OfferCalculator`、`CreditBand` 排序 | `RunSoftPull`（应用 Forced Outcome / Injected Fault） | —                                                                                                |
| Borrower Outreach | `Chase`、`DocumentRequest`（材料类型 → 借款人可读名称）、`ChaseMessage`                                                                           | `SendChase`；端口 `Composer`、`EmailGateway`          | `TemplateComposer`（将来 `LlmComposer`）、`EmailHttpGateway`（带 `Idempotency-Key: chase:{id}`） |
| Email Delivery    | `OutboundEmail`、`DeliveryReceipt`、`Sender`                                                                                                      | `SendEmail`；端口 `EmailProvider`                     | `ResendProvider`、`ConsoleProvider`                                                              |

#### 分层测试

| 层             | 测试方式                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------- |
| domain         | 纯单元测试：状态机每条合法 / 非法转换、不变量、`nextStep()` 推导、事件序列               |
| application    | 内存 fake（仓储、gateway）：三条路径、各步失败、Replay 断点续跑且只发一封                |
| infrastructure | Drizzle 仓储用 PGlite（聚合 + 事件原子保存）；HTTP gateway 用本地 Fastify 桩验证防腐翻译 |
| interface      | `fastify.inject`：DTO 校验、状态码、错误映射                                             |

## 3. 数据库

4 张表（Drizzle schema 位于 `apps/intake/src/db/schema.ts`）：

| 表                 | 关键字段                                                                                   | 约束 / 索引                                                |
| ------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `leads`            | 问卷 9 个字段、`status`、`created_at`、`updated_at`                                        | `status` 用 pg enum；金额用 `numeric(12,2)`                |
| `figure_decisions` | `lead_id`、`status`、`raw_response jsonb`                                                  | FK → leads；index(lead_id, created_at)                     |
| `chases`           | `lead_id`、`status(pending/sent/failed)`、`subject`、`body`、`email_message_id`、`sent_at` | FK；**unique(lead_id)**（一个 lead 只追一次，replay 复用） |
| `lead_events`      | `lead_id`、`type`、`payload jsonb`                                                         | FK；index(lead_id, created_at)                             |

迁移：`drizzle-kit generate` 生成 SQL 并入库；最后一个迁移追加 `ENABLE ROW LEVEL SECURITY`。

---

## 4. 测试策略

| 层         | 工具                                                                        | 覆盖                                                                                                            |
| ---------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 单元       | Vitest                                                                      | figure-mock 决策规则（全区间表驱动）、Offer 计算、TemplateComposer 输出（快照）、状态机转换、config 校验        |
| 服务集成   | Vitest + `fastify.inject` + **PGlite**（内存 Postgres，无需 Docker/secret） | intake 三条路径；figure 超时 → failed；chase 失败 → failed → replay 成功且**只发一次**；replay 对 approved 幂等 |
| Email 服务 | Vitest + FakeProvider                                                       | 鉴权、参数校验、幂等 key 透传、provider 报错映射为 502                                                          |
| 线上 smoke | `scripts/smoke.ts`                                                          | 打 4 个 `/health`；用 `X-Mock-Outcome` 各提交一次 lead，断言状态                                                |

CI（`.github/workflows/ci.yml`，PR 与 main 触发）：`pnpm install --frozen-lockfile` → lint → typecheck → test → build。无 secret。

---

## 5. 时间线（约 9.5 小时）

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

- [x] pnpm workspace、tsconfig.base、ESLint(flat) + Prettier、Vitest
- [x] `packages/config`、`packages/logger`、`packages/server-kit`、`packages/contracts`
- [x] 5 个 app 骨架（4 个 Fastify 服务只有 `/health`；web 占位页）+ 每个 app 的 `.env.example`
- [x] `pnpm check:env`：`.env.example` 与 env schema 不一致时 CI 失败
- [x] GitHub Actions CI

**验收**：`pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿，CI 在 PR 上跑通。

### Phase 2 — Walking Skeleton 上线（1h）

- [x] 4 个后端服务只实现 `/health`，全部部署到 Railway（`iad`），拿到公网域名 —— `.railway/railway.ts`
- [x] Railway 变量：非 secret 与服务间引用在 IaC 中声明；secret 由 `scripts/env-sync.ts --railway` 推送
- [x] web 部署占位页到 Vercel（`heloc-demo.vercel.app`，`NEXT_PUBLIC_API_URL` 已配置）
- [x] Better Stack：4 个 log source + 4 个 errors app + 4 个 `/health` uptime monitor（均 up）
- [x] Resend 发信域名 `linkerclaw.ai` 已验证；Cloudflare Email Routing 把 `user@linkerclaw.ai` 转发到测试 Gmail
- [ ] GitHub Repository Variables 填 URL；`scripts/smoke.ts` 的 health 部分跑通

| 服务        | 公网地址                                      |
| ----------- | --------------------------------------------- |
| web         | https://heloc-demo.vercel.app                 |
| intake      | https://intake-production-12aa.up.railway.app |
| figure-mock | https://figure-mock-production.up.railway.app |
| chase       | https://chase-production-4070.up.railway.app  |
| email       | https://email-production-48c5.up.railway.app  |

**验收**：5 个公网 URL 可访问，Better Stack 显示 4 个 Healthy。**这之后每次 merge main 自动部署。**

### Phase 3 — 领域模型 + 数据层 + Figure Mock + Intake 编排（2.5h）

- [x] ESLint 分层依赖规则（domain / application 不得依赖外层与框架）
- [x] figure-mock：`SoftPullPolicy`、`OfferCalculator`（domain）→ `RunSoftPull`（application）→ 路由（interface）；Forced Outcome / Injected Fault
- [x] intake domain：`Lead` 聚合、值对象、`PrequalDecision`、`Chase`、领域事件、`nextStep()`，全覆盖单元测试
- [x] intake application：`SubmitLead` / `ReplayLead` / `AdvanceLead` / `GetLead` + 端口；用内存 fake 测试
- [x] intake infrastructure：Drizzle schema + 迁移 + RLS、`DrizzleLeadRepository`（聚合 + 事件同事务）、`FigureHttpGateway`（防腐层）；PGlite 测试；Railway pre-deploy 迁移
- [x] intake interface：`POST /v1/leads`、`GET /v1/leads/:id`、`POST /v1/leads/:id/replay`、CORS
- [x] contracts：Figure 契约中的 `missingDocument` 改名 `requiredDocument`（与 Prequalification 术语一致，线上格式不变）

**验收**（待部署后验证）：线上 curl 三种 outcome（chase 暂用 fake 或未部署时标记 failed），Supabase 里能看到 leads / figure_decisions / lead_events。

### Phase 4 — Borrower Outreach + Email Delivery（1.5h）

- [x] email：`OutboundEmail`（domain）→ `SendEmail` + `EmailProvider` 端口（application）→ `ResendProvider` / `ConsoleProvider`（infrastructure）→ `POST /v1/send`；幂等 key 透传给 Resend
- [x] chase：`DocumentRequest` / `ChaseMessage`（domain）→ `SendChase` + `Composer` / `EmailGateway` 端口 → `TemplateComposer`（HTML + text）、`EmailHttpGateway` → `POST /v1/chases`
- [x] intake：`ChaseHttpGateway` 接入；Replay 端到端
- [x] 测试：chase 失败 → failed → replay → 只发一封（`tests/e2e/lead-chain.test.ts`：4 个服务真实 HTTP 串联 + PGlite）

**验收**（待部署后验证）：need-more-documents 线上提交后，`user@linkerclaw.ai`（转发到测试 Gmail）真实收到邮件；`chases.email_message_id` 与 Resend 后台一致。

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

| 风险                                         | 预案                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Resend 域名 DNS 验证迟迟不过                 | 退回 `onboarding@resend.dev` + Resend 账号邮箱作为测试收件箱            |
| Railway monorepo 构建识别不到 workspace 依赖 | 改用每个 app 的 Dockerfile（根目录作为 build context）                  |
| Supabase pooler 连接偶发断开                 | postgres-js 设 `max: 5`、`idle_timeout`；/health 暴露 db 检查           |
| 时间不够                                     | 砍顺序：结果页事件时间线 → Sentry Errors（保留日志型告警）→ shadcn 美化 |

---

## 7. 下一阶段（不在今天范围）

与需求文档 §28 一致：文档上传（Signed URL）→ 异步队列 / 重试 / DLQ → 真实 Figure 集成 → Auth 与后台 → OpenTelemetry。
`EmailComposer` 与 `EmailProvider` 已是接口，接入 `LLMComposer` / `SESProvider` 无需改动调用方。
