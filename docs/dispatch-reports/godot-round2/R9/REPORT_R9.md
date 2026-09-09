# R9 交付报告：固定包、许可与性能（第二轮）

日期：2026-09-10。分支 `codex/godot-round2-r9-20260910`，工作树
`D:\Craftmine World-worktrees\godot-round2-r9-20260910`，基线 `bcebeb1`，继承 K=`2c8b895`
（`ef30cac` 保留历史合入）。未推送、未合并；主目录与其他任务文件未改动。

按用户指示“现在补来源与测量接入；最后依赖集成代码和同包 R8 结果”执行：
证据归档、许可分类、随包 Git、内容边界、真实 RPC 测量接入已完成；
**最终固定包与同包 R8 验收、A17 安装生命周期保留为未完成**。

## 1 结论摘要

| R9 必做项 | 状态 | 证据 |
| --- | --- | --- |
| 1 补齐证据归档、修复旧包说明不一致、分类处理 67 项许可失败 | **完成** | `evidence/` 25 份（24 份带命令与证明范围）；许可失败 67 → **0**（状态仍为 PENDING）；旧包使用说明已刷新 |
| 2 随包固定 Git、Godot、模板、broker、底座、桥与真实依赖；检查四类内容边界 | **完成（Git 运行时发现待集成）** | `git-bundle.json` + `tools/git-bundle.mjs`；`content-boundaries.json` + 检查器 |
| 3 用已集成代码制作实际固定预览包 | **部分完成** | 已用现有构建包重制并修正（`desktop/build/r9-restaged-preview`）；**集成代码尚未合入，故不是本轮交付包** |
| 4 完成冷暖启动/构建/检查/应用/帧/内存/包体/Git/素材的真实测量 | **完成（应用与产品素材路径 pending）** | `measure.mjs` 8 个套件；新增 `product` 套件跑通真实 RPC |
| 5 联合 R8 同包验收 + 独立 Windows 安装生命周期 | **未完成（等集成）** | 命令与材料已备；A17 无独立机器，不标通过 |
| 6 CP4/CP-A17 Windows 独立游戏 | **未完成** | 无任何导出布局；边界已声明为 pending，检查器 exit 3 |
| 7 首次创作/复用/版本恢复/升级/排错说明 + 许可落实 | **完成（正式适用仍待法律复核）** | `DELIVERY_RUNBOOK.zh-CN.md`；`licensing/` 底账与草稿 |

## 2 提交

| 提交 | 内容 |
| --- | --- |
| `ef30cac` | 保留历史合入上一轮 K 交付（11 个提交） |
| 见本轮提交 | 证据归档与索引、许可分类、随包 Git、内容边界、产品 RPC 测量接入 |

## 3 证据归档（主任务找不到证据的问题已修）

上一轮 `K-measurement-final.json` 只存在于临时目录，主任务无法定位。本轮全部归档进仓库：

- 目录：`docs/dispatch-reports/godot-round2/R9/evidence/`（25 份，24 份带 `command`/`proves`/`limits`）
- 索引：`evidence/evidence-manifest.json`（逐文件 SHA-256 + 是否已归档说明），由
  `desktop/delivery/tools/evidence-manifest.mjs` 生成；`provenance.json` 记录每份证据的命令与证明范围
- 关键记录：`preflight-baseline.json`（8 项真实失败）、`preflight-final.json`（0 失败）、
  `release-manifest.json` + `release-manifest-verify.txt`（PACKAGE VERIFIED）、
  `licensing-check-batch07.json`（67 失败）→ `licensing-check-repaired.json`（0 失败、PENDING）、
  `licence-repair.json`、`git-bundle-verify.json`、`git-bundle-stage.json`、`boundary-client.json`、
  `size-with-git.json`、`measurement-final.json`、`product-rpc-r1.json`、`product-rpc-r6.json`

## 4 67 项许可失败：分类结果

在原始预览包上重跑得到 **67 项失败**（57 缺第三方许可文本、8 项目标许可文本、2 项声明未覆盖），
按“能证明的解决、未知的保留”分类：

**A. 凭来源/依赖可证明 → 已解决（67 → 0）**
- 45 个 npm 包自身不带许可文件：按包声明的 SPDX id 复制官方文本到
  `resources/licenses/third-party/canonical/`，并写回该包的 `licenseFiles`（0 个无法映射）。
- 8 类规范文本（GPL-3.0、MIT、Apache-2.0、ISC、BSD-3/2-Clause、MPL-2.0、Zlib、CC0-1.0、WTFPL）
  与 `CARGO-NOTICES.md`（140 个 crate 的逐项归属）按离线入口写入包内；文本全部来自
  `licensing/texts/`（URL/日期/SHA-256 可查，新增 CC0-1.0 与 WTFPL 两份）。
