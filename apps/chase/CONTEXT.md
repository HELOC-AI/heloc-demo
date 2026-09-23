# Borrower Outreach (Chase)

把一个 Chase 写成面向借款人的补材料通知并交付出去。不保存状态；Chase 的生命周期归 Lead Intake。

## Language

**Chase**:
Lead Intake 发起的一次补材料通知请求，带着借款人和 Missing Document 列表。
_Avoid_: Reminder、Campaign、Notification

**Document Request**:
Chase 信中的一项：借款人能看懂的材料名称加上需要它的原因，如 "Proof of income — Income requires verification"。
_Avoid_: Missing document（那是 Lead Intake 的说法）、Doc item

**Chase Message**:
由一个 Chase 写成的信：主题、纯文本正文和 HTML 正文。
_Avoid_: Email、Template、Letter

**Composer**:
把 Chase 写成 Chase Message 的方式。第一版是固定模板，将来可以换成 LLM 撰写。
_Avoid_: Generator、Renderer

**Reply Address**:
Chase Message 的回复地址，形如 `reply+<chase id>@linkerclaw.ai`；借款人回复这个地址即把材料交给这个 Chase。
_Avoid_: Inbox、Upload address

**Outcome Notice**:
Lead 得到最终结论后发给借款人的一封信，结论来自预审本身或 Document Review（ADR-0006）。通过则附报价摘要和 “View your offer” 按钮，拒绝则说明原因；都附结果页（Offer 详情）链接。措辞按结论来源区分，预审直接给出的结论不提材料。
_Avoid_: Result email
