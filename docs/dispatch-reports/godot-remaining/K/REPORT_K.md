# K 交付报告：性能、许可材料与 Windows 交付

日期：2026-09-10。分支：`codex/godot-remaining-k-20260910`，独立工作树
`D:\Craftmine World-worktrees\godot-remaining-k-20260910`，基线 `e4621478`。
未推送、未合并、未改动主目录与其他任务文件。

本轮按用户指示“立即做清单/测量/许可/打包工具；最终同包验收等集成”执行：
清单、测量、许可与打包工具已实现并留下真实证据；**最终同包验收、A17 安装生命周期、
M/N 集成后的复测保留为未完成**，并给出可直接执行的入口。

## 1 结论摘要

| 派单条目 | 状态 | 证据 |
| --- | --- | --- |
| 1 按实际代码修复发行预检 8 项失败 | **完成** | 重跑得到同样 8 项失败后修复数据与缺件；`preflight all` 6 项检查 0 失败 |
| 2 固定版本/来源/哈希，建立可复现构建与同包清单 | **完成（M/N 待集成）** | `release-manifest.mjs create/verify/diff`，9 个组件，268→276 文件哈希 |
| 3 实测冷暖启动、等待、帧时间、内存、体积，冻结阈值 | **完成（部分指标无真实样本）** | `measure.mjs`，42 项阈值冻结，实测 36 项，4 项 unmeasured、4 项 skipped |
| 4 逐模块来源/权利/依赖/交付清单 | **完成** | `licensing/inventory.json` 22 行；2 verified、19 pending、1 unknown |
| 5 版权/标准许可全文/第三方声明/对应源码/离线入口 + 草稿 | **完成（正式适用待法律复核）** | 15 份官方文本含 URL/日期/哈希；两份声明；离线入口；三份草稿 |
| 6 固定 Windows 预览/交付包 + 同包验收 + A17 | **未完成（等集成）** | 打包/固定/校验工具已完成；现有预览包校验出 1 处真实不一致；A17 无隔离机器 |
| 7 首次创作、底座区别、作品复用、导出、升级、恢复说明 | **完成** | `desktop/delivery/DELIVERY_RUNBOOK.zh-CN.md` |
| 配套：发行清单固定 Git/M 配置隔离与历史恢复/N 资源库与预览及完整依赖 | **部分完成** | Git 与依赖已固定；M/N 以 `pending-integration` 记录，绝不编造哈希 |

## 2 提交

| 提交 | 内容 |
| --- | --- |
| `4fa79a5` | 重跑并修复 8 项预检失败：bridge 字节重钉、runtime 声明、三个底座清单 |
| `154a8f7` | 打包工具新增 `pin` / `stage` / `diff`；必需文件清单收敛到 preflight-core |
| `f30992a` | 可复现发行清单 `create` / `verify` / `diff` |
| `9edb72b` | 交付运行手册（首次创作/底座/复用/导出/升级/恢复） |
| `45e61db` | 测量工具 + 冻结阈值 + 测量口径文档 |
| `6602a1f` | 逐模块许可底账、官方文本、声明、离线入口、草稿与检查器 |

工作树干净，无未跟踪残留（`test-results/` 已被 `.gitignore` 覆盖）。

## 3 第 1 项：8 项失败的真实重跑与修复

在 `e4621478` 重跑 `node desktop/delivery/preflight.mjs all`，**实际**得到 8 项失败，
与 `docs/GODOT_CYCLE_05.md` 记录一致（不是照抄旧数字）：

- `ASSET_BYTES_MISMATCH` ×3：`desktop/godot/web/bridge.js` 清单钉的是 5903 字节，
  实际为 6415 字节（任务 C 后续修改了桥接脚本）；
- `ASSET_UNDECLARED_FILE` ×2：`desktop/godot/web/runtime.mjs`（19163 字节）与
  `runtime.d.mts`（3033 字节）未声明；
- `ASSET_BASE_MANIFEST_MISSING` ×3：`desktop/godot/bases/{first-person,side-view,top-down}`
  没有交付来源清单。

修复方式（未放宽任何期望值）：

1. 重新核对并钉住 bridge.js 的真实字节与 SHA-256；
2. 新增两条 runtime 条目：`runtime.mjs` 为宿主侧 Web 运行库（`app-bundle`，
   `runtime.d.mts` 为构建期类型声明（`development-only`），均带显式 `outstanding` 许可说明；
