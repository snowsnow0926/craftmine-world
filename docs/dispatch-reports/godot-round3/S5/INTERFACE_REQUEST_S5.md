# S5 接口请求与消费契约

本文件只描述 S5 需要其他负责人实际合入的接线点，以及 S5 已提供的可消费实现。
所有条目都以「已提交实现 + 可复现命令」为准，不用未应用的 patch 计完成。

## 1. S1（Rust 入口、共享登记）——已由 S5 提交，请 S1 确认保留

`asset_catalog/**` 归 S5；核心入口归 S1。为了让正式默认构建可调用，S5 已提交最小接线：

- `vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/dispatch.rs`（S5 拥有）
  `pub fn dispatch(journal, method, params) -> Option<Result<Value>>`，覆盖 16 个 `asset.*`。
- `vendor/pi-desktop/crates/craftmine-core/src/lib.rs`
  `pub use asset_catalog::dispatch as asset_catalog_dispatch;`
- `vendor/pi-desktop/crates/craftmine-core/src/main.rs`
  在 `let params = ...` 之后：
  ```rust
  if let Some(result) = asset_catalog_dispatch(journal, method, params) {
      return result;
  }
  ```
  以及 `hello` 增加 `"assetCatalog":true,"assetPreview":true`。

提交：`bce5bd2`。若 S1 采用其他登记方式，请删除这三行并保留 `dispatch.rs`；不要双写
`asset.*` 方法表。

**共享契约**：`asset_catalog/contract.rs` 已只 re-export `content_history::contract` 的
`AssetRef/FileRef/AssetLock`，七类 `AssetKind` 只在本模块定义一次；S5 未新增第二套引用
或锁结构。素材回收需要 S1 的总回收器批准入口（见第 4 节）。

## 2. S2（插件服务构造与私有通道）

`plugins/craftmine-world/asset-service.mjs` 已提交新的尝试契约，构造签名不变：

```js
const assets = createAssetService({
  call: (method, params) => core.call(method, params),
  runPreview: (request, options) => runPreviewInWorker(request, options),
  readFile: path => readFile(path),
});
```

要求实际注册的通道（`workbench-service.cjs` 的 `channels` 或等价分发表）：

- 转发：`asset.search` `asset.read` `asset.versions` `asset.usage` `asset.annotate`
  `asset.scan` `asset.import` `asset.previewRead` `asset.probe` `asset.mapLegacy`
  `asset.resolveLegacy` `asset.recordUsage` `asset.recordCheck`
- 服务方法：**`asset.preview` → `assets.preview`**，**`asset.cancel` → `assets.cancel`**。

`assets.preview` 内部完成 begin → 读正文 → worker 解码 → finish，并绑定核心签发的
`claimId/attempt`；`assets.cancel` 会 abort 正在运行的 worker，再把该尝试置为终态。
`runPreview(request, { timeoutMs, signal })` 现在接收 `AbortSignal`；
`runPreviewInWorker` 已支持 abort 并返回 `facts.workerTerminated`。若 S2 的构造传的是
自建 runner，请让它尊重 `signal`，否则取消只能由核心的尝试校验兜底。

## 3. R2（导航/面板通道）

S5 已改 `use-asset-library.ts` / `AssetLibraryPanel.tsx`：

- 面板预览改调 **`asset.preview`**（不再是 `asset.previewBegin`+`asset.previewFinish`），
  取消改调 **`asset.cancel`**。迟到结果按 generation 淘汰，不再只靠 UI 隐藏。
- `AssetLibrarySnapshot.scan` 改名 `scanResult`（动作仍叫 `scan`），修复导入崩溃。

需要 R2 在玩家操作入口（不是模型通道）放行：`asset.preview`、`asset.cancel`、
`asset.import`、`asset.annotate`；只读白名单保持现有 `asset.search/read/versions/usage/scan/probe/previewRead`。
`asset.previewBegin/previewFinish` 不再由面板调用，可保留给宿主内部或移除。

建议（非必须）：在 `CraftmineNavigation.tsx` 的面板外再加一层局部 error boundary，
使单个面板渲染错误不再卸载整个 shell。

## 4. S4/S1（回收）——S5 只执行批准后的条目

S5 不自行判断哪些目录无用。需要：

- S1：在总回收计划中给出**已批准且再次核验**的素材条目（asset blob sha256 + 版本引用判定）。
- S4：把备份 pins 汇入同一保护集。
- S5：只对批准条目执行删除，并在删除前重算引用/哈希；任何未批准条目一律不动。

当前状态：素材侧只有 `store::discard_blob` 这类底层能力，尚无消费批准清单的
`asset.*` 入口。具体缺口与最小改动见本目录 `REPORT_S5.md` 第 6/7 节。
