# 任务 M 交付报告：玩家创作 Git 历史、分支与恢复（VM0–VM2）

日期：2026-09-10
基线：`e462147852e36bdfcaf897d3f915c5809fb88670`（本地 master，已含第 5 轮合入与两份配套计划）
分支：`codex/godot-remaining-m-20260910`
工作树：`D:\Craftmine World-worktrees\godot-remaining-m-20260910`（独立，未触碰主目录与其他工作树）
接口：`docs/dispatch-reports/godot-remaining/M/INTERFACE_M.md`；接线片段：`lib.rs.snippet.diff`

## 1 结论（先看这里）

- 已完成并自测：**VM0 受管理 Git 适配**、**VM0/AL0 共享引用契约（唯一定义 + 冻结向量）**、**VM1 本地仓库/历史/分支/检查点/草稿/版本/构建副本/回收规划**、**VM1 旧不可变修订逐字节迁移与后端切换**、**VM3 的 Git 文本级三方合并与冲突报告**、**VM4 的命名版本/离线 bundle/受保护引用原语**、**VM2 的 Git 侧引用事务与崩溃恢复状态机**。
- 未完成且未记作完成：**VM2 真实应用**（依赖 A/C/D/H 的构建、实例与部署记录）、**VM3 语义/玩法冲突判定**（依赖 C/I 检查器）、**VM4 Fork/导出端到端流程**、**VM5/VM6 远程与社区**（未授权、未实现）、**性能实测**（1 千/1 万档位未测）。
- **主任务/A 尚未接线**：`lib.rs`/`main.rs` 属 A，本交付不含其改动，只给可合并片段。因此当前工作树里 `content_history` 默认不参与编译；模块自测证据是在**临时**加入 `mod content_history;` + 两行 `migrate` 后取得（见第 4 节，已如实标注）。

## 2 交付文件

### 新增 Rust 模块（M 独占）

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `crates/craftmine-core/src/content_history/mod.rs` | 22 | 模块入口与测试登记 |
| `crates/craftmine-core/src/content_history/contract.rs` | 542 | 冻结共享引用 + `craftmine.assets-lock/1` 规范化 |
| `crates/craftmine-core/src/content_history/git.rs` | ~980 | VM0 受管理 Git 适配（唯一 spawn 点） |
| `crates/craftmine-core/src/content_history/repo.rs` | ~1060 | VM1 仓库布局、提交、分支、检查点、副本、差异、合并、版本、回收 |
| `crates/craftmine-core/src/content_history/migration.rs` | ~710 | VM1 旧修订迁移、映射、后端切换、崩溃续做、复核 |
| `crates/craftmine-core/src/content_history/apply.rs` | ~560 | VM2 Git 侧引用事务、恢复动作、耐久回执 |
| `contract_tests.rs` / `git_tests.rs` / `repo_tests.rs` / `migration_tests.rs` / `apply_tests.rs` | 共 ~2100 | 41 项自测 |

### 报告与文档

- `docs/dispatch-reports/godot-remaining/M/INTERFACE_M.md`（对接契约）
- `docs/dispatch-reports/godot-remaining/M/lib.rs.snippet.diff`（A 的最小接线片段）
- `docs/dispatch-reports/godot-remaining/M/REPORT_M.md`（本文件）、`DELIVERY_M.json`
- `docs/dispatch-reports/godot-remaining/M/evidence/`：`rust-full-crate-tests.txt`、`rust-content-history-tests.txt`、`git-provenance.txt`
- `tests/godot-remaining/M/contract/asset-lock-vectors.json`、`tests/godot-remaining/M/README.md`
- `vendor/pi-desktop/docs/spec/dispatch-m-content-history.md`、`vendor/pi-desktop/docs/adr/dispatch-m-content-history.md`、`vendor/pi-desktop/docs/spec/06-delivery/dispatch-m-e2e.md`

## 3 逐条对照专责任务

| 任务条目 | 状态 | 证据 / 说明 |
| --- | --- | --- |
| 1 VM0 固定随包 Git 来源/版本/哈希/许可与配置隔离 | 部分完成 | 适配器、隔离、白名单、超时、来源记录全部实现并测试；**随包二进制本身由 K 提供**，当前实测是 PATH 回退（2.53.0.windows.1，SHA-256 见 `git-provenance.txt`），不得记为“随包 Git 已完成” |
| 2 与 N 冻结共享契约与测试向量 | 完成（待 N 确认） | `contract.rs` 唯一定义；`asset-lock-vectors.json` + 2 个 golden 哈希；`INTERFACE_M.md` 第 1.3 节列出 5 项待 N 确认项 |
| 3 VM1 bare 仓库/工作副本、Git 为权威、旧修订映射与字节核对、构建副本排除元数据 | 完成 | `repo.rs`/`migration.rs` + 5 项迁移测试；副本无 `.git`、符号链接报错不跳过 |
| 4 检查点、历史分页、按需求分组、手动版本、两方案分支、租约与并发冲突、候选过期保留草稿 | 大部分完成 | 检查点/分页/trailer 分组/命名版本/分支独立/CAS 冲突/草稿 ref 已实现并测试；**每分支单写租约的 SQLite 表由 A 的任务/工作区租约承接**，M 只提供 Git 侧 CAS；候选过期（基线或素材锁变化）的判定点在 A/C，M 提供 `content_ref`/`asset_lock` 比对原语 |
| 5 VM2 分支试玩、比较、快进应用、恢复旧内容 | 部分完成 | Git 侧引用事务、比较、快进、恢复记录原语完成；**真实试玩/应用/进度迁移未完成**（依赖 A/C/D/H） |
| 6 崩溃点覆盖与未知回包查原操作 | Git 侧完成 | `apply.rs` 6 项测试覆盖 prepare/advance/confirm/rollback/recover/receipt；数据库部署记录与素材持久化仍属 A/N |
| 7 VM3 三方合并、文本冲突、二进制冲突、文件 diff | 部分完成 | 文本三方合并、冲突路径报告、准确文件 diff、二进制区分完成；**语义/依赖/素材版本冲突与局部撤销未完成** |
| 8 VM4 命名版本、离线作品版本、Fork 来源、受保护引用 | 部分完成 | annotated 版本标签、bundle 生成与校验、受保护引用列举、回收规划与只删真垃圾完成；**Fork/新世界复制与导出端到端未接** |
| 9 联合 H 的完整备份、路径与恶意配置、性能实测 | 部分完成 | 表清单与 `bundle()` 原语已提供（`INTERFACE_M.md` 第 6 节）；中文/长路径/大小写/设备名/恶意配置已测；**共同备份边界与全新目录恢复未联合验收，性能未测** |
| 10 VM5/VM6 保留 | 未实现 | `protocol.allow=never` 明确阻断网络；接口与依赖已记录，未公开任何玩家工程 |