3. 为三个已交付底座各生成一份逐文件来源清单（72 / 56 / 119 个文件），
   权利字段由 `desktop/delivery/base-assets/rights/*.md` 声明文件支撑。

新增（收紧而非放宽）：
- `ASSET_LICENSE_DOCUMENT_MISSING`（失败）：`licenseDocument` 指向的文件必须真实存在；
- `ASSET_RIGHTS_PENDING`（警告，每个清单一条）：`rightsStatus` 不是 `applied` 时把待定状态
  留在预检记录里，不静默变成通过。

验证：

```powershell
node desktop/delivery/preflight.mjs all --cache "<godot cache>" --package "<win-unpacked>" --quiet
# PASS notices / assets / lgpl / godot-cache / export(skipped) / package
# PREFLIGHT PASSED: 6 checks, 0 failures, 25 warnings
node --test desktop/delivery/preflight-selftest.mjs   # 35 cases, 0 failed
node --test tests/godot-remaining/K/*.test.mjs        # 43 tests, 42 pass, 1 skipped(符号链接权限)
```

25 条警告全部是显式的“许可文本待正式适用”说明，没有被改写成通过。

补充：H 在 `46739d2` 曾记录 6/6 通过、19 警告；本轮失败是其后集成引入的漂移，
两次记录的差异已用本次重跑证据对齐。

## 4 第 2 项：可复现发行清单与同包校验

`node desktop/delivery/release-manifest.mjs create --root . --cache <cache> [--package <pkg>] [--out <file>]`

固定内容（全部读真实字节）：客户端（提交、提交时间、工作树是否脏、版本）、Godot 引擎
（版本/URL/字节/SHA-256/可执行文件哈希）、导出模板（tpz + web_release.zip +
web_nothreads_release.zip）、broker/原生二进制、三个底座（版本、文件数、聚合内容哈希、
交付来源清单）、桥接（bridge.js/shell.html/web_bridge.gd）、依赖（pnpm-lock/Cargo.lock/
node/npm/cargo）、许可（引擎声明、UPSTREAM.json、windows-NOTICES.md、LGPL 文本）。

实测（`--cache` 真实引擎缓存，`--package` 指向现有预览包）：

```text
create → totals files=276 bytes=1704207561 presentFiles=271
         base:first-person 72 files / base:side-view 56 / base:top-down 119
         tooling:m pending-integration, tooling:n pending-integration（不写哈希）
verify → PACKAGE NOT VERIFIED: 0 missing, 1 mismatch, 0 unpinned, 0 forbidden, 0 links
```

唯一不一致是**真实发现**：包内 `resources/source/USER_GUIDE.zh-CN.md`（6456 字节）
与仓库当前版本（7099 字节）不同——预览包 `windows-preview-batch-07` 构建于
`7af2e41` 更新使用说明之前。这正说明“开发目录成功不等于发行包内容正确”。

同一包用 `pin` 独立复核：828 个文件、573,147,733 字节、1 个安装器、必需文件 0 缺失。

## 5 第 3 项：真实测量与冻结阈值

`node desktop/delivery/measure.mjs all --package <pkg> --cache <cache> --out <evidence>`
（客户端只以 offscreen、不可聚焦的 headless 模式启动，使用独立数据目录；不发送任何
输入、不抢焦点。）

实测（`windows-preview-batch-07` + 固定 Godot 4.7.2-stable，28 逻辑核 / 31.8 GiB）：

| 指标 | n | p50 | p95 | 阈值 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 冷启动 | 1 | 182.581 ms | – | ≤1000 | pass |
| 热启动 | 1 | 143.563 ms | – | ≤800 | pass |
| 离屏首帧渲染 | 2 | 1334 ms | 1579 ms | ≤5000 | pass |
| 引擎导入 | 3 | 2429.016 ms | 2650.477 ms | ≤8000 | pass |
| 工程构建（含建世界） | 3 | 2944.281 ms | 3254.206 ms | ≤8000 | pass |
| 探针检查 | 2 | 22539.411 ms | 23274.003 ms | ≤60000 | pass |
| 帧时间 | 900 | 6.9 ms | 6.976 ms | ≤16.67 | pass |
| 工作集峰值 / 稳态 | 1 | 534.348 / 464.641 MB | – | ≤1024 / ≤512 | pass |
| 进程树工作集峰值 | 1 | 1361.051 MB | – | ≤2560 | pass |
| 安装体积 / 文件数 | 1 | 546.596 MB / 828 | – | ≤700 / ≤1200 | pass |
| exe+dll / NSIS 安装器 | 1 | 300.665 / 147.893 MB | – | ≤400 / ≤250 | pass |
| git log | 30 | 37.378 ms | 46.049 ms | ≤500 | pass |
| git diff --stat | 30 | 138.681 ms | 182.41 ms | ≤1000 | pass |
| git 大文件 diff | 30 | 34.815 ms | 38.243 ms | ≤500 | pass |
| 资产搜索（合成 1k/10k） | 40 | 0.052 / 0.23 ms | 0.061 / 0.265 ms | 待真实样本 | unmeasured |

