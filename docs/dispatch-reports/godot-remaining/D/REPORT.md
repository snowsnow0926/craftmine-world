# D｜预览应用、世界画面与保存生命周期（2026-09-10）

分支：`codex/godot-remaining-d-20260910`（基线 `e462147`）。
工作树：`D:\Craftmine World-worktrees\godot-remaining-d-20260910`。
主目录 `D:\Craftmine World`、`test-results/g6-host` 及其他工作树只读，未修改。

任务标识（待主任务统一编号）：`CRAFTMINE-GODOT-REMAINING-D-01`。
ADP：`vendor/pi-desktop/docs/adr/0319-godot-candidate-native-host.md`（0318 已被
`godot-integration-audit-contracts.md` 占用，故顺延）。
规格：`vendor/pi-desktop/docs/spec/godot-candidate-native-host.md`。

## 1 接续的只读成果

`test-results/g6-host` 的未提交成果按文件哈希接续到本分支（仅我独占范围 + 我的测试目录）：

| 源文件（g6-host） | 源 SHA-256 | 本分支位置 |
| --- | --- | --- |
| `.../main/godot-runtime-adapter.ts` | `29374C60…A2E16C` | 同路径 |
| `.../main/godot-world-view-host.ts` | `59685744…D8D9496` | 同路径 |
| `.../main/godot-candidate-coordinator.ts`（新增） | `80D7DDDA…B3D6F` | 同路径 |
| `docs/spec/godot-candidate-native-host.md` | `D0BB46F6…1997A5` | 同路径 |
| `docs/adr/0318-godot-candidate-native-host.md` | `A11013CD…973B82` | 改号 `0319-…` |
| `tests/godot-candidate-coordinator.mjs` | `CE32E81A…ED2E` | `tests/godot-remaining/D/` |
| `tests/godot-candidate-host.mjs` | `D46EDC2A…9AC9D` | `tests/godot-remaining/D/` |
| `tests/godot-candidate-native.mjs` | `44B95ACE…9DB3` | `tests/godot-remaining/D/` |
| `tests/godot-candidate-typecheck.mjs` | `A89AFE8E…7AD3` | `tests/godot-remaining/D/` |
| `tests/godot-candidate-native/main.mjs` | `C129CC6E…C77D` | `tests/godot-remaining/D/godot-candidate-native/` |

未接续（属其他负责人或共享文件）：
`electron/main/index.ts`、`plugins/craftmine-world/view.mjs` 只提取接线片段（见 `snippets/`）；
`vendor/pi-desktop/docs/spec/06-delivery/04-e2e-test-plan.md` 属主任务总表。

## 2 复现与定位（保留失败）

1. **原生候选测试首跑**（Electron 43.4.0 + 固定 E 导出 + 新构建 Rust）：
   `bootstrap` 探针 `render-process-gone reason=crashed exitCode=-1073741823`（0xC0000005
   访问违规），随后 `Godot runtime did not report ready`。证据：
   `evidence/native-crash-first.log`（第一次运行），并保留在本节说明。
2. **同环境重跑**：探针通过，`seed()` 在 `godotProject.patch` 处返回
   `WORLD_BUILD_CONFLICT`。证据：`evidence/native-blocked.txt`、
   `evidence/native-blocked-report.json`。
3. **host 层重复预览**（真实 Electron + 真实 Godot Web，无 Rust）：连续 8 轮
   `stageCandidate → discardCandidate` 全部 ready（5.9–6.7 秒/轮），未复现“第二次超时”。
   证据：`evidence/renderer.txt`、`evidence/renderer-report.json`。
4. **强制真实渲染进程崩溃**：候选启动中途 `forcefullyCrashRenderer()` 稳定复现“永不 ready”。
   修复前该路径只能等到 30–45 秒启动预算耗尽，抛出 `Godot runtime did not report ready`，
   既没有原因也没有 renderer 证据；这正是 g6-host 第二次失败日志呈现的形态
   （`g6-candidate-native-second.log`：只有一句 ready 超时，无 console、无 did-fail-load、
   无 render-process-gone）。

