# C 追加修复：恢复成功但模型启动失败

日期：2026-09-09。结论：ready_for_integration。

代码冻结提交：4c3cc3b73db43656f1d5913d566f4fa43498216f。分支/工作树沿用 codex/parallel-c-20260909 / D:/Craftmine World-worktrees/parallel-c-20260909。此修复基于已交付的原始需求读取提交747e655，未修改 E 同时工作的 durable.rs，也未修改主项目/共享热文件。

已修复：显式恢复草稿后，如果provider解析、保存续作消息或sidecar启动失败，宿主可先 task.interrupt，再 end(error)。任务重新变为可恢复，保留代码、原始目标、预算owner、代际与累计账目；未确认的本任务请求保留估算并标为unknown，不能重开预算。旧代际、伪造身份和非受限错误代码被拒绝。

同一个SQLite事务撤销本任务检查/评审/待应用操作的worker token、释放本任务lease并记录幂等回执。另一世界的任务和预算不受影响。相同请求在end(error)之后可以查询原回执；进入下一代际后，旧上下文即使重复也拒绝。

最终实际验证：`cargo test -p craftmine-core --lib --manifest-path vendor/pi-desktop/Cargo.toml --target-dir "D:/Craftmine World-worktrees/parallel-c-20260909/test-results/dispatch-c-rust-target"`，cwd为本工作树，代码冻结后37/37通过，测试0.63秒，原始日志 docs/evidence/dispatch/C/interrupt-rust.log。

新增两项Rust/SQLite测试覆盖：第一次恢复→预留模型请求→启动失败中断→正常error结束→普通open明确拒绝→第二次显式恢复，继续保留原始代码/目标、三次压缩、30已知token和100未知估算。另一项验证只取消自己的检查/评审/待应用状态与token，另一世界的lease和预留保持不变，并测试错误身份、额外字段、敏感错误文本与幂等冲突。

评审/待应用状态是明确的durable job fixture，只用于验证撤销token，不声称实际模型评审或应用已完成。首次测试调用verification_submit多传了一个参数，修正为实际Rust签名；另一fixture时间戳0使任务先自动过期，修正为当前合法时间后严格的aborted断言通过。没有放宽断言、修改预算测试或用旧profile重跑。

G仍须注册私有Rust路由并在真实resume失败catch中调用，接口见 INTERRUPT_INTERFACE.md。首次调用必须早于正常end，模型/renderer不能调用。原生sidecar实际失败场景仍由G/F复验；本组模型调用0、压缩真实模型调用0、真实鼠标键盘输入0。

没有数据库schema/备份表变更。内部 `@host:interrupt` 回执包含DraftReceipt兼容字段，不能被当作已应用世界的回执。报告与证据单独提交，最终HEAD见交接；分支保留、没有推送或主项目合并。