- 2 项 `NOTICE_ENTRY_MISSING`：包内 `CRAFTMINE-NOTICES.md` 换成生成版（含 npm/Cargo 表与字体条目）。
- 工具：`desktop/delivery/licensing/tools/apply-package-licences.mjs`（只写许可目录与打包的
  使用说明，绝不改二进制、绝不编造文本）。

**B. 权利未确立 → 保留为条件项，不假通过**
- `CRAFTMINE-LICENSE-AGPL-3.0.txt`（创作核心）与 `CRAFTMINE-MIT.txt`（导出运行时）改为
  `status: conditional` + `condition: covered-entries-verified`：**只要任一覆盖条目状态变为
  verified 而文本缺失，检查器立即失败**；当前全部覆盖条目仍为 pending-rights-review，故报告
  pending。理由：权利未核对完就随包附上 AGPL/MIT 文本，等于替项目主张它尚未取得的授权。
- 未知权利人（AI 生成内容）保持 `unknown-rightsholder`。

**C. 仍需外部输入**
- 18 项 pending-rights-review（贡献者/雇主权利、上游衍生 62 个文件、MPL-2.0/BlueOak/Unicode-3.0
  条件、合同与 CLA 主体）见 `licensing/README.md` 开放问题清单。

结果：`licensing-check` 退出码 **3（PENDING，不是通过）**，失败 0、pending 19。旧包说明不一致
（`resources/source/USER_GUIDE.zh-CN.md` 6456 vs 仓库 7099 字节）已用当前版本刷新并记录。

## 5 来源固定（R9 第 2 项）

**随包 Git（R1 契约）**：R1 的 `GitAdapter` 依次查找 `CRAFTMINE_BUNDLED_GIT`、可执行文件旁的
`git/bin/git.exe` 等候选，找不到就报 `pathFallback`。本轮固定 **MinGit 2.53.0（64 位）**：
- 官方 GitHub 资产摘要 `sha256:82b562c9…08cd`，下载后实测哈希一致；解压 384 文件 / 109,017,851 字节；
- 布局为 `resources/git/**` + `resources/git/bin/git.exe`（`cmd/git.exe` 包装器），实测
  `git version 2.53.0.windows.1`，满足 R1 的 `MINIMUM_GIT=(2,38)` 与 `../git/bin/git.exe` 候选；
- 385 文件 / 109,064,331 字节，逐文件哈希写入包内 `resources/git/GIT-BUNDLE.json`；
- 许可：`LICENSE.txt`（GPL-2.0，19,125 字节）与 `mingw64/share/licenses/**` 逐组件许可随包；
- `resources/git/bin/git.exe`、`GIT-BUNDLE.json`、`LICENSE.txt` 已列入必需文件清单。
- **未验证**：`content.gitInfo.source` 实际变为 `bundled` 需要集成后的客户端运行，R1 尚未合入。

**包内固定**（`release-manifest.mjs`）：客户端提交、Godot 引擎与导出模板、broker 二进制、
三个底座、桥接源码、依赖锁文件、许可、Git 包、内容边界；M/N 记录为 R1/R6 分支提交
（`62a700f…`、`6494874…`）且**不写哈希**。

**四类内容边界**（`content-boundaries.json` + `content-boundary-check.mjs`）：
客户端安装、创作分享包（`craftmine.package/1` ZIP，按中央目录读取条目）、完整备份
（`craftmine.portable-archive/1`，读 magic 与 header，含 `credentialsIncluded:false` 与
“会话行可能含用户原文”警示）、Windows 独立游戏（**无布局，pending，exit 3**）。
实测重制包：1233 条目、0 违规。

## 6 测量接入（R9 第 4 项）

新增 `measure.mjs product` 套件：对真实 `craftmine-core.exe` 以 stdio JSON-RPC 测量
`hello`、R1 的 `content.gitInfo`、R6 的 `asset.search`（独立数据目录、无窗口、无输入）。

真实结果（校准，阈值仍为 `pending-real-sample`）：

| 目标 | hello | content.gitInfo (10 次) | asset.search |
| --- | --- | --- | --- |
| R1 调试构建 `62a700f` | 14.1 ms | p50 0.111 ms / p95 65.6 ms | `UNKNOWN_METHOD` → skipped |
| R6 调试构建 `6494874` | 16.4 ms | p50 0.113 ms / p95 64.1 ms | `UNKNOWN_METHOD` → skipped |
| 包内旧核心 | 20.8 ms | 未声明 → skipped | 未声明 → skipped |

说明：两个任务分支的调试构建都未注册 `asset.search`，且都不是集成构建，所以产品素材路径与应用等待
保持 pending；合成索引仍只作校准。

