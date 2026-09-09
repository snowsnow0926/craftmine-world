# S2｜统一执行器、隔离恢复和插件正式服务：交付报告

任务：`godot-round3-s2-20260910`。分支 `codex/godot-round3-s2-20260910`，
工作树 `D:/Craftmine World-worktrees/godot-round3-s2-20260910`。
本文件是进行中的交付记录，未完成项逐条保留。

## 0 基线与接续

| 项 | 值 |
| --- | --- |
| 起点 | 最新本地 `master` `c2e592f` |
| 综合基线 | 尚未由 S7 提供（无 `codex/godot-round3-s7-*` 分支），按派单保留历史地合入 R2 已提交基线 |
| 合入 | `2fa3c7c`（R2 综合，含 R1/R3/R4/R5/R6 与 C `f35c5c7`）→ `0645454`；B 最终沙箱 `5cf65eb` → `5838ca3` |
| 祖先核对 | 两次合并均无冲突，未复制旧树、未改写贡献历史；旧工作树只读 |
| 提交 | `d692917` 执行器恢复与账本；`ec777f1` 私有路由与服务接线 |
| 未触碰 | 主目录 `README.md`、`docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md` 及未提交文档；R2 树；运行中的二进制与共享缓存（只读复用 `D:\cm-g6-root` 的依赖目录，以 junction 挂入工作树且被 gitignore） |

旧 C 的回收路径与 B 的 `recover` 同时存在于合入结果中，本轮按派单"合并接手旧 C 与 B
的范围，避免两个清理器并存"处理：C 的弱路径已删除，只保留 B 的 host-owned 恢复。

## 1 必须完成项逐条

### 1.1 用最终恢复协议替换 PID+映像文件名清理（完成）

- `godot-executor.cjs` 删除 `reapTaskProcess`（`tasklist` + `taskkill /T /F`）与
  sidecar 读取，改为唯一入口 `godot-host-broker.exe recover <tasksRoot>`。
- 只有 `identityVerified && journalRemoved` 记为 `reclaimed`；`skipped`
  （`broker-still-running`、`pid-reused`）原样保留；`unreadable` 单独列出；
  报告若声称有最终回包，标记 `finalReceiptClaimed` 并作为矛盾暴露。
- 静态断言：执行器源码不含 `tasklist`/`taskkill`。
- 证据：`recovery-protocol` 14/14、`recovery-real-broker` 4/4、C 协议回归 15/15。

### 1.2 在启动、异常退出、取消、重启对账中实际调用 recover（完成）

触发点（单飞链）：`startup`、`broker-exit`、`cancel`、`reconcile`、`stop`。
只有 `state:succeeded && cleanup.verified && recoveryJournal.cleared` 记为
`succeeded`；否则 `reclaimed-without-final-receipt` / `no-final-receipt:<原因>`。
耐久账本 `<data>/godot/executor-ledger.json` 原子写入，逐 attempt 记录
requestId/transport/outcome。重启对账只在核心报 `queued`/`blocked` 且每个历史
attempt 已证明成功或已被身份核验回收时重新入队，否则置 `interrupted`
（`GODOT_RESTART_IDENTITY_UNVERIFIED`），同一作业不因观察等待超时被重复启动。

### 1.3 固定 broker 协议与二进制身份（完成机制，release pin 待打包）

- `broker-identity.mjs` 记录二进制 sha256、协议/恢复策略版本、源码摘要；
  `broker-identity.json` 已生成（profile `debug`，sha256
  `93d35cc8…4038c4`，源码摘要 `32ba0402…03501`，sourceCommit `5cf65eb`）。
- 执行器按 `CRAFTMINE_GODOT_BROKER_SHA256` → 二进制旁的
  `broker-identity.json` → `<data>/godot/broker-identity.json` 解析 pin；不符即
  `GODOT_BROKER_MISMATCH`，不注册。未配置 pin 时如实报告 `broker.pinned:false`。
