# craftmine world 交付运行手册（首次创作 / 底座区别 / 作品复用 / 导出 / 升级与恢复）

状态：**本机预览版。未签名、无隔离 Windows 机器、安装生命周期（A17）未验收。**
本文件是交付与说明材料，不是安装验收记录；每条都标明“已验证”或“待验证”。
写作日期 2026-09-10，代码基线 `e4621478`（K 分支 `codex/godot-remaining-k-20260910`）。

配套文档：`desktop/windows-USER_GUIDE.zh-CN.md`（面向玩家的完整说明）、
`desktop/delivery/README.md`（发行预检）、`desktop/delivery/RELEASE_MANIFEST.md`
（同包清单）、`desktop/delivery/MEASUREMENT.md`（测量口径）、
`desktop/delivery/licensing/README.md`（许可底账与离线入口）。

## 1 首次创作

1. 启动 `Craftmine World.exe`，在“模型设置”里选择自己的供应商、模型和密钥。客户端不会自动读取另一个 PI-Desktop 安装的账号；密钥由当前 Windows 用户的 DPAPI 保护。
2. 在“世界”面板新建世界，选择底座（见第 2 节），再打开世界。
3. 用自然语言描述想要的东西。助手产出的是**候选草稿**，不是已生效的世界。
4. 依次经过“检查 / 评审 / 应用”三个阶段；面板显示的失败条件会保留，可以“带评审提示应用”，但独立机器检查和实际加载仍必须通过。
5. 应用后等待保存确认回执（来自真实核心的耐久回执）。回执丢失时只查询已保存结果，不要重复点击。
6. 退出或切换世界前，客户端会先确认保存；保存失败会阻止离开，避免丢进度。

已验证：真实模型完成“从零创作 → 检查 → 评审 → 应用 → 保存恢复”的记录见
`docs/WINDOWS_BATCH_06.md`、`docs/WINDOWS_BATCH_07.md` 与
`docs/GODOT_CYCLE_05.md`（Godot 世界部分为固定样本与 headless 证据）。
待验证：可见窗口里的合成与操作手感由玩家自主试玩确认，自动测试不抢输入。

## 2 三个底座的区别与选择

| | 3D 第一人称 | 2D 横版 | 2D 俯视 |
| --- | --- | --- | --- |
| 目录 | `desktop/godot/bases/first-person` | `desktop/godot/bases/side-view` | `desktop/godot/bases/top-down` |
| 版本 | 0.1.0 | 1.0.0 | 1.0.0 |
| 视角/操作 | 第一人称、准星、射线命中 | 重力、跑跳、二段跳、平台碰撞 | 四方向移动、地图瓦片、房间与门 |
| 能力重点 | 装备、弹药、近战/远程、靶子 | 房间切换、机关、一次性拾取、检查点 | NPC、商店、采集、任务、存档 |
| 示例世界 | `scenes/training_range.tscn` | `worlds/ruins` | `worlds/town` |
| 空白起点 | `scenes/blank_start.tscn` | `worlds/blank` | `worlds/blank` |
| 素材来源 | 项目自有几何体与材质（MIT，`licenses/ORIGINAL_ASSETS_LICENSE.txt`） | 无素材文件，全部代码绘制 | 程序生成的像素图（`tools/make-assets.mjs`） |
| 状态格式 | `craftmine.godot-base-state/1` | `craftmine.godot-sideview-state/1` | `craftmine.godot-topdown-state/1` |

选择建议：要做武器、装备、射击类原型选第一人称；要做平台跳跃、房间机关选横版；
要做采集、商店、任务、地图探索选俯视。三个底座共享同一套宿主协议，切换底座不会
自动迁移旧世界的玩法状态，旧进度按第 5 节的恢复流程处理。

各底座的来源与权利声明：`desktop/delivery/base-assets/rights/*.md`；
逐文件字节与哈希：`desktop/delivery/base-assets/bases-*.json`。

## 3 作品复用

- “作品库”显示的是**固定版本**及其依赖；安装一件作品后仍要走检查 / 评审 / 应用，不会自动生效。
- 复用会记录作品版本、底座与依赖；底座不匹配时不会静默降级。
- 领域记忆与作品库是两件事：作品库保存可复用作品，记忆保存跨任务的偏好与事实。
- 已验证：作品复用、记忆与恢复的真实模型验收记录在 `docs/WINDOWS_BATCH_06.md`。
- 待验证：完整的 W0–W5 复用验收未全部完成，本手册不把部分验收当成全部。

## 4 导出

当前状态（必须如实说明）：

- 已实现并验证的是**固定样本导出**：`desktop/godot/export-probes.mjs` 只导出仓库
  自有的 `first-person` / `top-down` 样本工程，用于证明引擎接入与许可随包；
  它不是“导出玩家作品”。
