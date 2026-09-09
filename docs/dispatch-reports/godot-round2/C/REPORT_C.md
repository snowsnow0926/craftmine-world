# C｜自动 Godot 执行器与独立运行检查：第二轮交付报告

日期：2026-09-10。分支 `codex/godot-remaining-c-20260910`，工作树
`D:\Craftmine World-worktrees\godot-remaining-c-20260910`，基线 `e462147`。
本报告只描述本轮实际做到并留下原始证据的部分；未通过项逐条保留。

## 1 一句话结论

**真实 core → 固定 broker → 固定 Godot 导入/导出 → 独立 Electron 运行检查 →
core 候选**这条链路已经跑通，并留下可复算的原始证据：正常路径 23/23 通过
（`evidence/full-chain-report.json`），失败/取消/进程中断/恢复/清理 27/27 通过
（`evidence/failures-report.json`），协议级单元 15/15 通过
（`evidence/executor-protocol.log`）。执行器与检查器已分成提交交付给
R1/R2/R7 消费。

仍未完成的关键依赖见第 6 节：A 的 `godotExecutor.status/revoke`、
`godotJob.checkDescriptor`、`godotJob.pending` 尚未进入集成核心；L 的
`world-tools.cjs` 尚未调用 `enqueue`；R2 的 `main/index.ts` 尚未注入检查服务。

## 2 交付提交与文件

| 提交 | 内容 | 文件 |
| --- | --- | --- |
| `7357b0a` | 托管执行器服务 | `plugins/craftmine-world/godot-executor.cjs`（新增，约 800 行）、`host-requests.cjs`、`main.cjs`、`manifest.json`（仅 services 字段）、`desktop/build-world-plugin.mjs`、`vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts` |
| `ccd5b9f` | 独立运行检查 | `vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier.ts`（新增）、`electron/preload/godot-check.ts`（新增）、`electron.vite.config.ts`、`electron/main/plugin-host-process.mjs` |
| 本报告提交 | 测试、spec、ADR、证据 | `tests/godot-remaining/C/**`、`vendor/pi-desktop/docs/spec/dispatch-managed-godot-executor.md`、`docs/adr/ADR-godot-managed-executor-C.md`、本目录 |

未提交他人文件：`world-tools.cjs`（L）、`main/index.ts`、`view.mjs`（R2）、
`crates/craftmine-core/**`、`desktop/godot/sandbox/**`（A/B）均未被本任务修改。

## 3 身份与版本

| 项 | 值 |
| --- | --- |
| 核心二进制 | 本工作树 `cargo build --release -p craftmine-core`（源码 `e462147`），sha256 `60B39A2830FC29F1EF14097A6ACF17E0BE686E50B242F0B07A76C1235A37B903` |
| broker 二进制 | B 的未提交工作树 `D:\Craftmine World\test-results\g6-sandbox`（`3f52ce6`）`target\debug\godot-host-broker.exe`，sha256 `C9CD349615215E291C25DF61330C8356DD5BC0A79A8D555C3977A0F9B015B331`，与 B 证据记录一致 |
| broker 协议 | `BROKER_PROTOCOL_V1.md`（同一工作树），`schemaVersion:1`，`policyVersion: craftmine.windows.lpac-registry.v1` |
| Godot 引擎 | 4.7.2-stable（`desktop/build/godot/4.7.2-stable`），编辑器 sha256 `AB1824F85BFD8E0E4128182C000C4003A3E042245B2967848D089B2A04B22424`（与 `toolchain.lock.json` 一致），模板 `version.txt` = `4.7.2.stable` |
| 宿主 bridge | `desktop/godot/web/bridge.js`，sha256 `FB211925619E8ACC732744C233F46D4DB0EC88178921172DC9CD43A22A5BE0D3` |
| 引擎缓存与 broker | 只读复用共享缓存/B 的未提交产物，未修改、未复制进本树 |

## 4 实际命令与原始输出