结论：**“第二次预览 ready 超时”不是可稳定复现的固定第二步缺陷**，而是
“启动失败无法区分、也无法诊断”的宿主缺陷在特定时序下的表现；真实渲染进程崩溃
在本机可复现，且原实现会把它伪装成无信息超时。已按此修复（第 3 节），
没有扩大超时、没有删除重复预览、也没有用纯逻辑测试替代真实引擎。

## 3 实现改动

### 3.1 启动失败快速失败 + 有界证据（`desktop/godot/web/runtime.mjs`、host）

- `runtime.abortStartup(reason)`：未 ready/未退出/未释放时拒绝 `waitReady()`；
  已 ready 的运行时不受影响，迟到事件不会覆盖已完成的启动。
- host 对 pending 实例的 `did-fail-load`（主框架）与 `render-process-gone` 立即调用
  `abortStartup`，不再等满启动预算。
- host 为每个实例保留有界证据：最近 40 条 renderer console、故障列表（load-failed /
  render-process-gone / renderer-destroyed）、以及该实例 HTTP 请求与状态。
  启动失败错误追加紧凑原因摘要（`fault=…; console[error]=…; requests=n/m`，上限 700 字符）。
- 新增 `host.diagnostics("formal" | "candidate")`，返回上述证据并绑定
  `worldId/buildId/instanceId`。它是渲染进程证据，不宣称视图可见、已合成或已试玩。

### 3.2 首个世界加载确认（不假装旧实例存在）

- `host.stageCandidate(request, {first:true})`：世界还没有正式运行实例时也能暂存首个实例；
  已有同世界运行实例时报 `GODOT_WORLD_ALREADY_RUNNING`。
- `host.promoteCandidate` 在 `previous === null` 时提升暂存实例（已实现，补测试）。
- 协调器新增 `firstLoad(worldId, candidateId)`（私有路由 `godot.candidateFirstLoad`）：
  读持久世界记录 → 用该记录 revision/完整快照 prepare → 校验 runner 精确快照 → 只提交一次
  → 重读正式描述符后才提升。已有正式构建时报 `GODOT_FORMAL_WORLD_EXISTS`；
  失败时发布 `instanceId:""` 的 failed 状态，回到可恢复的创建状态。
- `godot.candidatePreview` 仍要求正式世界（`GODOT_FORMAL_WORLD_REQUIRED`），
  新建流程改走上面的确认路径，不再是死循环。

### 3.3 保留的既有语义（未放宽）

候选独立实例/独立 session/独立 origin；取消恢复原实例；应用前丢弃预览、重新 checkpoint
最新正式进度、加载全新暂停实例、按完整世界/候选/构建/实例/输入身份核对回执；
提交回包丢失只按原 id 查询、不重复提交；提升失败两侧保留并进入不确定态；
正式世界切换仍先 checkpoint、新实例 ready 后才释放旧实例；隐藏面板/切模式/退出/插件重载
都走既有保存与清理边界。以上均未放宽冻结断言。

## 4 验证

