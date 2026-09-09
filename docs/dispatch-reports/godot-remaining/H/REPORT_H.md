# H 报告：作品复用、旧世界转换与完整备份

任务标识：`godot-remaining-20260910-H`
分支：`codex/godot-remaining-h-20260910`
提交：`9dd37041d4119987edaf755b306ec9ea76e68263`（16 个文件，+4097/−5）
基线：本地 master `e462147`（分发基线 `92c98b2` 已包含在内）
工作树：`D:\Craftmine World-worktrees\godot-remaining-h-20260910`（主目录未改动）

## 0 结论摘要

按专责任务逐条对照：第 1、2、5 条完成并通过逻辑验证；第 3、4 条完成“声明式迁移/转换副本与报告”部分，脚本迁移与真实引擎转换未完成；第 6 条（联合 F/I 的模型自写 L2 扩展验收）**未完成**，因为本工作树没有可用执行器与模型自写扩展样本。

验收主责 A08、A13 达到**逻辑层可验证**，未达到“正式客户端 + 真实引擎”的验收口径；A05/A14 的联合验证未执行。以下逐项说明，不把“测试很多”当作完成。

## 1 交付物

| 文件 | 内容 |
| --- | --- |
| `crates/craftmine-core/src/library/packages.rs` | `craftmine.package/1` manifest、精确依赖闭包、循环/缺失/哈希/兼容性检查、`package.register` / `package.check` |
| `crates/craftmine-core/src/library/reuse.rs` | `package.install/list/read/progress/grant/upgrade/uninstall/restore/export/import/usage` |
| `crates/craftmine-core/src/backups/complete.rs` | `craftmine.complete-backup/1`、`backup.export-full` / `backup.verify` / `backup.restore-full` / `backup.content-usage` |
| `crates/craftmine-core/src/legacy/convert.rs` | `legacy.convert`：只生成副本 + 逐项支持报告 |
| `crates/craftmine-core/src/{library,backups,legacy}.rs` | 子模块登记与 `TABLES` 扩展（H 独占文件） |
| `plugins/craftmine-world/reuse-service.mjs` | 宿主通道包装 + 中文失败原因 `explain` + `compatibilityMatrix` / `migrationReport` |
| `tests/godot-remaining/H/reuse-service.test.mjs` | 8 项纯逻辑测试 |
| `vendor/pi-desktop/docs/spec/godot-package-reuse-and-migration.md` | 独立 spec |
| `docs/dispatch-reports/godot-remaining/H/{INTERFACE_H.md,REGISTRATION_H.md,ADR_H_PACKAGE_REUSE_AND_BACKUP.md}` | 接口契约、登记补丁、ADR 片段 |

## 2 逐条对照

### 2.1 第 1 条：可安装包、来源记录、固定版本、依赖检查 —— 完成

- `craftmine.package/1` 记录 `ref`（精确 `{id,version,hash}`）、`kind`、`name`、`stateVersion`、`compatibility{base,baseVersion,engine,stateFormat,sceneFormat}`、`dependencies`、`parts{scene,source,assets,components}`（逐项 64 位十六进制哈希）、`initialState`、`migration`。
- 内容仍只存 `craftmine_library` 一处；`craftmine_packages` 只存安装契约，不复制正文。
- 固定版本：解析只用精确 ref；`PACKAGE_VERSION_NOT_FOUND: door@9`（测试 `fixed_version_closure_and_explicit_failures`），不会回退到同 id 的其它版本。
- 依赖：`PACKAGE_DEPENDENCY_MISSING`、`PACKAGE_DEPENDENCY_CYCLE`（`a@1 -> b@2 -> a@1`）、`PACKAGE_DEPENDENCY_HASH_MISMATCH`、`PACKAGE_VERSION_CONFLICT`；兼容性 `PACKAGE_INCOMPATIBLE_{BASE,BASE_VERSION,ENGINE,STATE_FORMAT,SCENE_FORMAT}` 带“实际值/要求值”。
- 未做：`parts` 目前是**声明与哈希登记**，没有把包内文件物化到 Godot 工程目录（那是 GD2 构建路径，由 F/I 负责）。

