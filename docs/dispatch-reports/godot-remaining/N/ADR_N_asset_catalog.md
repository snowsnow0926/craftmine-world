# ADR 草案（唯一任务标识：`ADR-N-asset-catalog-01`，编号由主任务统一分配）

状态：提议（N 分支实现已完成，待主任务编号与汇入总表）

## 背景

素材库需要同时满足两件互相拉扯的要求：玩家可自由改名、打标签、收藏，而世界运行必须
严格复现当时使用的固定内容。计划还要求“已索引 / 可预览 / 某底座已检查 / 已应用于来源世界”
四个事实分别记录，且首发要支持 PNG/JPEG、静态 GLB、WAV/OGG 与经检查的 Godot 包。

现有 `godot_builds.rs` 的素材表是**每世界**的、单文件上限 512 KiB、同一路径不同内容冲突，
不能承载跨世界复用的逻辑资源版本；`library.rs` 处理的是旧 scene/module 格式的作品包。
二者都不能直接当作新的素材事实来源。

## 决策

1. **内容寻址 + 不可变版本行**：正文按 SHA-256 存于
   `<core dir>/asset-catalog/blobs/<前两字节>/<sha256>`，流式写入临时文件后原子改名；
   版本行 `craftmine_asset_versions(asset_id, version, content_hash, …)` 不可变，
   同一 `(assetId, version)` 不同 `contentHash` 一律 `ASSET_VERSION_CONFLICT`。
2. **浏览元数据与运行内容分离**：`craftmine_asset_metadata` 只存 `display_name/tags/
   favorite/notes`，改名不触碰版本行，`contentHash` 不变。
3. **正文去重不合并身份**：相同 `sha256` 共用一个 blob，但每个资源的来源、作者与许可
   各自记录在版本行上。
4. **状态分离**：`indexed` 由版本行存在决定；`previewable` 由该 `contentHash` 的
   `ok`/`partial` 预览记录决定；`baseChecked` 绑定
   `contentHash+baseId+baseVersion+engineVersion+target+checkerVersion`；
   `appliedToSource` 来自 `world-current` 使用关系。
5. **预览证据强制**：`asset.previewFinish` 的 `ok`/`partial` 必须携带
   `facts.decoder` 与 64 位 `facts.digest`，否则 `PREVIEW_EVIDENCE_REQUIRED`；
   解码在独立 worker 线程中运行，硬超时，无窗口/焦点/输入/播放。
6. **`partial` 状态**：容器级可解析但样本未解码（当前 OGG Vorbis/Opus）记为 `partial`
   并附 `reason`，既不冒充完整预览，也不把它当成格式不支持。
7. **安装与应用不属于素材库**：导入/替换/升级只产生草稿与锁文件变更，由 M 的创作提交与
   VM2 应用事务完成；素材库不写正式世界、不写 Git 历史。
8. **单一共享契约**：`AssetRef/FileRef/ContentRef/BuildRef/ProgressRef/OperationContext`
   与 `craftmine.assets-lock/1` 的唯一共享定义在 M 的版本管理计划第 5 节；N 提供 Rust
   实现与跨语言测试向量（`assets-lock-vectors.json`），不另建相似结构。

## 影响

- 新增 `craftmine_asset_*` 八张表与 `asset-catalog/` 目录；由 A 统一登记迁移。
- 512 KiB 单文件限制只保留给既有 `godotAsset.put` 模型小载荷入口；玩家导入走新预算
  （默认 64 MiB/文件、256 MiB/版本、4096 文件），实测值在报告中单列。
- 预览缓存键包含 `contentHash + previewerVersion + engineVersion + settingsHash`，
  解码器升级会自动使旧缓存失效。
- 使用关系表成为 AL5 删除保护的输入；N 只删除满足 A 的回收条件且无引用的正文。

## 未采用

- 不引入第二套素材事实数据库（SQLite 仍是唯一持久化）。
- 不把每张图片做成独立 Git 仓库；Git 只保存素材锁与引用（M 决定）。
- 不用 Electron 主进程内联解码：解码放在独立 worker，避免阻塞宿主并便于超时/取消。
- 不为 OGG 伪造成波形预览。
