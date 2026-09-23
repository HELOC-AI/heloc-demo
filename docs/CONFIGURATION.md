# 配置与 Secret 管理设计

> 适用范围：`heloc-demo` monorepo 内全部服务（web / intake / figure-mock / chase / email）。
> 原则：**Secret 只存在于真正需要它的 Service；仓库里只提交变量名，永不提交值。**

---

## 1. 三层存储模型

| 层                           | 存什么                                  | 存在哪里                                                                                        | 谁读                    |
| ---------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| **① 定义层（进 Git）**       | 变量名、类型、是否 secret、默认值、说明 | `packages/config/src/<service>.ts`（Zod schema）+ 每个 app 的 `.env.example` + 本文件           | 代码、开发者、RUNBOOK   |
| **② 运行时真源（不进 Git）** | 线上实际值                              | Railway 各 Service 的 Variables；Vercel Project Env                                             | 线上进程                |
| **③ 本地主副本（不进 Git）** | 同一份值的主副本                        | **仓库根 `.env`**（gitignored，权限 600）+ 密码管理器备份；`apps/*/.env` 由脚本从根 `.env` 生成 | 开发者本机、`scripts/*` |

规则：

- **线上值以 ② 为准**。改 secret = 改 Railway/Vercel 变量 → 触发重新部署；同时更新 ③ 的备份。
- **GitHub 不存任何运行时 secret**。PR 流水线（lint / typecheck / test / build）不需要 secret；部署走 Railway / Vercel 的 Git 集成，也不需要 deploy token。
- GitHub 仅用 **Repository Variables**（非 secret）存线上公开 URL，供部署后 smoke test 使用。
- `.gitignore` 忽略 `.env`、`.env.*`，但保留 `.env.example`。

### 1.1 根 `.env` 命名约定

| 形式                    | 含义                                               | 例子                                                                      |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `NAME`                  | 多个服务共用，或只有一个服务使用、名字本身不会冲突 | `RESEND_API_KEY`、`DATABASE_URL`                                          |
| `<SERVICE>__NAME`       | 只属于某个服务，同步时去掉前缀                     | `INTAKE__BETTERSTACK_SOURCE_TOKEN` → intake 的 `BETTERSTACK_SOURCE_TOKEN` |
| `<SERVICE>__PUBLIC_URL` | 该服务的公网地址（非 secret），供脚本使用          | `WEB__PUBLIC_URL`                                                         |

**管理员凭据只留在根 `.env`，永不同步到任何服务**：`BETTER_STACK_API_KEY`（能改整个 Better Stack 账号）、`RESEND_ADMIN_API_KEY`（Full access，只用于添加/验证域名，用完可在 Resend 删除）、`SUPABASE_SECRET_KEY`（本项目不使用）、`BETTERSTACK_QUERY_*`（SQL 查询连接，24 小时过期，只用于核验日志）、`SUPABASE_PASSWORD`（只用来拼 `DATABASE_URL`）。

自动写入根 `.env` 的脚本（幂等，只打印 id / host，不打印 token）：

- `node scripts/setup-betterstack.ts [--monitors]`：建 log source、errors app（加 `--monitors` 再建 uptime monitor），写回 `<SERVICE>__BETTERSTACK_*`
- `node scripts/setup-resend-domain.ts [--wait]`：在 Resend 添加 `RESEND_DOMAIN`，把 DKIM / SPF / bounce MX + DMARC 记录写入 Cloudflare（通过已登录的 `cf` CLI，DNS only），触发验证，写回 `EMAIL_FROM`
- `node scripts/env-sync.ts --railway`：把每个 service 自己的 secret 推到 Railway（stdin 传值，不进命令行历史）；`--local`：生成本地 `apps/*/.env`（本地不向生产 Better Stack 发日志，email 默认 `EMAIL_PROVIDER=console`）

---

## 2. 变量清单（Inventory）

图例：🔒 = secret，📄 = 普通配置。「来源」指值从哪里拿到。

### 2.1 intake-service（Railway）

