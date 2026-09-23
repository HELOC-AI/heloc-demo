# Email Delivery

通用的事务邮件投递。只认识收件人、主题和正文，不知道 Lead、Chase 或任何 HELOC 概念。

## Language

**Outbound Email**:
一封待投递的事务邮件：收件人、主题、纯文本正文和 HTML 正文，发件人由服务统一决定。
_Avoid_: Message、Mail、Notification

**Delivery Receipt**:
邮件服务商接受一封 Outbound Email 后返回的凭证，其中的 message id 可以在服务商后台追踪投递结果。
_Avoid_: Response、Result

**Email Provider**:
实际把 Outbound Email 交给收件人的外部服务，如 Resend；可替换为 SES、SendGrid、Postmark。
_Avoid_: Vendor、Mailer、SMTP

**Sender**:
所有 Outbound Email 统一使用的发件人地址，必须属于已验证的发信域名。
_Avoid_: From address

**Inbound Email**:
寄到我们域名、由收信适配器（Cloudflare Email Worker）上报的一封邮件：发件人、收件地址、主题、认证结论和附件元数据；附件内容不离开适配器。
_Avoid_: Received message、Webhook

**Authentication Verdict**:
收信服务器（Cloudflare）自己算出的 SPF/DKIM/DMARC 结论；发件人无法伪造，用来判断邮件是否真的来自 From 地址。
_Avoid_: Auth header
