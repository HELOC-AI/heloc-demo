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
