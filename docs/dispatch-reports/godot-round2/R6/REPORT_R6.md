# R6 任务报告：素材库界面、实际预览与证据补齐

- 分支：`codex/godot-round2-r6-20260910`，工作树 `D:/Craftmine World-worktrees/godot-round2-r6-20260910`
- 起点：`bcebeb1`（本轮主线），保留历史地合入 N=`b646b2e` 与 R1=`5c98e75`（共享契约依赖）
- 日期：2026-09-10
- 范围：素材 UI、解码与格式边界、契约合并、健壮性、实测与证据

## 1. 交付内容

| 类别 | 位置 |
| --- | --- |
| Rust 素材目录 | `vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/**` |
| 预览服务与解码器 | `vendor/pi-desktop/apps/desktop/electron/craftmine-assets/**` |
| 素材服务（插件侧，新增） | `plugins/craftmine-world/asset-service.mjs` |
| 素材 UI（专属子目录） | `vendor/pi-desktop/apps/desktop/src/components/craftmine/assets/**` |
| 测试 | `tests/godot-round2/R6/**`、`tests/godot-remaining/N/**` |
| 原始证据 | `docs/dispatch-reports/godot-round2/R6/evidence/**` |
| 接口与接线片段 | `docs/dispatch-reports/godot-round2/R6/INTERFACE_R6.md` |

### 1.1 共享契约合并（删除重复实现）

上一轮 R6/N 自己定义了 `AssetRef`/`FileRef`/`ContentRef`/`BuildRef`/`ProgressRef`/
`OperationContext` 与 `craftmine.assets-lock/1` 规范化。本轮已全部删除：

- 新增 `asset_catalog/lock.rs` 只做“用 R1 的 `AssetLock` 组装并解析闭包”，
  不再实现锁格式；`lockfile.rs` 与自建 vectors 文件已删除。
- `contract.rs` 只保留素材库自己的词汇：CP0 七类（`base/world/module/object/scene/raw/data`）、
  媒体分类、查询范围、许可状态、使用关系、内容清单哈希。
- Rust 与 Node 两侧现在都读同一份权威向量
  `tests/godot-remaining/M/contract/asset-lock-vectors.json`：
  Rust 断言 `parse_canonical/canonical_text/asset_lock_hash` 与
  `lock::build` 一致，并执行 17 条错误向量；Node 断言同一 `lockText` 的 SHA-256 等于
  `assetLockHash`。任一消费者偏离即测试失败。
- 目录路径规则改由 R1 契约决定（允许 `.hidden`、拒绝 `.git` 组件），不再自行加严。

### 1.2 素材 UI

`src/components/craftmine/assets/`（R6 独占，R2 只接导航）：

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `asset-library-model.ts` | 903 | 纯逻辑：搜索请求/分页合并/四状态徽标/六种预览状态文案/扫描提示/导入入参/版本排序 |
| `use-asset-library.ts` | 700 | 可注入 `call` 的控制器 + `useSyncExternalStore` hook；搜索/分页/选择/版本/预览/取消/重试/标注/扫描/导入 |
| `AssetLibraryPanel.tsx` | 860 | 左筛选、中卡片、右详情；缩略图、四状态、来源许可、文件、版本、使用关系、预览与取消/重试、导入流程、空/错/截断态、窄窗切换 |
| `asset-library.css` | 391 | 只用 ui-kit 类与设计令牌（style lint 通过） |

关键行为（都有测试）：

- 四个状态分别展示（indexed / previewable / baseChecked / appliedToSource），不用一个绿灯代表全部。
- 预览六态文案：图片 `ok` 显示真实缩略图；GLB `partial` 明确写“仅结构解析，无画面”；
  WAV `ok` 且 `playable` 才出现播放器；OGG `failed` 显示“不可试听（未实现解码）”且永不出现播放器；
  `timeout/cancelled` 显示可重试。
