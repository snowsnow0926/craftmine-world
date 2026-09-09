# 任务 H 交付报告：许可、资源清单与打包预检

日期：2026-09-09。基线 `46739d2`（`docs(goal): record cycle three merge and deferred cleanup`）。

## 1 工作位置

| 项 | 值 |
| --- | --- |
| 分支 | `codex/godot-parallel-h-20260909` |
| 工作树 | `D:\Craftmine World-worktrees\godot-parallel-h-20260909` |
| 起点提交 | `46739d222ceefc654b596725c96288a4087993b3` |
| 工具提交 | `3a49d99`（本报告为其后的文档提交） |

未合并 master、未推送、未清理任何工作树、未运行安装器、未发布包。

## 2 交付物

| 文件 | 作用 |
| --- | --- |
| `desktop/delivery/preflight.mjs` | 可运行的只读预检 CLI：`notices`、`assets`、`lgpl`、`cache`、`export`、`package`、`all` |
| `desktop/delivery/lib/preflight-core.mjs` | 检查规则与哈希比对实现（可被其他工具复用） |
| `desktop/delivery/preflight-selftest.mjs` | 23 条正反用例自检，证明每条失败规则真的会触发 |
| `desktop/delivery/base-assets/{first-person,top-down,shared-web}.json` | 每个底座的素材来源、作者、版本、许可、再分发条件与固定哈希 |
| `desktop/godot/licenses/notices.manifest.json` | 离线声明清单（`craftmine.notices/1`），含内容断言与锁文件交叉核对 |
| `desktop/godot/licenses/README.md` | 用户可离线查看的许可入口说明 |
| `desktop/delivery/windows-lifecycle-acceptance.ps1` | A17 首装/升级/升级失败恢复/卸载/跨用户隔离验收脚本 |
| `desktop/delivery/README.md` | 工具用法、清单格式与限制说明 |
| `docs/dispatch-reports/godot-parallel/H/SPEC_H_ASSET_MANIFEST.md` | 素材清单规范 |
| `docs/dispatch-reports/godot-parallel/H/ADR_H_DELIVERY_PREFLIGHT.md` | 预检架构决策记录 |

工具是只读的：不下载、不运行安装器、不开窗口、不写被检查目录。

## 3 逐项工作结果

### 3.1 锁定 Godot 与实际模板的哈希、许可、版权及第三方声明

- 两个许可文件的实际哈希与 `toolchain.lock.json` 完全一致：
  - `GODOT_LICENSE.txt` `b0435e3b…5c80`（1149 字节）
  - `GODOT_COPYRIGHT.txt` `cb1980c8…4d6d`（100108 字节）
- 引擎缓存实测通过（读只读缓存 `desktop/build/godot/4.7.2-stable`，耗时 2.1 秒）：编辑器压缩包 86,013,866 字节、主程序 `ab1824f8…2424`、模板压缩包 1,281,349,702 字节、4 个模板文件、`version.txt` = `4.7.2.stable`、`unpacked-files.json` / `template-files.json` 与锁文件一致。
- 新增内容断言：MIT 正文必须出现 “Permission is hereby granted…” 与 “THE SOFTWARE IS PROVIDED "AS IS"”；即使把哈希改成与新文本一致，文本不对仍然失败（自检用例 3 证明）。
- 声明清单与锁文件双向交叉核对：任一侧被改动而另一侧未同步即失败（`LOCK_NOTICE_DRIFT` / `LOCK_NOTICE_UNDECLARED`）。

### 3.2 PI-Desktop LGPL 单独核对（不能用 Godot MIT 替代）

- `vendor/pi-desktop/LICENSE`（7652 字节，`e3a994d8…3118`）确认为 LGPL-3 正文并引用 GNU GPL；`desktop/UPSTREAM.json` 为 `LGPL-3.0-or-later`，上游提交为完整 40 位；`vendor/pi-desktop/Cargo.toml` 仍为 `LGPL-3.0-or-later`。
- 清单条目 `pi-desktop-lgpl` 带 `expectNone`：出现 MIT 授权句式即失败。自检用例 6 把 Godot MIT 文本替换进 `vendor/pi-desktop/LICENSE` 并同步哈希，仍然得到 `LGPL_NOTICE_NOT_LGPL`、`LGPL_NOTICE_IS_MIT`、`NOTICE_CONTENT_FORBIDDEN` 三个失败。
- 包内核对：`resources/licenses/PI-Desktop-LICENSE.txt` 必须与源码 LICENSE 字节一致，且必须有对应源码归档与声明文件；在真实包 `desktop/build/windows-preview-batch-06` 上实测通过。
- 记录一条待确认项（警告，不是失败）：`vendor/pi-desktop/LICENSE` 只含 LGPL-3 补充条款并引用 GPL-3，未附 GPL-3 全文。是否需要随包附 GPL-3 全文属法律判断，工具按事实报告，未替用户下结论。