### 2.2 第 2 条：跨世界安装与复制分配新身份 —— 完成（域层）

- 每次安装生成 `ins-<24hex>`（由 `operationId` 决定，重放稳定，不同操作必然不同）。
- `mode:"initial"` 用 `initialState`；`mode:"copy"` 要求源实例、记录 `origin{instanceId,worldId}`、必要时对源状态做声明式迁移。
- 两个世界复用同一固定版本：测试断言 `instanceId` 不同、ref 相同、world1 改金币后 world2 状态哈希不变、`package.usage` 计 2 且 `removable:false`。
- 导出/导入不携带凭据、会话和世界进度：`credentialsIncluded/sessionIncluded/progressIncluded` 均为 false，且导出前递归拒绝含 `credential/token/session/password/secret` 等键（`PACKAGE_EXPORT_CONTAINS_PRIVATE_DATA`）。

### 2.3 第 3 条：升级、卸载与失败恢复 —— 部分完成

已完成（有测试）：

- 声明式迁移算子：`rename` / `add` / `remove` / `renameField` / `addField` / `removeField` / `preserve`。
- 缺少迁移路径 → `PACKAGE_MIGRATION_MISSING`；会丢数据的删除必须声明 `expected`，否则 `PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS: fields/visits`，且断言升级失败后实例的 `ref`、`stateHash`、`revision` **完全不变**。
- 一次性奖励 `once` 账本跨升级保留，`package.grant` 幂等（升级后再发放同 key 返回 `granted:false`）。
- 卸载只改状态、保留进度，`package.restore` 可逆；版本消失时 `PACKAGE_VERSION_UNAVAILABLE`，不静默降级。
- 回退方向（目标版本更低）显式 `PACKAGE_DOWNGRADE_UNSUPPORTED`，不静默清空。

未完成：

- **脚本迁移**没有实现。计划要求“脚本迁移确有必要时，在独立副本执行并验证，且只在 C/B 允许的独立副本执行”。当前没有任何脚本执行入口，`migration` 只接受声明式算子；需要 C/B 提供受限副本执行器后才能补。
- 实体重命名/新增/删除是在**实例状态**上做的，没有同步改 Godot 工程里的场景节点（那属于工程文件层，由 F/I 的补丁/构建路径负责）。

### 2.4 第 4 条：保留旧运行器、旧世界仅生成副本 —— 部分完成

已完成（有测试）：

- `legacy.convert` 只创建 `legacy-<12hex>` 新世界；转换前后各重算一次封存归档哈希，结果显式 `sourceUnchanged:true`；源 `project.json` 字节比对未变。
- 逐项报告：`geometry`、`systems`、PNG/JPEG/静态 GLB → `supported`；动画/骨骼 GLB、glTF/FBX/MP3 → `unsupported`；旧 JS 玩法 → `unsupported`（保留旧底座）；未知素材格式、未知进度格式、会话/需求/记忆归属 → `needsReview`。
- 进度按格式区分：`progress/2|3` 视为背包/生命/装备/任务可保留，`progress/1` 只保留玩家位姿并把其余标为需人工确认。
- 归档损坏/哈希不符/路径逃逸 → 先失败、不建世界（`CORRUPT_LEGACY_ARCHIVE`、`INVALID_ARCHIVE_PATH`），测试断言世界数量不变。
- 未给 `compiled` 时副本保留旧底座（`keptOnLegacyBase:true`）；给了受信任 `compiled` 时用其 build/snapshot，报告标 `converted:true`。
- 旧运行器入口未改动：`legacy.capture/readText/commit` 行为保持，`legacy_commit` 仍走原路径。

未完成：

- 真实旧 JS 玩法→GDScript 的**转换**没有实现（按计划“暂留旧底座”处理并逐项报告，不假装能执行旧代码）。
- `compiled` 路径没有与真实 Godot 兼容编译器联调；本工作树没有引擎与构建执行器。
- 测试用的是合成旧工程样本，不是真实用户存档。

