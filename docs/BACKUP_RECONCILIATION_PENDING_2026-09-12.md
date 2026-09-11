# 备份资料恢复后交接失败修复

本轮区分领域资料已经激活与世界启动／界面交接完成。确认激活后 afterRestore 失败，改为返回并缓存有限 `reconciliation-pending` 结果和 operationId；UI 明确资料已恢复，需重开继续。没有再次恢复、回滚或 activated:false 清理。

同编号重试、backup.status、并发调用不会二次激活；取消已激活操作明确拒绝。操作日志保留部分结果，UI 不再根据日志 completed 标记宣称世界全部完成。未知丢回执仍然没有已激活断言。

新增故障注入测试，不启动任何实际 profile，不修改 PCK 合同或源码保护。本次不调整 checkpoint 驱动的完整成功判据；pending 回执应原样进入失败／阻塞报告。

验证入口：`node --test tests/backup-reconciliation-pending.test.mjs tests/backup-lifecycle-errors.test.mjs`。桌面服务、操作日志、网关和 UI 采用精确状态与有限错误码；异常原文和本地路径不加入结果。

新增故障注入及既有备份、网关、日志回归共 31 项通过；桌面 TypeScript noEmit、UI 模块语法和 diff 检查通过。没有进行真实恢复或界面操作，实际成品交接由总控验证。