- taskId/profile 长度：`craftmine.godot.task.<taskId>` ≤ 64，执行器生成
  `<pf|im|ex>-<24hex>` 并在启动前校验，测试覆盖上限常量。

### 1.4 正式私有路由（完成）

`host-requests.cjs` 新增字段级白名单表并同时登记到
`plugin-runtime.ts` 的私有方法白名单（有测试保证两边同步）：

- `godotWorld.initialize/initStatus/copy/backupSnapshot/verifySnapshot`
- `godotProject.create/index/read/patch/receipt`
- `godotBuild.start/read/cancel/receipt`、`godotJob.continue/usage`
- `godotCandidate.list/read`、`godotStorage.status/reclaimPlan/reclaimCommit`
- `godotAsset.put/list`
- `content.status/gitInfo/history/changes/diff/readFile/branch.list/version.list/
  checkpoint.set/checkpoint.list/apply.prepare/advance/confirm/rollback/recover/
  reclaim.plan/reclaim.prune/verify/bundle`（历史与恢复）
- `library.search/read/capture`、`world.list/create/saveProgress`、`asset.request`、
  `package.request`
- 原有 `backup.export/inspect/restore/status/cancel`（portable backup）

路由只转发列出的字段，未列字段在到达核心前被拒绝；模型/页面无法到达这些方法
（`godotExecutor.enqueue/cancel/revoke` 不在白名单中，只有宿主可用）。

### 1.5 main.cjs 构造并注入服务（部分完成）

- **完成**：`createAssetService({call, runPreview, readFile})` 与
  `createReuseService({call})` 在 `onLoad` 中真实构造，并注入 host router；
  `asset.request`/`package.request` 按服务自身的有界方法面转发。
  `asset-service.mjs`、`reuse-service.mjs` 已加入 `build-world-plugin.mjs`
  拷贝列表，打包产物已实际生成并验证。
- **完成**：`plugin-runtime.ts` / `plugin-host-process.mjs` 暴露宿主桥
  `craftmine.godotCheck`、`craftmine.cancelGodotCheck`、`craftmine.assetPreview`、
  `craftmine.sampleLiveState`；此前 `pi.craftmine.godotCheck` 会落到
  `UNSUPPORTED`，现在能到达宿主注入的实现。
- **完成**：`main.cjs` 向 `createWorldTools` 传入第 6 参数
  `{sampleLiveState, budget, executorEnqueue, historyMethods, libraryMethods}`；
  其中 `executorEnqueue` 与 S6 已提交的
  `codex/godot-round3-s6-20260910`（`world-tools.cjs` 第 6 参数）契约一致：
  `executorEnqueue({jobId,worldId,mode}, context) -> {enqueued, reason}`，
  `budget` 是 S6 期望的提供者函数（本树返回空对象，所有计数保持 unknown）。
- **未完成**：本树 `world-tools.cjs` 仍是 5 参数版本，不消费该对象；S6 的新
  `world-tools.cjs`/`godot-*.cjs` 在其分支上，需由 S7 集成（或 S6 基于本分支
  重做）后模型链路才成立。
- **未完成（依赖已就绪）**：素材/作品的正式可用依赖核心方法。S1 已在
  `codex/godot-round3-s1-20260910`（`b307d54`）登记
  `asset.import/read/versions/bodyPath/search/scan/annotate/recordUsage/usage/
  previewBegin/previewFinish/previewRead/probe/recordCheck/mapLegacy` 与
  `package.formatCheck/planInstall/...`，并新增 `backup.*Portable` 等；本分支按派单
  不代做 S1 的核心，待 S7 综合后这两个服务即可端到端工作。当前这两个服务的调用
  会得到本树核心的 UNSUPPORTED_METHOD。

### 1.6 模型 build/enqueue/cancel 与 firstLoad（接口已交，集成待 S7）

- `godotExecutor.enqueue/cancel/status` 私有路由已就绪，宿主可驱动；
  `runJob` 会真实 claim/import/export/check/finish 并记录耐久 attempt。
