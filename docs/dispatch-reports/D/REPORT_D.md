# Agent D 完工报告

日期：2026-09-09。提示词：W2–W5 派工 v1 / D_GAMEPLAY_EXTENSIONS.md。

结论：**ready_for_integration**。玩法运行器和可复用样本已经完成一批可审查的实现，实际游戏与 Worker 测试通过；W4 整体尚不能宣称完成，Rust 作品安装应用、原生 Agent 与最终程序包需要 G/F 联合验收。

## 1. 用户能得到的功能

花有细茎和花瓣，草是薄叶片，均贴地且能穿行。提供可复用的树、花、草以及花园训练场示例，不往用户空白世界硬塞场景。

训练场包含真实生命值、训练枪、近战剑、弹药、换弹、死亡、奖励与吸血扩展。保存重开后，冷却、换弹、奖励和扩展次数会继续保留。已发现并修复“重开就重复执行启动奖励”的问题。

需求检查中的“攻击”现在真的执行射线命中、伤害和扣弹，墙后的靶不会受伤。桌面可以接收实际选中对象的世界和版本信息；G/C 仍需连接可信桌面上下文。

## 2. 任务完成情况

| 验收项 | 状态 | 证据与实际范围 |
| --- | --- | --- |
| 花草和可复用组合 | 通过 | examples/dispatch-d；实际画面 garden.png，所有花草无碰撞 |
| 生命/近战/射击真实状态 | 通过 | headless-final.json：命中、未命中、遮挡、射程、冷却、无弹、装填、死亡 |
| 状态迁移和进度保留 | 通过 | targeted-final.log：兼容迁移、拒绝不兼容、旧存档兼容；实际重开保留生命/背包/扩展次数 |
| 启动/重启不重复奖 | 通过 | 预览、保存重开、击破后重开均实际检查；正式 Rust 回执链待集成 |
| 固定扩展新行为调用 | 通过 | 实际 Worker；可移植 creation 新实例重绑、验证、重开，缺依赖拒绝 |
| 评审断言执行 | 通过（范围有限） | selfTests 的实际沙箱轨迹执行评审断言，结果 advisory；未生成额外对抗场景 |
| ABI/权限/空实现/超时/释放失败 | 通过 | 定向逻辑与实际 Worker 反例；宿主进程正常结束 |
| 冻结回归 | 依赖未到 | 269/276；7 项均因新 extension-loader 与旧冻结 checksum 不符；未擅改清单 |
| 实际选中事件 | 部分通过 | 游戏实际 raycast 生成 world/build/object/revision；桌面旧版本拒绝由 G/C 接线 |
| A 真实 Rust 库安装/检查/应用 | 依赖未到 | 目前用既有 materializeCreation 安装并在实际游戏/Worker 中验证；不冒充 A 新接口 |
| 原生 PI 真实模型、程序包 | 未运行 | 留给 G/F 联合验收，不把固定样本当作模型创作 |

## 3. 改动与 Git 交付

- 工作树：`D:/Craftmine World-worktrees/parallel-d-20260909`。
- 分支：`codex/parallel-d-20260909`。
- 基线：dispatch/w2-w5-v1 / `2f71e128fd9ff9c49ee4e466138f4949b6bce862`。
- 冻结实现提交：`fb0883a73775c130145bc57fb04bff02569ce919`。
- `ec3c6471b69cf7880784121815171eb8937d3863`：实例启动、扩展状态、目标重绑与冷却保存。
- `1963e684bb8585c4cb27b3450e2f5376b14fe592`：评审断言在实际自测轨迹执行。
- `fb0883a73775c130145bc57fb04bff02569ce919`：物理验收、选择消息、组合样本与测试。
- 后续只提交本报告及证据；最终 HEAD 由交付消息给出，避免自引用。

修改文件完整列表见 DELIVERY。G 明确授权扩大 D 所有权至 world-runtime、extension-runtime 和 request-plan。无其他共享入口直接修改；冻结单项 hash 建议作为 integration.patch 交 G 审查。没有合并、推送、删除工作树。

## 4. 实际验证

下列命令工作目录均为本工作树。Node 24.14.0。headless 测试使用独立 Chromium profile，HTTP 随机端口与实际游戏页面；没有启动 Electron EXE。