**skipped（附可执行命令，未伪造）**：
- `waits.candidate-apply.ms`：当前树没有真实 broker/apply 计时；
- `waits.install.ms`：运行 NSIS 安装器会改机器，改由 A17 隔离环境执行；
- `assets.search.ms` / `assets.preview.ms`：N 的 `src/asset_catalog/**` 尚未集成。

阈值在验收前一次冻结（`MEASUREMENT_THRESHOLDS.json`，`frozenAt` + 逐条 rationale），
实测值均低于阈值；未测项保持 unmeasured/skipped，不因缺样本而通过。

## 6 第 4–5 项：许可底账、文本与声明

- `licensing/inventory.json`：22 行，覆盖上游 PI-Desktop 及其修改、craftmine-core、
  `app/`、世界插件、`world-workshop-3d/`、Godot 桥接与 runtime、三个底座、Godot 引擎、
  npm 796 个包、Cargo 140 个 crate、字体、音频/模型、用户内容与 AI 输出。
  结论：**2 项 verified（Godot 引擎、内置字体）、19 项 pending-rights-review、
  1 项 unknown-rightsholder（AI 生成内容）**。没有任何一项被写成“已生效”。
- 证据：与上游 zip 的逐文件 diff（1078 未变 / 62 修改 / 155 新增 / 0 删除）、
  真实 `cargo metadata` 依赖走查、真实 npm 安装树与 pnpm-lock 比对。
- `licensing/texts/`：15 份官方文本，`SOURCES.json` 记录 URL、获取日期、字节与 SHA-256
  （AGPL-3.0 34523 B、LGPL-3.0 7652 B、GPL-3.0 35149 B、MIT 1078 B 等，全部 HTTP 200）。
- `licensing/notices/`：客户端 `CRAFTMINE-NOTICES.md`（1311 行，含 npm/Cargo 表与
  19 处证据引用）与 `EXPORT-NOTICES.md`。
- `licensing/OFFLINE_LICENSE_ENTRY.md` + `offline-entry.json`：包内与导出物内的离线入口。
- 草稿：`COMMERCIAL_LICENSE_DRAFT.md`、`CLA_DRAFT.md`、`EXPORT_LICENSE_NOTES.md`，
  均带“草稿、待法律复核、非合同”横幅与 `TODO(unknown)` 权利人清单。
- 检查器：`licensing-check.mjs` 对现有预览包实测 **exit 1，67 项失败**
  （57 项缺少第三方许可文本、8 项目标许可文本缺失、2 项声明未覆盖 Cargo/OFL），
  19 项 pending 一律按 pending 报告，绝不通过。

未做且刻意不做：未给任何源文件加许可头、未改任何包的 license 字段、未重新标记既有文件。

## 7 第 6 项：打包工具与固定包（等集成）

已完成工具：

```powershell
node desktop/windows-package-tools.mjs pin   --package <win-unpacked> [--out <file>]
node desktop/windows-package-tools.mjs stage --from <win-unpacked> --out <dir> `
     [--source-archive <zip>] [--build-manifest <json>] [--notices <dir>] [--force]
