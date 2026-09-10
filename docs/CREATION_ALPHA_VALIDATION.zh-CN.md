# 造物首版验证入口

整体计划见 `OVERALL_DEVELOPMENT_PLAN_2026-09-11.md`，机器进度见 `IMMERSIVE_ALPHA_STATUS.json`。

1. 在独立工作树准备依赖：设置 `CRAFTMINE_DEPENDENCY_ROOT` 到已有完整依赖目录，再运行 `node scripts/prepare-isolated-dependencies.mjs`。各workspace包需先完成TypeScript构建，再构建desktop的main/preload/renderer。
2. 固定引擎缓存用 `CRAFTMINE_GODOT_CACHE_DIR`。新编译Rust核心用 `CRAFTMINE_CORE_BIN` 与 `CRAFTMINE_CORE_BINARY`。可信执行器用 `CRAFTMINE_GODOT_BROKER_BIN`、`CRAFTMINE_GODOT_BROKER_IDENTITY`、`CRAFTMINE_GODOT_ENGINE_ROOT`；均使用真实已验证路径，不能借用未匹配源码的身份文件。
3. 浏览器依赖用既有 `PLAYWRIGHT_MODULE_PATH`／`CRAFTMINE_BROWSER`（或自动发现）；脚本只创建独立headless配置。运行 `node scripts/verify-creation-alpha.mjs`。
4. 报告位于 `test-results/creation-alpha-*/report.json`，每个步骤保留日志、退出码、耗时与SHA-256。任一步失败则整个报告失败，依赖缺失不能计为通过。

`--quick` 仅运行单元与宿主契约测试，不代表引擎、Web、可信执行器、正式采用或完整重开验收。完整入口包含这些层：操作和分页事务、迁移、字库完整性、官方底座契约、实际面板、真实引擎故事、Web导出规则、可信执行器和运行时分发。

浏览器验证不发送鼠标键盘、不调用输入模拟、不申请PointerLock或激活窗口；Godot使用--headless。实际玩家手感、物理麦克风识别准确率和模型首次需求成功率与固定作者输入的自动测试分开记录。

字库来自仓库已有Noto Sans SC，保留OFL许可及完整30890字符映射，冻结weight400并改名Craftmine CJK。维护时用 `scripts/build-creation-font.py` 和其注明的fontTools版本重建；游戏运行或普通打包不需要Python。分片JSON是字库数据，不是用户脚本和权限来源。