| 变量                                                      | 类型  | 用途                                     | 来源 / 取值                                                                         |
| --------------------------------------------------------- | ----- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`                                            | 🔒    | Drizzle 连接 Supabase Postgres           | Supabase → Connect → **Session pooler**（`...pooler.supabase.com:5432`，IPv4 兼容） |
| `FIGURE_API_URL`                                          | 📄    | Mock Figure 地址                         | `https://${{figure-mock.RAILWAY_PUBLIC_DOMAIN}}`（Railway 引用变量）                |
| `FIGURE_API_KEY`                                          | 🔒    | 调 figure-mock 的内部 key                | `${{figure-mock.INTERNAL_API_KEY}}`                                                 |
| `CHASE_API_URL`                                           | 📄    | Chase Service 地址                       | `https://${{chase.RAILWAY_PUBLIC_DOMAIN}}`                                          |
| `CHASE_API_KEY`                                           | 🔒    | 调 chase 的内部 key                      | `${{chase.INTERNAL_API_KEY}}`                                                       |
| `CORS_ORIGINS`                                            | 📄    | 允许的前端 Origin（逗号分隔）            | `https://heloc-demo.vercel.app`                                                     |
| `ALLOW_MOCK_OVERRIDE`                                     | 📄    | 是否透传 `X-Mock-Outcome` 给 figure-mock | Demo 环境 `true`                                                                    |
| `BETTERSTACK_SOURCE_TOKEN` / `BETTERSTACK_INGESTING_HOST` | 🔒/📄 | 日志投递                                 | Better Stack → Telemetry → Sources（每个 service 一个 source）                      |
| `BETTERSTACK_ERRORS_DSN`                                  | 🔒    | 异常上报（Sentry SDK 兼容）              | Better Stack → Errors → Application（每个 service 一个）                            |

> 与原需求文档差异：文档写的是 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`，但我们用 **Drizzle 直连 Postgres**，只需要 `DATABASE_URL`。
> Service role key 会绕过 RLS、权限远大于需要，**不生成、不存放**。Supabase 的 anon key 同样不使用。

### 2.2 figure-mock-service（Railway）

| 变量               | 类型 | 用途                    | 来源 / 取值            |
| ------------------ | ---- | ----------------------- | ---------------------- |
| `MOCK_MODE`        | 📄   | `deterministic`（默认） | 手填                   |
| `INTERNAL_API_KEY` | 🔒   | 校验调用方（intake）    | `openssl rand -hex 32` |
| `BETTERSTACK_*`    | 同上 | 日志 / 异常             | 同上                   |

### 2.3 chase-service（Railway）

| 变量                    | 类型 | 用途                 | 来源 / 取值                                |
| ----------------------- | ---- | -------------------- | ------------------------------------------ |
| `INTERNAL_API_KEY`      | 🔒   | 校验调用方（intake） | `openssl rand -hex 32`                     |
| `EMAIL_SERVICE_URL`     | 📄   | Email Service 地址   | `https://${{email.RAILWAY_PUBLIC_DOMAIN}}` |
| `EMAIL_SERVICE_API_KEY` | 🔒   | 调 email 的内部 key  | `${{email.INTERNAL_API_KEY}}`              |
| `BETTERSTACK_*`         | 同上 | 日志 / 异常          | 同上                                       |

### 2.4 email-service（Railway，`apps/email`）

| 变量               | 类型 | 用途                | 来源 / 取值                                                           |
| ------------------ | ---- | ------------------- | --------------------------------------------------------------------- |
| `RESEND_API_KEY`   | 🔒   | 调 Resend           | Resend → API Keys，权限选 **Sending access**，并限定到发信域名        |
| `EMAIL_FROM`       | 📄   | 发件人              | `HELOC Demo <noreply@linkerclaw.ai>`（Cloudflare 上的域名，脚本配置） |
| `INTERNAL_API_KEY` | 🔒   | 校验调用方（chase） | `openssl rand -hex 32`                                                |
| `BETTERSTACK_*`    | 同上 | 日志 / 异常         | 同上                                                                  |

### 2.5 web（Vercel）

| 变量                  | 类型 | 用途            | 来源 / 取值                |
| --------------------- | ---- | --------------- | -------------------------- |
| `NEXT_PUBLIC_API_URL` | 📄   | Intake 公网地址 | intake 的 Railway 公网域名 |

> `NEXT_PUBLIC_*` 会在 **build 时内联进前端 bundle**，只能放公开值。前端没有任何 secret。

### 2.6 GitHub（仅 heloc-demo）

| 名称                                                                                  | 类型 | 用途                                |
| ------------------------------------------------------------------------------------- | ---- | ----------------------------------- |
| Repository Variables：`INTAKE_URL`、`FIGURE_URL`、`CHASE_URL`、`EMAIL_URL`、`WEB_URL` | 📄   | 部署后 smoke test（只打 `/health`） |
| Secrets                                                                               | —    | **无**                              |

