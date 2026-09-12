# Craftmine World 项目复盘（2026-09-12）

## 当前结论

当前 `master` 与 `origin/master` 同步，源码基线为 `ab381fe8d5fef9af6bbc4899722b7c8989a4c299`。桌面端版本为 `0.14.4-preview.15`。本轮没有发现会阻塞构建或提交的代码回归；发现的主要问题是状态文档落后、产品验收边界仍未闭合，以及 Windows 包体偏大。

## 已验证

- `pnpm --filter @pi-desktop/desktop typecheck` 通过。
- 桌面端 style token 检查通过。
- 根目录 `npm test`：304 项通过，0 失败。
- `cargo test --manifest-path vendor/pi-desktop/Cargo.toml -p craftmine-core`：336 项通过，0 失败，7 项忽略。
- 包清单漂移检查通过，Windows 包验证可重复执行。
- 安装器 payload 校验通过；便携包嵌套 ZIP 完整性通过。
- 最新安装器：`desktop/build/releases/ab381fe8d5fe-800e46ce-288a-422a-a1f7-87f45e452727/output/Craftmine-World-Setup-0.14.4-preview.15.exe`，SHA-256 `94e8ee93eff1d5e494433edc6367489513f7a5971a60ace1f8bbe9d81a1602ee`。
- 最新便携包：`desktop/build/releases/ab381fe8d5fe-800e46ce-288a-422a-a1f7-87f45e452727/portable-c6e3a13a-e56b-4e61-adcf-9f1e44280d6b/Craftmine-World-portable-ab381fe8d5fe.zip`，SHA-256 `87c0925672266f94ddbe8300c011cc2b023422fece7467ddce349fd14c97d811`。

## 需要修复或补齐的问题

### P0：验收边界

1. 尚未在独立干净 Windows 环境完成首装、升级、卸载、回滚、跨用户 DPAPI 和异常中断恢复。
2. 最新包尚未完成一次由真实玩家驱动的完整 M5 故事：自然语言采集、背包、交互物、敌人/战斗、简单任务、保存重开、空白世界复用。
3. 当前包是本地 unsigned preview，不能当作公开发布版本；授权、第三方资产归属和导出许可草案仍需定稿。

### P1：工程质量与可维护性

1. `docs/DEVELOPMENT_STATUS.json`、`docs/CREATION_CONTINUITY_STATUS.json` 和部分路线文档仍记录 `preview.11`，与当前 `preview.15` 不一致。
2. 许多 Godot 能力报告是“限定范围通过”，仍明确保留运行时继承、原生崩溃原因、生产 provider/tool 接线、同规模性能优化等未知项；不能把这些 scoped evidence 当成全量产品验收。
3. 包体较大：安装器约 373 MB，便携包约 1.03 GB。Godot editor/templates、运行时依赖和开发资源占比较高；便携包为保证嵌套 ZIP 完整性当前使用低压缩策略。
4. 当前构建、验证、证据和文档之间仍有多条手工串联路径，容易再次出现“代码已更新、状态文档未更新”的漂移。

## 建议的开发顺序

### 下一步一：最新包真人验收

用户直接测试 `preview.15`，记录模型、思考强度、世界 ID、每一步操作和失败原文。测试只在独立后台数据目录进行，不使用真实键鼠自动化。先完成一个闭环，再决定哪些失败属于产品缺陷、模型能力边界或环境问题。

### 下一步二：干净 Windows 生命周期矩阵

用隔离 VM/测试机执行首装、启动、创建世界、升级、保留用户 `.craftmine`、卸载、回滚和跨用户启动；把安装日志、版本、退出码和存档哈希写入机器可读证据。完成前不宣称 Windows 正式发布就绪。

### 下一步三：M5 闭环产品化

把采集、库存、交互、敌人/战斗、任务、保存恢复和跨空白世界复用串成一个可重复的玩家流程。每个环节都需要“模型提出、后台检查、玩家实际采用、冷重开复验”四段证据，避免只验证接口或 fixture。

### 下一步四：构建与包体优化

先生成逐目录体积报告，再评估拆分 editor/debug 资源、删除未使用模板、单独提供开发包，以及在不破坏嵌套 ZIP 完整性的前提下采用更高效的压缩。每次优化都必须比较安装器 payload hash、启动和解压耗时。

### 下一步五：建立单一审计入口

新增一个只读 `audit` 命令，统一执行状态漂移检查、manifest check、包验证、JS/Rust/桌面测试和证据摘要，并在失败时指出具体阶段。发布前只认该入口生成的审计结果。

## 磁盘与工作树

当前仅保留主工作树，历史 agent 分支已经有 `refs/archive/pre-cleanup-20260912/*` 备份引用。当前 D 盘约有 313 GB 可用，C 盘约有 65 GB 可用，没有必要为本轮复盘执行高风险系统清理。可在确认最终安装器和便携包已复制到外部位置后，清理 `desktop/build/releases` 中旧的解压目录和临时证据；不要删除 Git archive refs、用户 `.craftmine` 或未审阅的测试结果。