### 3.3 每个底座的素材清单检查

- 三个清单覆盖 `first-person`、`top-down`、`shared-web`，共 18 个条目（含外部输入）。
- 事实核对结果：当前底座**没有第三方美术/音频/字体素材**。三个探针工程只引用 `res://world.gd`、`res://world.tscn`、`res://crosshair.gd`、`res://web_bridge.gd`，几何与准星都由代码生成；因此条目全部是项目自有源码与配置，加上引擎声明。
- 每个条目声明 `origin`、`author`、`version`、`license`、`redistribution`、`distribution`、`bytes`、`sha256`。自有代码的正式许可文本尚未定案，条目用 `outstanding` 显式记录，不允许“无许可且无说明”的静默状态。
- 失败规则：文件缺失、字节/哈希不符、底座目录出现未声明文件、许可缺失、需要通知却没有通知文件、引擎版本与锁不一致、`redistribution` 为 `denied`/`unreviewed` 却仍要分发或导出。

### 3.4 应用随包资源与用户可拆用/导出资源

清单用 `distribution` 区分三类，`preflight.mjs assets` 输出分组清单：

- `app-bundle`：随客户端分发（探针脚本、桥接、配置）
- `user-export`：允许进入玩家导出的独立作品（GDScript、`bridge.js`、`shell.html`、引擎声明）
- `development-only`：不得进入任何发行物（`desktop/godot/web/host.mjs`，仅 GD0 测试用）

规则上，`user-export` 与 `app-bundle` 都要求 `redistribution` 不是 `denied`/`unreviewed`；`user-export` 额外要求许可明确指向通知文件。

### 3.5 离线许可入口、可重建构建清单、失败检查

- 离线入口：`desktop/godot/licenses/` 提供两个固定文本 + 机读清单 + 中文说明，全部离线可读；预检要求包内存在 `resources/licenses/`、LGPL 副本、`CRAFTMINE-NOTICES.md`、字体许可与第三方清单。
- 可重建构建清单：预检校验包内 `resources/source/build-manifest.json` 的每个产物哈希，并检查 `vendor/pi-desktop/pnpm-lock.yaml`、`Cargo.lock`、`toolchain.lock.json` 等重建输入存在；同时采集 Node/pnpm/Cargo 版本与提交时间进入证据。
- 条件式 Godot 义务：只有当包内**实际存在**引擎可执行文件时才要求 `resources/licenses/godot/` 与声明中提到 Godot MIT。当前锁文件状态为 `gd0-candidate-not-production-bundled`，真实包实测 `godotEngineBundled: false`，因此不误报也不放行。自检用例 22/23 证明“有引擎无声明”失败、“有引擎有声明”通过。

### 3.6 Windows 首装/升级/升级失败恢复/卸载/跨用户隔离

脚本 `desktop/delivery/windows-lifecycle-acceptance.ps1`：

- 默认（不带 `-Execute`）只输出环境要求并写入 `a17Status: not-verified`，不执行任何安装。
- 执行前硬门禁：必须同时满足 `-Execute` + 临时运行器标记（GitHub hosted runner，或 `CRAFTMINE_LIFECYCLE_ISOLATED=1` 且 `CRAFTMINE_LIFECYCLE_ROOT` 为绝对路径）+ 绝对 `-InstallDirectory` 位于隔离根内 + 配置目录不是 `%LOCALAPPDATA%\CraftmineWorld`。
- 步骤：静默首装并记录版本 → 写入合成进度 → 原地升级并校验进度字节不变、`upgrade-backups` 快照可被 `windows-upgrade-guard.ps1 -Mode Verify` 验证 → 持有 `pi.sqlite` 独占锁时升级必须被拒绝且安装目录与进度零漂移，并逐文件证明快照可回滚 → 静默卸载并保留进度 → 跨用户隔离（第二个账户目录必须存在且当前用户不可写，禁止出现机器级共享配置目录；缺第二个账户时记为未验证，绝不记为通过）。

门禁实测（均未执行安装器）：

| 场景 | 结果 |
| --- | --- |
| `-Execute` 但无隔离标记 | `ISOLATED_RUNNER_REQUIRED`，退出码 1 |
| 有标记但安装目录在隔离根之外 | `INSTALL_OUTSIDE_ISOLATED_ROOT`，退出码 1 |
| 有标记但把配置目录指向生产 `%LOCALAPPDATA%\CraftmineWorld` | `PROFILE_OUTSIDE_ISOLATED_ROOT`，退出码 1 |