### 2.7 不进任何运行时的凭据（只放密码管理器）

| 凭据                    | 用途                          |
| ----------------------- | ----------------------------- |
| Supabase DB 密码        | 生成 `DATABASE_URL`、紧急直连 |
| 各平台账号 / 2FA 恢复码 | 登录                          |
| Resend 域名 DNS 记录    | 重新验证域名                  |

---

### 2.8 追加变量（ADR-0004：邮件回复补材料）

| 变量                                                      | 服务                               | 类型  | 说明 / 来源                                                                          |
| --------------------------------------------------------- | ---------------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `WEB_APP_URL`                                             | intake                             | 📄    | 结果页地址，Outcome Notice 里的链接；IaC 中为 `https://heloc-demo.vercel.app`        |
| `INBOUND_API_KEY`                                         | intake                             | 🔒    | Email Worker 调 `POST /v1/inbound-emails` 用；根 `.env` 的 `INTAKE__INBOUND_API_KEY` |
| `CHASE_REPLY_ADDRESS`                                     | chase                              | 📄    | `reply@linkerclaw.ai`；每个 Chase 的 Reply-To 为 `reply+<chase_id>@linkerclaw.ai`    |
| `INTAKE_API_URL`                                          | email-inbound（Cloudflare Worker） | 📄    | `wrangler.jsonc` 的 `vars`                                                           |
| `INTAKE_API_KEY`                                          | email-inbound                      | 🔒    | Worker secret，值 = `INTAKE__INBOUND_API_KEY`                                        |
| `BETTERSTACK_SOURCE_TOKEN` / `BETTERSTACK_INGESTING_HOST` | email-inbound                      | 🔒/📄 | Worker secret，值 = `EMAIL_INBOUND__BETTERSTACK_*`                                   |

Worker 部署（wrangler 未登录时借用已登录的 `cf` CLI 的 OAuth token，不打印）：

```bash
cd apps/email-inbound
export CLOUDFLARE_API_TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/Library/Preferences/cloudflare/config/default.json'))['oauth_token'])")
export CLOUDFLARE_ACCOUNT_ID=<account id>
npx wrangler deploy                       # 代码；secret 已存在则保留
npx wrangler deploy --secrets-file <tmp>  # 需要更新 secret 时（临时文件 600 权限，用完即删）
```

告警接收人：根 `.env` 的 `ALERT_EMAIL`（`simonarthur2012@gmail.com`）。Better Stack 免费版没有 Escalation Policy，所以由 `setup-betterstack.ts --alerts` 把它设为默认值班表的 on-call（一年），5 个 monitor 与日志告警都用 email 通知值班 / 团队（团队只有这一人）。

Cloudflare Email Routing：`linkerclaw.ai` 开启 subaddressing；规则 `reply@linkerclaw.ai` → Worker `heloc-email-inbound`；`user@linkerclaw.ai` → 转发到测试 Gmail。

## 3. 服务间鉴权：每一跳一把 key

```text
web ──(无鉴权, CORS 白名单)──► intake ──K_fig──► figure-mock
                                   └───K_chase──► chase ──K_email──► email ──RESEND_API_KEY──► Resend
```

- 每个被调用方只认自己的 `INTERNAL_API_KEY`；调用方用 `<TARGET>_API_KEY` 保存对应值。
- 三把 key 互不相同 → 任一泄露只影响一跳。
- 请求头：`Authorization: Bearer <key>`；校验用 `crypto.timingSafeEqual`。`/health` 不鉴权。
- **Railway 引用变量**让调用方直接引用被调用方的 key 和域名：在 `.railway/railway.ts` 里写作 `chase.env.INTERNAL_API_KEY`（类型化引用）或 `https://${{chase.RAILWAY_PUBLIC_DOMAIN}}`。值只维护一处，轮换时只改被调用方，调用方重新部署即拿到新值。

---

## 4. 代码中如何使用

### 4.1 `packages/config`：启动即校验（fail fast）

```ts
// packages/config/src/intake.ts
export const intakeEnv = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  FIGURE_API_URL: z.string().url(),
  FIGURE_API_KEY: z.string().min(32),
  CHASE_API_URL: z.string().url(),
  CHASE_API_KEY: z.string().min(32),
  CORS_ORIGINS: z.string().transform((s) => s.split(',').map((o) => o.trim())),
  ALLOW_MOCK_OVERRIDE: z.stringbool().default(false), // 注意别用 z.coerce.boolean()："false" 会被转成 true
  ...betterStackEnv.shape, // 均为 optional：本地开发不配也能跑，只是日志不外发
});

// apps/intake/src/main.ts
const config = loadConfig(intakeEnv); // 缺失/非法 → 打印“变量名 + 原因”（不打印值）后 exit(1)
```