### 2.5 第 5 条：完整备份 —— 完成

- `craftmine.complete-backup/1` = `domain`（既有域快照）+ `content`（不可重建内容的清单与逐文件哈希：封存旧归档 manifest/文件、已注册包与其不可变库内容）+ `rebuildable`（`godot-import-cache`、`godot-build-artifacts`、`godot-export-artifacts`，`excluded:true` 并带原因）+ `provenance`。
- `backup.verify` 逐项报告 `missing` / `mismatched` / `pathEscapes` / `verified` / `rebuildable`；任一非空则 `valid:false`。
- `backup.restore-full` **先验证内容再执行原子域恢复**：缺文件时返回 `BACKUP_CONTENT_INCOMPLETE`，并断言 `currentHash` 不变（测试 `complete_backup_separates_caches_and_verifies_every_content_file`）。
- 测试覆盖：导出→校验通过；篡改归档→`BACKUP_HASH_MISMATCH`；删除文件→`missing`；改写文件→`mismatched`；路径逃逸→`pathEscapes`；恢复原字节后同一归档恢复成功；库内容被删→`package/gate@1` 报 missing。
- 旧归档兼容：缺少包相关表的旧归档用**实时列定义**补空表，`backups::SCHEMA_VERSION` 保持 3，未改动 `durable_tests.rs`/`memory_receipt_tests.rs` 的冻结断言。
- 未做：完整备份**不内嵌**旧归档字节（会超出 32 MiB 可移植归档上限），只存清单+哈希，由 `backup.verify` 对内容目录校验；这一取舍写进了 spec 与 ADR。

### 2.6 第 6 条：联合 F/I 验证模型自写 L2 扩展 —— 未完成

计划要求用三类不同用途的**模型自写** L2 扩展做安装、独立检查、升级、保存重启、第二世界复用和卸载，且“固定模板只能证明包机制，不能替代模型自写验收”。

本工作树没有：可用的 Godot 执行器/构建作业通道、F 的底座组件、I 的检查器、以及模型自写扩展样本。因此这条**未执行**，也不以固定样例冒充。下一步入口见 §5。

## 3 验收主责与配套计划对照

| 条目 | 状态 | 依据 |
| --- | --- | --- |
| A08 在第二个世界复用作品 | 逻辑层完成，端到端未验收 | `two_worlds_reuse_the_same_version_with_independent_identity_and_progress`：固定版本、新身份、进度独立；未经过正式客户端与真实引擎 |
| A13 转换旧世界副本并导出导入 | 部分完成 | `legacy.convert` 副本+逐项报告+源不变；`package.export/import` 往返；未使用真实用户世界 |
| A05 连续修改已玩的武器世界 | 未联合验证 | 需要 A/D/I 的真实应用与进度事务联调 |
| A14 坏候选/不兼容迁移或加载失败 | 部分完成 | 不兼容、缺依赖、缺迁移、会丢进度四类失败均有测试且失败后状态不变；未在真实候选加载路径上验证 |
| AL3 简单物件闭环 | 契约/逻辑层 | 固定依赖安装、独立实例、局部覆盖冲突（`SYSTEM_CONFIG_CONFLICT` 等）由既有 library 安装路径承担；H 未改 `library-service.mjs` |
| AL4 组合作品与升级 | 逻辑层 | 状态迁移、升级/卸载提案、奖励不重复已实现并测试；“商店/战斗区完整依赖安装”需与 N/E 联调 |
| AL5 完整库管理与交付 | 部分 | 使用关系 `package.usage`、清理保护 `removable`、完整备份与许可清单边界已具备；归档/清理动作本身与正文快照属 N/M |
| VM4 离线作品与 Fork | 部分 | 离线包 `craftmine.work-package/1`（无凭据/会话/进度）、从固定版本创建独立世界（`mode:"copy"` + 新身份）；命名版本与受保护 Git 引用属 M |

## 4 给 E/L/K 的接口