- **已交付接口**：`main.cjs` 按 S6 契约注入
  `executorEnqueue({jobId,worldId,mode}, context)`；S6 分支的 `world-tools.cjs`
  在 `godot_build_start` 之后调用它。本树尚未包含 S6 的 `world-tools.cjs`，
  因此模型链路在本分支仍停在 `blocked/queued`，需 S7 集成后联合验证。
- 核心仍无 `godotJob.pending`（S1 分支亦无），跨进程遗留 `queued` 作业无法自动
  发现；已启动过的作业由本任务的耐久账本覆盖。
- firstLoad 需 R2 在 `main/index.ts` 注入 `GodotBuildVerifier`（本任务已把
  `craftmineGodotCheck` 桥打通），双方联合验证未进行。

### 1.7 运行期异常、画面区分、快照、崩溃/丢回包（完成本任务范围）

- **新补**：`electron/preload/godot-check.ts` 在 main world 安装
  `error`/`unhandledrejection` 钩子，把被授权脚本抛出的异常以 `runtime-error`
  帧上报宿主；此前只有引擎 `onPrintError` 与 console 通道能发现错误。
  真实 Electron 离屏隐藏窗口验证：`uncaught-error: … S2 in-game boom` 与
  `unhandled-rejection: … S2 unhandled rejection` 均到达宿主（`check-error-hooks`）。
- 加载页/空画面/静态有效画面区分与快照一致性由 C 的 verifier 负责（
  `BLANK_GAME_FRAME`、3 帧非空、`snapshot.expectedHash==actualHash`），C 协议回归
  15/15 覆盖未破坏。
- 崩溃/丢回包/清理由本任务的恢复协议与耐久账本覆盖（见 1.1/1.2）。

### 1.8 资源与执行边界、打包（部分完成）

- `resourceEnforcement` 与硬配额分开报告：receipt 报 `enforced:true` 时作业失败为
  `GODOT_RESOURCE_BUDGET_EXCEEDED`；`status().resources` 如实标注
  `hardFilesystemQuota:false` 与采样 scope，不声称文件系统配额。
- **完成**：`desktop/build-world-plugin.mjs` 实际执行成功，产物包含
  `godot-executor.cjs`、`asset-service.mjs`、`reuse-service.mjs`、`domain.cjs`；
  打包后的 `main.cjs`/`host-requests.cjs` 可加载，入口存在（`plugin-routes` 断言）。
- **完成**：`godot-check` preload 用与 electron-vite 相同的参数实际编译成功，产物
  含输入守卫与错误钩子，并在真实 Electron 中运行通过。
- **未完成**：完整 `electron-vite build`（main+renderer）未在本树运行；依赖目录
  `D:\cm-g6-root` 的工作区包没有 `dist`，直接 `tsc --noEmit` 有 252 个既有
  解析错误（全部为缺 `@pi-desktop/*` 类型，与本次改动无关，`godot-check.ts` 与
  `godot-build-verifier.ts` 零错误）。规范构建由 S7/S8 在综合基线上执行。
- **未完成**：源码导入、包脚本/预览、Git hooks/filter 的宿主权限边界本轮只做了
  路由收敛（只转发白名单字段、服务自身校验），未做合成资源的输入/剪贴板边界实测。

### 1.9 独立代码评审与修复（完成）

对 `godot-executor.cjs` 的恢复/账本逻辑做了独立只读评审，按发现逐条修复并补测：

