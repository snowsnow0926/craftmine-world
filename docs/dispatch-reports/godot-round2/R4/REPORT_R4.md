# R4 报告：作品包真正安装、升级和跨世界复用（本轮范围）

任务：`godot-round2-20260910/R4-packages-and-installation.md`
分支：`codex/godot-round2-r4-20260910`（master `bcebeb1` + 继承 H `da41621`）
工作树：`D:\Craftmine World-worktrees\godot-round2-r4-20260910`（主目录未改动）
用户本轮指示：**静态包与安装器先做；实际场景安装依赖 R1/R3/C/R2**。

## 0 结论摘要

本轮完成 CP0（格式与向量冻结）与 CP1（静态包 ZIP 往返与拒绝规则）的可执行实现，并完成安装器的**规划层**（依赖顺序、新身份、实体映射、冲突清单、依赖锁），全部有测试。真正把源码/场景/资源写进草稿并形成候选（CP2 的物化与应用）依赖 R3 的物化器与 C/R2 的候选链路，**未完成**，也不以“计划生成成功”冒充安装成功。

按提示词 7 条要求逐条对照见 §2。结束条件（自动门/宝箱跨世界全链路）**未达到**：缺少 R3/C/R2 的物化与候选通道。

## 1 交付物

| 文件 | 内容 |
| --- | --- |
| `crates/craftmine-core/src/library/package_format.rs` | CP0：严格 JSON 解析（重复键/浮点/超范围拒绝）、JCS 子集规范化、路径与保留设备名规则、七类 kind、旧格式显式映射、依赖锁校验、`craftmine.resource/1` 与 `craftmine.package/1` 校验、`package.formatCheck` 入口 |
| `crates/craftmine-core/src/library/package_format_tests.rs` | 直接读取共享向量文件执行 CP0 契约 |
| `crates/craftmine-core/src/library/installer.rs` | `package.planInstall`：依赖优先顺序、环/缺依赖拒绝、`ins-<24hex>` 新身份、实体映射、锁、冲突清单、输入动作显式重映射、`localOverrides` 基线；**只规划，不写入** |
| `crates/craftmine-core/src/library/installer_tests.rs` | 计划、缺依赖、环、六类冲突、不兼容底座、重放身份 |
| `plugins/craftmine-world/package-format.mjs` | CP0 的 JS 镜像（367 行），与 Rust 执行同一向量 |
| `plugins/craftmine-world/package-zip.mjs` | CP1 ZIP 读写（store+deflate，`node:zlib` 无新依赖）、限额、加固拒绝、`packStaticPackage` / `unpackStaticPackage` / `archiveIdentity` |
| `tests/godot-round2/R4/vectors/package-format-vectors.json` | 冻结向量（25 canonical + 21 path + 11 kind + 11 legacy + 6 lock） |
| `tests/godot-round2/R4/package-format.test.mjs` / `package-zip.test.mjs` | 9 + 22 项 Node 测试 |
| `vendor/pi-desktop/docs/spec/godot-creation-package.md` | 独立 spec（含 4 项待 R1/R6 共同冻结的 CP0 决策） |
| `docs/dispatch-reports/godot-round2/R4/REGISTRATION_R4.md` | R1/R2/R3/R7 的登记与物化契约补丁 |

## 2 逐条对照

| # | 要求 | 状态 | 依据 |
| --- | --- | --- | --- |
| 1 | 与 R1/R6 冻结 CP0 七类资源、两种格式、固定依赖、目录/哈希/重复键/Unicode 规则，Rust/JS 同向量验证，旧四类显式迁移 | **完成（单方冻结，待 R1/R6 确认）** | 同一向量文件被 `package_format_tests.rs` 与 `package-format.test.mjs` 执行；`creation` 返回 `ambiguous` 而非猜测；spec §5 列出 4 项需共同确认的决策 |
| 2 | 带实际正文的 ZIP 导入导出，raw/data 静态包新目录离线往返；缺依赖/坏哈希/路径逃逸/同名冲突/链接/解压膨胀均拒绝；三种导出用途区分 | **静态部分完成** | `package-zip.test.mjs` 22 项：store+deflate 往返、raw+data 依赖闭包、临时目录离线往返、15 类精确拒绝码；分享包已实现，完整备份归 R5、独立游戏归 R9（未做） |
| 3 | 真正把 module/object/scene 源码、场景、资源锁和实体映射安装进草稿，调用 R3 物化器，经 C/R2 形成候选与正式应用 | **未完成（阻塞）** | 规划层已产出 `instances[].entityMap` 与锁；R3 物化器与 C/R2 候选通道不存在，未写入任何草稿 |
| 4 | 自动门/宝箱两世界复用、同世界两实例只改一个、保存变体；v2 不自动改 v1；升级/卸载保留局部覆盖与兼容状态 | **部分完成（逻辑层）** | H 的 `package.install/upgrade/uninstall`（固定版本、新身份、独立进度、声明式迁移、局部覆盖基线 `localOverrides`）已测试；本轮新增 `planInstall` 的冲突与重映射；**未在真实场景中验证** |
| 5 | 与 R1 的 Git 内容提交和部署事务接通，幂等/取消/晚到结果/失败回退实际测试 | **未完成（阻塞）** | R1 未交付 content_history/部署事务；H 的 operationId 重放与事务回滚已就绪，未联合验证 |
| 6 | 旧 Web 包/世界转副本、保留原始字节/来源/检查未知、不支持脚本明确列出；CP3/CP4 交接 | **部分完成** | H 的 `legacy.convert`（只生成副本、逐项报告、源不变）已测试；本轮未改 legacy 文件；CP3 玩家底座与 CP4 独立运行包未做 |
| 7 | 实际登记 RPC/服务并由 R2 接作品 UI、R7 接模型工具 | **未完成（阻塞）** | 提供 `REGISTRATION_R4.md` 精确片段；R1/R2/R7 不在本会话，未登记 |

