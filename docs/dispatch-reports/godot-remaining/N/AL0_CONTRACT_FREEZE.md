# AL0 共享契约冻结（N 侧实现与测试向量）

状态：N 侧实现并已通过测试；**共享定义的唯一维护处仍是 M 的
`docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` 第 5 节**。本文记录 N 实际冻结的
规则、可执行向量位置，以及需要 M 确认的边界，不替代 M 的定义。

基线：`codex/godot-remaining-n-20260910`，从 `e462147` 建立。
实现：`vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/`。

## 1. 冻结的类型与格式

| 项 | 冻结值 | 实现 |
| --- | --- | --- |
| 契约版本 | `craftmine.assets/1` | `contract.rs:ASSET_CONTRACT_FORMAT` |
| 锁文件 | `craftmine.assets.lock.json`，`craftmine.assets-lock/1` | `contract.rs:ASSET_LOCK_FORMAT`、`lockfile.rs:AssetLock` |
| 内容清单 | `craftmine.asset-content/1` | `contract.rs:ASSET_CONTENT_FORMAT`、`store.rs:content_hash` |
| 预览缓存键 | `craftmine.asset-preview/1` | `preview.rs:cache_key` |
| 资源类型 | `raw` / `object` / `creation` / `world-template` | `contract.rs:AssetKind` |
| 查询范围 | `current-world` / `local-library` / `import-source` | `contract.rs:QueryScope` |
| 许可状态 | `verified` / `unverified` / `unknown` | `contract.rs:LicenseStatus` |
| 使用关系 | `world-current` / `world-history` / `world-draft` / `creation-dependency` / `backup-retention` / `export-package` | `contract.rs:UsageKind` |
| 预览状态 | `pending` / `ok` / `partial` / `failed` / `timeout` / `cancelled` | `preview.rs` |

`AssetRef={assetId,version,contentHash}`、`FileRef={path,sha256,bytes,mediaType}`、
`ContentRef={repoId,commitOid,assetLockHash}`、
`BuildRef={content,baseId,baseVersion,engineVersion,target,buildId}`、
`ProgressRef={worldId,progressId,revision,build,stateSchemaVersion,contentHash}`、
`OperationContext={operationId,worldId,repoId,branchId,expectedHeadOid,expectedAppliedOid,expectedProgressRevision}`
均按 M 的定义实现（`contract.rs`，`deny_unknown_fields` + `camelCase`）。
`assetLockHash` 与素材正文用 SHA-256；Git OID 单独校验为 40–64 位小写十六进制，
不假定固定长度。

## 2. 规范化规则（冻结）

1. `assets` 按 `(assetId, version)` 排序；`dependencies` 同序去重；`overrides` 字典序去重。
2. 完全相同的重复引用合并；同一 `(assetId, version)` 内容哈希不同 → `ASSET_LOCK_CONFLICT`，绝不覆盖。
3. `installPath` 大小写不敏感唯一，重复即 `ASSET_LOCK_PATH_CONFLICT`。
4. 路径规则：相对路径、`/` 分隔、≤240 字节、≤16 段、每段 ≤80 字节且不以 `.` 开头、
   无 `.`/`..` 段、无 Windows 保留名、无控制字符、段尾无空格或点 → `INVALID_ASSET_PATH`
   （因此 `.gitignore` 一类隐藏文件会被拒绝）。
5. 规范 JSON：紧凑分隔符、结构体字段顺序、无尾随换行、UTF-8。
6. `assetLockHash = SHA-256(规范 JSON 字节)`。
7. 内容哈希 `contentHash = SHA-256("craftmine.asset-content/1\n" + 每文件一行
   `path\nsha256\nbytes\nmediaType\n`，按 path 排序)`；同版本内路径大小写冲突 → `ASSET_CONTENT_PATH_CONFLICT`。
8. 依赖闭包：缺失依赖 → `ASSET_DEPENDENCY_MISSING`，环（含自引用）→ `ASSET_DEPENDENCY_CYCLE`；
   闭包按 `(assetId, version)` 排序返回。缺项或环存在时不允许安装。
9. 预览缓存键：`SHA-256("craftmine.asset-preview/1\n{assetId}\n{version}\n{contentHash}\n{previewerVersion}\n{engineVersion}\n{settingsHash}")`。

## 3. 共享测试向量

- 可执行副本（Rust 通过 `include_str!` 加载）：
  `vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/vectors/assets-lock-vectors.json`
- 给 M 的同一份拷贝：`docs/dispatch-reports/godot-remaining/N/assets-lock-vectors.json`
- 覆盖：规范排序/合并/去重、覆盖项排序、多版本、同版不同内容、安装路径冲突、路径穿越、
  Windows 保留名、错误格式、依赖版本冲突、传递闭包、缺失依赖、环、自引用、
  以及跨语言预览缓存键向量（`previewCache`）。
- 生成器（可复现）：`build-vectors.mjs`（会话 scratch；逻辑已固化进向量文件本身，
  M 只需消费 JSON，不需要 Node）。

Rust 侧断言：`asset_catalog::tests::al0_shared_lock_vectors_are_frozen` 与
`al2_preview_cache_key_matches_the_shared_vector`。
Node 侧断言：`tests/godot-remaining/N/preview-service.test.mjs` 的
`cache key matches the frozen cross-language vector`。

## 4. 状态分离（不可合并的四个事实）

| 事实 | 来源 | 不会因其他事实变绿 |
| --- | --- | --- |
| 已索引 `indexed` | 版本行存在 | 与预览无关 |
| 可预览 `previewable` | 该 `contentHash` 存在 `ok`/`partial` 预览记录 | 预览失败/超时/取消不算 |
| 某底座已检查 `baseChecked` | `craftmine_asset_checks`，绑定 `contentHash+baseId+baseVersion+engineVersion+target+checkerVersion` | v1 的通过不会出现在 v2 |
| 已应用于来源世界 `appliedToSource` | `craftmine_asset_usage` 的 `world-current` | 仅"存入库"不会产生 |

## 5. 需要 M 确认或对齐的边界

1. M 的 `AssetLock` 若增加字段（例如 `overrides` 之外的运行覆盖引用），需同步更新本向量文件与
   `lockfile.rs`；当前 `overrides: Vec<String>` 只承载相对路径引用。
2. M 的锁文件写入端负责把素材库返回的 `AssetRef` 原样写回；素材库不会写 `latest`。
3. 安装/替换/升级只产生草稿与锁文件变更，由 M/H 的创作提交应用；N 不直接改正式世界。
4. `ContentRef.repoId` 的具体取值规则（世界工程仓库标识）由 M 冻结；N 只做格式校验。
5. 若 M 采用不同 JSON 序列化器，规范字节必须与本向量的 `canonical` 字段逐字节一致，
   否则锁哈希不互通。
