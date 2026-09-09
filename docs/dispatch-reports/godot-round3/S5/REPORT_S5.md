# S5 交付报告：素材正式服务、真实预览与取消重试

## 0. 结论摘要

- 素材导入面板崩溃（R2 记录的真实 UI 缺陷）已修复并提交，附结构性回归测试。
- 预览的「缓存身份 / 执行尝试身份」已分离：claim/代际由核心签发，begin/decode/cancel/retry/finish
  全部绑定同一尝试；失败重试、同次幂等重放、取消后晚到成功、并发单次执行、重启恢复均由
  **正式提交构建的真实核心进程**证明（35/35）。
- 图片（PNG/JPEG）、WAV 实际解码保持；GLB 现在产出**真实离屏软件光栅静态画面**，并与
  accessor 结构解析分别记账；OGG 只解析容器并明确报为不可播放（不冒充可播放）。
- 面板预览/取消/重试改为调用真实服务通道 `asset.preview` / `asset.cancel`，迟到结果按
  代际淘汰。
- 未完成项集中在下游协作：S2 的服务构造/通道注册、R2 的玩家写通道放行、S1 的总回收
  批准器与 S4 pins 聚合；见第 4 节逐条状态。

## 1. 交付身份

| 项 | 值 |
| --- | --- |
| 分支 | `codex/godot-round3-s5-20260910` |
| 工作树 | `D:/Craftmine World-worktrees/godot-round3-s5-20260910` |
| 起点 | `f561d4b` = master `c2e592f` + R2 已提交 `2fa3c7c`（含 `957bbe4` 素材导航） |
| 提交 | `41cbf76` `c96d8bc` `8a86e0a` `bce5bd2` `e81e137` `62ebf9c`（回收/测试提交见文末更新） |
| 核心二进制 | `vendor/pi-desktop/target/debug/craftmine-core.exe`，9,192,448 bytes，SHA256 `2D7BBF750A8F3806CE7BE18F1380729AA184216FDB57EF3049C402A7A59DC895` |
| 工具链 | cargo 1.96.1、node v24.14.0 |
| 素材源码 | `vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/**`、`plugins/craftmine-world/asset-service.mjs`、`vendor/pi-desktop/apps/desktop/electron/craftmine-assets/**`、`vendor/pi-desktop/apps/desktop/src/components/craftmine/assets/**` |

## 2. 逐条完成条件

### 2.1 与 S1 唯一 AssetRef/锁、与 S2 生产构造、正式 RPC 可调用

- `asset_catalog/contract.rs` 只 re-export `content_history::contract` 的
  `AssetRef/FileRef/AssetLock`，七类 `AssetKind` 只在素材模块定义一次；S5 未新增第二套
  引用或锁结构。
- S5 提交了最小登记：`asset_catalog/dispatch.rs`（16 个 `asset.*`）+
  `lib.rs` 一行 re-export + `main.rs` 一行转发 + `hello` 能力位。见 `bce5bd2`。
- **正式默认构建可调用已证明**：`tests/godot-round2/R6/core-rpc-smoke.mjs` 对
  SHA256 `2D7BBF75…` 的提交构建跑出 `SUMMARY: 35 passed, 0 failed, 35 checks`，退出码 0。
  这同时解除了审计记录的「20 项成功 RPC 来自临时登记版本」缺口。
- 仍待 S2 实际构造 `createAssetService` 并注册 `asset.preview` / `asset.cancel` 通道；
  精确清单见 `INTERFACE_REQUEST_S5.md` 第 2 节。

### 2.2 缓存身份与执行尝试身份分离

- 缓存键仍为 `contentHash + previewerVersion + engineVersion + settingsHash`。
- 核心新增 `attempt/claim_id/claim_owner/claim_deadline` 四列（幂等 ALTER 迁移），
  `asset.previewBegin` 返回 `claim:{attempt, claimId, owner, deadline}`：
  - 活跃 claim 再次 begin → 返回同一 claim（`cached:true, resumed:true`），只有一个有效执行；
  - `ok/partial` → `cached:true` 且 `claim:null`，不重跑解码；
  - `failed/timeout/cancelled/过期` → 新尝试、新 claim（`retried:true`）。
- `asset.previewFinish` 必须携带 `claimId+attempt`，只有持有活跃 claim 的尝试能落盘；
  其它尝试返回 `{applied:false, stale:true, reason:"STALE_PREVIEW_ATTEMPT"}`（正常结果，
  不是 `OPERATION_CONFLICT`，也不覆盖现状）。