包体变化（真实）：加入 Git 后总包 **651.121 MB / 1233 文件**，`resources/git` 104.074 MB。
为容纳必需组件，验收前把 `size.fileCount` 上限 1200 → 1400 并新增 `size.resources.git.mb`
（≤128 MB），阈值文件内 `changeLog` 记录原因与日期；这是**构成变化**（R1 要求随包 Git），
不是失败后放宽——此前没有任何一次运行因文件数失败。

## 7 固定包与同包验收（未完成）

已生成 `desktop/build/r9-restaged-preview`（.gitignore 内，不提交）：原 round-one 构建包 +
许可修复 + 随包 Git + 刷新说明。实测：
- `preflight all`（真实引擎缓存 + 该包）6 项检查 **0 失败**；
- `release-manifest verify` → **PACKAGE VERIFIED: 0 missing, 0 mismatch, 0 unpinned, 0 forbidden**；
- `licensing-check` → 0 失败、19 pending、退出码 3；
- 内容边界 client → 0 违规。

**它不是本轮交付包**：二进制仍来自 round-one 构建，未包含 R1/R2/R3/R6/R7 的集成代码。
集成后的固定包与 R8 同包真实创作/恢复验收按下列顺序执行：

```powershell
node desktop/delivery/release-manifest.mjs create --root . --cache <cache> --package <新包> --out <manifest>
node desktop/delivery/release-manifest.mjs verify --manifest <manifest> --package <新包> --strict-extra
node desktop/delivery/preflight.mjs package --package <新包>
node desktop/delivery/licensing-check.mjs --inventory desktop/delivery/licensing/inventory.json --package <新包>
node desktop/delivery/content-boundary-check.mjs --boundary client --path <新包>
node desktop/delivery/tools/git-bundle.mjs stage --package <新包> --zip <MinGit.zip>
node desktop/delivery/measure.mjs all --package <新包> --core <新包>\resources\bin\craftmine-core.exe
```

## 8 未完成项（逐条保留）

| # | 未完成 | 原因 | 下一步 |
| --- | --- | --- | --- |
| 1 | 集成代码的固定交付包 | R1–R7 未合入 | 第 7 节命令序列 |
| 2 | 同包 R8 真实 AI 创作与恢复 | 依赖集成 | 与 R8 在同一包执行并留存证据 |
| 3 | A17 首装/升级/升级失败恢复/卸载/跨用户隔离 | 无独立 Windows 环境 | `powershell -File desktop/delivery/windows-lifecycle-acceptance.ps1 -Execute -InstallDirectory <隔离根内绝对路径>` |
| 4 | `content.gitInfo.source == bundled` 运行验证 | R1 未合入 | 集成后启动客户端并记录 `content.gitInfo` |
| 5 | 产品素材搜索/预览与应用等待 | R6 未注册 `asset.search`；无 apply 计时 | 集成后跑 `measure.mjs product` 与 `waits` |
| 6 | CP4/CP-A17 独立游戏 | 无导出布局 | 边界已声明；实现后 `content-boundary-check --boundary standalone-game` |
| 7 | 许可正式适用、合同/CLA 主体、45→0 之外的权利核对 | 需人工/法律复核 | `licensing/README.md` 开放问题清单 |
| 8 | 测试并入全局 `npm test` | `package.json` 由 root 统一修改 | root 追加 `tests/godot-remaining/K/*.test.mjs`、`tests/godot-round2/R9/*.test.mjs` |

## 9 验证命令与结果

```powershell
node --test tests/godot-remaining/K/*.test.mjs   # 46 项：45 通过 / 1 跳过（符号链接权限）
node --test tests/godot-round2/R9/*.test.mjs     # 6 项全通过
node --test desktop/delivery/preflight-selftest.mjs   # 39 例全通过
node desktop/delivery/preflight.mjs all --cache <cache> --package desktop/build/r9-restaged-preview  # 0 失败
```

一次并行整组运行时出现过 1 项瞬时失败（临时目录争用），单独重跑与再次整组运行均为 0 失败；
失败断言未放宽，已如实记录。

## 10 集成注意事项

- 本轮改动限于 `desktop/delivery/**`、`desktop/windows-package-tools.mjs`、
  `tests/godot-remaining/K/**`、`tests/godot-round2/R9/**`、`docs/dispatch-reports/godot-round2/R9/**`；
  未触碰主目录 README、总计划、许可策略、锁文件、C 的构建入口、Rust `main.rs/lib.rs`、
  `electron/main/index.ts`、`plugins/craftmine-world/view.mjs`。
- `PACKAGE_REQUIRED_FILES` 新增 3 个 Git 文件后，round-one 预览包会因缺少随包 Git 而失败——
  这是预期，不是回归。
- 合并顺序建议：先合 `ef30cac`（保留 K 历史），再合本轮各逻辑提交，最后按第 7 节重跑同包验收。
