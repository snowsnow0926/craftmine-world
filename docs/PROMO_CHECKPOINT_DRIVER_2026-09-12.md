# 宠物检查点派生试验驱动

日期：2026-09-12。本轮只实现驱动和离线测试，没有启动产品、导出原测试档案、恢复世界或调用模型。

## 用途与边界

`tests/promo-wish-checkpoint.mjs` 将已经成功采用的 PET02 世界经正式备份交给下一轮产品。导出和恢复是两个独立阶段，报告均标记 `checkpoint-derived`。原试验已经用完的 10 请求结果保持原样，不能将后续修改归为原试验自主成功。

驱动只接受成功 `craftmine.promo-adoption/1` 报告，核对原 pilot 的世界 ID、采用构建，以及原评测账本确实有 10 个不同请求且限额为 10。报告、采用报告、评测账本、原隔离 marker 在运行前后必须 SHA 相同。测试不能复制整个 profile、删除账本或提高限额。

## 导出

```powershell
node tests/promo-wish-checkpoint.mjs export "D:\...\adoption-...\report.json"
```

默认使用原报告记录的原始成品；若需要指定诊断成品，必须说明原因：

```powershell
node tests/promo-wish-checkpoint.mjs export "D:\...\adoption-...\report.json" --packaged-root "D:\...\win-unpacked" --diagnostic-reason "验证新产品的正式备份兼容性"
```

驱动验证实际包清单、headless 守卫和原 profile marker，通过正常入口进入工作台；必须仍是原已采用 build。执行 `godot.runtimeSave(freeze:true)`，再执行 `backup.export`，绝不再次 candidateApply。

正常 headless 文件选择器固定导出到原测试 root 的 `portable-backup.craftmine`。驱动将完整归档复制到独立的新 `test-results/desktop-native-*` 目录，记录实际文件 SHA-256、大小、产品 archiveHash，以及新的导出报告路径。实际文件哈希与产品内部 archiveHash 是不同字段，不混为一谈。

## 恢复

```powershell
node tests/promo-wish-checkpoint.mjs restore "D:\...\checkpoint-export-root\report.json" --packaged-root "D:\...\new-product\win-unpacked"
```

创建全新合法 headless root/profile、全新 marker/token；仅复制归档到新 root 的固定备份文件名。使用产品默认选中世界，通过 `backup.inspect` 获取临时授权及目标当前哈希，随后 `backup.restore`。等待真实产品完成缓存重建，再正常选择原 worldID、保存并读取引擎 snapshot 和历史页面源索引。

报告区分旧／新 build，记录正式 appliedOid、历史分支 head/source manifest 及进度。历史分支索引可能包含后续草稿，因此不把它冒充正式源码；构建或 manifest 改变也不自动等同于作者源码丢失或保留。相关差异交给实际集成验收判断。

如果产品要求显式任务恢复、存在 lease、活动任务或重建失败，报告阻塞／失败。驱动不会自动 resume、discard 旧任务，更不会删库或强制修改状态。

## 下一次模型试验

这个驱动不启用模型评测处理器，不提供 key、不初始化 provider/session、不创建评测账本。新 profile 在恢复后仍没有 `creation-evaluation-budget.json`；它保留领域任务和领域预算历史，这是正常备份内容。

总控另起新的检查点派生模型试验时，可正常建立新 provider/session，并用 `CRAFTMINE_EVAL_REQUEST_LIMIT=10` 初始化独立额度。正式发出请求前必须校验新 session/task 的正常 lease，不能继承旧任务后宣称其预算已重置。原报告与原账本 SHA 仍需保留。

## 已验证内容

- 7 项离线契约测试通过：阶段参数、成功采用和耗尽账本、marker 隔离、禁止模型／采用／任意 RPC／信封覆盖、剔除模型环境、实际文件哈希及差异报告。
- 主驱动语法检查和 diff 空白检查通过。
- 未运行真实 export/restore。真实旧包导出、新包恢复、重建及源／进度比对由总控运行上述两阶段验证。

测试命令：`node --test tests/promo-wish-checkpoint.test.mjs`。