```
# 协议级单元（脚本化 broker 桩 + 内存 core；非产品验收）
node --test tests/godot-remaining/C/executor-protocol.mjs        -> 15/15

# 正常链路（真实 core + 真实 broker + 真实引擎 + 真实 Electron 检查）
$env:CRAFTMINE_TYPECHECK_DEPENDENCY_ROOT="D:\cm-g6-root"
$env:CRAFTMINE_CORE_BIN="<worktree>\vendor\pi-desktop\target\release\craftmine-core.exe"
$env:CRAFTMINE_GODOT_BROKER_BIN="D:\Craftmine World\test-results\g6-sandbox\desktop\godot\sandbox\target\debug\godot-host-broker.exe"
$env:CRAFTMINE_GODOT_ENGINE_ROOT="D:\Craftmine World\desktop\build\godot\4.7.2-stable"
node tests/godot-remaining/C/full-chain.mjs                      -> 23/23（run godot-remaining-c-full-chain-JaCjsg）

# 失败/取消/进程中断/恢复
node tests/godot-remaining/C/failures.mjs                        -> 27/27（run godot-remaining-c-failures-46VQgq）

# 页面加载诊断（静态正常画面 vs 加载页 vs 停滞）
node tests/godot-remaining/C/load-probe.mjs <artifacts-dir>      -> ready/coi/canvas 证据
```

`CRAFTMINE_HEADLESS_TEST=1`、独立 `--user-data-dir`、offscreen 窗口、禁 Pointer Lock；
未发送真实输入、未激活窗口、未运行 `tests/browser.mjs` / `tests/modules-browser.mjs`。

## 5 逐条对照

### 5.1 原任务（第一轮 1–7 条）

| 条目 | 状态 | 证据 |
| --- | --- | --- |
| 1 发现并核验固定 Godot/broker/模板，预检成立后注册，动态反映不可用原因，重启后不永久有效 | 完成（除 A 的 revoke） | `full-chain` 前 6 项：真实 version 预检 `processVerified/networkVerified/cleanupVerified` 全真、6 项网络检查 `10013`；注册返回 `promotedJobs`；`status()` 给出 `GODOT_*_MISSING/MISMATCH` 等原因；协议测试覆盖缺 broker/引擎/模板/bridge 与哈希不符 |
| 2 领取真实作业，核验源码与宿主资源，调固定 import/exportWeb，比较实测 source files/digest、inputHash 与绑定，读回包与日志 | 完成 | `validateBrokerReceipt` 校验 requestId/绑定/inputHash/策略/进程/网络/清理；`sourceFiles` 必须与 claim 清单逐项相等且 `sourceSnapshotDigest` 等于宿主自算；协议测试覆盖改/缺/多/篡改摘要 |
| 3 区分固定引擎原生隔离诊断与脚本/编译失败 | 完成 | 窄规则按“完整消息 + 引擎位置”匹配 5 条实测诊断；未知 ERROR / GDScript 回溯一律失败。真实解析错误记录为 `SCRIPT ERROR: Parse Error: Expected parameter name.` + `Failed to load script "res://main.gd"` |
| 4 产物复制到核心管理目录再独立验哈希，补宿主固定 bridge，拒绝逃逸/重复/不完整/伪造 | 完成 | 复制后逐个重算 sha256、拒绝未列出文件、`web/index.html` 必需、`web/bridge.js` 强制为宿主 pin 版本（`failures`/`full-chain` 均验证）；协议测试覆盖 `../` 逃逸、未列出、哈希篡改 |
| 5 私有 checkDescriptor 启动独立 Electron 检查：无焦点、非零尺寸、独立 session、严格边界、禁输入抢占；检查 ready/画面/错误/快照/恢复，不写正式进度 | 完成 | `isolation={offscreen:true,focusable:false,visible:false,guard:{focus:0,pointerLock:0},sessionCleared:true}`；3 帧非空 960×640；快照与正式进度 `expectedHash==actualHash`；检查只发 `snapshot`，从不 `save/acknowledge` |
| 6 真实 core → B → Godot → Electron → core 候选全链路，跑正常/语法错误/运行错误/伪造回包/取消/进程中断 | 正常、语法错误、伪造回包、取消、进程中断、恢复与清理已完成；“运行错误（游戏内异常）”未单独构造 | `failures-report.json` 27 项：真实解析错误、取消、硬杀 broker（引擎停在固定导入标记后中断）、两次恢复、记录子进程身份核验与消失确认；伪造回包在协议级覆盖。**运行期异常用例待补** |
| 7 支持 A/E 第一次新建 Godot 世界的工程构建与检查，初始快照来自 F 的正式契约 | 部分 | 执行器对任意世界/工程按同一接口工作，`full-chain` 用的就是“新建世界→建工程→建作业”的路径；与 D 的首次加载确认/失败清理对接未做（D 的宿主归 D） |