- 服务层 `operationId` 改为 `preview-<cacheKey>-a<attempt>-<claimId>`，同次重放幂等、
  新次结果不同不再冲突。

### 2.3 取消终止 worker、无永久 pending、并发单执行、预览身份

- `asset-service.cancel` 会对该 claim 的在途执行 `AbortController.abort()`，
  `preview-worker.runPreviewInWorker` 支持 `signal` 并终止 worker
  （`facts.workerTerminated`）。
- 取消写入该尝试的终态并清空 claim；旧 worker 的晚到结果被判定 stale。
- `asset_preview_sweep()` 把超过 TTL（4 分钟，> 20 s 解码超时）的 pending claim 关闭为
  `failed/PREVIEW_CLAIM_EXPIRED`；begin/finish/read 都会先 sweep，重启后不会永久 pending。
- 预览身份覆盖真实文件/版本/内容哈希与全部影响输出的设置（cacheKey 组成不变）。

### 2.4 图片/模型/音频预览

| 格式 | 状态 | 证据 |
| --- | --- | --- |
| PNG/JPEG | 真实像素解码 + 缩略图（`picture:true`） | `tests/godot-remaining/N/preview-service.test.mjs`、真实核心 `real decode evidence -> png 16x8` |
| GLB | **真实静态画面**（离屏软件光栅，`rendered:true`、`renderer:'glb-software-raster/1'`、`digest` 为渲染像素摘要）+ 独立 `accessorParsed:true` 结构事实 | `decode/glb-render.mjs`、preview-service GLB 分支、7 项 GLB 测试 |
| WAV | 真实 PCM 解码（`pcmDecoded:true, playable:true`） | `audio-decode.mjs`、22 项测试 |
| OGG | 只解析容器（codec/采样率/时长），**明确 `playable:false`、状态 failed** | `OGG_PCM_DECODE_NOT_IMPLEMENTED` |
| Godot 场景/脚本 | 静态引用检查，`executed:false` | `godot-package.mjs` |

- 预览在独立 worker 中运行，无窗口、无 Pointer Lock、无输入、不播放音频；含脚本的检查
  仍走 S2 可信入口（本模块不执行脚本）。
- 未支持/无效格式明确报错（`UNSUPPORTED_MEDIA_TYPE`、`CORRUPT_ASSET_BODY` 等），没有把
  已承诺格式改成「不支持」来关闭缺口；OGG 的 PCM 缺口如实保留为失败状态。

### 2.5 导入面板崩溃修复与真实服务调用

- 根因：`AssetLibrarySnapshot.scan` 与 `AssetLibraryActions.scan` 同名，`useAssetLibrary`
  的合并让方法覆盖数据，面板渲染时读 `scan.items` 抛错，根 error boundary 卸载整个 React 树。
- 修复：快照字段改名 `scanResult`（动作仍叫 `scan`），面板加 `Array.isArray` 守卫；
  `controllerActions()` 暴露动作集合，测试断言「快照数据键与动作名互不相交」。
- 面板预览改调 `asset.preview`、取消改调 `asset.cancel`；`previewGeneration` 按选择/尝试
  淘汰迟到结果（不是只靠 UI 隐藏）。
- 搜索/分类/标签/分页/范围/固定版本/使用关系仍走既有真实通道（R6 测试覆盖）。

### 2.6 导入鲁棒性（部分完成）

已实现并有测试：
- 流式导入（64 KiB 分块、fsync、临时文件 + rename、登记在正文就位后同事务）；
- 中断残留：`sweep_pending` 清理过期 staging 文件；
- 同版冲突 `ASSET_VERSION_CONFLICT`、来源冲突 `ASSET_SOURCE_CONFLICT`，且冲突时不再留下
  孤儿正文；固定 v1 不可被覆盖；
- 正文读取前重算 blob 哈希（`CORRUPT_ASSET_BLOB`）；
- Windows 独占锁：os error 32/33 映射为 `ASSET_SOURCE_LOCKED`，扫描遇到被锁文件只记
  `SOURCE_LOCKED` 问题、不再整体失败。

未完成/归他人：
- 扫描的「玩家授权」目前是宿主侧（面板经 `fs.requestDirectory` 选择目录），核心未持有
  授权清单；watch 按设计由宿主重复扫描，核心未实现 watcher；
