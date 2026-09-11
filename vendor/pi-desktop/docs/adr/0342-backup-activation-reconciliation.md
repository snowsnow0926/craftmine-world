# ADR 0342：区分备份资料激活与世界交接完成

日期：2026-09-12。状态：采用。

## 问题

`backup.restorePortableActive` 已返回 `status: completed, activated: true` 后，`afterRestore` 仍可能因世界重新构建、启动或界面交接失败而抛错。旧代码将它归为笼统备份失败，既无法告诉玩家资料已经恢复，也没有缓存这次已激活的事实，同编号重试可能再次走恢复链。

## 决定

只有服务直接收到并校验上述两项确认，才建立已激活结果。随后 `afterRestore(activated:true)` 失败，返回有限结构化状态：

```json
{
  "status": "reconciliation-pending",
  "activated": true,
  "errorCode": "BACKUP_RESTORED_RECONCILIATION_PENDING",
  "operationId": "原操作编号",
  "scope": "profile",
  "modelReplay": false
}
```

保留已有回执中的 id、currentHash 和 rebuildRequired；不透出异常原文、路径或任意后缀。它不是完整成功。UI 提示资料已恢复，但世界启动或界面交接未完成，需要重新打开应用继续；不能告诉玩家原资料保持未变，也不引导再次恢复。

已确认激活后消耗选择授权，缓存结果。同操作编号再次请求和 backup.status 返回这个结果，不重放领域恢复，也不再次调用 activated:false 清理。取消已激活操作返回 BACKUP_ALREADY_ACTIVATED。

操作日志的 completed 仅说明回执已经记录，不能解释为世界启动完成。日志精确允许这一个 backup.restore 的 pending 回执，UI 据 result.status 显示部分结果和「知道了」按钮。持久化日志重开后保留原部分结果；确认只是清除此操作提醒，不代表重新构建成功。

领域调用丢回执、未知激活状态或未通过 activated 校验继续按原失败路径处理，不推断已经激活。此改动不回滚已恢复库、不放松 PCK／源码保护、不重放模型，也不改 checkpoint 驱动的 completed 验收条件。

## 验证

故障注入覆盖确认激活后交接失败、同编号和并发重试、状态查询、取消拒绝、旧授权拒绝、日志重开不重放、主进程恢复查询不再激活、未知丢回执、完整成功和有限 UI 文案。没有启动任何真实测试 profile。
