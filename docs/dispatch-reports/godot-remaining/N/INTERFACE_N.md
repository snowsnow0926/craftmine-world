# N 接口与最小接线片段

范围：N 独占 `vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/**`、
`vendor/pi-desktop/apps/desktop/electron/craftmine-assets/**`、
`tests/godot-remaining/N/**`。
**作品的安装、升级、应用与事务由 H/M/A/C/D 联合完成**，N 只提供固定资源正文、
锁解析、只读证据与预览结果；N 不直接修改运行中的正式世界，不写 Git 历史。

## 1. Rust RPC（已实现，方法名待主任务统一登记）

| 方法 | 参数 | 返回要点 | 调用方 |
| --- | --- | --- | --- |
| `asset.import` | `operationId, sourceRoot, sourcePath, assetId, version, kind, mediaKind, path, mediaType, displayName, source{origin,author,license,licenseStatus}, tags[], budget?` | `contentHash, bytes, fileCount, deduplicated, replayed, version_, state` | 宿主/玩家导入（H、E 入口） |
| `asset.read` | `assetId, version` | 不可变版本清单 + 四个分离状态 | 模型/UI |
| `asset.versions` | `assetId, offset, limit` | 多版本分页 | UI |
| `asset.bodyPath` | `assetId, version, path` | 宿主侧绝对 `blobPath`、`sha256`、`bytes`（**不把大正文塞进聊天**） | H 备份、M 导出、K 打包 |
| `asset.mapLegacy` / `asset.resolveLegacy` | 旧 `asset id/version/hash` 与 `assetId/version` | 旧格式映射，保留原始定义 | H 迁移 |
| `asset.search` | `scope, worldId?, query?, kind?, mediaKind?, tags?, favoritesOnly?, latestOnly?, offset, limit` | 分类/标签/范围检索，返回 `state` | 模型/UI |
| `asset.scan` | `sourceRoot, maxFiles?, maxBytes?, hashBytes?` | 授权目录递归扫描，按内容哈希返回新版本提示；`worldUpdated:false`，不登记、不改世界 | 玩家/UI 目录导入 |
| `asset.annotate` | `operationId, assetId, displayName?, tags?, favorite?, notes?` | 只改浏览元数据，`contentHash` 不变 | 玩家/UI |
| `asset.recordUsage` / `asset.usage` | `assetId, version, refKind, refId, detail` / `assetId, version?` | 使用关系，AL5 删除保护依据 | H/M（宿主） |
| `asset.previewBegin` | `assetId, version, settingsHash?` | `jobId, cacheKey, cached, timeoutMs, preview` | C/D 宿主 |
| `asset.previewFinish` | `operationId, assetId, version, settingsHash?, status, detail, facts` | `ok`/`partial` 必须有 `facts.decoder` 与 64 位 `facts.digest` | C/D 宿主 |
| `asset.previewRead` | `assetId, version` | 该版本全部预览记录 | UI |
| `asset.probe` | `assetId, version, path?` | Rust 结构探测（`pixelDecoded:false`） | UI/诊断 |
| `asset.recordCheck` | `operationId, assetId, version, baseId, baseVersion, engineVersion, target, checkerVersion, status, detail` | 底座检查证据，绑定确切 `contentHash` | C/F |

错误码：`INVALID_ASSET_ID`、`INVALID_ASSET_PATH`、`INVALID_ASSET_HASH`、`INVALID_MEDIA_TYPE`、
`UNSUPPORTED_MEDIA_TYPE`、`MEDIA_KIND_MISMATCH`、`ASSET_SOURCE_UNAVAILABLE`、
`ASSET_SOURCE_OUTSIDE_ROOT`、`ASSET_FILE_TOO_LARGE`、`ASSET_VERSION_CONFLICT`、
`OPERATION_CONFLICT`、`ASSET_NOT_FOUND`、`ASSET_FILE_NOT_FOUND`、`CORRUPT_ASSET_BLOB`、
`ASSET_LOCK_CONFLICT`、`ASSET_LOCK_PATH_CONFLICT`、`ASSET_DEPENDENCY_MISSING`、
`ASSET_DEPENDENCY_CYCLE`、`INVALID_PREVIEW_STATUS`、`PREVIEW_EVIDENCE_REQUIRED`、
`LEGACY_MAPPING_CONFLICT`。

## 2. lib.rs 注册（A 拥有；N 分支内已加，作为合并片段）

```rust
mod asset_catalog;                       // 字母序：applications 之后
// TaskJournal::open 迁移链，library::migrate(&db)?; 之后：
asset_catalog::migrate(&db)?;
```

只有这两处改动触碰 A 的文件；其余全部在 `asset_catalog/**` 新目录内。

## 3. main.rs 分发片段（A 拥有，未改）

```rust
"asset.import" => return journal.asset_import(params),
"asset.read" => return journal.asset_read(params),
"asset.versions" => return journal.asset_versions(params),
"asset.bodyPath" => return journal.asset_body_path(params),
"asset.mapLegacy" => return journal.asset_map_legacy(params),
"asset.resolveLegacy" => return journal.asset_resolve_legacy(params),
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
```