## 4 验证与证据

命令（工作树 `vendor/pi-desktop` 下）：

```powershell
cargo test -p craftmine-core --offline                       # 152 passed; 0 failed; 2 ignored  (exit 0)
cargo test -p craftmine-core --offline --lib content_history # 41 passed; 0 failed; 1 ignored   (exit 0)
```

- 证据原文：`evidence/rust-full-crate-tests.txt`、`evidence/rust-content-history-tests.txt`（含首轮失败与修复过程的工作日志在会话内，最终通过结果在文件里）。
- 41 项自测覆盖：契约规范/错误向量、OID 变长、路径与大小写、Git 来源与隔离（含**发现并修复 CWD 泄漏产品仓库 config**）、恶意仓库配置（8 类键/节写法）、子命令白名单、CAS 与批量更新、超时杀进程、提交/分支/历史分页/分组、资产锁与 `ContentRef`、检查点/草稿/版本/applied、构建副本排除元数据与不支持条目、创作路径排除、文本与二进制 diff、三方合并（干净/冲突）、bundle/回收/剪枝只删真垃圾、sha256 仓库端到端、200 文件批量提交、迁移预检/导入/字节核对/后端切换/续做采纳/损坏报告、VM2 事务全流程与并发。
- **未运行**：任何真实鼠标/键盘/窗口/浏览器测试，`tests/browser.mjs`、`tests/modules-browser.mjs`（项目约束禁止）；真实 Godot 执行器；真实模型创作；真实应用与完整备份恢复；性能档位测量。
- 证据身份：Windows 10.0.19045、rustc/cargo 1.96.1、git 2.53.0.windows.1（PATH 回退，非随包）、基线提交 `e462147`。

### 4.1 验证方式的重要说明

模块自测需要 `lib.rs` 声明模块（A 独占）。M 在本地**临时**加入：

```rust
mod content_history;                                   // 第 3 处：模块声明
content_history::migration::migrate(&db)?;             // TaskJournal::open 内
content_history::apply::migrate(&db)?;
```

跑完 41 项后**已从交付中撤回**（`lib.rs` 未改动），片段见 `lib.rs.snippet.diff`。因此：模块代码本身已用真实 git 进程验证，但**交付分支默认不编译该模块**，接线与复验由 A/主任务完成。这是任务约定（`lib.rs` 归 A）的结果，不是“已验证接线”。

## 5 未完成项与依赖（不记为完成）

1. **随包 Git**：需要 K 提供固定版本二进制、来源与许可清单；M 的适配器已能记录并优先使用它。
2. **A**：`lib.rs` 接线（`lib.rs.snippet.diff`）；`godot_projects.rs` 写入前调用 `migration::assert_legacy_writes_allowed(&tx, &world_id)`，否则切换后的世界仍可走旧入口建立第二套历史；`main.rs` 工具登记（M 未写 RPC 层）。
3. **N**：确认 `INTERFACE_M.md` 第 1.3 节 5 项；补依赖环/路径/哈希用例后共同重冻 golden 向量。
4. **H**：`backups.rs` 的 `TABLES` 白名单必须加 5 张 `craftmine_content_*` 表，并把 `content-history/repos/**` 纳入完整备份与全新目录恢复；M 提供 `bundle()`。
5. **C/D**：真实构建/执行/检查与实例提升；M 的 `materialize()` 已保证构建输入无 Git 元数据、无 hook/filter。
6. **I**：真实模型四类任务（生成武器、再修改、恢复旧版、分支应用）验收；Git 单测不能替代。
7. **性能**：1 千/1 万文件与提交、历史/diff P50/P95、取消时延、迁移与备份耗时未测。
8. **VM5/VM6**：远程同步与社区协作未实现、未授权。

## 6 集成顺序建议

1. 先合 M 的 `content_history/**` + `lib.rs.snippet.diff`（A 应用）→ 跑 `cargo test -p craftmine-core --offline`（应 152 passed）。
2. 再合 A 的 `godot_projects.rs` 守卫调用，验证切换后的世界旧入口被拒。
3. 与 N 对冻结向量；与 H 对备份表清单与 `bundle()`。
4. VM2 真实应用在 C/D/H 就绪后接线：`prepare → advance → 调用方提交部署/进度 → confirm`，重启走 `recover`。