- 与 S3 安装、S4 归档正文的联合联测未做（依赖对方提交）。

### 2.7 回收（S5 执行器 + 待 S1 批准器）

- S5 侧只执行「已批准且再次核验」的条目：见文末「回收执行器」一节（计划/提交两个方法、
  陈旧 plan 拒绝、使用关系保护、blob 复验与幂等）。
- S1 的总回收批准器（汇总世界/候选/草稿/活跃任务/分支/命名版本/迁移 + S4 pins）与
  `godot_storage::plan` 不再信任调用方 `protectedBuilds` 的加固仍未实现，因此本项按
  「未完成」记账。

## 3. 验收命令与结果

| 命令 | 结果 |
| --- | --- |
| `cargo test --offline -p craftmine-core --lib asset_catalog` | 26 passed / 0 failed（`preview.rs` 尝试契约 + 6 个新尝试测试） |
| `cargo test --offline -p craftmine-core --lib` | 232 passed / 1 failed / 3 ignored；失败为既存 `backups::portable::…GODOT_PROJECT_REVISION_NOT_INDEXED`（属 S4 范围，与素材改动无关） |
| `node --test tests/godot-remaining/N/preview-service.test.mjs` | 19/19 |
| `node --test tests/godot-remaining/N/image-decode.test.mjs` | 28/28 |
| `node --test tests/godot-remaining/N/audio-decode.test.mjs` | 22/22 |
| `node --test tests/godot-remaining/N/godot-package.test.mjs` | 25/25 |
| `node --test tests/godot-round2/R6/asset-service.test.mjs` | 8/8 |
| `node --test tests/godot-round2/R6/asset-library.test.mjs` | 18/18 |
| `node tests/godot-round2/R6/core-rpc-smoke.mjs` | 35/35，退出码 0（真实核心进程 + 正式提交构建） |

真实核心状态机证据（`docs/dispatch-reports/godot-round3/S5/evidence-core-rpc-attempts.txt`）：

```
[pass] a failed attempt is recorded as failed
[pass] a retry issues a new attempt and claim -> attempt=3
[pass] a changed retry result never becomes OPERATION_CONFLICT
[pass] cancel is applied as the attempt terminal state
[pass] a late success cannot overwrite the cancel
[pass] a concurrent begin resumes the single live claim
[pass] the pending claim survives the restart -> attempt=5
[pass] a restarted core resumes the same claim, not a second run
[pass] a fabricated claim cannot write a result
```

## 4. 首次失败与未解决项

- 首次失败（他方记录，本轮修复）：R2 `evidence/asset-navigation-ui.report.json` 的
  `Uncaught TypeError: Cannot read properties of undefined (reading 'find')`，
  栈顶 `AssetLibraryPanel.tsx:211`；已修复并有回归测试。
- 首次失败（本模块）：`asset-service.test.mjs` 的「cancel 终止 worker」断言第一次失败
  （runner 尚未挂载 abort 监听），保留为测试内注释说明「取消可能早于 worker 启动」。
- 未解决：
  1. S2 生产构造 `createAssetService` 与 `asset.preview`/`asset.cancel` 注册未合入
     （服务端代码已提交可消费）。
  2. R2 玩家写通道放行未合入；真实浏览器面板端到端验收未在本树执行（缺 node_modules）。
  3. S1 总回收批准器 + S4 pins 聚合未实现，回收只能以「执行器 + 批准清单」形式交付。
  4. OGG/Vorbis PCM 解码未实现（明确失败，不冒充可播放）。
  5. 与 S3 安装、S4 完整归档正文的联合联测未做。

## 5. 回收执行器（S5 侧）

见 `asset_catalog/reclaim.rs`：`asset.reclaimPlan` 只列出**没有任何使用关系**的版本候选
并给出 `planHash`/容量；`asset.reclaimCommit` 重新推导计划（哈希不符即
`ASSET_RECLAIM_PLAN_STALE`），逐条核验批准项（未批准 `ASSET_RECLAIM_NOT_APPROVED`、
有引用 `ASSET_RECLAIM_PROTECTED`、正文哈希复验），同事务删除版本/文件行并在提交后仅对
无引用正文执行 `discard_blob`。S5 不自行猜测哪些目录无用；批准策略与 pins 聚合属 S1/S4。
