# R8 交付报告：产品适配器接通 + 首条真实模型需求

- 任务：`R8`（`docs/dispatch-prompts/godot-round2-20260910/R8-real-product-model-acceptance.md`），原 I 接续
- 分支：`codex/godot-round2-r8-20260910`（未推送、未合并）
- 工作树：`D:/Craftmine World-worktrees/godot-round2-r8-20260910`
- 基线：`bcebeb1`；已保留历史地合入 上一轮 I `9df9801`、R2 集成分支 `451033b`
- 主目录、其他工作树未改动；C 的源码未复制

## 1 结论

**产品适配器已实现并真实接通**，不是模拟工具、不是作者源码、不是接口草案：

- 真实 `@earendil-works/pi-agent-core` + `pi-ai`（固定 0.85.1）+ 用户现有 DeepSeek 配置
- 真实 `craftmine.world` 插件子进程（构建产物 `desktop/build/craftmine.world`，**25 个真实工具**）
- 真实 `craftmine-core.exe`（本工作树自建，SHA-256 见证据）stdio JSON-lines
- 真实写入落到核心的 Godot 工程存储；驱动只读回产品状态

**首条真实需求（R15.1 + R15.2，武器准星/持枪/装备切换 + 后续修改）已真实执行**，并已扩大到 2 轮。
结果：**最终冻结规则下 3 次尝试中 1 次两轮全通过**（保留失败分母，见 §4）。

## 2 本轮新增/改动

| 文件 | 作用 |
| --- | --- |
| `tests/godot-remaining/I/lib/transport/pi-plugin.mjs` | **产品适配器**：真实 PI + 插件 + core 会话；真实工具调用、真实用量、真实身份；无浏览器、无输入 |
| `tests/godot-round2/R8/run-real-requirement.mjs` | R8 驱动：跑 R15.1/R15.2，回读产品状态，用冻结断言判定并落证据 |
| `tests/godot-round2/R8/source-evidence.test.mjs` | 源级证据启发式的离线测试（5 项，证明注释不能糊弄） |
| `tests/godot-remaining/I/spec/*.frozen.json` | **新增 R15 类别**（2 轮 / 13 条断言）：源级证据，显式不代替 R02 运行时断言；原有 14 类 / 28 轮 / 128 条断言一条未改 |
| `tests/godot-remaining/I/spec/FREEZE.lock.json` | 重新冻结（记录 3 次 `--accept-change` 原因） |

冻结集现在为 **15 类 / 30 轮 / 141 条断言**；原分母保留，新增条目单独记账。

## 3 真实产品能力（本次实测，非声明）

| 产品能力 | 实测结果 | 证据 |
| --- | --- | --- |
| 插件加载 25 个真实工具 | 通过 | `evidence/*/tool-calls.json`、`report.json` |
| `godot_project_create` 写入源码工程 | 通过（7–8 个文件、29–31KB、manifestHash 真实） | `evidence/attempt-2-pass/evidence/R15.1/observation.json` |
| `godot_project_patch` 增量修改 | 通过（revision 0→1→2→3→4） | 同上 + `project-files.json` |
| `godot_project_index` / `godot_file_read` 回读 | 通过（真实 sha256、字节数、文本） | 同上 |
| `godot_build_start` | **被阻断**：`blockedReason: GODOT_EXECUTION_UNAVAILABLE` | 同上 |
| 执行器门禁 | **`GODOT_BROKER_MISSING`**（broker 二进制未配置） | `runtime_info` |

精确阻塞点：`godot-host-broker.exe` 不存在/未配置（`CRAFTMINE_GODOT_BROKER_BIN` 或 `desktop/godot/sandbox/target/{debug,release}/godot-host-broker.exe`），
因此 `godotBuild.start` 只登记作业并返回 `GODOT_EXECUTION_UNAVAILABLE`；**构建/检查/候选/应用尚未打通**。这属于 B/R10 与 C 的范围，本报告只记录调用点与原始错误。

## 4 首条真实需求的尝试记录（失败保留在分母）

同一份冻结需求（R15.1 + R15.2），最终规则下：

| 尝试 | 模型调用 | 结果 | 说明 |
| --- | --- | --- | --- |
| 驱动修复期 run1 | 7 | 失败（非模型失败） | 需求文本让模型以为要改既有工程，模型正确地拒绝凭空重建 |
| 驱动修复期 run2/run3 | 15 / 18 | 失败（**验收器缺陷**） | 观测在 turn 结束后执行被 `TURN_ENDED` 拒绝；`godot_file_read` 缺 revision/manifestHash |
| **尝试 1（run4）** | 18 | **2/2 通过** | 旧版源级启发式；原始文件文本当时未持久化 |
| **尝试 2（run5）** | 23 | **2/2 通过** | 用最终启发式离线复验仍通过 |
| **尝试 3** | 8 | 0/2 失败 | 模型核查后要求确认，没有写入（`model-omission`） |
| **尝试 4（run6）** | 6 | 0/2 失败 | 同一失败模式（`model-omission`） |

