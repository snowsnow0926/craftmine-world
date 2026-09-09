# R6 接口与接线片段（素材库）

N 的独占范围：`vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/**`、
`vendor/pi-desktop/apps/desktop/electron/craftmine-assets/**`、
`plugins/craftmine-world/asset-service.mjs`（新增，素材服务）、
`vendor/pi-desktop/apps/desktop/src/components/craftmine/assets/**`（素材 UI）。
共享引用契约（`AssetRef`/`FileRef`/`AssetLock` 等）由 R1 定义在
`content_history/contract.rs`，R6 只消费；作品安装由 R4，完整备份由 R5，RPC 登记由 R1，
宿主与导航由 R2。

## 1. Rust RPC（已实现，待 R1 登记）

| 方法 | 参数 | 返回要点 |
| --- | --- | --- |
| `asset.import` | `operationId, sourceRoot, sourcePath, assetId, version(正整数), kind(CP 七类), mediaKind, path, mediaType, displayName, source{origin,author,license,licenseStatus}, tags?, budget?` | `contentHash, bytes, fileCount, deduplicated, replayed, existing, version_, state` |
| `asset.read` | `assetId, version` | `version_{...files[]}` + 四个分离状态 |
| `asset.versions` | `assetId, offset, limit` | 多版本分页（新版本在前） |
| `asset.bodyPath` | `assetId, version, path` | 宿主侧绝对 `blobPath` + `sha256/bytes/mediaType`（大正文不进聊天） |
| `asset.search` | `scope, worldId?, query?, kind?, mediaKind?, tags?, favoritesOnly?, latestOnly?, offset, limit` | `items[]` + `total` + `truncated` + `nextOffset` |
| `asset.scan` | `sourceRoot, maxFiles?, maxBytes?, hashBytes?` | 授权目录扫描；`hints{newVersions,unchanged,unsupported}`、`worldUpdated:false` |
| `asset.annotate` | `operationId, assetId, displayName?, tags?, favorite?, notes?` | 只改浏览元数据，`contentHash` 不变 |
| `asset.usage` / `asset.recordUsage` | `assetId, version?` / `assetId, version, refKind, refId, detail` | 使用关系（AL5 删除保护） |
| `asset.previewBegin` | `assetId, version, settingsHash?` | `jobId, cacheKey, cached, retried, previousStatus?, timeoutMs, preview` |
| `asset.previewFinish` | `operationId, assetId, version, settingsHash?, status, detail, facts` | `ok/partial` 必须有 `facts.decoder` + 64 位 `facts.digest`；无 claim 报 `PREVIEW_NOT_CLAIMED` |
| `asset.previewRead` | `assetId, version` | 全部预览记录（含 `facts.thumbnailBase64`） |
| `asset.probe` | `assetId, version, path?` | Rust 结构探测，恒 `pixelDecoded:false` |
| `asset.recordCheck` | `operationId, assetId, version, baseId, baseVersion, engineVersion, target, checkerVersion, status, detail` | 底座检查证据，绑定确切 `contentHash` |
| `asset.mapLegacy` / `asset.resolveLegacy` | 旧 `asset id/version/hash` ↔ `assetId/version` | 旧格式映射 |

预览状态语义（不可互相冒充）：

| status | 含义 | `facts` 关键字段 |
| --- | --- | --- |
| `ok` | 真实解码成功 | 图片 `picture:true`；WAV `playable:true, pcmDecoded:true` |
| `partial` | 真实解析但无画面 | GLB `rendered:false, renderReason:"model-render-not-implemented"` |
| `failed` | 明确失败 | OGG：`detail:"OGG_PCM_DECODE_NOT_IMPLEMENTED", playable:false` |
| `timeout` / `cancelled` | 可重试 | `previewBegin` 返回 `retried:true` 后重跑 |
| `pending` | 已 claim，未完成 | 重复 begin 返回 `cached:true`（不会重复解码） |

## 2. 给 R1（Rust 登记）

