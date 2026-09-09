# S3 报告：底座、组件身份与作品实际安装

日期：2026-09-10
任务：`docs/dispatch-prompts/godot-round3-20260910/S3-bases-and-package-install.md`
分支：`codex/godot-round3-s3-20260910`
工作树：`D:\Craftmine World-worktrees\godot-round3-s3-20260910`
基线：`24edb0c`（S1 的第三轮起点提交；其父提交为已提交的 R2 综合头 `2fa3c7c` 与 master `c2e592f`）

本轮从 R2 综合头起步，接续 R3=`cf4704f` / R4=`5ee9206` 的职责。旧树只读，未复制旧树、未改写旧提交、未清理任何旧工作树。主目录 `D:\Craftmine World` 的未提交文档未改动。

## 1 结论摘要

| 必需项 | 状态 | 依据 |
| --- | --- | --- |
| 1 唯一引用/锁规范，移除 R4 同名不同结构 | **模块级完成**，待 S1 登记 | 三种锁结构合并为 `AssetLock`；Rust/JS 执行同一向量并复现冻结哈希 |
| 2 ZIP 导入导出与拒绝规则 | **完成（含本轮补强）**，性能测量未做 | R4 既有 22 项 + 本轮新增同版冲突、隐私拒绝 5 项 |
| 3 完整受管理草稿文件集 | **模块级完成**，正式事务/构建检查/候选应用未接线 | `draft_install.mjs` + Rust 真实计划夹具跨语言验证 |
| 4 身份覆盖、CRLF、已有文件、路径/脚本冲突 | **完成** | 8 项逻辑回归 + 真实引擎 8/8 |
| 5 全或无安装 | **完成** | 预检、原子应用、取消回滚、崩溃恢复、幂等/重复操作 |
| 6 门/宝箱两世界/两实例/升级/卸载全链路 | **未完成** | 逻辑层既有通过，真实产品链路缺 S1/S2/R2 接线 |
| 7 四底座受管理生命周期与真实玩法 | **模块级通过**，产品级未验 | 同源码真实引擎 26/26（四底座）；产品创建/游玩属 S7 候选 |
| 8 CP 玩家底座/世界包与旧世界转换副本 | **未完成** | 本轮未实现，边界与下一步已列 |

**不能声明 S3 整条完成。** 第 3、6、7、8 项的产品级证据依赖 S1 的 RPC 登记、S2 的服务构造、R2 的客户端接线和 S7 的综合候选；本轮已把可独立完成的部分做成可调用模块、真实反例回归和跨语言向量，并给出精确登记补丁（`REGISTRATION_S3.md`）。

## 2 交付身份

见 `evidence/identities.json`。要点：

| 项 | 值 |
| --- | --- |
| 分支 / 提交 | `codex/godot-round3-s3-20260910`；功能提交 `d775df6`、`9aaea0f`、`b294216`、`0190ec7`，本报告为同一分支的后续 docs 提交 |
| 基线 | `24edb0c`（祖先已核对：含 R2 `2fa3c7c`，其中含 R3/R4/C/R1/R5/R6 主体） |
| 引擎 | `D:\Craftmine World\desktop\build\godot\4.7.2-stable\editor\Godot_v4.7.2-stable_win64.exe`，180,858,888 字节，SHA-256 `ab1824f85bfd8e0e…` |
| 工具链锁定 | `desktop/godot/toolchain.lock.json` = `4.7.2-stable` |
| 核心/插件模块哈希 | 见 `evidence/identities.json` 的 `modules`（`asset-lock.mjs`、`package-format.mjs`、`package-zip.mjs`、`scene_materializer.mjs`、`draft_install.mjs`、`package_format.rs`、`installer.rs` 等） |

## 3 逐条实现与证据

### 3.1 唯一锁规范（要求 1）

审计反例：三种结构共用 `craftmine.assets-lock/1`——R4 规划器输出 `{direct, closure, graph}` 字符串数组、R4 校验器要求对象、R1/R6 共用结构是 `{format, assets[]}`，且规划器输出连自己的校验器都通不过。

本轮：

