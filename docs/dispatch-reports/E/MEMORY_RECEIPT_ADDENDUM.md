# E 追加集成修复：记忆重复提交回执

2026-09-09，根 Agent 在 E 原交付完成后追加授权。E 已先合并 G `88957dc0c14e85cb4f683129b61710ca77e6abc5`，然后完成独立逻辑提交 `cdb9ba3`。这不是此前 E 安装包内容，最终集成包必须重建。

## 问题与结果

记忆写入成功、短任务正常结束之后，如果回执丢失，界面使用同一操作编号重试时会建立新 turn。原 `memory.propose` 将 context 纳入请求哈希，因此新 turn 被拒绝为 REPLAY_MISMATCH。现有 operation 表只有 hash/result，无法证明原会话，不能仅凭相同文本就猜测重用。

本修复在**原表**添加 nullable `request_json`；新写入与原结果同事务保存原始请求。新增只读 `memory.findReceipt`，核对原请求哈希、记录、project/session/world、完整业务内容，返回原保存结果。不会新建任务、获取租约或写入第二条记忆。原提议接口的严格幂等规则保留。

## G / C 接线

Rust 方法 `TaskJournal::memory_find_receipt(&self, args)`。G 在 craftmine-core/src/main.rs 的 memory.propose 路由旁加：

```rust
"memory.findReceipt" => return journal.memory_find_receipt(params),
```

完整输入 `{projectId,sessionId,worldId,operationId,request:{kind,claim,tags?,supersedes?}}`；所有身份字段必须由受信宿主注入，不能让 renderer/model 冒充。`claim` trim；数组缺省为空但顺序保留，C 已确认其正常化约定。无原操作返回 null；命中则返回原 saved record。不同身份返回 MEMORY_RECEIPT_OWNER_MISMATCH，不同业务请求返回 REPLAY_MISMATCH；旧行无原始证据返回 MEMORY_RECEIPT_UNVERIFIABLE，损坏返回 MEMORY_RECEIPT_CORRUPT。未知字段拒绝。不可核实的旧操作必须停止，不能继续创建代替旧回执。

补丁 `memory-integration.patch` 只含上述 G 热文件接线，`git apply --check` 通过。实际 stdio 回归使用这一临时 overlay；测试后已移除，主入口没有提交变化。对应源码/overlay/二进制 SHA256 记录在 `docs/evidence/dispatch/E/memory-verification.json`。

## 备份兼容

新导出 `format:craftmine.domain-backup/1` 的 **schemaVersion 为 2**，因为 memory_operations 精确列变为四列。仍接收 schemaVersion 1，但必须匹配原三列，先验证原始归档哈希，再在隔离验证和真实原子恢复时补 request_json:null；不会推测历史会话。新版严格要求四列，未知版本或错标列拒绝。恢复旧归档后再导出为 schemaVersion 2。回滚快照和 status 的版本同步。E 文件选择桥不假定具体列，因此保持 32 MiB 与原接口不变。原 E 安装包/报告中 schema 1 描述对应旧源码，不应套在本增补之后的集成版本。

## 实测

在 E 自己的 target/debug 与 test-results/dispatch-e-receipt 合成档案运行，没有真实模型/用户凭据/输入/窗口。`cargo test --manifest-path vendor/pi-desktop/Cargo.toml --locked -p craftmine-core`：37 个通过，含 5 个新 Rust 回执/迁移测试。首次使用过滤词 memory 匹配到零项，未记为验证；改为 receipt_tests 得到 5/5，再完成全 crate 37/37。

`cargo build --manifest-path vendor/pi-desktop/Cargo.toml --locked -p craftmine-core` 后设置 CRAFTMINE_CORE_BIN 为本组绝对路径，执行 `node --test tests/dispatch/e/memory-receipt-process.test.mjs tests/dispatch/a/domain-process.test.mjs`：7/7 通过，其中 5 项原 A 全功能进程回归、2 项新增。真实覆盖结束/重启回执、原记录数量不增加、身份与内容差异/未知字段拒绝、新备份自导自验和恢复、旧版迁移、错标/未知版本拒绝。

日志 memory-rust.log、memory-build.log、memory-process.log 已提交。没有重打包、没有改 G 工作树。仍由 G 接线并验收最终 UI；本修复自身状态 ready_for_integration。
