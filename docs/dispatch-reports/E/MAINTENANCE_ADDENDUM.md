# E 追加集成修复：手动压缩保持世界任务

2026-09-09。根 Agent 授权本项并明确暂停相关共享入口修改；基于已合并 G 645b030 的 E 工作树开发。代码提交 `1e685fd4072272386d74f046722e09c1bda51339`。状态 ready_for_integration；未重打安装包。

此前点手动压缩会调用 workspace.open，产生新任务、取消原检查/评审并重置预算。现在只开启 PI 维护 turn，Main 将它私下映射到原 session 的 finished/current 世界任务。原世界绑定来自私有 maintenance.context 路由，与面板选择无关。没有 finished 世界任务就明确报错，不为压缩新建世界草稿。

维护只能读上下文、预约 summary、记录 compaction 和结算，连只读工具也全部拒绝。上下文读取不追加最新用户请求。Rust 只给 finished/current/no-recovery 的 summary 和 compaction 边界增加许可，creation/retry/tool 仍需活跃写租约。PI 完成或失败不会结束旧领域任务；映射保留用于准确结算迟到回执，新作者 turn 不继承它。新领域 turn 出现后，旧 summary 在 Rust 被 STALE_TURN 拒绝。手动尝试失败仍记压缩次数与无法确认的保留额度。

实际改动含 index.ts 手动入口/gateway回调/finishTurn、独立 craftmine-maintenance-context.ts、gateway 可选只读谓词、PluginRuntime 私有路由白名单、host-requests 的 maintenance.context 分支、durable.rs finished-summary/compaction 许可、B finished-summary 上下文与测试、独立进程回归、同步 ADR/E2E 文档。未触碰 root 新纠错/requirements 区域；没有第二套 Agent 循环。

## 验证

- `node desktop/build-world-plugin.mjs` 与 `cargo build --manifest-path vendor/pi-desktop/Cargo.toml --locked -p craftmine-core`，自己的 target/debug：通过。
- 设置 CRAFTMINE_CORE_BIN 为本组绝对路径，执行 `node --test tests/dispatch/e/maintenance-process.test.mjs`：1 个完整场景通过（200.8 ms）。真实 Rust + 实际 Main registry/gateway + 私有插件 router；检查/评审输入和模型 usage 为明确合成夹具。完整比较 workspace、verification、review、requirements 未变；预算 owner 未变，原创建 90 token + 成功 summary 40 token = 130，失败 summary 100 估计保留，3 请求/2 压缩；原生成结果仍为待应用候选。直接 Rust creation/tool 和维护 tool/retry/review 被拒绝；晚结算允许，新上下文拒绝。
- `pnpm --filter @pi-desktop/agent-runtime exec vitest run src/craftmine-context.test.ts`：15/15，新增 finished summary 不能用于 creation/retry/cancelled 的测试。
- `pnpm --filter @pi-desktop/agent-runtime build` 后 `pnpm --filter @pi-desktop/desktop exec tsc -p tsconfig.json --noEmit`：通过。
- `cargo test --locked -p craftmine-core`：37/37，通过（0.93 秒）。

第一次维护夹具漏提供 known usage 必需的 inputTokens/outputTokens，Rust 返回 INTEGER_REQUIRED；补齐真实契约后通过，没有弱化实现校验。初次桌面 tsc 引用了 E 旧包留下的 agent-runtime dist，缺少 B 导出；重建该工作空间依赖后通过。没有把上述失败记为成功，也没有真实模型或真实键鼠/窗口操作。

这不是完整 UI/真实模型手动压缩成绩；G/F 仍须从集成版本运行原生入口，确认同预算归属、候选可应用。此前 E source 2cf0f69 安装包不含此修复，不可作为最终发行证据。当前代码与 debug 二进制哈希见 maintenance-verification.json。根 Agent 已收到代码并可继续相邻入口工作。

## 普通会话兼容补丁

根 Agent 再次指出：内置插件存在不代表当前 PI 会话已创建世界。提交 `d8a83a05f7c2b85fd864e6882200fe4111de252b` 使私有发现路由仅在 workspace 不存在时返回 null，Main 使用原 generic compact；已有 running/cancelled/interrupted 世界仍拒绝，绝不新建草稿作为回退。真实进程测试新增 absent 仍 absent、running 拒绝以及实际关闭重启后 interrupted 拒绝，最终 1/1 通过（238.5 ms）；桌面 tsc 通过。首次测试尝试不存在的 task.recover RPC，随后改用真实进程重启复现，未修改协议以迁就测试。此前本附录对“无 finished 世界一律报错”的描述只对应 1e685fd 旧提交；最新行为以本补丁为准。