同时 `hello` 响应建议追加 `"assetCatalog":true,"assetPreview":true`（主任务统一）。

## 4. manifest.json agentTools 片段（L 拥有，未改）

只把**只读检索**暴露给模型；导入、标注、预览写回是宿主/玩家操作，不作为 agent 工具。

```json
{
  "name": "asset_search",
  "description": "Search the local asset library by scope, kind, tags and text. Read-only: returns fixed AssetRef metadata and separated indexed/previewable/baseChecked/appliedToSource facts. Never installs anything.",
  "risk": "low",
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "scope": {"type": "string", "enum": ["current-world", "local-library", "import-source"]},
      "worldId": {"type": "string"},
      "query": {"type": "string", "maxLength": 120},
      "kind": {"type": "string", "enum": ["raw", "object", "creation", "world-template"]},
      "mediaKind": {"type": "string", "enum": ["image", "model", "audio", "package", "other"]},
      "tags": {"type": "array", "items": {"type": "string", "maxLength": 40}, "maxItems": 32},
      "favoritesOnly": {"type": "boolean"},
      "latestOnly": {"type": "boolean"},
      "offset": {"type": "integer", "minimum": 0, "maximum": 10000},
      "limit": {"type": "integer", "minimum": 1, "maximum": 100}
    },
    "required": ["scope"]
  }
},
{
  "name": "asset_read",
  "description": "Read one immutable asset version: fixed AssetRef, file hashes, source/license record and the four separated state facts. No body bytes are returned.",
  "risk": "low",
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "assetId": {"type": "string", "maxLength": 128},
      "version": {"type": "integer", "minimum": 1}
    },
    "required": ["assetId", "version"]
  }
},
{
  "name": "asset_versions",
  "description": "List every immutable version of one logical asset so the model can reuse an old version or start from it. Read-only.",
  "risk": "low",
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "assetId": {"type": "string", "maxLength": 128},
      "offset": {"type": "integer", "minimum": 0, "maximum": 10000},
      "limit": {"type": "integer", "minimum": 1, "maximum": 100}
    },
    "required": ["assetId"]
  }
}
```

## 5. world-tools.cjs 映射片段（L 拥有，未改）

```js
asset_search:'asset.search',
asset_read:'asset.read',
asset_versions:'asset.versions',
```

## 6. 宿主预览接线（C/D 拥有）

```js
import { runPreviewInWorker } from '../electron/craftmine-assets/preview-worker.mjs';

const begun = await call('asset.previewBegin', { assetId, version });
if (!begun.cached || begun.preview.status === 'pending') {
  const body = await call('asset.bodyPath', { assetId, version, path });
  const bytes = await fs.promises.readFile(body.blobPath);
  const evidence = await runPreviewInWorker({
    assetId, version,
    contentHash: body.sha256,        // 宿主传入确切内容身份
    mediaType: body.mediaType,
    path: body.path,
    bytes,
    engineVersion,
    settingsHash: begun.cacheKey ? 'default' : 'default',
  }, { timeoutMs: begun.timeoutMs });
  await call('asset.previewFinish', {
    operationId: `preview-${begun.cacheKey}`,
    assetId, version,
    status: evidence.status,
    detail: evidence.detail,
    facts: evidence.facts,
  });
}
```

注意：`contentHash` 必须来自 `asset.read`/`asset.bodyPath` 返回的版本身份，不能由模型填写；
`runPreviewInWorker` 是独立 worker 线程，无窗口、无焦点、无输入、不播放声音。

## 7. 交接

| 对象 | N 提供 | 需要对方完成 |
| --- | --- | --- |
| H | `asset.import` 的流式正文与不可变版本、`asset.bodyPath` 的备份正文快照、`asset.mapLegacy` 旧格式映射、`asset.recordUsage` 使用关系 | 作品组合/安装/升级/完整备份；安装只产生草稿与锁文件变更，应用走 VM2 |
| M | 共享锁契约的 Rust 实现与向量、`AssetRef` 校验、依赖闭包/环检测 | 唯一共享定义、Git 锁文件读写与历史；不采用第二套引用格式 |
| A | `asset_catalog` 模块与两行 lib.rs 注册片段、迁移函数 | 统一登记 `asset.*` RPC 与迁移顺序；共享数据库迁移归属 A |
| C/D | 预览 worker 协议与证据格式、`asset.previewBegin/Finish` | 可信执行器与宿主接线；脚本/插件真实预览走 B/C 可信路径 |
| E | 素材面板数据契约（`asset.search/read/versions/previewRead` 返回结构） | 导航与素材 UI 子目录接线 |
| K | 来源/许可字段与 `asset.bodyPath` 实际正文 | 发行清单与许可核对；不得把清单存在当成分发合格 |
| F | `asset.recordCheck` 写入底座检查证据 | 底座清单与真实检查结果 |

## 8. 明确未做（不在 N 范围）

- 安装、升级、卸载、应用事务（H/M/A/C/D）。
- Git 仓库、提交、分支、合并（M）。
- 正式世界运行与执行器（A/B/C/D）。
- 远程同步/社区（AL6/AL7，单独立项）。
