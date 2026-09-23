# Inbound Email (reply adapter)

把借款人回复 Chase 的邮件交给 Lead Intake 的适配器（Cloudflare Email Worker）。发信由独立仓库的 Email Service（[heloc-email-service](https://github.com/HELOC-AI/heloc-email-service)）负责，收信在这里。

## Language

**Inbound Email**:
寄到我们域名、由收信适配器（Cloudflare Email Worker）上报的一封邮件：发件人、收件地址、主题、认证结论和附件元数据；附件内容不离开适配器。
_Avoid_: Received message、Webhook

**Authentication Verdict**:
收信服务器（Cloudflare）自己算出的 SPF/DKIM/DMARC 结论；发件人无法伪造，用来判断邮件是否真的来自 From 地址。
_Avoid_: Auth header