### 5.2 第二轮补充要求（1–6 条）

| 条目 | 状态 |
| --- | --- |
| 1 继续定位画面断言与超时，保留宿主证据，区分静态正常画面/加载页/停滞/无真实呈现 | 完成：见第 7 节，两个根因都已定位并修复；`evidence/load-probe.log` 记录 `ready/coi/canvas/game` 状态 |
| 2 核对核心/broker 源码、版本、协议与二进制哈希 | 完成：见第 3 节；未改他人 Rust/broker 文件 |
| 3 尽早整理可消费提交 | 完成：`7357b0a`、`ccd5b9f` 已在分支上；测试/文档随后单独提交 |
| 4 真实正常路径 + 失败/取消/恢复/清理；给 R2 的 firstLoad/候选检查契约 | 正常路径与失败/取消/中断/恢复完成；firstLoad 契约见 `INTERFACE_C.md`（**仍需 R2 联合验证**） |
| 5 保持文件范围 | 完成：仅本任务文件 |
| 6 不抢鼠标等约束 | 完成：全程 offscreen、无输入、独立数据目录 |

## 6 未完成与依赖

1. **A 的接口尚未进入集成核心**：`godotExecutor.status`、`godotExecutor.revoke`、
   `godotJob.checkDescriptor`、`godotJob.pending`、`kind:"host"` 构建文件。
   执行器全部做了特性探测与本地兜底，并显式报告状态：
   `stop()` 返回 `revokeReason: GODOT_EXECUTOR_REVOKE_UNSUPPORTED`（实测），
   `checkDescriptor` 缺失时用 claim + `world.read` 组同构描述符（描述符字段与 A
   一致，验证字节仍由检查器独立完成）。
2. **L 的接线**：`godot_build_start` 成功后需调用 `executor.enqueue({jobId, worldId, mode})`
   （`INTERFACE_C.md` 给出一行补丁）。本轮验收直接调用该接口，模型路径尚未接线。
3. **R2 的接线**：`main/index.ts` 需注入 `craftmineGodotCheck` 服务（片段见
   `INTERFACE_C.md`）；`plugin-host-process.mjs` 已暴露 `pi.craftmine.godotCheck`。
   首次加载确认与候选应用仍需与 R2 同版本联合验证。
4. **硬杀 broker 的 AppContainer 配置清理**：协议明确要求宿主恢复日志，本轮未实现，
   只记录该限制。
5. **未覆盖**：游戏内运行期异常（如 GDScript 运行时错误）单独用例；真实模型创作
   （任务 I）；玩法必需断言（任务 I）；插件打包 esbuild 实际构建（本工作树无
   `node_modules`，只做静态校验）。
6. **`desktop/build-world-plugin.mjs`** 已加入 `godot-executor.cjs` 拷贝项，但
   无法在本工作树实际跑打包（缺依赖）。

## 7 首次失败、根因与修复（保留原始记录）

