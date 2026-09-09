# N 任务报告：素材库 AL0/AL1/AL2

- 分支：`codex/godot-remaining-n-20260910`，工作树 `D:/Craftmine World-worktrees/godot-remaining-n-20260910`
- 基线：`e462147`（本地 master，比派发时的 `92c98b2` 新两个文档提交）
- 日期：2026-09-10
- 范围：AL0 契约与开源评估、AL1 流式导入与不可变版本、AL2 浏览与可信预览
- 不含：作品安装/升级/应用（H/M/A/C/D 联合）、Git 历史（M）、正式世界执行（A/B/C/D）

## 1. 交付内容

### 1.1 AL0 契约与评估

| 交付 | 位置 |
| --- | --- |
| 冻结契约实现 | `vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/contract.rs` |
| 锁文件规范化、依赖闭包、环检测、锁哈希 | `.../asset_catalog/lockfile.rs` |
| 共享测试向量（Rust `include_str!` + 给 M 的同一份拷贝） | `.../asset_catalog/vectors/assets-lock-vectors.json`、`docs/dispatch-reports/godot-remaining/N/assets-lock-vectors.json` |
| 契约说明 | `docs/dispatch-reports/godot-remaining/N/AL0_CONTRACT_FREEZE.md` |
| 上游真实代码评估 | `docs/dispatch-reports/godot-remaining/N/AL0_REUSE_EVALUATION.md` |
| ADR 草案（唯一标识 `ADR-N-asset-catalog-01`） | `docs/dispatch-reports/godot-remaining/N/ADR_N_asset_catalog.md` |
| 接口与最小接线片段 | `docs/dispatch-reports/godot-remaining/N/INTERFACE_N.md` |

上游评估要点（真实 commit）：Global Asset Manager `08e784c0c794dec9e541a41e1ee6a106cc6e62da`（MIT，Godot 4.6 编辑器插件，扫描同步阻塞主线程、只按扩展名判定、缩略图内存缓存无上限）；
Allusion `631cfb5fb9c3bb62677e5fd37be28dbfaf4b8e2f`（GPL-3.0，`package.json` 却写 ISC，代码不得移入）；
godot-asset-library `11b303dad6a5b3a4347df2633a03d4338c4db063`（MIT，维护模式，本地库几乎无可复用代码）。

### 1.2 AL1 正文与不可变版本

- 流式导入：64 KiB 分块读 + 增量 SHA-256 + 临时文件 `fsync` 后原子改名，写入
  `<core dir>/asset-catalog/blobs/<前两字节>/<sha256>`（`store.rs:stream_blob`）。
- 预算与旧限制分离：玩家导入默认 64 MiB/文件、256 MiB/版本、4096 文件；既有
  `godotAsset.put` 的 512 KiB/96 KiB 模型小载荷入口未改动（`budget.rs`）。
- 不可变版本：`(assetId, version)` 内容哈希不同即 `ASSET_VERSION_CONFLICT`，绝不覆盖；
  同 `operationId` 重放返回同一结果，请求不同则 `OPERATION_CONFLICT`。
- 正文去重：相同 SHA-256 共用一个 blob，来源/作者/许可按版本行分别保留。
- 旧格式映射：`asset.mapLegacy` / `asset.resolveLegacy` 保留旧 `asset id/version/hash`。
- 宿主正文访问：`asset.bodyPath` 返回绝对 blob 路径与哈希，大正文不经过聊天 base64。
- 授权边界：`sourcePath` 必须 canonicalize 到 `sourceRoot` 之内，拒绝链接/重解析点。
- 目录扫描：`asset.scan` 只在授权根内递归（深度/文件数/字节数/哈希预算可限），跳过链接与
  重解析点，按内容 SHA-256 给出"新版本 / 未变化 / 不支持"提示，显式返回 `worldUpdated:false`；
  目录监听由宿主重复调用该扫描实现，文件系统事件不能直接改世界。

### 1.3 AL2 浏览与可信预览

- Rust 侧：分类/标签/搜索/范围分页（`index.rs`）、可变浏览元数据与不可变版本分离
  （改名不改 `contentHash`）、使用关系（`index.rs`）、结构探测（`preview.rs:asset_probe`，
  明确 `pixelDecoded:false`）、预览状态机与证据强制、底座检查证据。
