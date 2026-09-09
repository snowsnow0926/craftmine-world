# S5 交付报告：素材正式服务、真实预览与取消重试

## 0. 结论摘要

- **导入面板崩溃（R2 记录的真实 UI 缺陷）已修复**：`scan` 同名冲突消除，附结构性回归测试。
- **缓存身份 / 执行尝试身份已分离**：claim 与代际由核心签发，begin/decode/cancel/retry/finish
  绑定同一尝试。失败重试、同次幂等重放、取消后晚到成功、并发单次执行、重启恢复均由
  **正式提交构建的真实核心进程**证明（39/39，退出码 0）。
- **真实预览**：PNG/JPEG 真实像素、WAV 真实 PCM 保持；GLB 现在产出**真实离屏软件光栅静态
  画面**并与 accessor 结构解析分别记账；OGG 只解析容器并明确报为不可播放。
- **面板预览/取消/重试改调真实服务** `asset.preview` / `asset.cancel`，迟到结果按代际淘汰。
- **回收**：S5 侧执行器（计划 + 提交、批准清单、再次核验、陈旧计划拒绝）已实现并有测试；
  S1 的总回收批准器与 S4 pins 聚合仍未实现，本项按「未完成」记账。
- 待他人合入：S2 的 `createAssetService` 生产构造与 `asset.preview`/`asset.cancel` 注册、
  R2 的玩家写通道放行。服务端代码已提交可直接消费。

## 1. 交付身份

| 项 | 值 |
| --- | --- |
| 分支 | `codex/godot-round3-s5-20260910` |
| 工作树 | `D:/Craftmine World-worktrees/godot-round3-s5-20260910` |
| 起点 | `f561d4b` = master `c2e592f` + R2 已提交 `2fa3c7c`（含 `957bbe4` 素材导航） |
| 提交 | `41cbf76` `c96d8bc` `8a86e0a` `bce5bd2` `e81e137` `62ebf9c` `df08a4e` `c8e0253` `d723c94` `b887de7` `593bf3a` |
| 核心二进制 | `vendor/pi-desktop/target/debug/craftmine-core.exe`，9,336,320 bytes，SHA256 `CDD50218BD20895A6A7BBF34C7170F6612FD34C1228EEE3ADB342D828047E307` |
| 工具链 | cargo 1.96.1、node v24.14.0 |
| 素材源码 | `crates/craftmine-core/src/asset_catalog/**`、`plugins/craftmine-world/asset-service.mjs`、`apps/desktop/electron/craftmine-assets/**`、`apps/desktop/src/components/craftmine/assets/**` |
| 专项测试 | `tests/godot-round3/S5/**`（新）、`tests/godot-round2/R6/**`、`tests/godot-remaining/N/**` |
| 报告与证据 | `docs/dispatch-reports/godot-round3/S5/{REPORT_S5.md,INTERFACE_REQUEST_S5.md,evidence-core-rpc-attempts.txt}` |

## 2. 逐条完成条件

### 2.1 唯一 AssetRef/锁、七类映射、生产构造与正式 RPC（部分完成）

- `asset_catalog/contract.rs` 只 re-export `content_history::contract` 的
  `AssetRef/FileRef/AssetLock`；七类 `AssetKind` 只在本模块定义一次。S5 未新增第二套引用或
  锁结构。
- S5 提交最小登记：`asset_catalog/dispatch.rs`（18 个 `asset.*`）+ `lib.rs` 一行 re-export
  + `main.rs` 一行转发 + `hello` 的 `assetCatalog/assetPreview` 能力位（`bce5bd2`）。
- **正式默认构建可调用已证明**：`core-rpc-smoke.mjs` 对上述 SHA256 的提交构建得到
  `SUMMARY: 39 passed, 0 failed, 39 checks`（退出码 0）。审计记录的「20 项成功 RPC 来自
  临时登记版本」缺口由此解除。
- 待 S2：在插件中实际构造 `createAssetService` 并注册 `asset.preview` → `preview`、
  `asset.cancel` → `cancel`；精确清单见 `INTERFACE_REQUEST_S5.md` 第 2 节。

### 2.2 缓存身份与执行尝试身份分离（完成）

- 缓存键不变：`contentHash + previewerVersion + engineVersion + settingsHash`。
- 核心新增 `attempt/claim_id/claim_owner/claim_deadline`（幂等 ALTER 迁移），
  `asset.previewBegin` 返回 `claim:{attempt, claimId, owner, deadline}`：
  - 活跃 claim 再次 begin → 同一 claim（`cached:true, resumed:true`），只有一个有效执行；
  - `ok/partial` → `cached:true, claim:null`，不重跑解码；
  - `failed/timeout/cancelled/过期` → 新尝试、新 claim（`retried:true`）。
- `asset.previewFinish` 必须携带 `claimId+attempt`；非当前尝试返回
  `{applied:false, stale:true, reason:"STALE_PREVIEW_ATTEMPT"}`——是正常结果，不是
  `OPERATION_CONFLICT`，也不覆盖现状。