## 3 CP 验收矩阵对照（本轮涉及项）

| 编号 | 状态 | 说明 |
| --- | --- | --- |
| CP-A01 七种类型与错误类型声明 | 部分 | 七类 kind 与非法 kind 已冻结并有向量；真实资源样本与后缀绕过测试未做 |
| CP-A02 包导出到全新离线目录 | 静态部分通过 | raw+data 包在临时目录离线往返字节一致（合成样本） |
| CP-A03 同版不同哈希 / 不同身份同正文 | 逻辑层 | H 的 `IMMUTABLE_VERSION_CONFLICT` 与库内容哈希；本轮向量覆盖规范化身份 |
| CP-A04 清单自引用、重复键、Unicode/排序边界 | **通过（逻辑）** | 共享向量：重复键、浮点、超范围、UTF-16 排序、非 BMP、控制字符转义 |
| CP-A05 路径穿越、同名覆盖、链接、ZIP 膨胀 | **通过（逻辑）** | Rust 路径规则 + ZIP 15 类拒绝码，均在解压前拒绝 |
| CP-A06 缺传递依赖、环、同资源不同版本、动态资源缺失 | **通过（逻辑）** | 锁向量 6 项 + 计划器缺依赖/环 |
| CP-A10 同一宝箱两个实例只改一个 | 未验 | 需要 R3 物化与真实实例状态 |
| CP-A11 场景入口、全局类、UID、输入动作冲突 | 计划层通过 | 六类冲突码 + 显式输入动作重映射；结构映射后重新导入检查未做 |
| CP-A12 升级背包/任务/配方保留进度 | 逻辑层 | H 的声明式迁移与一次性奖励测试；真实数据包升级未验 |
| CP-A13 作者发布新版本与修改介绍 | 部分 | 固定版本不可变、介绍/标签单独更新由 H 的库元数据承担；未做发布流程 |
| CP-A14 各持久边界退出与响应丢失 | 逻辑层 | H 的 operationId 重放；与 R1 部署事务未联测 |
| CP-A19/A20 甲导乙创作丙游玩 / AI 检索安装再导出 | 未验 | 依赖 R8 真实模型与 R2 客户端 |

## 4 验证命令与证据

```
cd "D:\Craftmine World-worktrees\godot-round2-r4-20260910\vendor\pi-desktop"
$env:CARGO_TARGET_DIR="C:\Users\WINDOWS\.pi-desktop\scratch\c25e2b38-659a-4d01-8149-2b84d81ffddd\cargo-target-r4"
cargo test -p craftmine-core
# ok. 132 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out（0 warning）

cd "D:\Craftmine World-worktrees\godot-round2-r4-20260910"
node --test tests/godot-round2/R4/package-format.test.mjs   # tests 9 / pass 9 / fail 0
node --test tests/godot-round2/R4/package-zip.test.mjs      # tests 22 / pass 22 / fail 0
```

- 原始输出：`evidence/rust-cp0-cp2-tests.txt`、`evidence/node-package-format.txt`、`evidence/node-package-zip.txt`。
- 首次失败与修正：`evidence/first-failures.txt`（含安装器 2 项失败、dead_code 处理、子代理误写主目录的清理核对）。
- 证据记账：**纯逻辑 + 合成样本**。没有运行 Godot 引擎、正式客户端或真实模型；没有人工手感环节。未运行 `tests/browser.mjs`、`tests/modules-browser.mjs`，未发送真实鼠标键盘，未激活窗口。
- 数据身份：Node 测试在内存 Buffer 与 `os.tmpdir()` 临时目录；Rust 测试用 `tempfile::tempdir()`；未触碰用户存档、共享引擎缓存或旧工作树。
- 源码身份：本报告提交号见 `DELIVERY_R4.json`；引擎/二进制身份：无（本轮不涉及引擎二进制）。

## 5 未完成项与依赖（保留，不删）

1. **CP2 物化与应用**：等 R3 的 `entityMap/overrides` 物化器 + C 的检查器 + R2 的候选入口。R4 已给出契约（`REGISTRATION_R4.md` §5）。
2. **RPC/服务登记**：R1 加 `package.formatCheck` / `package.planInstall`；R2 加 `workbench-service.cjs` 通道与作品 UI；R7 加模型工具。
3. **CP0 待共同冻结的 4 项**：Unicode 规范化依赖、整数-only 规范化数值、`content.interfaces` 形状、资源相对路径与包相对路径的分工（spec §5）。
4. **与 R1 Git/部署事务联测**：幂等、取消、晚到结果、失败回退。
5. **真实样本**：提示词要求“自动门和宝箱的创建、保存为包、全新数据目录导入、两世界独立复用、局部改动、升级保持状态全链路”。本轮只有合成 raw/data 包与 H 的实例逻辑；门/宝箱真实包未制作（需要 R3 底座与 C 执行器）。
6. **CP3/CP4/CP5/CP6**：玩家底座、独立运行包、三方合并冲突、扩展生态，均未开始。
7. **完整备份**已按新边界移交 R5；R4 本轮未修改 `backups.rs` / `backups/complete.rs`。

## 6 集成顺序

1. R1：`main.rs` 两条分发 + `package.formatCheck` / `package.planInstall`。
2. R2：`workbench-service.cjs` 通道表 + 作品 UI 导入/规划入口。
3. R3：按 `REGISTRATION_R4.md` §5 实现物化器，产出草稿。
4. R7：`package_inspect` / `package_plan_install` 工具。
5. 之后才能做 CP2 的“门/宝箱两世界全链路”与 CP-A10/CP-A19 验收。