- Node 侧独立预览服务（`vendor/pi-desktop/apps/desktop/electron/craftmine-assets/`）：
  - `decode/image-decode.mjs`：PNG（colorType 0/2/3/4/6、8/16 位、filter 0–4、tRNS）与
    baseline/extended sequential JPEG（Huffman + 反量化 + IDCT + 上采样 + RST）真实解码，
    产出 RGBA、缩略图 PNG 与像素 SHA-256。
  - `decode/audio-decode.mjs`：WAV 真实 PCM 解码（8/16/24/32 位、float32、EXTENSIBLE、多声道），
    peak/rms/信号摘要；OGG 只做容器级解析，返回 `pcmDecoded:false` 与明确原因。
  - `decode/godot-package.mjs`：`.tscn/.tres/.gd` 静态引用检查、缺失引用定位到引用方与行号、
    环检测、路径安全，始终 `executed:false`。
  - `preview-service.mjs`：按媒体类型分派、缓存键与 Rust 同向量、`ok/partial/failed/timeout`
    证据格式；GLB 静态解码（真实 accessor 字节、三角形/顶点/节点/材质/图片计数）。
  - `preview-worker.mjs`：独立 worker 线程 + 硬超时 + 终止，无窗口/焦点/输入/播放。

## 2. 验证证据（原始输出已存档）

| 命令 | 结果 |
| --- | --- |
| `cargo test -p craftmine-core --offline` | **127 passed; 0 failed; 1 ignored**（既有 111 + 新增 16；忽略项是仓库原有的 Windows junction 测试），0 warning |
| `cargo test -p craftmine-core --offline --lib asset_catalog` | 16 passed; 0 failed |
| `node --test tests/godot-remaining/N/image-decode.test.mjs` | 28 pass / 0 fail / 0 skipped |
| `node --test tests/godot-remaining/N/audio-decode.test.mjs` | 22 pass / 0 fail |
| `node --test tests/godot-remaining/N/godot-package.test.mjs` | 22 pass / 0 fail |
| `node --test tests/godot-remaining/N/preview-service.test.mjs` | 10 pass / 0 fail |
| `node --test tests/godot-remaining/N/*.test.mjs` | **82 pass / 0 fail / 0 skipped** |

实测值（`cargo test ... -- --nocapture`，本机 Windows，debug 构建）：

| 场景 | 实测 |
| --- | --- |
| 导入 1000 个资源（1 KiB 正文，含事务） | 2790 ms |
| 1000 资源库检索（每页 100，20 次采样） | P50 8656 µs，P95 12721 µs |
| 单文件 16 MiB 流式导入 + 独立哈希核对 | 233 ms（≈69 MB/s），`verified=true` |
| 3 MiB+7 B 文件导入 | 通过，`sha256` 与独立计算一致，`contentHash` 与独立计算一致 |

跨语言契约：`previewCache` 向量在 Rust 与 Node 两侧都断言
`craftmine.asset-preview/1\ndoor-texture\n1\n<64a>\nasset-preview/1\n4.7.2-stable\ndefault`
→ `a372177f10f8030150ed62ff1543e1fc5e41c46d211a85248fc12c640ea48d42`。

## 3. AL-A 验收对照（N 侧）

| 编号 | 场景 | N 侧状态 | 证据 |
| --- | --- | --- | --- |
| AL-A01 | 导入支持格式的真实文件 | 通过 | `al1_streams_…`、`preview-service` 的 PNG/JPEG/GLB/WAV 真实解码用例 |
| AL-A02 | 大文件与分块中断 | 部分通过 | 16 MiB 实测通过；超预算拒绝且无半成品（`al1_refuses_…` 断言无版本行、无残留 blob）；**进程级中断未注入验证** |
| AL-A03 | 同版不同内容、重复操作、相同正文 | 通过 | `al1_replays_…`（冲突/幂等）、`al1_streams_…`（去重但来源分离） |
| AL-A04 | 坏图、模型引用缺失、预览超时 | 通过 | `preview-service` 的 broken PNG/GLB、package missing、worker timeout 用例 |
| AL-A05 | 当前世界引用 v1，库里新增 v2 | 通过（库侧） | `al1_versions_stay_immutable_…`、`al2_probe_and_preview_states_never_conflate` |
| AL-A06–A10 | 实例、跨世界复用、依赖闭包、升级保留状态 | **不属于 N** | 由 H/M/A/C/D 联合完成；N 提供 `AssetRef`、闭包解析与正文 |
| AL-A11 | 归档、卸载和清理 | 部分 | 使用关系表已实现（`world-current` 等六类）；回收条件由 A 统筹，未执行删除 |
| AL-A12 | 导出到新目录/另一台环境 | 部分 | blob 自包含 + `asset.bodyPath`；作品包与完整备份由 H/K |
| AL-A13 | 旧 Web 包与 Godot 存储迁移 | 部分 | 旧格式映射与解析已实现；真实旧库迁移由 H |
| AL-A14 | AI 检索并安装旧作品 | 部分 | 检索/读取已实现；安装是 H/M/A/C/D 的链路 |
| AL-A15 | 目录监听、路径碰撞、链接与外链 | 部分通过 | `al1_scan_…`（授权根递归、链接跳过、预算截断、内容哈希新版本提示、`worldUpdated:false`）、路径/保留名规则；**目录监听仍是宿主轮询，未做 OS 事件监听** |
| AL-A16 | 切世界时旧搜索/预览请求返回 | 部分 | 预览缓存键含内容身份、检索按世界范围过滤；迟到响应/取消的宿主侧处理未验证 |
| AL-A17 | 打包资源与许可清单不一致 | **不属于 N** | H/K 的清单与预检 |

