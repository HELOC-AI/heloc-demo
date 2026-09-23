# heloc-demo

HELOC（房屋净值信用额度）申请垂直切片：Quiz → Lead Intake → Mock Figure soft pull → 需补材料时自动 Chase → 独立 Email Service → Resend 真实投递。
全链路线上部署、落库 Supabase、Better Stack 监控，支持 Replay。

| 组件 | 位置 | 部署 |
|---|---|---|
| web | `apps/web` | Vercel |
| intake-service | `apps/intake` | Railway |
| figure-mock-service | `apps/figure-mock` | Railway |
| chase-service | `apps/chase` | Railway |
| email-service | [HELOC-AI/heloc-email-service](https://github.com/HELOC-AI/heloc-email-service) | Railway |

## 文档

- [开发计划](docs/DEV-PLAN.md)
- [配置与 Secret 管理](docs/CONFIGURATION.md)
- `docs/RUNBOOK.md`（开发中）

> 本仓库为 public：只提交变量名（`.env.example`），任何 secret 值都不入库。
