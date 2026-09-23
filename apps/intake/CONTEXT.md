# Lead Intake

核心域：接收借款人的 HELOC 问卷，形成 Lead，并把它推进到一个预审结果；需要补材料时发起 Chase。

## Language

### Lead 与借款人

**Lead**:
借款人提交一次问卷所形成的 HELOC 预审请求，从提交一直跟踪到预审结果和后续跟进。每次提交都是一个新的 Lead。
_Avoid_: Application、Applicant、Submission（面向借款人的文案里可以说 "your HELOC application"，领域里只说 Lead）

**Borrower**:
提交问卷、希望获得 HELOC 额度的人，由姓名、Email、手机号描述。
_Avoid_: User、Customer、Applicant

**Property**:
Lead 所抵押的房产，由所在州、预估房屋价值和当前房贷余额描述。
_Avoid_: Home、Collateral

**Credit Band**:
借款人自报的信用分区间，如 `700-739`。
_Avoid_: Credit score、FICO

**Income Band**:
借款人自报的年收入区间，如 `150k-200k`。

**Purpose**:
借款人使用 HELOC 资金的用途，如 home improvement。
_Avoid_: Use case、Reason

### 预审

**Prequalification**:
向 Figure 发起的软查询预审，不影响借款人信用分，结果不具约束力。一个 Lead 最多只有一次成功的 Prequalification。
_Avoid_: Soft pull（那是 Figure 的说法）、Underwriting、Approval

**Prequal Decision**:
Prequalification 的结果，恰好是 Approved、Rejected、Need More Documents 三者之一。一旦获得就不再改变。
_Avoid_: Figure decision、Response、Result

**Approved**:
Figure 给出了 Offer 的 Prequal Decision。

**Rejected**:
Figure 拒绝授信的 Prequal Decision，附带原因，如 insufficient home equity。
_Avoid_: Declined、Denied

**Need More Documents**:
Figure 需要借款人补充材料才能继续的 Prequal Decision，附带 Missing Document 列表。
_Avoid_: Pending、Documents required

**Offer**:
Approved 时的授信条件：出借方、额度、APR 区间、期限、预估月供和过期时间。
_Avoid_: Quote、Proposal

**Missing Document**:
Figure 要求补充的一类材料及其原因，如收入证明、因为收入需要核实。
_Avoid_: Required document、Doc request

### 跟进与运维

**Chase**:
Lead 处于 Need More Documents 时，自动发给借款人的一次补材料通知。每个 Lead 至多一个 Chase，它要么待发送、要么已发出、要么发送失败。
_Avoid_: Reminder、Nudge、Notification、Campaign

**Lead Status**:
Lead 当前所处的阶段：submitted、processing、approved、rejected、need_more_documents、chase_sent、failed。
_Avoid_: State、Stage

**Lead Event**:
Lead 上已经发生的一件事的不可变记录，如 lead.created、figure.need_more_documents、email.sent。按时间排列即是这个 Lead 的完整执行链。
_Avoid_: Log、Audit entry、History

**Replay**:
从上次停下的地方继续推进一个 Lead：缺预审就做预审，缺 Chase 就发 Chase，都已完成则什么都不做。Replay 从不重做已经完成的步骤。
_Avoid_: Retry、Resubmit、Rerun
