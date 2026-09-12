# FB02 地面颜色运行时复查（2026-09-12）

用户再次验证 `Craftmine-World-portable-2dc7748e570a` 后反馈地板颜色没有变化。此反馈有效，不能用“包内源码已更新”证明旧世界已经更新。

## 根因与证据

- 只读检查玩家保留世界 `world-e2b39ed23ff7`。其 `scripts/creation_world.gd` 的完整 SHA256 为 `f599887d0ebe4c17c37fec16ac8821d1e0f97da2cbac88758ae71870c2d5ce9a`，仍使用地板 `6e9580`、环境光能量 `0.7`。
- 新模板是地板 `4f6b5a`、环境光能量 `0.55`。现有世界拥有自己的源码和已校验正式构建；换应用 ZIP 不会重写它们。
- `_update_time()` 在中午给出太阳能量 `1.1`。材质为受光 StandardMaterial3D，叠加蓝色环境光后，旧地板实际渲染接近亮青白色；仅看 albedo 色值不能代表屏幕效果。
- 当前模板相对这个精确旧 stock 脚本只改变 HUD 快捷键说明与上述两项亮度配置，没有改变世界进度、几何或玩法。

## 实际渲染验证

命令：`CRAFTMINE_GROUND_SOURCE` 指向上述保留源码目录，运行 `node tests/creation-ground-web.mjs`。

测试只读旧脚本，复制到独立测试世界，由锁定的 Godot 真实导出 Web PCK，在独立 headless Chromium/SwiftShader 中执行真实 WebGL。初始化禁用 Pointer Lock 和 window.focus，未模拟鼠标键盘。

证据目录：`test-results/creation-ground-GI6hel/`。

| 地面下方固定区域（139,008 个像素） | 旧 stock | 当前模板 |
| --- | --- | --- |
| RGB 均值 | 194.98 / 255.00 / 244.63 | 138.12 / 191.94 / 170.81 |
| 亮青像素比例（G > 240 且 B > 220） | 100% | 0% |
| Pointer Lock / 置前请求 | 0 / 0 | 0 / 0 |
| 页面脚本错误 | 0 | 0 |

`retained.png` 复现用户图片中的亮青地面；`current.png` 为明显柔和的绿色地面。前后 gameplay snapshot 完全一致。

这是同相机、同时间、同内容的实际渲染验证；并非已发布 Windows 包端到端验收，也不代表已对玩家世界完成迁移。

## 保留世界的安全迁移边界

新增 `electron/main/creation-ground-upgrade.ts` 提供 host-only 计划器：

1. 仅接受发行过的完整旧 stock 脚本 SHA256（LF / CRLF 两种），不信任项目自己声明的 managed-base 哈希，不按颜色文本猜测是否 stock。
2. 自定义脚本不改；计划器要求操作的分支清单与正式源码一致。启动编排器从正式内容另建稳定命名的 `host-ground-*` 分支，因此玩家主分支上未采用的草稿可以完整保留，不必阻塞本次修复。
3. 计划只替换 stock 脚本，保留所有其他文件及完整清单；目标资源也以精确 SHA256 固定。
4. `creation-ground-maintenance.ts` 已编排独立 core turn、内容 Git 事务补丁、候选构建校验及已有候选应用协调器，并在应用前再次核验全部源文件和主分支 head。失败重试只复用完整匹配的维护分支，不重写草稿；正式进度由已有协调器在应用前保存、试运行校验和提交。
5. 世界切换会中止维护；`stop()` / `stopAll()` 使用正常 `godotBuild.cancel` 取消其构建并关闭所属 core turn。不得直接覆盖旧 artifact、数据库、存档或原世界目录。
6. 计划器和编排故障测试合计 14 项通过，涵盖未采用主分支草稿、丢失补丁回复、错误候选分支、应用前源码变化、重试幂等和退出取消。启动接线及新 Windows 包仍须由总控单独验收，不能据此把反馈标成已解决。

## 真 Core 分支事务验证

`tests/creation-ground-maintenance-core.mjs` 使用已退出的 `test-results/desktop-native-fb02-gjdMTq` 测试副本，再复制到自己的独立 domain。`test-results/creation-ground-core-uPIgAz/report.json` 记录真实 Rust 与私有 host router 接受了正式内容分支创建、独立 turn、分页索引、单文件 Git 补丁和检查任务提交。

由于此测试未启动执行器，检查正常停在 `GODOT_EXECUTION_UNAVAILABLE`，没有应用。主分支 head、正式 appliedOid、完整 world 文档与进度均保持一致。另实测 `godotBuild.cancel` 接受真实任务并返回 cancelled。发现并修正了 turn 结束契约：取消必须传 `aborted`，不能传 `cancelled`。实际执行器构建与应用由桌面集成测试继续验证。

## 桌面检查中的调试器焦点污染

集成副本 `desktop-native-fb02-oJ0B9c` 的真实导出完成后，检查以 `GODOT_CHECK_FOCUS_LEAK` 拒绝应用。原始结果显示 guard 的 focus / pointerLock 都为零。排查发现审计脚本使用 Playwright 默认 `connectOverCDP`，该版本会自动对每个页面启用 `Emulation.setFocusEmulationEnabled(true)`，使隐藏验证页面的 `document.hasFocus()` 变为 true。

新增 `tests/fb02-cdp-focus-isolation.mjs` 以真实隐藏 Electron 窗口进行 A/B 对照，证据 `test-results/cdp-focus-bkU37z/report.json`：默认 CDP 连接使 document focus 从 false 变为 true，而 native focus、可见性、可聚焦性始终为 false；使用 `noDefaults:true` 后 document focus 始终为 false。

因此仅修改审计脚本连接参数，保持产品的焦点守卫原样。维护失败信息增加保留具体 reason / error，以及 Core 返回的失败断言；故障测试合计增至 15 项通过。