**A17 本轮未验收**：当前会话没有独立 Windows 环境，未执行任何安装器。脚本交付的是可执行的门禁与步骤，不是通过结论。

### 3.7 与 I 对齐最终包体、构建时间、版本证据

- 预检的 `package` 检查消费 I 维护的 `build-manifest.json`（`craftmine.build/1`）与 `npm-inventory.json`（`craftmine.third-party/1`），并新增采集 `commit`、`sourceDate`、`appId`、`sourceArchiveHash`、`toolchain`、产物数、第三方包数与缺文本数。
- 预检的 `export` 检查消费导出流水线写入的 `build.json`（`buildId`、`engineVersion`、`bytes`、`files`）。
- 需要 I 确认的映射表与新增包内路径见 `INTERFACE_H.md`。

## 4 实际验证与原始证据

所有命令均在本工作树执行，读只读输入，不联网、不开窗口、不模拟输入。

| 验证 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 规则自检 | `node desktop/delivery/preflight-selftest.mjs` | 23/23 通过 | `evidence/preflight-selftest.json` |
| 全量预检（含 1.4 GB 引擎缓存、真实 Web 导出、真实 Windows 包） | `node desktop/delivery/preflight.mjs all --cache … --export … --package … --evidence …` | 6/6 通过，0 失败，19 警告 | `evidence/preflight-all.json` |
| 真实 Web 导出 | `prepareWebProbes` 使用固定引擎 headless 导出 | `buildId 40d7a6db…e165`，14 个文件，39,313,891 字节，引擎 `4.7.2.stable.official.ed1daf0bf` | `evidence/preflight-all.json` 的 `export` 检查 |
| 真实 Windows 包 | `--package desktop/build/windows-preview-batch-06` | 5 个产物哈希一致，796 个第三方条目，LGPL 副本一致，`godotEngineBundled: false` | `evidence/preflight-all.json` 的 `package` 检查 |
| A17 未运行 | `powershell -File desktop/delivery/windows-lifecycle-acceptance.ps1` | `not-verified`，未执行安装器 | `evidence/windows-lifecycle-not-run.json` |

预检 `all` 的 19 条警告中，17 条是自有代码许可文本待定案的显式 `outstanding` 记录，1 条是 GPL-3 全文是否随包的待确认项，1 条是第三方清单中无许可文本的条目数（按事实记录，不编造许可）。

## 5 未完成项与边界

1. **A17 未验收**：无独立 Windows 环境，未执行首装/升级/卸载/跨用户隔离。
2. 自有代码（创作核心、导出运行时、示例脚本）的正式许可文本尚未适用，条目仅记录 `outstanding`；`docs/LICENSING_STRATEGY.md` 的逐模块权利核对未完成。
3. Godot 引擎尚未进入发行包，因此“包内 Godot 声明”只做了条件化校验，没有真实通过记录。
4. 预检只证明字节与声明一致，不构成法律意见，也不判断某项许可是否适合特定商业用途。
5. 素材清单固定的是 `46739d2` 的字节。其他任务修改底座源码后，清单必须重新核对并更新 `bytes`/`sha256`/`reviewedCommit`；预检故意不提供自动刷新，避免未复核就“放行”新字节。
6. 未验证：硬件 GPU 渲染、可见窗口合成、玩家手感、真实模型创作。这些分别由其他任务与人工环节记账。

## 6 需要其他任务提供的接口

详见 `INTERFACE_H.md`。要点：

- **I（打包）**：引擎入包时提供 `resources/licenses/godot/{GODOT_LICENSE.txt,GODOT_COPYRIGHT.txt}`；保留 `build-manifest.json` 产物路径与包内路径的映射；把离线许可入口加入客户端界面；在 CI 中调用预检并保存 `--evidence`。
- **B/C（底座）**：改动 `desktop/godot/probes/**` 或 `desktop/godot/web/**` 后同步更新 `desktop/delivery/base-assets/*.json` 的哈希与 `reviewedCommit`，或通知 H 重新核对；不要在这些目录放生成物或缓存。
- **A（隔离）**：无需改动；预检不涉及隔离代码。
- **根 `.gitattributes`**：建议增加 `desktop/delivery/** text eol=lf`，使工具在 Windows 检出时保持 LF。当前 CRLF 转换不影响任何固定哈希（被哈希的 `desktop/godot/probes/**` 与 `desktop/godot/licenses/**` 已有规则），因此不是阻塞项。