- `library/package_format.rs::validate_lock` 不再定义结构，改为把文档解析成 `content_history::contract::AssetLock` 并 `canonicalize()`；`LOCK_FORMAT` 直接引用 `ASSET_LOCK_FORMAT`（单一常量）。
- `library/installer.rs` 输出规范锁：固定版本、内容哈希、`installPath`、`files`（含媒体类型）与完整依赖列表，并返回 `assetLockHash`。
- 包自身的依赖元数据 `content.dependencies[] = {id, version, sha256}` 保持**独立 schema**，通过 `dependency_to_asset_ref` 显式转换；声明哈希与解析出的资源内容哈希不一致时 `PACKAGE_DEPENDENCY_HASH_MISMATCH`。
- 包清单文件条目没有媒体类型，转换时用固定表推导（Rust/JS 同一张表，向量冻结）。
- 旧 `{direct, closure, graph}` 文档显式拒绝为 `ASSET_LOCK_LEGACY_SHAPE`，迁移路径是"从资源清单重新规划"，不做静默猜测。
- JS 侧新增 `plugins/craftmine-world/asset-lock.mjs`（规范锁的唯一 JS 实现），`package-format.mjs::validateLock` 改为委托，`package-zip.mjs` 的常量有断言保证一致。

共享向量：`tests/godot-round3/S3/vectors/asset-lock-vectors.json` 由 Rust（`package_format_tests.rs`）与 Node（`asset-lock.test.mjs`）共同执行；JS 侧逐字节复现 S1 冻结向量 `tests/godot-remaining/M/contract/asset-lock-vectors.json`（`fixture-lock`、`empty-lock`）的规范文本与 `assetLockHash`。跨语言错误码对齐（缺失/类型错误 → `INVALID_ASSET_LOCK`，未知字段 → `UNKNOWN_FIELD`）。

### 3.2 ZIP 与隐私（要求 2）

R4 已交付的 22 项（store/deflate 往返、raw+data 闭包、全新目录离线往返、15 类加固拒绝）继续通过。本轮补齐两处缺口：

- `uniqueAssetVersions`：同一 assetId@version 不同内容哈希 → `PACKAGE_VERSION_CONFLICT`（导入与导出两侧）；完全相同重复折叠为一条。
- `assertShareablePath`：导出与导入都对每个 payload 路径应用文档化拒绝清单（`.env`、credentials/secrets、`*.pem|p12|pfx|key`、`id_rsa`/`id_ed25519`、`progress.json`、`chunks/`、`saves/`、`.git/`）→ `PACKAGE_PRIVATE_FILE_REFUSED`。

旧格式迁移仍由 `legacy_kind`（显式映射，`creation` 返回 ambiguous 交由作者选择）与 `legacy.convert`（只生成副本）承担。未做：大文件/多依赖深度的真实性能测量（属 CP0/CP1 与 S5 共同测量项）。

### 3.3 完整受管理草稿文件集（要求 3）

`desktop/godot/shared/draft_install.mjs`：

- `planDraftInstall({plan, payload, projectDir, sceneEdits, inputActions, expectedHead, currentHead})` 产出完整集合：每个资源按 `installPath` 的正文、规范 `craftmine.assets.lock.json`、确定性的 `.craftmine/instances.json`（实例 id、`entityMap`、`localOverrides`、`assetLockHash`）、基于当前场景文本计算出的场景编辑，以及组件声明的 `project.godot` 输入动作。**只规划不写盘**。
- 预检拒绝：正文缺失、哈希/声明字节数不符、脚本缺 `.uid`、`class_name` 与世界中已有类冲突或在包内重复、已有正文文件哈希不同且未被 overrides 覆盖、陈旧 HEAD、安装路径逃逸。

跨语言证据：Rust 真实计划 → `tests/godot-round3/S3/vectors/install-plan-fixture.json`（由 `cargo test -p craftmine-core --lib library::installer::tests::print_install_plan_fixture -- --ignored --nocapture` 生成）→ JS 层 `planDraftInstall`/`applyDraftInstall` 全通过。

未接线：**草稿经 S1 正式修订事务提交、S2 构建检查、R2 候选应用**尚未实现（见 `REGISTRATION_S3.md` §1–§3）。

### 3.4 身份覆盖与 CRLF（要求 4）

审计反例（`REPRODUCTIONS.md` 第 2 节）原样转为回归：

- 规划器现在由计划独占节点结构与身份；`placement`/`overrides` 中的身份字段、`parent`、`script`、`name`、`instance`、`type`、`groups` 一律拒绝（`reserved-override`），并在返回计划前复核身份未被改写。
- `applySceneInsertion` 序列化后重新解析：计划身份必须恰好出现一次、同一身份值不得重复、节点不得重复声明身份字段、同一父节点下不得重名（Godot 按父节点作用域命名）。
- 解析器规范化 `\r`，修掉"CRLF 场景隐藏已有身份"的潜在重复身份缺陷；节点 `parent` 头部属性此前从未解析（一律当作 `.`），一并修正；新写入行沿用文件原行尾；`planInputActions` 接受两种行尾，CRLF 中已有动作不再被误报缺失。