```rust
// main.rs dispatch()
"asset.import" => return journal.asset_import(params),
"asset.read" => return journal.asset_read(params),
"asset.versions" => return journal.asset_versions(params),
"asset.bodyPath" => return journal.asset_body_path(params),
"asset.search" => return journal.asset_search(params),
"asset.scan" => return journal.asset_scan(params),
"asset.annotate" => return journal.asset_annotate(params),
"asset.recordUsage" => return journal.asset_record_usage(params),
"asset.usage" => return journal.asset_usage(params),
"asset.previewBegin" => return journal.asset_preview_begin(params),
"asset.previewFinish" => return journal.asset_preview_finish(params),
"asset.previewRead" => return journal.asset_preview_read(params),
"asset.probe" => return journal.asset_probe(params),
"asset.recordCheck" => return journal.asset_record_check(params),
"asset.mapLegacy" => return journal.asset_map_legacy(params),
"asset.resolveLegacy" => return journal.asset_resolve_legacy(params),
```

`lib.rs` 的 `mod asset_catalog;` 与 `asset_catalog::migrate(&db)?;` 已在 R6 分支存在（合入 R1 后无冲突）。
`hello` 响应建议追加 `"assetCatalog":true,"assetPreview":true`。

## 3. 给 R2（宿主与导航）

1. `electron/main/craftmine-navigation-host.ts` 通道白名单加入：
   `asset.search`、`asset.read`、`asset.versions`、`asset.usage`、`asset.scan`、`asset.probe`、
   `asset.previewRead`（只读）；写操作 `asset.annotate`、`asset.import`、`asset.previewFinish`
   走玩家操作入口，不开放给模型通道。
2. 把 `src/components/craftmine/assets/AssetLibraryPanel.tsx` 挂到素材面板，props：
   `{bridge, lang?, worldId?, onImportRequest?}`；现有 `craftmine-aux.ts` 的 `assets` 行
   `channel: null` 改为 `asset.search` 并在 `WorldAuxSections` 中打开面板。
3. 注册 `plugins/craftmine-world/asset-service.mjs`：

```js
import { createAssetService } from './asset-service.mjs';
import { runPreviewInWorker } from '../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/preview-worker.mjs';
import { readFile } from 'node:fs/promises';

const assets = createAssetService({
  call: (method, params) => core.call(method, params),
  runPreview: (request, options) => runPreviewInWorker(request, options),
  readFile: path => readFile(path),
});
// workbench/服务分发表加入：asset.search/read/versions/usage/annotate/scan/import/
// previewRead/probe 以及 preview/cancel
```

4. 宿主预览按钮：`preview` 已包含 begin→decode→finish；取消调用 `cancel`；
   `retried:true` 表示失败/超时后重跑。

## 4. 给 R4（作品安装与复用）

- 锁文件：用 `asset_catalog::lock::{entry, build, resolve_closure}` 生成 R1 的
  `AssetLock`；`build` 会拒绝未解析依赖与环，`resolve_closure` 给出固定闭包。
- 正文：`asset.bodyPath` 取宿主侧 blob 路径；安装只产生草稿与锁文件变更，应用走 VM2。
- 使用关系：安装/引用时写 `asset.recordUsage {refKind:"world-current"|"world-draft"|"creation-dependency", ...}`。
- 跨世界复用：`asset.search {scope:"local-library"}` 取固定 `AssetRef`，不得引用 latest。

## 5. 给 R5（完整备份与回收）

- 备份正文快照：`asset.bodyPath` + `asset.read` 的文件清单；恢复后核对 `sha256`。
- 引用保护：`asset.usage` 列出 `world-current/history/draft/creation-dependency/backup-retention/export-package`。
- 回收：R6 只删除满足 R1 总回收条件且 `discard_blob` 判定无引用的正文。

## 6. 未接线 / 未完成

- `asset.*` 的 `main.rs` 登记与 `hello` 能力位：R1。
- 导航白名单、面板挂载、插件服务注册：R2。
- 插件 manifest 的 agentTools（R7 独占）：只读工具建议 `asset_search/asset_read/asset_versions`。
- `tsc --noEmit` 未运行（工作树无 node_modules）；已用 `node --test` 与 TS 导入 hook 做行为验证。
- 真实 Godot 引擎导入、真实模型创作、新目录包恢复不在 R6 范围。
