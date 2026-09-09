# S2｜统一执行器、隔离恢复和插件正式服务：交付报告

任务：`godot-round3-s2-20260910`。分支 `codex/godot-round3-s2-20260910`，
工作树 `D:/Craftmine World-worktrees/godot-round3-s2-20260910`。
本文件是进行中的交付记录，未完成项逐条保留；每次提交后刷新。

## 0 基线与接续

| 项 | 值 |
| --- | --- |
| 起点 | 最新本地 `master` `c2e592f` |
| 综合基线 | 尚未由 S7 提供（无 `codex/godot-round3-s7-*` 分支），按派单保留历史地合入 R2 已提交基线 |
| 合入 | `2fa3c7c`（R2 综合，含 R1/R3/R4/R5/R6 与 C `f35c5c7`）→ `0645454`；B 最终沙箱 `5cf65eb` → `5838ca3` |
| 祖先核对 | 两次合并均无冲突，未复制旧树、未改写贡献历史；旧工作树只读 |
| 未触碰 | 主目录 `README.md`、`docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md` 及未提交文档；R2 树；任何运行中的二进制与共享缓存 |

旧 C 的回收路径与 B 的 `recover` 同时存在于合入结果中，本轮按派单"合并接手旧 C 与 B
的范围，避免两个清理器并存"处理：C 的弱路径已删除，只保留 B 的 host-owned 恢复。

## 1 必须完成项逐条

### 1.1 用最终恢复协议替换 PID+映像文件名清理（完成）

- `plugins/craftmine-world/godot-executor.cjs` 删除 `reapTaskProcess`
  （`tasklist` + `taskkill /T /F`）与 sidecar 读取，改为唯一入口
  `godot-host-broker.exe recover <tasksRoot>`。
- 只有 `identityVerified === true && journalRemoved === true` 记为 `reclaimed`；
  `skipped`（含 `broker-still-running`、`pid-reused`）保持原样不动；
  `unreadable` 单独列出。
- 恢复报告恒有 `finalReceiptObserved:false`；若报告声称有最终回包，标记
  `finalReceiptClaimed` 并作为矛盾暴露，不采信。
- 静态断言：执行器源码不含 `tasklist`/`taskkill`。
- 证据：`tests/godot-round3/S2/recovery-protocol.mjs` 12/12（脚本 broker）、
  `tests/godot-round3/S2/recovery-real-broker.mjs` 4/4（真实 broker CLI）、
  C 协议回归 15/15。原始输出见 `evidence/`。

### 1.2 在启动、异常退出、取消、重启对账中实际调用 recover（完成）

触发点（单飞链，避免并发争抢同一 journal 目录）：`startup`、`broker-exit`
（任何未同时满足"成功 + 自己退休 journal"的运行）、`cancel`、`reconcile`、
`stop`。区分"无最终回包后回收"与"成功完成"：

- 只有 `state:succeeded && cleanup.verified && recoveryJournal.cleared` 记为
  `succeeded`；否则记为 `reclaimed-without-final-receipt` 或
  `no-final-receipt:<原因>`。
- 耐久账本 `<data>/godot/executor-ledger.json` 原子写入，逐 attempt 记录
  requestId / transport / outcome。
- 重启对账：只有在核心报告 `queued`/`blocked` 且每个历史 attempt 都已证明成功或已被
  身份核验回收时才重新入队；否则置 `interrupted`
  （`GODOT_RESTART_IDENTITY_UNVERIFIED`），不重复启动同一作业。

### 1.3 固定 broker 协议与二进制身份（部分完成）

- 已实现 pin 机制与 `broker-identity.mjs` 记录器；身份文件包含协议/恢复策略版本、
  源码摘要、二进制 sha256。
- 本树已生成 `desktop/godot/sandbox/broker-identity.json`
  （profile `debug`，sha256 `93d35cc8…4038c4`，源码摘要 `32ba0402…03501`，
  sourceCommit `5cf65eb`）。