证据：`tests/godot-round3/S3/scene-identity.test.mjs` 8/8；真实引擎 `tests/godot-round2/R3/scene-install.mjs` **8/8（14 次引擎运行）**，含"同组件装两次得到两个独立实例""改一个不影响另一个""真实引擎报出两个身份"。

### 3.5 全或无（要求 5）

`applyDraftInstall` 先把整个集合暂存于项目内、写入操作日志，再替换目标并保留每个被替换文件的原字节：

- 任一步失败、取消、磁盘/锁错误 → 还原全部目标并删除本次新建文件；
- `recoverDraftInstall` 依据日志回滚被中断的 `applying` 操作，未知操作 id 明确拒绝；
- 同一 operationId 同内容 → 幂等空操作；同 id 不同内容 → `OPERATION_CONFLICT`（不写盘）；
- 应用返回 `created`/`replaced`/`unchanged`/`fileSetHash`/`assetLockHash`。

证据：`tests/godot-round3/S3/draft-install.test.mjs` 11/11（含取消回滚后"旧文件字节不变、无半写锁、无半写正文、暂存目录已清理"）。

### 3.6 门/宝箱复用（要求 6）— 未完成

既有 `library/reuse.rs` 的 5 项逻辑测试（固定版本、两世界独立身份与进度、声明式升级不重复奖励、卸载保留进度、离线包不带凭据与进度）在本轮同源码下继续通过。**但**"自动门/宝箱真实保存为作品 → 两个世界复用 → 同世界两个实例只改一个 → 保存变体 → 固定 v1 → 显式升级 v2 → 卸载 → 保留兼容状态与失败回退"这条产品链路仍未验证：它需要 §3.3 的正式事务与客户端接线（S1/S2/R2）以及 S7 的候选构建。本轮不把它计为完成。

### 3.7 四底座（要求 7）— 模块级通过，产品级未验

同源码真实引擎运行 `desktop/godot/shared/tests/progress.mjs`：

- 首次运行：first-person 7/7、top-down 6/6 通过后在 side-view 的 `--editor --import` 阶段进程异常退出（`code 3221225477`，即 `0xC0000005`）。证据 `evidence/engine-managed-progress.log`。
- 立即重试：**四底座 26/26 全通过**（`evidence/engine-managed-progress-retry.log`，末行 `{"passed":26,…}`）。与 R3 报告记录的"并发导入同一缓存目录造成瞬时干扰"一致，但本机两次结果都保留。

覆盖内容：四底座的显式初始加载、完整状态回执、暂停活恢复、耐久回执绑定运行哈希与实例、整进程重启保留原生进度、非法/未来版本状态原子拒绝。产品级"由客户端创建、真实游玩操作、保存重启、能力门槛与挖掘规则"属 S7 候选构建验收，本轮未执行。

### 3.8 CP 玩家底座与世界包（要求 8）— 未完成

本轮未实现玩家底座导入治理、世界包与旧世界转换副本；现有边界：`desktop/godot/bases/base-catalog.json`/`component-catalog.json` 与 `validateBaseContract` 已能阻止不合规底座进入目录，`legacy.convert` 只生成副本。下一步需与 S1/S5 对齐共同 SDK、来源、固定版本与迁移声明，并在客户端提供实际创建入口。不得据此扩大本轮宣称。

## 4 验证命令与原始证据

```powershell
# Rust：核心库锁/规划/复用
cd "D:\Craftmine World-worktrees\godot-round3-s3-20260910\vendor\pi-desktop"
$env:CARGO_TARGET_DIR="C:\Users\WINDOWS\.pi-desktop\scratch\0a6183fd-af6c-4c76-9973-74b8dab4afbf\cargo-target-s3"
cargo test -p craftmine-core --lib library::
# 22 passed; 0 failed; 1 ignored（ignored 为夹具再生成）

# Node：S3 专项
cd "D:\Craftmine World-worktrees\godot-round3-s3-20260910"
node --test tests/godot-round3/S3/asset-lock.test.mjs tests/godot-round3/S3/scene-identity.test.mjs `
  tests/godot-round3/S3/draft-install.test.mjs tests/godot-round3/S3/draft-install-plan-fixture.test.mjs