| 验证 | 结果 | 证明范围 |
| --- | --- | --- |
| `tests/godot-remaining/D/godot-candidate-coordinator.mjs` | 18 通过 | 纯逻辑：预览/取消/应用/回包丢失/外来回执/并发互斥/过期回执/首载确认与拒绝 |
| `tests/godot-remaining/D/godot-candidate-host.mjs` | 12 通过 | 真实 host 类 + 确定性原生替身：保留原实例、阻止正式保存、提升校验、真实渲染崩溃与加载失败快速失败、有界且脱敏的诊断、首实例路径与重复首载 |
| `tests/godot-remaining/D/godot-runtime-abort.mjs` | 3 通过 | 真实 runtime host：`abortStartup` 精确拒绝未 ready 启动、不覆盖已 ready 实例、长度有界 |
| `tests/godot-remaining/D/godot-candidate-typecheck.mjs` | `diagnostics=0` | 严格 TS 检查 host/adapter/coordinator/preload（需本机依赖，见第 6 节） |
| `tests/godot-remaining/D/godot-candidate-renderer.mjs` | 16 通过 | 真实 Electron 43.4.0 + 真实 Godot 4.7.2 Web 导出：重复暂存、非零离屏视口、不遮挡正式视图、表面隐藏/恢复、真实渲染进程崩溃快速失败并保留原实例、renderer 诊断绑定实例身份、无 Pointer Lock/焦点请求 |
| `tests/godot-remaining/D/godot-candidate-native.mjs` | **阻塞** | 真实 Rust + Electron + 导出；被 `WORLD_BUILD_CONFLICT` 挡在 `seed()`，见第 5 节 |

原始输出：`evidence/coordinator.txt`、`evidence/host.txt`、`evidence/runtime-abort.txt`、
`evidence/typecheck.txt`、`evidence/renderer.txt`、`evidence/renderer-report.json`、
`evidence/renderer-diagnostics.json`、`evidence/native-blocked.txt`、
`evidence/native-blocked-report.json`、`evidence/native-blocked-renderer.log`、
`evidence/native-crash-first.log`。

### 4.0 提交前对抗评审与修复

由独立只读评审（code-reviewer）复核后修复：

- 启动被故障取消时 `pending` 未清空，会让该 host 之后一直 `WORLD_BUSY`（已修复并测试）。
- 协调器 `invoke` 在 `await` 之后才置 `busy`，两个并发页面调用可同时进入（已改为先占锁并加并发测试）。
- `stageCandidate` 对累积的 allowedRoots 逐个 `realpath` 无容错，任一旧构建目录被回收即全部失败（已与 `ensureInner` 一致地容错）。
- `close()` 中 `recover()` 抛错会把 `active` 永久留下（已改为进入不确定态、暂停并隐藏候选）。
- 已完成后被更晚构建取代的候选回执由抛 `GODOT_FORMAL_COMMIT_MISMATCH` 改为返回 `closed`。
- `godot.candidateFirstLoad` 原为页面可达路由，等于让页面绕过预览直接提交（已改为仅主进程方法 `firstLoad()`，不出现在 `invoke` 白名单）。
- `diagnostics()` 曾返回含实例 origin 令牌的原始 URL（已脱敏为 `/w/*/…`），并对 console/故障/请求长度与条数设上限；renderer 控制字符在进入错误文本前被剥离。

### 4.1 剩余 WebGL 警告及其影响（记录，不当作通过）

每次实例启动都会出现
`GL_INVALID_FRAMEBUFFER_OPERATION: glDrawArrays/glBlitFramebuffer: Framebuffer is incomplete:
Attachment has zero size.`（`evidence/renderer-diagnostics.json`）。它出现在引擎完成初始化之后、
`ready` 之前/之后的软件渲染（swiftshader）路径上，本机不阻止 ready，也不改变快照/回执；
但“可见合成与手感”仍属玩家环节，`visible=true` 不等于实际可见。修复方向（若需要）应在
呈现层给离屏候选真实合成面，而不是改断言。

## 5 阻塞与依赖（需主任务/A 处理）

**A（Rust 核心）— `godotProject.patch` 的构建来源校验未完成。**
连续修改已应用过的世界时：

- `workspace.open` 绑定 `base_build = world.build.id`（已应用后的新 build id），
- 而项目 manifest 仍保留创建时的 `base_build`（原始底座 build），
- `godotBuild.start` 已允许“lineage”例外，`godotProject.patch` 没有，
  且 `validate_manifest` 仍要求 `manifest.base_build == manifest.task.base_build`。