- 服务层 `operationId` 为 `preview-<cacheKey>-a<attempt>-<claimId>`：同次重放幂等、新次结果
  不同不冲突。

### 2.3 取消、无永久 pending、并发单执行（完成）

- `asset-service.cancel` 对在途执行 `AbortController.abort()`；
  `preview-worker.runPreviewInWorker` 支持 `signal` 并终止 worker（`facts.workerTerminated`）。
- 取消写入该尝试终态并清空 claim；旧 worker 的晚到结果被判定 stale。
- `asset_preview_sweep()` 把超过 TTL（4 分钟，> 20 s 解码超时）的 pending claim 关闭为
  `failed/PREVIEW_CLAIM_EXPIRED`；begin/finish/read 先 sweep，重启后不会永久 pending。
- 真实核心证据（`evidence-core-rpc-attempts.txt`）：

```
[pass] a failed attempt is recorded as failed
[pass] a retry issues a new attempt and claim -> attempt=3
[pass] a changed retry result never becomes OPERATION_CONFLICT
[pass] the same finish replays idempotently
[pass] cancel is applied as the attempt terminal state
[pass] a late success cannot overwrite the cancel
[pass] a concurrent begin resumes the single live claim
[pass] the pending claim survives the restart -> attempt=5
[pass] a restarted core resumes the same claim, not a second run
[pass] a fabricated claim cannot write a result
```

### 2.4 图片 / 模型 / 音频预览（完成，OGG PCM 缺口如实保留）

| 格式 | 状态 | 证据 |
| --- | --- | --- |
| PNG/JPEG | 真实像素解码 + 缩略图（`picture:true`） | 19 项 preview-service 测试、真实核心 `real decode evidence -> png 16x8` |
| GLB | **真实静态画面**（离屏软件光栅：`rendered:true`、`renderer:'glb-software-raster/1'`、`digest` = 渲染像素摘要）+ 独立 `accessorParsed:true` 结构事实 | `decode/glb-render.mjs`（807 行）、7 项 GLB 测试（不同几何→不同摘要/缩略图、确定性、损坏/缺 POSITION/超时） |
| WAV | 真实 PCM（`pcmDecoded:true, playable:true`） | `audio-decode.mjs`、22 项测试 |
| OGG | 只解析容器（codec/采样率/时长），**明确 `playable:false`、状态 failed** | `OGG_PCM_DECODE_NOT_IMPLEMENTED` |
| Godot 场景/脚本 | 静态引用检查，`executed:false` | `godot-package.mjs`、25 项测试 |

- 预览在独立 worker 线程中运行：无窗口、无 Pointer Lock、无输入、不播放音频；含脚本的检查
  仍走 S2 可信入口，预览不获得任意宿主读写。
- 无效/未支持格式明确报错（`UNSUPPORTED_MEDIA_TYPE`、`CORRUPT_ASSET_BODY` 等），没有把
  已承诺格式改成「不支持」来关闭缺口；OGG 的 PCM 缺口保留为明确失败。

### 2.5 导入面板崩溃修复与真实服务调用（完成）

- 根因：`AssetLibrarySnapshot.scan` 与 `AssetLibraryActions.scan` 同名，`useAssetLibrary`
  合并让方法覆盖数据，面板渲染读 `scan.items` 抛错，根 error boundary 卸载整个 React 树
  （R2 原始栈 `AssetLibraryPanel.tsx:211`）。
- 修复：快照字段改名 `scanResult`（动作仍叫 `scan`）；面板加 `Array.isArray` 守卫；
  `controllerActions()` 暴露动作集合，测试断言「快照数据键与动作名互不相交」。
- 面板预览改调 `asset.preview`、取消改调 `asset.cancel`；`previewGeneration` 按选择/尝试
  淘汰迟到结果（不是只靠 UI 隐藏）。搜索/分类/标签/分页/范围/固定版本/使用关系仍走真实通道。

### 2.6 导入鲁棒性（完成已实现部分，其余归宿主/联测）

已实现并有测试（`c8e0253` 等）：
- 流式导入：64 KiB 分块、fsync、临时文件 + rename、登记在正文就位后同事务；
- 中断残留：`sweep_pending` 清理过期 staging 文件；
- 同版冲突 `ASSET_VERSION_CONFLICT`、来源冲突 `ASSET_SOURCE_CONFLICT`，**冲突时不再留下孤儿
  正文**（新增测试断言 blob 目录恰好一份）；
- 固定 v1 不可覆盖（`ASSET_VERSION_CONFLICT` 守卫 + 测试）；
- 正文读取前重算 blob 哈希（`CORRUPT_ASSET_BLOB`，新增测试）；
- Windows 独占锁：os error 32/33 → `ASSET_SOURCE_LOCKED`；扫描遇到被锁文件只记
  `SOURCE_LOCKED` 问题、不再整体失败（两项 `#[cfg(windows)]` 测试）。