# 30 passed; 0 failed
node --test tests/godot-round3/S3/package-hardening.test.mjs   # 5 passed

# Node：回归
node --test tests/godot-remaining/F/components.test.mjs tests/godot-remaining/F/contracts.test.mjs `
  tests/godot-remaining/F/base-creation.test.mjs tests/godot-round2/R4/package-format.test.mjs `
  tests/godot-round2/R4/package-zip.test.mjs
# 54 passed; 0 failed

# 真实引擎
$env:CRAFTMINE_GODOT_BIN="D:\Craftmine World\desktop\build\godot\4.7.2-stable\editor\Godot_v4.7.2-stable_win64_console.exe"
node tests/godot-round2/R3/scene-install.mjs            # 8/8（14 次引擎运行）
$env:CRAFTMINE_GODOT_CACHE_DIR="D:\Craftmine World\desktop\build\godot\4.7.2-stable"
node desktop/godot/shared/tests/progress.mjs            # 26/26（首次 side-view 导入崩溃，重试通过）
```

原始输出：`evidence/rust-library-tests.log`、`evidence/node-s3-tests.log`、`evidence/node-regression-tests.log`、`evidence/engine-scene-install.log`、`evidence/engine-managed-progress.log`、`evidence/engine-managed-progress-retry.log`、`evidence/identities.json`。

记账边界：**模块逻辑 + 真实引擎**已分别记账；**正式产品调用、真实客户端、真实模型、安装包**本轮均未取得，不计入完成。未运行 `tests/browser.mjs`、`tests/modules-browser.mjs`，未发送真实鼠标/键盘，未激活或置前窗口，未请求 Pointer Lock；引擎一律 `--headless`、独立进程与独立临时目录；测试数据目录为本任务新建并已按绝对路径核对后清理（`test-results/godot-managed-progress-*` 两个目录，均含本任务引擎副本）。未结束任何非本测试进程，未按名称前缀清理未知目录。

## 5 已定位但未解决

1. **产品入口未登记**：`package.formatCheck` / `package.planInstall` 未在 `main.rs` 分发；`workbench-service.cjs` 通道与 Electron 导航未接。精确补丁见 `REGISTRATION_S3.md`。责任：S1 / S2 / R2。
2. **草稿提交链路未接**：草稿经 S1 修订事务提交、S2 构建检查、R2 候选应用尚未实现；因此要求 6 的产品级验收无法完成。
3. **四底座产品级验收**：需在 S7 固定源码/核心/引擎/broker/插件身份上由客户端创建、游玩、保存重启，并覆盖真实能力门槛与挖掘规则。
4. **side-view 编辑器导入偶发崩溃**：`0xC0000005`，重试通过；未定位到确定性根因，保留两次证据，建议在 S7 候选构建中复测。
5. **CP 玩家底座/世界包与旧世界转换副本**：未实现（要求 8），需与 S1/S5 共同冻结 SDK、来源、固定版本与迁移声明。
6. **性能测量**：CP0/CP1 的压缩/解压体积、1/16/64 MiB 文件与依赖深度档位未测。

## 6 审计反例 → 回归对照

| 审计反例 | 现在的结果 | 回归 |
| --- | --- | --- |
| `overrides:{entity_id:'old-id'}` 被接受，出现两个相同身份 | 计划返回 `reserved-override`；序列化后再次校验 | `scene-identity.test.mjs` |
| CRLF `[input]` 中已有动作被判为缺失 | 两种行尾都识别 | 同上 |
| CRLF 场景隐藏已有身份（本轮新发现） | 解析规范化 `\r` | 同上 |
| 节点 `parent` 头部属性未解析（本轮新发现） | 正确解析父作用域 | 同上 |
| 三种锁结构互不兼容 | 单一规范锁 + 显式 legacy 拒绝 + 共享向量 | `asset-lock.test.mjs`、`package_format_tests.rs` |
| 规划器锁无法被自己的校验器接受 | `the_plan_lock_is_accepted_by_the_package_validator` | `installer_tests.rs` |
| 逐文件写入导致半安装、已有文件不校验哈希 | 预检 + 原子应用 + 回滚 + 恢复 | `draft-install.test.mjs` |
| 同版不同哈希、分享包带凭据/进度（本轮新发现） | `PACKAGE_VERSION_CONFLICT` / `PACKAGE_PRIVATE_FILE_REFUSED` | `package-hardening.test.mjs` |