最小修复（A 负责，未提交进本分支）：`godotProject.patch` 接受
`lineage == manifest.base_build`，并把 manifest 与其任务绑定一致地重绑到当前 lineage，
使 `validate_manifest` 通过。仅放开第一个检查会继续在 `INVALID_PROJECT_MANIFEST` 失败
（本地临时补丁已实测：`evidence/native-blocked.txt` 之前的尝试）。A 已有对应修复时，
请用其版本重跑 `tests/godot-remaining/D/godot-candidate-native.mjs`。

**C（受管执行器/构建）**：原生用例的 executor/check 注册是测试夹具，不代表真实执行器
证明；最终同版本测试需 C 的真实产物与检查描述符。

**主任务**：`snippets/index.ts.patch`、`snippets/view.mjs.patch` 是共享入口/面板的最小接线，
请统一合并；`godot.candidateFirstLoad` 需按第 3.2 节接入初始化事务。

## 6 验证环境身份（可复现）

| 项 | 值 |
| --- | --- |
| Node | v24.14.0 |
| Electron | 43.4.0（`%LOCALAPPDATA%\electron\Cache\…\electron-v43.4.0-win32-x64.zip`，解压到 scratch） |
| Godot 导出 | `test-results/g6-bases/…/godot-runtime-native-qRqcMv/first-person/export`，`index.wasm` SHA-256 `F6090F055E16765BCEF5DC3A031F68AB40C151D9E7F0541D9D7EB61E92DC5051`（与 g6-host 实际使用产物逐字节一致） |
| Rust 核心（无补丁） | `vendor/pi-desktop/target/release/craftmine-core.exe`，4 244 480 字节，SHA-256 `8C20F3C3563735A60DA7ECD4DCF3887D775FEE828B9BD77D8774AF5B758D25A3`，2026-09-10 构建 |
| 本地依赖替身 | `node_modules/{esbuild,typescript,@types/node,electron}` 为指向本机 pnpm store 的 junction（gitignored，仅用于运行测试/类型检查） |

主目录旧二进制 `EF3C4E25…`（2026-09-09 13:27）**早于** Godot 完整进度提交
（`17ec6ba`/`8f4d496`，2026-09-09 23:06/23:17），不能用它跑本轮用例。

运行命令：

```powershell
$env:CRAFTMINE_ELECTRON_BIN="<scratch>\electron-43.4.0\electron.exe"
$env:CRAFTMINE_CORE_BIN="<worktree>\vendor\pi-desktop\target\release\craftmine-core.exe"
$env:CRAFTMINE_CANDIDATE_EXPORT="<fixed E export>"
node tests/godot-remaining/D/godot-candidate-native.mjs
```

## 7 安全与边界

所有验证使用独立 headless/offscreen 进程与独立 `--user-data-dir`，窗口
`show:false, focusable:false`，注入 pointer-guard preload 并拒绝全部权限；
未发送真实鼠标/键盘、未调用 Playwright 输入模拟、未激活窗口、未操作用户浏览器，
未运行 `tests/browser.mjs` / `tests/modules-browser.mjs`。渲染进程崩溃由
`forcefullyCrashRenderer()` 触发，不是用户输入。

## 8 未完成项与下一步入口

1. 原生候选端到端（预览→游玩→取消→应用→重启）仍被第 5 节 A 的来源校验挡住；
   入口：A 修复后用上面的命令重跑，预期覆盖预览隔离、取消保留原实例、
   提交回包丢失恢复、重启后完整进度。
2. 首载确认接口已实现并单测（协调器方法 `firstLoad(worldId, candidateId)`，刻意不作为页面路由），
   但尚未接入真实初始化事务（A/F/C 同版本）；入口：主进程初始化事务调用该方法。
3. 正式世界间切换“旧实例保留到新世界确认”的失败恢复仅有 host 单测；
   需与 E/F 的真实三底座同版本测试补齐。
4. 可见合成与玩家手感未验收（本报告只给出渲染进程与几何证据）。