| 类型 | 命令 | 源码与结果 | 原始证据 |
| --- | --- | --- | --- |
| 定向逻辑/契约 | `node --test tests/dispatch/d/runtime.test.mjs tests/extension.test.mjs tests/extension-dispatch.test.mjs tests/behavior.test.mjs tests/creation.test.mjs tests/state-migration.test.mjs tests/modules.test.mjs tests/desktop-domain.test.mjs` | fb0883a；65/65，约 0.50 秒 | docs/evidence/dispatch/D/targeted-final.log |
| 实际 headless 游戏/Worker | `node tests/dispatch/d/headless.mjs` | fb0883a；27/27，约 3 秒；每个产品文件 SHA 已记录 | headless-final.log / headless-final.json / garden.png |
| 领域全量 | `npm test` | 冻结实现前工作树：269/276；7 项均因冻结清单尚未接受 loader 改动 | domain-regression.log；G 更新清单后须复跑 |
| 初次 headless | 同上 | 已通过 17 项后，测试错误地在浏览器 import Node 模块，修正测试分层后通过 | headless-failed-browser-import.json |
| 桌面应用额外测试 | `node --test tests/desktop-application.test.mjs` | 未通过启动：缺少 desktop/build/craftmine.world/applications.cjs | 构建依赖未安装，本项不记通过 |
| 桌面插件构建 | `node desktop/build-world-plugin.mjs` | 未完成：本工作树缺 esbuild；NODE_PATH 尝试也未解析到依赖 | 未产生可测试桌面包，G/F 统一构建 |

针对上一次 Node 导入错误的失败证据保留；首次编写定向用例时还修正了测试源码括号、origin build hash 和严格 frame 字段错误，均未改动断言目标。最终 headless 无页面错误、无 Pointer Lock 或焦点请求。测试仅通过受信页面脚本/HTTP/真实游戏消息验证，不模拟鼠标/键盘。

本次未使用临时共享文件 overlay。integration.patch 只是建议，未应用；不能将 269/276 写成完整绿色。

## 5. 真实模型与资源消耗

未调用真实模型。模型调用数 0，压缩次数 0，无 provider usage；未读取用户密钥或改模型配置。测试场景是固定源码。没有改动端口 8787、用户浏览器、个人 `.craftmine` 或 D:/pi。

## 6. 接口与依赖

详见 INTERFACE_D.md。A 保留新生命周期和 extension state 字段；扩展源码/targets 为固定的作者本地空间，由运行器重绑，不应被安装器全文改写。C/G 在 load 提供 worldId 并校验来自游戏的 selection；F 使用真实 attack/equip/reload 与有界 yaw/pitch。

G 审查 `app/harness/extension-loader.mjs` 后，可应用 integration.patch 更新一个冻结 checksum。旧值 a76d414e…，新值 202de91c…。自测真实结果及反空实现没有放松，冻结断言解释器完全未修改。

## 7. 数据迁移、取消与恢复

新字段是旧存档格式的兼容扩展。已有模块恢复时缺 initialized 视为已启动，避免重复发奖；新建实例视为未启动。状态版本迁移保留标记、背包与旧世界；不兼容扩展版本拒绝载入。Worker 被释放后晚到结果不会再写入行为状态；异步 dispose 拒绝被接管。

输出和 profiles 保留在工作树 test-results/ 中；可审查证据复制到 docs/evidence/dispatch/D，没有包含 Chromium profile、世界个人数据或凭据。

## 8. 尚未完成与风险

1. G 审查冻结 loader 变更并更新清单，随后跑完整回归。
2. A/G 用真实 Rust 作品 capture/prepareInstall 和既有草稿/应用事务安装 garden-training@1，F 用最终原生程序复验重开，不只用 materializeCreation 夹具。
3. C/G 处理正式世界 load.worldId 与旧 source/nonce/build/revision/object 拒绝，F 验证世界切换不串选择。
4. 评审断言只在既有 selfTests 轨迹执行。需要额外对抗输入时要增加真实测试场景，不能把尚未执行的断言宣称通过。
5. 多扩展命令仍逐条应用；同一事件后续命令失败，不回滚先前已应用命令。模块会停止并留错。本批解决重启重放与状态丢失，但不宣称所有扩展命令已具备整步原子性。
6. 扩展状态版本变化没有通用迁移语言；目前安全拒绝，保留旧存档。旧存档缺少 initialized 时无法判断历史上尚未激活的草稿模块，优先避免重复奖励。

W2 的原生自动创作/跨会话复用、W3 的真实压缩、W4 全部玩法与应用事务联合验收、W5 交付门槛仍需各组集成。本组不修改全局完成状态。

## 9. 复现与交付物

同机直接审查上述分支的三个实现提交；从统一基线依次 cherry-pick 即可。无需新增 JS/Rust 依赖运行 D 定向逻辑；headless 复用已有 Playwright/浏览器只读安装。真实桌面构建先在 vendor/pi-desktop 安装锁定依赖再统一构建。

报告、接口、DELIVERY、冻结单行建议补丁及 evidence 均在 docs/dispatch-reports/D 和 docs/evidence/dispatch/D。DELIVERY 列出 SHA256。严禁运行 tests/browser.mjs 或 tests/modules-browser.mjs 等历史真实输入测试。
