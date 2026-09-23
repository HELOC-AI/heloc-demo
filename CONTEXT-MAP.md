# Context Map

HELOC 预审申请系统由四个限界上下文组成，每个上下文对应一个独立部署的服务。

## Contexts

- [Lead Intake](./apps/intake/CONTEXT.md) — 核心域。把借款人问卷变成 Lead，推进预审与补材料跟进；唯一持有业务状态的上下文
- [Prequalification](./apps/figure-mock/CONTEXT.md) — 模拟 Figure 的软查询预审；在真实世界里是外部系统
- [Borrower Outreach](./apps/chase/CONTEXT.md) — 把缺失材料写成一封面向借款人的补材料通知并投递出去
- [Email Delivery](https://github.com/HELOC-AI/heloc-email-service/blob/main/CONTEXT.md) — 通用事务邮件投递，不懂任何 HELOC 业务；独立仓库 `heloc-email-service`（ADR-0005）。收信适配器见 [Inbound Email](./apps/email-inbound/CONTEXT.md)

## Relationships

- **Lead Intake → Prequalification**（Customer / Supplier + Anti-Corruption Layer）：Intake 请求软查询；Prequalification 用 Figure 的语言回答（`need-more-documents`、`documents`），Intake 在防腐层把它翻译成自己的 Prequal Decision，Figure 的词汇不进入 Intake 的领域模型
- **Lead Intake → Borrower Outreach**（Customer / Supplier）：Intake 拥有 Chase 的生命周期（标识、是否已发出）；Outreach 无状态，只负责把一个 Chase 变成一封信并交付
- **Borrower Outreach → Email Delivery**（Open Host Service）：Email Delivery 提供与业务无关的发送接口，只认识收件人、主题和正文；契约由 heloc-email-service 拥有，`packages/contracts` 里是调用方的副本
- **Published Language**：跨服务的请求 / 响应格式定义在 `packages/contracts`。它只是线上契约，不是共享的领域模型——每个上下文都把契约映射成自己的领域类型
- **跨上下文引用只用标识**：Lead Id、Chase Id