约定：

- **只有 `main.ts` 读取 `process.env`**，其余代码通过依赖注入拿 `config`。便于测试，也便于审计谁用了什么 secret。
- 每个 service 的 schema 只声明它需要的变量 —— schema 本身就是「这个 service 拥有哪些 secret」的清单。
- `.env.example` 与 schema 保持一致：`pnpm check:env`（CI 中运行）比对两者的 key 集合，`RAILWAY_*` 等平台注入变量除外。

### 4.2 日志脱敏

`packages/logger`（pino）统一配置：

- `redact`: `req.headers.authorization`、`*.api_key`、`*.apiKey`、`*.password`、`*.DATABASE_URL`；
- 业务日志只带 `lead_id / request_id / service / event`，**不打 email、phone、name**（PII）；
- 启动日志只打印「已加载的变量名列表」，不打印值。

### 4.3 本地开发

```bash
cp apps/intake/.env.example apps/intake/.env   # 从密码管理器填值
pnpm --filter @heloc/intake dev                # node --watch --env-file-if-exists=.env src/main.ts
```

本地端口：web 3000、intake 4000、figure-mock 4001、chase 4002、email 4003（`.env.example` 已按此填好互相的 URL）。email 本地可设 `EMAIL_PROVIDER=console`，不需要 Resend key。
本地默认指向本地起的 figure-mock / chase，`DATABASE_URL` 可以指向 Supabase 上单独建的 dev 数据库或本地 Postgres；单元 / 集成测试用 PGlite（内存 Postgres），**不需要任何 secret**。

---

## 5. 各平台具体操作

| 平台             | 操作                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase**     | 建 Project（region 选离 Railway 近的 `us-east`/`us-west`）→ 复制 Session pooler 连接串 → 迁移后对 4 张表 `ENABLE ROW LEVEL SECURITY`（不建 policy，等于关闭 Data API 对这些表的匿名访问）                                                                                                                           |
| **Resend**       | 添加并验证发信域名（DNS: SPF/DKIM）→ 建 Sending-access API key。若暂时没有域名，只能用 `onboarding@resend.dev` 发到 **Resend 账号自己的邮箱**，测试收件箱就用这个邮箱                                                                                                                                               |
| **Railway**      | 1 个 Project、4 个 Service（`intake` / `figure-mock` / `chase` / `email`），全部由 `.railway/railway.ts`（IaC）定义并 `railway config apply`；secret 在 IaC 中声明为 `preserve()`，值由 `node scripts/env-sync.ts --railway` 从根 `.env` 经 stdin 推送；**不用 Shared Variables**（避免 secret 扩散到所有 service） |
| **Vercel**       | Import `heloc-demo`，Root Directory = `apps/web`，配置 `NEXT_PUBLIC_API_URL`（Production + Preview）                                                                                                                                                                                                                |
| **Better Stack** | 全部由 `scripts/setup-betterstack.ts` 通过 API 创建：每个 service 一个 Telemetry source + 一个 Errors application（与该 source 关联，日志和异常可互相跳转）；Uptime：4 个 `/health` monitor；Alert：Email（+ 可选 Slack）                                                                                           |
| **GitHub**       | 仓库 Settings → Variables 填公网 URL；开启 Secret scanning + Push protection（public 仓库免费）                                                                                                                                                                                                                     |

---

## 6. 轮换（Rotation）

| Secret                       | 轮换步骤                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `INTERNAL_API_KEY`（任一跳） | 在被调用方改值并部署 → 重新部署引用它的调用方（引用变量在部署时解析）。Demo 规模可接受短暂不一致；如需零中断，再引入“新旧 key 并存”列表 |
| `RESEND_API_KEY`             | Resend 新建 key → 改 email-service 变量 → 部署成功后删除旧 key                                                                          |
| `DATABASE_URL`               | Supabase 重置 DB 密码 → 更新 intake 变量 + 密码管理器                                                                                   |
| `BETTERSTACK_*`              | 新建 source → 替换 token → 删除旧 source                                                                                                |

泄露应急：先撤销（provider 侧删除 key）再替换；然后在 Better Stack 日志里按时间窗排查异常调用。