node desktop/windows-package-tools.mjs diff  --a <manifest> --b <manifest>
```

- `stage` 缺必需文件时 **exit 1** 并写入 `missingRequired`（实测缺 9 项时 exit 1），
  同时产出 `resources/source/package-manifest.json` 与 `SHA256SUMS.txt`，
  并显式写 `verification.verified=false` 与下一步校验命令；
- 必需文件清单收敛到 `preflight-core.PACKAGE_REQUIRED_FILES` 单一来源，
  开发目录不可能被当作完整包；
- 旧的 `manifest` / `verify` 模式保持兼容（`desktop/build-client.ps1` 调用未受影响）。

**未完成**：没有制作新的固定交付包。原因：GD7 同包依赖 A–I/L 的适用交付（尤其
C 的世界插件、M/N 的集成），现在打包会把未集成状态固化成“交付包”。集成后按顺序执行：

```powershell
node desktop/delivery/release-manifest.mjs create --root . --cache <cache> --package <新包> --out <manifest>
node desktop/delivery/release-manifest.mjs verify --manifest <manifest> --package <新包> --strict-extra
node desktop/delivery/preflight.mjs package --package <新包>
node desktop/delivery/licensing-check.mjs --inventory desktop/delivery/licensing/inventory.json --package <新包>
node desktop/delivery/measure.mjs all --package <新包> --cache <cache>
```

## 8 第 7 项：使用与恢复说明

`desktop/delivery/DELIVERY_RUNBOOK.zh-CN.md` 覆盖：首次创作六步、三个底座逐项区别与
选择建议、作品复用（安装后仍需检查/评审/应用）、导出真实状态（只有仓库自有固定样本导出，
玩家作品导出未交付）、升级与失败恢复（备份 → 安装 → `upgrade-backups` 快照 → 回滚规则 →
数据隔离）、离线许可入口、未完成项与执行入口。玩家可见合成与手感留给用户试玩确认。

## 9 未完成项（逐条保留，含执行入口）

| # | 未完成 | 原因 | 下一步 |
| --- | --- | --- | --- |
| 1 | GD7 同包验收（客户端+Godot+模板+broker+底座+桥接+许可 同一包重跑真实创作与恢复） | 依赖 A–I/L 集成 | 第 7 节五条命令，联合 I 在同一包执行 |
| 2 | A17 首装/升级/升级失败恢复/卸载/跨用户隔离 | 无独立 Windows 环境 | `powershell -File desktop/delivery/windows-lifecycle-acceptance.ps1 -Execute -InstallDirectory <隔离根内绝对路径>` |
| 3 | 玩家作品导出 | GD6/GD7 未交付 | 实现后补 `preflight.mjs export` + `licensing-check.mjs --export` |
| 4 | M 配置隔离 / 源码历史恢复 进入发行清单 | 未集成 | 集成后 `release-manifest.mjs create` 自动固定；当前为 `pending-integration` |
| 5 | N 资源库/搜索/预览及完整依赖 | 未集成 | 集成后重跑 `measure.mjs assets`，阈值从 `pending-real-sample` 转正式 |
| 6 | candidate-apply / install 等待时间 | 无真实计时/不执行安装器 | 真实应用与隔离安装各跑一次后补样本 |
| 7 | 45 个无许可文本的 npm 包、MPL-2.0/BlueOak/Unicode-3.0 复核、未知权利人与主体、CLA 与商业合同 | 需人工/法律复核 | `licensing/README.md` 的开放问题清单，交法律复核后回填 |
| 8 | 把 K 的测试并入全局 `npm test` | `package.json` 由 root 统一修改 | root 追加 `tests/godot-remaining/K/*.test.mjs` |

## 10 集成注意事项

- 本次改动只落在 `desktop/delivery/**`、`desktop/windows-package-tools.mjs`、
  `tests/godot-remaining/K/**`、`docs/dispatch-reports/godot-remaining/K/**`；
  未触碰主目录 README、总计划、LICENSING_STRATEGY、锁文件、`desktop/build-world-plugin.mjs`、
  Rust `main.rs/lib.rs`、`electron/main/index.ts`、`plugins/craftmine-world/view.mjs`。
- 若任务 C 再次修改 `desktop/godot/web/**`，需同步
  `desktop/delivery/base-assets/shared-web.json`（可用
  `draft-base-manifest.mjs --check` 报漂移，再人工复核提交）。
- 合并顺序建议：先合 `4fa79a5`（修复红项）→ `154a8f7`/`f30992a`（打包与清单）→
  `45e61db`（测量）→ `6602a1f`（许可）→ `9edb72b`（说明）。
- 现有预览包 `desktop/build/windows-preview-batch-07` **不是**本次交付包：
  它带有旧版使用说明，且不含 Godot 运行时声明，只能作为工具校验的输入。