| 发现 | 处理 |
| --- | --- |
| 作业可通过但 attempt 记为"无最终回包" | 运行"成功 + cleanup.verified"即记 `succeeded`，另记 `journalRetired`；未退休的 journal 仍走恢复，两者不再混同 |
| `reconcileAfterRestart` 忽略 `enqueue` 返回值 | 只有 `enqueued:true` 才置 `enqueued`，否则保持非终态并记录原因 |
| 阻塞期取消被记成 `blocked` 且不通知核心 | 改为走 `abandon()`（调用 `godotBuild.cancel` + 恢复） |
| `abandon` 吞掉取消失败 | 未确认的核心取消记 `cancel-unconfirmed` 并保持可重试 |
| `persistLedger` 固定临时名 / 失败被吞 | 唯一临时名；读写失败记入 `status().ledger.error`；`loadLedger` 前先等写链，并规范化损坏条目 |
| `finish` 非 `failed` 一律记 `finished` | 只有核心确认 `passed` 才是终态成功，其余保持可重试 |
| broker 忽略取消帧且杀不掉时作业永久挂起 | 宽限期后强制结算，交由恢复判定清理 |
| `child.on('error')` 不做恢复 | 同样触发恢复 |
| 恢复执行器抛异常改变作业状态 | 恢复失败只返回 `ok:false` 摘要，不影响作业结果 |
| 汇总用报告自报计数 | 计数改为从条目数组推导，同时保留报告值以便对比 |

新增测试：journal 未退休仍为有效构建、恢复失败不改作业结果、损坏账本不阻断启动。

## 2 身份

| 项 | 值 |
| --- | --- |
| 源码 | `codex/godot-round3-s2-20260910`：`d692917`（恢复）、`ec777f1`（接线） |
| broker 二进制 | `desktop/godot/sandbox`（`cargo build --offline`），sha256 `93d35cc881887fa632dd2bc02502141c1b9670353d6a6536590c36e2824038c4`，profile `debug` |
| broker 协议 | `BROKER_PROTOCOL_V1.md`，`schemaVersion:1`，`craftmine.windows.lpac-registry.v1`，恢复策略 `craftmine.windows.recovery-journal.v1` |
| Godot 引擎 | 4.7.2-stable（`desktop/build/godot/4.7.2-stable`，编辑器 sha256 `ab1824f8…b22424`） |
| 宿主 bridge | `desktop/godot/web/bridge.js` |
| Electron | 43.4.0（`D:\cm-g6-root` 只读依赖） |

## 3 证据

| 文件 | 内容 |
| --- | --- |
| `evidence/recovery-protocol.log` | 14/14，脚本 broker：异常退出/取消/停止/重启对账/身份不可验证不重启/journal 未退休/恢复失败/损坏账本 |
| `evidence/recovery-real-broker.log` | 4/4，真实 `godot-host-broker.exe recover` |
| `evidence/c-executor-protocol-regression.log` | 15/15，C 协议回归 |
| `evidence/plugin-routes.log` | 5/5，打包后的 router：字段白名单、服务转发、白名单同步、打包产物入口 |
| `evidence/check-error-hooks.log` | 1/1，真实 Electron 离屏窗口中的未捕获异常与未处理 rejection |

## 4 已定位但仍未解决

1. **release broker pin**：debug 哈希含构建目录，发行 pin 必须由 S8 的规范 release
   构建用 `broker-identity.mjs` 重新生成。
2. **核心缺 `asset.*` 与 `package.*`**：S5/S3 服务已构造并路由，但调用会得到核心
   UNSUPPORTED_METHOD；责任 S1（RPC）+ S5/S3（最终方法）。
3. **核心缺 `godotJob.pending`**：跨进程遗留 `queued` 作业无法自动发现；已启动过的
   作业由本任务的耐久账本覆盖，未启动过的需要 S1 该接口。
4. **S6 `world-tools.cjs` 未消费第 6 参数**：采样桥与 budget 提供者已注入，接口
   由 S6 实现；budget 计数在提供者返回空对象时保持 unknown。
5. **模型→构建→检查→应用→firstLoad 的联合串通**：需 S6 工具钩子 + R2 注入
   verifier 后联合验证，本任务不代替验收者。
6. **完整 electron-vite 构建与同包验收**：依赖工作区包 `dist`，由 S7/S8 在综合
   基线上完成。