## 4. 未完成 / 依赖 / 集成顺序

必须继续（N 范围内）：

1. **目录监听（AL-A15 剩余部分）**：扫描已实现（`asset.scan`）；OS 级文件系统事件监听尚未实现，
   当前由宿主重复调用扫描来发现变化。变化只产生"新版本提示"，不隐式更新世界。
2. **进程中断注入（AL-A02）**：在流式写入各持久边界杀进程，证明无伪完整资源。
3. **迟到/取消的宿主侧验证（AL-A16）**：切世界后旧预览任务的结果不得写入新世界。
4. **1 万资源与 1/64 MiB 全档位测量**：当前测到 1000 资源与 16 MiB。
5. **素材 UI 子目录**：数据契约已定（`INTERFACE_N.md`），组件与导航由 E 接线。
6. **产品接线**：`asset.*` RPC 登记（A 的 `main.rs`）、插件工具声明与转发（L）、
   宿主预览调用（C/D）；片段已给出，未接线。

集成顺序建议：A 先登记 `asset_catalog::migrate` 与 `asset.*` 分发（两行 + 一段 match）；
L 加三个只读工具；C/D 接 `asset.previewBegin/Finish` + worker；H 用 `asset.bodyPath` 做备份正文；
M 用共享向量对齐锁哈希；E 接素材面板。

## 6. 只读评审发现与修复

首轮实现后由只读评审逐条核对，以下缺陷已修复并补测试：

| 严重度 | 缺陷 | 修复 |
| --- | --- | --- |
| 高 | `asset_import` 命中"版本已存在"分支时不写操作回执，operationId 可被复用 | 该分支在事务内写回执；新增 `al1_existing_version_path_…`（重放 `replayed:true`、改请求 `OPERATION_CONFLICT`） |
| 高 | `asset.recordCheck` 检查 operationId 却从不落库 | 改为事务内 `record_operation`；新增 `al2_record_check_is_idempotent_and_conflict_safe` |
| 高 | Godot 包环检测在稠密无环图上指数爆炸 | 子代理加显式搜索预算与 `cyclesTruncated`，并补稠密图回归用例 |
| 中 | 同正文但不同来源/许可被静默丢弃 | 新增 `ASSET_SOURCE_CONFLICT` 与断言 |
| 中 | 失败/超时预览永远无法重试 | `previewBegin` 对 failed/timeout/cancelled 重置为 pending 并返回 `retried:true`；pending/ok/partial 仍缓存 |
| 中 | `previewFinish` 不要求先 claim，可被任意 digest 变绿 | 无 claim 行即 `PREVIEW_NOT_CLAIMED`；新增断言 |
| 中 | >1 MiB blob 探测只校验长度不校验哈希 | `blob_read_prefix` 先整块校验；新增篡改 blob 后探测失败的用例 |
| 中 | 注册事务失败会留下孤儿 blob | 新增 `discard_blob`（有引用绝不删），失败路径调用；新增直接单元测试 |
| 低 | 同一路径重复出现在清单里会改变 contentHash | 重复路径一律 `ASSET_CONTENT_PATH_CONFLICT` |
| 低 | 检索静默截断 2 万行 | 响应新增 `truncated` 字段 |
| 低 | `probe_package` 对任意 UTF-8 都判通过 | 必须含 `[gd_scene`/`[gd_resource` 或脚本标记 |
| 低 | 包摘要只由计数组成，不同内容同摘要 | 摘要改为对包内路径+字节求哈希 |
| 低 | `audioMaxFrames` 设置不生效 | 传入 `decodeAudio` 的 `maxFrames` |
| 低 | `baseChecked` 同毫秒记录不确定 | `ORDER BY created_at DESC, target DESC, checker_version DESC` |
| 低 | 扫描对非 UTF-8 文件名整体失败、大目录先全量入内存 | 非 UTF-8 记为 issue，目录列举按 `maxFiles` 截断 |



- 所有自动验证都是**逻辑/离线**验证：没有真实 Godot 引擎、没有真实客户端、没有真实模型调用。
- 音频不播放；OGG 只有容器级结果（`partial`），Vorbis/Opus → PCM 未实现。
- progressive JPEG 与 Adam7 隔行 PNG 明确返回不支持错误码，未伪装成功。
- Godot 脚本/插件包只做静态引用检查（`executed:false`），真实预览仍需 B/C 可信执行器。
- 上游评估未在各自运行时执行，README 性能宣传未实测（见 `AL0_REUSE_EVALUATION.md` 第 5 节）。
- `vendor/pi-desktop/crates/craftmine-core/src/lib.rs` 的 2 行注册改动属于 A 的所有权范围，
  仅为让本模块可编译测试而加入，已在 `INTERFACE_N.md` 第 2 节标注为合并片段。