- 导入：宿主选文件 → `asset.scan` → 新版本/未变化/不支持提示 → 确认后 `asset.import`。
- 取消调用 `asset.previewFinish {status:"cancelled"}`，重试重新 `previewBegin`（失败/超时/取消可重跑）。

### 1.3 素材服务与预览链路

`plugins/craftmine-world/asset-service.mjs` 转发 13 个只读/写入通道，并实现预览编排：
`previewBegin → asset.read（取版本身份）→ asset.bodyPath → 宿主读文件 → 独立 worker 解码 →
asset.previewFinish`；`cancel` 写 cancelled。worker 为独立线程、硬超时、无窗口/焦点/输入/播放。
`asset.previewFinish` 的 `ok/partial` 必须带 `decoder` 与 64 位 `digest`，且必须先 claim，
否则 `PREVIEW_NOT_CLAIMED`；缩略图只允许 ≤700 KB 的 base64。

### 1.4 格式边界（不把容器解析当可播放）

- 首发可预览：PNG、JPEG（真实像素 + 缩略图）、WAV（真实 PCM + peak/rms）、
  静态 GLB（真实 accessor/拓扑解析，**不渲染画面**）、Godot 包（静态引用检查，`executed:false`）。
- OGG：容器可解析但 PCM 解码未实现 → 预览状态 `failed`、`detail:"OGG_PCM_DECODE_NOT_IMPLEMENTED"`、
  `playable:false`；不再用 `partial` 冒充可播放。
- 含脚本预览仍走 C/R10 可信执行器；R6 只做静态检查。

## 2. 验证证据（原始输出已提交）

| 命令 | 结果 | 证据文件 |
| --- | --- | --- |
| `cargo test -p craftmine-core --offline` | **192 passed / 0 failed / 2 ignored** | `evidence/rust-craftmine-core-full.txt` |
| `cargo test -p craftmine-core --offline --lib asset_catalog` | 20 passed | `evidence/rust-asset-catalog.txt` |
| `cargo test ... --lib asset_catalog -- --nocapture` | 含全部实测数字 | `evidence/rust-asset-catalog-measurements.txt` |
| `node --test tests/godot-remaining/N/*.test.mjs` | 86 pass | `evidence/node-assets-round1-suite.txt` |
| `node --test tests/godot-round2/R6/*.test.mjs` | 19 pass（12 UI + 7 服务） | `evidence/node-round2-R6-all.txt`、`node-asset-library-ui.txt`、`node-asset-service.txt` |
| `node vendor/pi-desktop/scripts/check-style-tokens.mjs` | `style tokens OK` | `evidence/style-tokens.txt` |
| 10k 搜索进程内存采样 | 峰值工作集 21.1 MB | `evidence/memory-10k-search.txt` |

### 2.1 实测数字（本机 Windows，debug 构建，本轮重新测量）

| 档位 | 实测 |
| --- | --- |
| 1000 资源检索（每页 100，20 次） | P50 8.8–14.6 ms，P95 14.8–21.0 ms |
| 10000 资源检索（每页 100，20 次） | P50 46–69 ms，P95 62–91 ms（多次运行波动） |
| 10000 资源精确过滤 | 33–56 ms，命中 1 |
| 10000 资源检索峰值内存 | 21.1 MB |
| 导入 1000 个资源（1 KiB 正文） | 4.1–6.8 s |
| 导入 1 MiB / 16 MiB / 64 MiB | 24 ms / 220–298 ms / 1171 ms（均独立哈希核对） |
| 64 MiB + 1 字节 | 拒绝 `ASSET_FILE_TOO_LARGE`，无半成品 |

**旧数字追溯说明**：上一轮报告的 127/85 项与 2790 ms / 8656 µs / 233 ms 只有报告文字，
没有提交原始日志（本轮审计已指出）。本报告不再把它们当作当前证据；上表数字均由
`evidence/` 下提交的原始输出支撑。不同轮次机器负载不同，数字不可直接互相替代。

## 3. 健壮性覆盖