| # | 现象 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | `GODOT_BROKER_PREPARATION_FAILED`，broker 返回 `CreateAppContainerProfile HRESULT 0x80070057` | broker 用 `craftmine.godot.task.<taskId>` 作 AppContainer 名称，Windows 上限 64 字符；原 taskId 太长 | taskId 改为 `pf/im/ex-<24hex>`，并加 64 字符上限校验 |
| 2 | 检查页只有 160 字节 “Not found” | 核心返回 Win32 verbatim 路径 `\\?\D:\...`，Node `realpathSync` 拒绝，共享 Web 运行时对每个文件都用它 → 404 | 执行器与检查器统一把核心给出的根目录规范化（去 `\\?\`）后再交给运行时 |
| 3 | 语法错误作业停在 `interrupted` | core 对 `check` 作业要求至少一条断言，我的失败路径给了空数组，`finish` 被拒 → 租约过期 | 失败路径补 `runtime.not-run` 断言；实测同一作业变为 `failed` 并记录真实报错 |
| 4 | 快照断言“通过”但 `expectedHash:null` | `world.read` 把快照放在 `world.snapshot`，兜底路径读错字段，检查其实没比正式进度 | 读取 `record.world.snapshot`；修复后 `expectedHash==actualHash` |
| 5 | `isolated check observed real frames` 失败（frames=3, distinct=1） | 静止但正确的场景本就画出相同帧；引擎活性已由 `snapshot` 操作证明 | 取消“至少两帧不同”的通过条件，仅保留 3 帧非空 + 真实尺寸，`distinctFrames` 仍记录为证据 |
| 6 | 检查 30 秒超时 | 38 MB wasm 在软件渲染下首次启动超过 30 秒 | 检查预算可配置（默认 30 秒，验收用 180 秒）；未放宽任何断言 |
| 7 | Electron 在检查窗口销毁后提前退出 | Electron 默认在所有窗口关闭时退出 | 验收宿主保留进程；产品路径主窗口常驻，不受影响 |
| 8 | 硬杀 broker 后可能留下引擎子进程 | broker 被强杀时 Job 句柄未必来得及回收子进程（协议已注明“不保证清理”） | 执行器在每次非成功回包后读取 broker 记录的 `process-verification.json`，按记录镜像名核对并在必要时 `taskkill /T /F` 该 pid，把结果记入 `status().reaps`；验收断言记录 pid 已消失 |

首次失败日志：`evidence/full-chain-electron.log`、`evidence/failures-electron.log`
（含修复后重跑）；`load-probe.log` 保留“Not found → ready”的页面状态对比。

## 8 给 R1/R2/R7 的接入方法

见 `INTERFACE_C.md`（同目录）。摘要：

- R1/R2：`godotExecutor.status` 只读查询；`runtime_info.godotBuildAvailable` 已改为实时值。
- R2：在 `main/index.ts` 注入 `craftmineGodotCheck`（`new GodotBuildVerifier({deadlineMs})`）；
  首次加载/候选检查契约见接口文档第 3 节。
- R7：`world-tools.cjs` 在 `godot_build_start` 返回后调用 `enqueue`；取消用
  `godot_build_cancel` → 执行器自行收敛。
- 构建入口：`desktop/build-world-plugin.mjs` 已包含新模块。

## 9 证据清单

| 文件 | 内容 |
| --- | --- |
| `evidence/full-chain-report.json` | 正常链路 23 项检查、运行检查完整证据、执行器日志 |
| `evidence/full-chain-electron.log` | 同上原始 stdout/stderr |
| `evidence/failures-report.json` | 失败/取消/中断/恢复 27 项检查与核心状态、子进程核验记录 |
| `evidence/failures-electron.log` | 同上原始 stdout/stderr |
| `evidence/executor-protocol.log` | 协议级 15 项单元原始输出 |
| `evidence/load-probe.log` | 导出页在隔离窗口中的 ready/coi/canvas/引擎事件（真实呈现） |
| `evidence/load-probe-empty.log` | 空导出页的负向对照：`game=undefined`、无 canvas、`waitReady ok=false` |