未完成/归他人：
- 扫描的「玩家授权」在宿主侧（面板经 `fs.requestDirectory` 选目录），核心未持有授权清单；
  watch 按设计由宿主重复扫描，核心未实现 watcher；
- 与 S3 安装、S4 完整归档正文的联合联测未做（依赖对方提交）。

### 2.7 回收（S5 执行器完成，S1 批准器未完成）

S5 侧只执行「已批准且再次核验」的条目（`asset_catalog/reclaim.rs`、`d723c94`）：
- `asset.reclaimPlan`（只读）：候选 = **没有任何使用关系行**的版本，输出
  `{assetId, version, contentHash, bytes, sha256[], mediaKind}`、`planHash`/`planId`、
  `candidateCount`、`totalBytes`、`protectedVersions`、`requiresApprovalFrom`。
- `asset.reclaimCommit`：同 operationId 幂等重放；重新推导计划，哈希/计划 ID 不符即
  `ASSET_RECLAIM_PLAN_STALE`；未批准 `ASSET_RECLAIM_NOT_APPROVED`；有使用关系
  `ASSET_RECLAIM_PROTECTED`；正文 sha 集不匹配拒绝；同事务删版本/文件行（及无版本时的
  元数据），提交后只对无引用正文执行 `discard_blob` 并删除无引用 blob 行。
- 真实核心证据：`[pass] asset.reclaimPlan publishes a usage-aware plan -> candidates=0 protected=1`、
  `[pass] a stale reclaim plan is refused`、`[pass] a version with a usage relation cannot be reclaimed`、
  `[pass] the refused reclaim left the asset intact`。

**未完成**：S1 的总回收批准器（汇总世界/候选/草稿/活跃任务/分支/命名版本/迁移 + S4 pins）与
`godot_storage::plan` 不再信任调用方 `protectedBuilds` 的加固均未实现。因此按「未完成」记账。
**契约要求**：S4 的 pins 若要保护素材，必须被登记为使用关系行（如
`asset.recordUsage {refKind:"backup-retention"}`）；执行器只把 `craftmine_asset_usage` 当作
保护来源，没有使用行的版本按契约即可回收。

## 3. 验收命令与结果

| 命令 | 结果 |
| --- | --- |
| `cargo test --offline -p craftmine-core --lib asset_catalog` | **37 passed / 0 failed**（含 6 个尝试契约测试、4 个导入鲁棒性测试、7 个回收测试） |
| `cargo test --offline -p craftmine-core --lib` | 243 passed / **1 failed** / 3 ignored；唯一失败是既存 `backups::portable::tests::portable_archive_restores_into_a_new_directory_without_the_source`（`GODOT_PROJECT_REVISION_NOT_INDEXED`，属 S4，本 diff 未触碰该模块） |
| `node --test tests/godot-remaining/N/preview-service.test.mjs` | 19/19 |
| `node --test tests/godot-remaining/N/image-decode.test.mjs` | 28/28 |
| `node --test tests/godot-remaining/N/audio-decode.test.mjs` | 22/22 |
| `node --test tests/godot-remaining/N/godot-package.test.mjs` | 25/25 |
| `node --test tests/godot-round2/R6/asset-service.test.mjs` | 8/8 |
| `node --test tests/godot-round2/R6/asset-library.test.mjs` | 18/18 |
| `node --test tests/godot-round3/S5/cancel-latency.test.mjs` | 3/3；实测取消延迟 **18 ms**（活跃 1 MiB PNG worker）/ **0 ms**（启动前取消），进程 RSS 增量约 12 MiB |
| `node tests/godot-round2/R6/core-rpc-smoke.mjs` | **39 passed / 0 failed**，退出码 0（真实核心进程 + 上述提交构建） |

## 4. 首次失败与未解决项

- 首次失败（他方记录、本轮修复）：R2 `evidence/asset-navigation-ui.report.json` 的
  `Uncaught TypeError: Cannot read properties of undefined (reading 'find')`，
  栈顶 `AssetLibraryPanel.tsx:211`。
- 首次失败（本模块）：`asset-service.test.mjs` 的「cancel 终止 worker」第一次失败——runner
  尚未挂载 abort 监听；修正为「已 abort 的 signal 立即终止」，并在测试中说明取消可能早于
  worker 启动。
- 未解决：
  1. S2 生产构造与 `asset.preview`/`asset.cancel` 注册未合入（服务端代码已提交）。
  2. R2 玩家写通道放行未合入；真实浏览器面板端到端未在本树执行（本树无 node_modules）。
  3. S1 总回收批准器 + S4 pins 聚合未实现（执行器已就绪，见 2.7 契约）。
  4. OGG/Vorbis PCM 解码未实现（明确失败，不冒充可播放）。
  5. 与 S3 安装、S4 完整归档正文的联合联测未做。