| 场景 | 状态 | 证据 |
| --- | --- | --- |
| 导入进程被中断 | 通过（恢复语义） | 陈旧 `pending-*` 暂存文件在下次写入前清扫，活跃写入者保留（`al1_sweeps_…`） |
| 存储不可写（磁盘满/只读的代理） | 通过 | 占用 `asset-catalog` 名称后导入失败且无版本行（`al1_unwritable_storage_…`） |
| 磁盘真正写满 | **未模拟** | 无可用配额工具；以“目录不可创建”作为代理 |
| 源文件被锁定 | **未模拟** | Windows 独占锁需 winapi，未引入依赖 |
| 重复操作/同版不同内容/相同正文去重 | 通过 | `al1_replays_…`、`al1_streams_…` |
| 正文完整性 | 通过 | 篡改 2 MiB blob 后探测报 `CORRUPT_ASSET_BLOB` |
| 授权目录扫描/新版本提示 | 通过 | `al1_scan_…`（`worldUpdated:false`） |
| 链接/重解析点 | 通过（跳过并记 issue） | `scan.rs` + `godot_projects::ordinary`；junction 用例仍受权限限制 |
| 取消与重试 | 通过 | 控制器 + 服务 + Rust 状态机 |
| 切世界后迟到结果 | **部分** | 预览缓存键绑定 `contentHash`，未 claim 不可变绿；宿主侧世界切换取消未在真实客户端验证 |
| 目录文件系统事件监听 | **未实现** | 现由宿主重复调用 `asset.scan` |

## 4. 未完成与依赖

- **R1**：`main.rs` 登记 16 个 `asset.*` 通道、`hello` 能力位（片段见 `INTERFACE_R6.md` 第 2 节）。
  未登记前，UI 与素材服务只能通过直接调用与假 `call` 验证。
- **R2**：导航白名单、面板挂载、`craftmine-aux` 的 assets 行通道、插件服务注册（第 3 节片段）。
  真实客户端里的导入/检索/预览/取消需要这一步。
- **R4**：用 `lock::{entry,build,resolve_closure}` 生成锁、`asset.recordUsage` 记引用。
- **R5**：用 `asset.bodyPath` 做正文快照、`asset.usage` 做引用保护。
- `tsc --noEmit` **未运行**：本工作树没有 `node_modules`，也不安装依赖；TS 行为验证用
  `node --test` + 仓库自带的 TS 导入 hook，类型正确性只有人工复核。
- 真实 Godot 引擎导入、真实模型创作、新目录包恢复不在 R6 范围。
- `asset-library.css` 由组件直接 import；若要改成 `globals.css` 统一入口，需 R2 加一行。

## 5. 自查修复

只读评审子代理在 50 轮上限内未产出报告，改为定向自查并修复了两处真实缺陷（均有回归测试）：

1. **UI 竞态**：`use-asset-library.ts` 原本没有请求代际保护，玩家切换范围/世界后，旧
   `asset.search` 的迟到响应会覆盖当前列表。现引入单调 `generation`，迟到的分页与搜索响应
   一律丢弃（`a late search response for a previous scope never overwrites the list`）。
2. **缩略图注入面**：`thumbnailSrc` 原先直接拼接 `data:image/png;base64,`，现校验
   base64 字符集与 ≤700 KB 上限，并只在 `picture===true` 时返回
   （`thumbnailSrc only accepts a bounded, well-formed base64 payload`）。

## 6. 诚实边界

- 所有自动验证都是逻辑/离线验证：没有真实 Godot 引擎、没有真实客户端窗口、没有真实模型调用。
- 音频不播放；OGG 只做容器解析且明确不可播放；GLB 只有结构解析，没有画面。
- 10000 资源档位只测到“可检索”，没有承诺 1 万资源下的全部交互时延；数字随机器负载波动已如实记录。
- 磁盘写满、文件锁定、目录事件监听、真实客户端世界切换取消仍未验证。
