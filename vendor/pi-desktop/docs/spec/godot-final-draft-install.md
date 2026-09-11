# Recoverable package draft file sets

Production package installation computes a complete file set and submits it through the Rust managed source transaction. The local apply helper is restricted to private staging workspaces; it is never a write path to the running world.

Plans merge existing canonical lock and instance entries, reject incompatible existing locks and duplicate instance identities, accumulate multiple edits to one scene, and deduplicate identical target writes. Instance metadata is `craftmine.instances.json`, a portable managed source path. All target paths reject traversal, Windows aliases and links.

The private staging apply helper persists synced before-images for every target and a version-2 intent journal before replacement. Targets have unique staging names even when content matches. A process crash restores each original file or removes only a file proved to have been newly created. Unexpected target content fails recovery instead of overwriting it. Legacy journals without before-images are refused. A committed journal is not rolled back when cleanup fails. Same operation/request replays the prior receipt before replanning.

This proves process-crash recovery, not guaranteed survival of every storage controller/power-loss failure. Journal replacement is atomic and file bytes are flushed; Windows directory durability remains platform dependent.

E2E: terminate the helper immediately after it replaces an existing scene, restart recovery, compare old scene, lock and instance-map bytes, then retry. Also install two nodes into one scene, install the same bytes into separate targets, and perform a second installation retaining the first instance.

## 受控静态 GLB 导入策略（2026-09-12）

源码事务仅额外接纳与同目录 `.glb` 配对的 `.glb.import`。配置不得超过 2048 字节，只允许 `[remap]` 的 `importer="scene"`、`type="PackedScene"`、可选 `importer_version=1`，以及 `[params]` 的 `meshes/generate_lods=false`。拒绝未知字段、重复字段/分节、脚本、自定义 importer、deps、缓存地址及任何其他参数。LF 与 CRLF 等价校验，存储仍保持原字节。

create、文本/二进制 patch 与 applyFiles 共用内容校验；最终文件集必须保留真实 GLB 2 容器，校验 magic、版本、长度、JSON/BIN chunk 边界与 asset.version。后续删除或写坏配对模型同样拒绝，失败保持源码原子性。这只是容器与导入配置准入，不代替引擎导入、资源兼容性或游戏检查。现有路径、权限、CAS、校验采用规则不变。