**首次完成率（最终规则）＝ 1/3**。失败全部保留：`evidence/real-run`、`run6`、`attempt-0-driver-fix`。

失败分类与责任：`model-omission`——模型第一句是"I'll start by inspecting the existing project so I patch the real thing instead of rebuilding"，
查到没有工程后**停下来询问**而不是按要求新建。这是模型策略/提示敏感性问题，不是产品工具缺失（工具本身可用，尝试 1/2 已证明）。

另有一个**保真度缺口**：驱动目前注入自己的 system prompt（`run-real-requirement.mjs` 的 `SYSTEM_PROMPT`），
产品真正的系统提示由 `vendor/pi-desktop` 的 `craftmine-context.ts` 在桌面运行时内组装，尚未作为服务暴露。
在拿到产品真实提示之前，本结果只能算"模型 + 适配器提示 + 真实产品工具"，不能算"产品完整提示词下的结果"。归 R7/主任务接线。

## 5 源级证据的边界（不允许被当成运行时通过）

R15 的断言只读模型真实写出的源码：

| 断言 | 依据 | 边界 |
| --- | --- | --- |
| I.R15.1.1/1.2 | 工程文件列表、每个文件的真实 sha256 与字节数 | 只证明文件真的写入了核心 |
| I.R15.1.3 | 去注释后代码里存在居中计算（`size * 0.5` / `anchor_*=0.5` / 视口矩形 /2 等） | **不是**运行时准星偏移 |
| I.R15.1.4 | 代码里 `Camera3D` 且武器通过 `camera.add_child(...)` 或 `parent="...Camera3D..."` 挂上 | **不是**运行时跟随视角 |
| I.R15.1.5 | 两个不同装备 id + 真实 `equip/set_style/...` 调用 | **不是**运行时切换同步 |
| I.R15.2.1/2.2 | revision 增加、manifestHash 变化 | 证明是增量修改而非重建 |

`source-evidence.test.mjs` 证明：**只写注释不能通过**（注释先被剥离），只居中准星而没有相机挂武器也只算一半。

**R02.1 / R02.2 的运行时断言（准星 0.5px、持枪跟随、开火/伤害/弹药/冷却）仍然一条都没有通过**，因为没有运行时观测通道。它们保持「尚未执行」，不被 R15 替代。

## 6 身份与账目

| 项 | 值 |
| --- | --- |
| 模型 | `deepseek` / `deepseek-v4.1-flash-expires-on-0910` / thinking=high（沿用用户现有配置） |
| 凭据 | 只读取 `.craftmine/secrets.json`（只读、未复制、未打印、报告内只出现键名） |
| 引擎 | Godot `4.7.2-stable` / `gl_compatibility` |
| 核心 | 本工作树 `cargo build --release -p craftmine-core`，SHA-256 见 `report.json` |
| 插件 | `desktop/build/craftmine.world`，25 工具 |
| 输入 | `inputEventsSent=0 / pointerLockRequests=0 / focusSteals=0 / browserLaunched=false` |
| 用量 | 每次尝试的 token/缓存逐轮记录；未上报记 `unknown`（本轮 0） |

## 7 复现

```powershell
cd "D:/Craftmine World-worktrees/godot-round2-r8-20260910"
node desktop/build-world-plugin.mjs
cargo build --release -p craftmine-core --manifest-path vendor/pi-desktop/Cargo.toml --target-dir <scratch>/cargo-target-r8
$env:CRAFTMINE_I_LIVE_CONFIG="D:/Craftmine World/.craftmine/secrets.json"
$env:CRAFTMINE_CORE_BIN="<scratch>/cargo-target-r8/release/craftmine-core.exe"
node tests/godot-round2/R8/run-real-requirement.mjs --out test-results/r8-real
node --test tests/godot-round2/R8/source-evidence.test.mjs
node tests/godot-remaining/I/selfcheck.mjs
```

## 8 未完成与下一步入口

| 未完成 | 原因 | 下一步 |
| --- | --- | --- |
| 构建/检查/候选/应用 | `GODOT_BROKER_MISSING` → `GODOT_EXECUTION_UNAVAILABLE` | B/R10 提供 broker 稳定二进制与哈希；C 接线后重跑 |
| R02.1/R02.2 运行时断言 | 无运行时观测通道（`godot_runtime_state` 未接宿主采样） | R2 按 `INTERFACE_NOTE_R7.md` 暴露采样 |
| 全冻结集（30 轮）真实执行 | 需要每轮的观测计划与运行时通道 | 下一步按"已集成范围"逐类补 `observe` 计划 |
| 产品真实系统提示 | 未作为服务暴露 | R7/主任务提供 |
| 画面证据与人工手感 | 无可见窗口与真实玩家 | 保留未验收，不用 offscreen 代替 |
| 商店/任务/自动门/扩展等 | 需要 R3/R4/R6/R7 的工具真正登记与运行观测 | 按类别逐步接入 |
