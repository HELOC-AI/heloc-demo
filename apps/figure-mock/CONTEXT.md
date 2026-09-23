# Prequalification (Figure mock)

模拟 Figure 的软查询预审。它代表一个外部系统，因此保持 Figure 自己的语言；调用方负责翻译。

## Language

**Soft Pull**:
一次不影响信用分的预审查询，输入房产、房贷余额、信用分区间和收入区间，输出一个 Outcome。
_Avoid_: Credit check、Hard pull

**Outcome**:
Soft Pull 的结论：`approved`、`rejected`、`need-more-documents` 之一。
_Avoid_: Decision、Status

**Available Equity**:
房屋价值的 85% 减去当前房贷余额，即理论上能提供的最高授信额度。
_Avoid_: Equity、Max line

**Offer**:
`approved` 时给出的授信条件：出借方、额度、APR 区间、期限、预估月供和过期时间。
_Avoid_: Quote

**Required Document**:
`need-more-documents` 时要求补充的一类材料及原因。
_Avoid_: Missing document（那是调用方的说法）

**Forced Outcome**:
演示时由调用方指定的 Outcome，覆盖规则的判断结果。
_Avoid_: Override、Test mode

**Injected Fault**:
演示故障时由调用方指定的异常行为：超时或服务端错误。
_Avoid_: Chaos、Error mode
