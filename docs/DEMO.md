# Demo 脚本（3–5 分钟）

> 按需求文档 §25 的 8 步走，外加一步“借款人邮件回复补材料”（ADR-0004）。
> 2026-09-23 已在生产环境按本脚本完整彩排一遍，截图在 `.playwright-mcp/rehearsal/`（本地，gitignored）。

## 准备（演示前 5 分钟）

- [ ] 浏览器能打开 https://heloc-demo.vercel.app（本机网络需要走代理）
- [ ] 提前打开这些标签页：
  - Supabase → Table editor（`leads`、`figure_decisions`、`lead_events`）
  - Gmail（`simonarthur2012@gmail.com`，`user@linkerclaw.ai` 会转发到这里）
  - Better Stack：Dashboards → **HELOC operations**、Uptime → Incidents、Errors
  - 状态页 https://heloc-demo-status.betteruptime.com
  - Resend → Emails
- [ ] 跑一遍 `pnpm smoke`，9 项全过（本机加代理：`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890`）
- [ ] 若要**现场用 Gmail 回信**：问卷邮箱填 Gmail 地址（回信发件人必须等于问卷邮箱）

## 步骤

| #   | 做什么                                                                                                                      | 展示什么                                                                                                                                                                                       | 备用方案                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | 打开 https://heloc-demo.vercel.app，填问卷：房价 800,000、房贷 350,000、信用 700–739、邮箱 `user@linkerclaw.ai`（或 Gmail） | 字段校验、金额格式化、实时的可用净值预估                                                                                                                                                       | —                                                                                           |
| 2   | 底部 **Demo outcome** 选 _Need more documents_（或不选：700–739 按规则就是补材料），点提交                                  | 跳到结果页：所需材料、“邮件已发到 u\*\*\*@linkerclaw.ai”、回复地址、**Open in your email app** 按钮                                                                                            | 在 Demo outcome 里切换 _Approved_ / _Rejected_，展示另外两种结果                            |
| 3   | Supabase → `leads`                                                                                                          | 新的一行，`status = chase_sent`                                                                                                                                                                | `SELECT * FROM leads ORDER BY created_at DESC LIMIT 5;`                                     |
| 4   | （第 2 步已经让 Figure 返回 need-more-documents）                                                                           | 讲确定性规则：信用 ≥ 740 通过，< 620 拒绝，其余需补材料；`X-Mock-Outcome` 可强制指定                                                                                                           | —                                                                                           |
| 5   | Supabase → `figure_decisions`、`lead_events`（或结果页展开 **Application timeline**）                                       | `soft_pull / need_more_documents`；事件 `figure.need_more_documents` → `chase.created` → `email.sent`                                                                                          | `SELECT type, created_at FROM lead_events WHERE lead_id='…' ORDER BY created_at, sequence;` |
| 6   | 打开 Gmail                                                                                                                  | 真实收到 **Additional documents required for your HELOC application**，里面有 **Reply with documents** 按钮                                                                                    | Resend → Emails 里可以看到 `delivered`                                                      |
| 6+  | 点 **Reply with documents**（或直接回复），附一个 PDF 发送；切回结果页                                                      | 页面**自动**变成 _You're prequalified_；时间线多出 `documents.received` → `figure.review_approved` → `notice.sent`；Gmail 收到 **Your HELOC offer is ready**                                   | 用 Resend 以 `user@linkerclaw.ai` 身份发一封带附件的回信（见 RUNBOOK §6）                   |
| 7   | Better Stack                                                                                                                | 状态页全部 Operational；看板 **HELOC operations**（错误数、5xx、p95、Lead 流水、回信结果）；Live tail 按 `request_id` 串起一次请求；Errors；Uptime → Incidents 里的告警与 “Sent an email to …” | —                                                                                           |
| 8   | 提交时带 `X-Mock-Fault: error`（curl），打开它的结果页 → 点 **Try again**                                                   | “We couldn't complete your credit check” → Replay → _You're prequalified_；时间线里只查过一次预审                                                                                              | `curl -X POST …/v1/leads/<id>/replay`                                                       |

第 8 步用到的请求：

```bash
curl -s -X POST https://intake-production-12aa.up.railway.app/v1/leads \
  -H 'content-type: application/json' -H 'x-mock-fault: error' \
  -d '{"name":"Replay Demo","email":"user@linkerclaw.ai","phone":"+14155551234","property_state":"CA","estimated_home_value":800000,"mortgage_balance":350000,"credit_band":"780+","income_band":"150k-200k","purpose":"home_improvement"}'
# → {"lead_id":"…","status":"failed","failed_step":"prequalify",…}
# 打开 https://heloc-demo.vercel.app/result/<lead_id> 点 Try again
```

## 讲解要点（每步一句）

- **架构**：5 个服务按 DDD 限界上下文拆分；Figure 的语言只在防腐层出现；`Lead` 聚合守护全部不变量。
- **可靠性**：每一步都先落库，失败的 Lead 能从断点 Replay；邮件带幂等键，重放不会重复发信；一个 Lead 只做一次预审、一次材料审核。
- **安全**：每一跳用独立的 key；只信任 Cloudflare 自己加的 DMARC 结论（伪造的认证头无效）；日志不含 PII；Supabase 的表开启了 RLS。
- **可观测**：状态页、看板、3 条日志告警 + 5 个 uptime 监控，都用代码配置（`scripts/setup-*.ts`）；告警已演练过并送达。