- `docs/dispatch-reports/godot-remaining/H/INTERFACE_H.md`：manifest 字段、16 个 RPC、错误码语义。
- `plugins/craftmine-world/reuse-service.mjs`：`createReuseService({call})` 的 16 个严格校验方法；`explain(code)` 覆盖 33 个错误码的中文 `{title,detail,action}`；`compatibilityMatrix(report)`、`migrationReport(receipt)` 为纯函数。
- `docs/dispatch-reports/godot-remaining/H/REGISTRATION_H.md`：A 与主任务的登记补丁（`main.rs` 分发、`workbench-service.cjs` 通道表、`domain-adapter.mjs` 再导出、`craftmine-panel-gateway.ts` 通道白名单、`craftmine-operation-journal.ts` 的 `allowed` 与 `receipt` 字段）。

## 5 未完成项与下一步可执行入口

1. **RPC 接线未合并**（阻塞端到端）：按 `REGISTRATION_H.md` 加 `main.rs` 分发与三处宿主登记。合并前 `package.*`、`backup.export-full/verify/restore-full/content-usage`、`legacy.convert` 只有 Rust 方法与 Node 包装，没有端到端通道。
2. **第 6 条联合验收**：等 F 的底座组件、I 的检查器与执行器就绪后，用三个模型自写扩展跑安装→独立检查→升级→保存重启→第二世界复用→卸载；H 提供 `package.*` 通道与 `package.usage` 清理保护。
3. **脚本迁移**：需要 C/B 的独立副本执行器；在它落地前，`migration` 只有声明式算子，且会拒绝会丢进度的迁移。
4. **真实引擎/客户端验收**：本工作树无引擎与正式客户端，A08/A13 的“真实玩法”部分未跑；需要在集成后的完整环境重跑，并保留截图/回执。
5. **A17 Windows 安装生命周期**：需要独立 Windows 环境，未执行。
6. **旧 JS 玩法转换**：当前按“保留旧底座”处理并逐项报告；若要真正转写，需要与 I 的语义回归一起立项。

## 6 验证命令与证据

```
cd "D:\Craftmine World-worktrees\godot-remaining-h-20260910\vendor\pi-desktop"
$env:CARGO_TARGET_DIR="C:\Users\WINDOWS\.pi-desktop\scratch\c25e2b38-659a-4d01-8149-2b84d81ffddd\cargo-target-h"
cargo test -p craftmine-core
# test result: ok. 120 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 2.69s（无 warning）

cd "D:\Craftmine World-worktrees\godot-remaining-h-20260910"
node --test tests/godot-remaining/H/reuse-service.test.mjs
# tests 8 / pass 8 / fail 0
```

- 原始输出：`evidence/rust-tests-final.txt`、`evidence/node-tests-final.txt`。
- 首次失败/重试/最终成功：`evidence/first-failures.txt`（含两次编译错误、四次测试失败及处理方式）。
- 证据记账：本轮为**纯逻辑测试 + 合成样例**。没有运行真实引擎、正式客户端或真实产品模型；没有人工手感环节。`tests/browser.mjs`、`tests/modules-browser.mjs` 未运行，未发送任何真实鼠标键盘操作，未激活窗口。
- 数据身份：全部为 `tempfile::tempdir()` 合成副本；未触碰用户存档、共享引擎缓存或历史工作树。
- 源码身份：`9dd3704`（分支 `codex/godot-remaining-h-20260910`）；引擎/二进制身份：无（未涉及引擎二进制）。

## 7 集成顺序

1. A：`main.rs` 分发（`REGISTRATION_H.md` §1）。
2. 主任务/E：`workbench-service.cjs` 通道表与 `createReuseService` 接线、`domain-adapter.mjs` 再导出、`craftmine-panel-gateway.ts` 通道白名单、`craftmine-operation-journal.ts` 的 `allowed` 与 `receipt` 字段（`REGISTRATION_H.md` §2–§4）。
3. 主任务：ADR 片段统一编号并入总表；`SCHEMA_VERSION` 维持 3 的取舍需与 A 复核。
4. 之后才能进行第 6 条联合验收与 A08/A13 的端到端重跑。