- 未完成：发行用的 release 身份需由打包步骤从规范构建重新生成（debug 哈希含绝对
  路径）。见第 3 节。
- 任务 ID / profile 长度：`craftmine.godot.task.<taskId>` ≤ 64，执行器生成
  `<pf|im|ex>-<24hex>`（27 字符）并在启动前校验；测试覆盖上限常量。

### 1.4–1.8 正式路由、服务构造、模型链路、运行期异常、资源边界、打包

见第 2 节进行中清单。

## 2 进行中与未完成

| 派单条目 | 状态 | 说明 |
| --- | --- | --- |
| 4 正式私有路由 `godotWorld.initialize/initStatus` 等 | 进行中 | 核心已提供 `godotWorld.*`（godot_worlds.rs）；插件 router 尚未开放 |
| 5 main.cjs 构造 S5 素材服务 / S3 作品服务 / S6 采样预算 | 未完成 | `createAssetService`、`createReuseService` 目前无生产构造；S6 的 `sampleLiveState`/budget 参数在本树 `world-tools.cjs` 中尚不存在（S6 未交付） |
| 6 模型 build/enqueue/cancel、firstLoad 证据串通 | 未完成 | 依赖 S6 工具层与 R2 注入 |
| 7 运行期异常、加载页/空画面/静态有效画面、崩溃/丢回包 | 部分 | 加载页/空画面/静态帧区分与快照已由 C 的 verifier 覆盖；游戏内未捕获 JS 异常待补 |
| 8 插件与检查 preload 实际打包 | 未完成 | `godot-check` 已在 electron-vite preload 输入中；本树无 `node_modules`，尚未实际打包 |

## 3 已定位但未解决

1. **release broker 身份**：debug 构建哈希含构建目录，发行 pin 必须由 S8 的规范
   release 构建生成；本树提供记录器与格式，未生成 release pin。
2. **S6 采样/预算参数缺失**：`world-tools.cjs` 在本树只有 5 个参数，没有
   `sampleLiveState`/`budget` 注入点（审计报告指向 R7/L 分支的 6 参数变体）。
   需要 S6 交付后由本任务接线，不能在本任务内发明该接口。
3. **核心缺少 `godotJob.pending`**：跨进程遗留 `queued` 作业的自动重入队仍不可用；
   本任务用自身耐久账本 + 可信调用方覆盖已启动过的作业，未启动过的 `queued` 作业
   需要 S1 提供该接口。
4. **`asset.*` / `library.install|planInstall|formatCheck` / `portable.*` 不是核心
   路由**：素材与作品服务的生产接线需要 S1/S5/S3 的真实方法名；不得为省接线开放任意
   core RPC。

## 4 身份

| 项 | 值 |
| --- | --- |
| 源码 | `codex/godot-round3-s2-20260910`，基线提交见第 0 节 |
| broker 二进制 | `desktop/godot/sandbox`（`cargo build --offline`），sha256 `93d35cc881887fa632dd2bc02502141c1b9670353d6a6536590c36e2824038c4`，profile `debug` |
| broker 协议 | `BROKER_PROTOCOL_V1.md`，`schemaVersion:1`，`craftmine.windows.lpac-registry.v1`，恢复策略 `craftmine.windows.recovery-journal.v1` |
| Godot 引擎 | 4.7.2-stable（`desktop/build/godot/4.7.2-stable`，编辑器 sha256 `ab1824f8…b22424`） |
| 宿主 bridge | `desktop/godot/web/bridge.js` |

## 5 证据

| 文件 | 内容 |
| --- | --- |
| `evidence/recovery-protocol.log` | 12/12，脚本 broker，含异常退出/取消/停止/重启对账 |
| `evidence/recovery-real-broker.log` | 4/4，真实 `godot-host-broker.exe recover` |
| `evidence/c-executor-protocol-regression.log` | 15/15，C 的协议回归未被破坏 |