- 玩家作品的一键导出仍在 GD6/GD7 范围内，**尚未交付**。
- 导出物必须携带：`licenses/GODOT_LICENSE.txt`、`licenses/GODOT_COPYRIGHT.txt`
  （哈希固定在 `desktop/godot/toolchain.lock.json`），以及项目自有导出运行时与示例
  脚本的目标 MIT 许可文本（见 `desktop/delivery/licensing/drafts/EXPORT_LICENSE_NOTES.md`）。
- 导出物中若包含 AGPL/LGPL 代码，需要单独处理，不能用“不抽成”代替分发合规。
- 机器核对入口：`node desktop/delivery/preflight.mjs export --export <导出目录>`
  与 `node desktop/delivery/licensing-check.mjs --export <导出目录>`。

## 5 升级与失败恢复

1. **升级前**：在“备份与诊断”里导出领域备份（Windows 文件选择器选位置，授权十分钟有效）。备份范围是整个客户端的全部世界、作品与领域记忆，**不含**凭据存储和 Chromium 缓存。
2. 关闭程序，再运行新的 `Craftmine-World-Setup-版本.exe`。安装器会先尝试保存本机世界数据副本，并在档案目录的 `upgrade-backups` 下写只读快照与哈希；数据被占用或备份失败时安装停止。
3. **升级失败**：保留升级副本和原程序目录，不要删除世界目录来绕过；先核对发行材料里的来源提交与兼容范围（`resources/source/build-manifest.json`、`package-manifest.json`）。
4. **回滚**：不要用不认识新数据格式或 DPAPI 格式的旧程序写入当前档案。可正常启动的兼容客户端用“恢复备份”恢复先前导出的领域文件。
5. **数据隔离**：卸载默认保留 `%LOCALAPPDATA%\CraftmineWorld`；设置 `CRAFTMINE_DATA_DIR` 时必须使用绝对路径。安装与升级脚本不读取 PI-Desktop 的个人档案。
6. **崩溃/断电后**：重新打开客户端时先确认待确认操作的原编号，再决定是否重试；作品安装成功但检查提交失败时用“重新检查草稿”，不必重新安装。

已验证：升级守卫脚本 `desktop/windows-upgrade-guard.ps1` 的快照与占用检测逻辑、
`desktop/delivery/windows-lifecycle-acceptance.ps1` 的验收步骤定义（默认只报告，不执行）。
**待验证：A17 首装、覆盖升级、升级失败恢复、卸载、跨用户数据隔离需要在独立 Windows
机器上执行，目前没有该环境，因此 A17 保持未验收。**

## 6 离线许可入口

| 位置 | 内容 |
| --- | --- |
| 客户端包内 | `resources/licenses/`（PI-Desktop LGPL 全文、Craftmine 声明、字体许可、第三方清单） |
| 引擎 | `desktop/godot/licenses/GODOT_LICENSE.txt`、`GODOT_COPYRIGHT.txt` |
| 导出游戏内 | `licenses/`（引擎许可与版权声明随导出物携带） |
| 离线索引 | `desktop/delivery/licensing/OFFLINE_LICENSE_ENTRY.md` + `offline-entry.json` |

许可状态：目标许可是“自有创作核心 AGPL-3.0-only 或商业许可、导出运行时 MIT、
上游 LGPL-3.0-or-later”，逐模块权利核对与正式适用**尚未完成**；
`desktop/delivery/licensing/inventory.json` 逐条记录已验证与待确认项。

## 7 未完成项与执行入口

| 条目 | 状态 | 下一步 |
| --- | --- | --- |
| A17 安装生命周期 | 未验收 | 在隔离 Windows 机器执行 `desktop/delivery/windows-lifecycle-acceptance.ps1 -Execute`（需要隔离标记与绝对安装目录） |
| 同包验收（客户端 + Godot + 模板 + broker + 底座 + 桥接 + 许可） | 待集成 | 集成后执行 `release-manifest.mjs create --package <包>` 再 `verify`，并与 I 在同一包上重跑真实创作与保存恢复 |
| 玩家作品导出 | 未交付 | GD6/GD7 实现后补 `preflight.mjs export` 与 `licensing-check.mjs --export` |
| M 配置隔离 / 源码历史恢复 | 未集成 | 按 `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` 集成后由发行清单固定 |
| N 资源库 / 搜索 / 预览 | 未集成 | 按 `docs/ASSET_LIBRARY_DEVELOPMENT_PLAN.md` 集成后测量 P50/P95 |
| 干净 Windows 首装 | 未验证 | 同上，需独立环境 |
