# Record the actual automatic compaction guard decision

Date: 2026-09-14

Status: Accepted.

The A2 1M/384000/max run reported PI `tokensBefore=235561`, while the complete
input threshold is 521859. Read-only reconstruction found its first physical
request already reserved 485402 estimated input tokens; new reasoning and four
tool results raised history alone to 539046. No reverted model configuration or
second output subtraction was found. The apparent conflict came from comparing
different token estimates without recording the actual guard measurement.

Capture only inspection already performed by the existing guard and retain
short-circuit behavior. Carry bounded trigger values through start/end and opaque
checkpoint details. The event field is additive, requires no database schema
change and is not emitted by Codex. Provider usage remains distinct from estimates.

This does not lower the estimator. Reusing actual provider usage safely requires
exact prefix and model/system/tool/transport identity proof at reservation and
final payload boundaries; that calibration is separate work.
