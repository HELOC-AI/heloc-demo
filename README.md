# heloc-demo

HELOC（房屋净值信用额度）申请垂直切片：Quiz → Lead Intake → Mock Figure soft pull → 需补材料时自动 Chase → 独立 Email Service → Resend 真实投递。
全链路线上部署、落库 Supabase、Better Stack 监控，支持 Replay。

| 组件                | 位置               | 部署    |
| ------------------- | ------------------ | ------- |
| web                 | `apps/web`         | Vercel  |
| intake-service      | `apps/intake`      | Railway |
| figure-mock-service | `apps/figure-mock` | Railway |
| chase-service       | `apps/chase`       | Railway |
| email-service       | `apps/email`       | Railway |

## 本地开发

需要 Node 24+（见 `.node-version`）与 pnpm 10。

```bash
pnpm install
for app in intake figure-mock chase email web; do cp apps/$app/.env.example apps/$app/.env; done
# 填 .env 中的 key（本地可随便生成：openssl rand -hex 32，成对的 key 保持一致）
pnpm dev          # 同时启动全部 app：web :3000, intake :4000, figure-mock :4001, chase :4002, email :4003
```

| 命令                                                 | 作用                                              |
| ---------------------------------------------------- | ------------------------------------------------- |
| `pnpm test`                                          | Vitest 全部单元 / 集成测试                        |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | 静态检查                                          |
| `pnpm check:env`                                     | 校验每个 app 的 `.env.example` 与 env schema 一致 |

后端没有构建步骤：Node 直接运行 TypeScript（`node src/main.ts`）。

## 文档

- [开发计划](docs/DEV-PLAN.md)
- [配置与 Secret 管理](docs/CONFIGURATION.md)
- `docs/RUNBOOK.md`（开发中）

> 本仓库为 public：只提交变量名（`.env.example`），任何 secret 值都不入库。
