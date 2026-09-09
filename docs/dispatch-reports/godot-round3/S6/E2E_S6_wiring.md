# E2E S6｜实时观察、耐久预算与执行器交接

vendor 场景：`vendor/pi-desktop/docs/spec/06-delivery/04-e2e-test-plan.md` → `CRAFTMINE-GODOT-023`。

## 1 本会话实际执行（无真实输入、无窗口、无用户浏览器）

```powershell
cd D:\Craftmine World-worktrees\godot-round3-s6-20260910
node --test tests/godot-round3/S6/*.test.mjs tests/godot-remaining/L/*.test.mjs `
  tests/godot-round2/R7/jobs-and-recovery.test.mjs tests/godot-round2/R7/library-and-intents.test.mjs `
  tests/godot-round2/R7/context-injection.test.mjs      # 126 tests, 121 pass, 0 fail, 5 skipped
node desktop/build-world-plugin.mjs                      # 35 工具，模块可加载
```

证据：`evidence/tests-logic.log`、`evidence/plugin-build.log`、`evidence/built-tool-surface.json`、`evidence/source-hashes.txt`。

## 2 场景断言与对应测试

| 断言 | 测试 |
| --- | --- |
| 活体字段只来自宿主样本，存档装备不泄漏 | `live-and-execution-wiring.test.mjs`：live observation… |
| 跨世界/构建/实例、缺身份、带进度正文、超时样本 → unknown + 原因 | 同上；`tool-services.test.mjs` |
| 宿主桥只对 `craftmine.world` 开放，未注册服务即拒绝 | `host-bridge.test.mjs`（真实 `PluginRuntime.dispatchHostCall`） |
| 宿主采样器只读正式实例、可收窄不可改向、未运行返回 null | `host-live-sample.test.mjs`（esbuild 打包真实 TS 模块） |
| 七类限额来自耐久行，context/service/resource 保持 unknown，接续不重置 | `tool-services.test.mjs` |
| 执行器门禁优先活体、排队作业当轮交接、取消与续跑都到执行器 | `live-and-execution-wiring.test.mjs` |
| 连续三次压缩 + 换模型后同一耐久事实重建，且不含实时装备 | `context-recovery.test.mjs` |
| 讨论模式在接线后仍拒绝写入与草稿接续 | `live-and-execution-wiring.test.mjs` |
| 能力报告暴露 `services.wired/missing` 与 round-three owner | `live-and-execution-wiring.test.mjs`、`capability.test.mjs` |

## 3 未覆盖（分别记账，不得由上述测试替代）

| 未覆盖 | 原因 | 下一步 |
| --- | --- | --- |
| 真实运行实例的端到端采样 | 需要引擎/窗口与真实世界实例 | 正式客户端启动世界后调用 `godot_runtime_state scope=live` |
| 真实模型完成“观察→修改→编译检查→应用→再修改” | 由 S7 统一安排 | S7 用本分支 35 工具插件 + 真实模型 |
| 三次**真实**压缩后的继续创作 | 需要真实模型与真实压缩 | S7 |
| 进程重启后接续原工程任务 | 需要真实核心与插件重启 | S7 + 核心二进制 |
| `asset.*`/`package.*`/`content.*` 真实可用 | 核心未登记（S1） | S1 登记后工具无需改动 |
| 插件重启后回收已排队作业 | 核心无 `godotJob.pending` | S1 登记或 S2 改 reconcile 数据源 |

## 4 环境

- 插件构建与 TS 打包复用旧工作树的依赖安装（junction，只读）：
  `vendor/pi-desktop/node_modules`、`vendor/pi-desktop/packages/agent-runtime/node_modules`、`vendor/pi-desktop/apps/desktop/node_modules`
  → `D:/Craftmine World-worktrees/batch07-delivery-20260909/vendor/pi-desktop/*`（未安装、未修改、未复制）。
- 本会话未构建 Rust 核心；真实核心回归留待 S7 的综合候选。
