# S2｜统一执行器、隔离恢复和插件正式服务

新 agent；立即启动。合并接手旧 C 与 B 的范围，避免两个清理器并存。

你是用户新分配的专项开发 agent，负责完成下述审计缺口。以实际产品可用和原始证据为交付，模块自测、正式接线、真实模型、安装包分别记账。

先只读以下资料：
- D:/Craftmine World/AGENTS.md；涉及 vendor 时读 vendor/pi-desktop/AGENTS.md。
- 主目录 docs/audits/godot-round2-20260910/REPORT.md、REPRODUCTIONS.md、snapshot.json。
- 主目录本轮 docs/dispatch-prompts/godot-round3-20260910/README.md，以及本任务列出的旧报告和代码。
- 主目录 docs/ 下 GODOT_MULTIBASE_DEVELOPMENT_PLAN、VERSION_MANAGEMENT_DEVELOPMENT_PLAN、ASSET_LIBRARY_DEVELOPMENT_PLAN、CREATION_PACKAGE_DEVELOPMENT_PLAN、LICENSING_STRATEGY 对应 .md，以当前原文为准。社区/AI效率计划只用于范围辨别，不在本轮扩展。

共同执行约定：
1. 从最新本地 master 建唯一 codex/ 分支和独立工作树；先消费 S7 的已提交综合基线，若尚未提供则保留历史地合入 R2 的已提交 2fa3c7c（或更新提交）和本任务依赖；S7 自身先从该 R2 基线起步。先核对祖先，不复制整个旧树、不改旧树、不重写贡献历史。旧角色已停止的范围由你接手；R2 原任务继续负责客户端，绝不覆盖它的未提交文件。
2. 主目录 README、总计划及其他现存未提交文档属于别的工作，禁止修改或顺带提交。旧工作树、用户资料、运行中的二进制和共享缓存不作清理目标。需要依赖时只读复用或用独立目录，记录固定二进制完整哈希。
3. 唯一入口负责人：S1 管 Rust main.rs/lib.rs、共享 DB 登记、唯一引用契约与总回收；S2 管插件 main.cjs/host-requests.cjs、私有服务构造及执行器；R2 管 Electron main/index.ts、导航、创建/预览/历史/恢复 UI；S6 管模型工具、agent-runtime 与 manifest 的 agentTools。专属模块/组件按本任务边界写。各方实际合入接线；未应用的 patch、临时登记后撤销的测试构建不能计为产品完成。
4. 先交最小可消费逻辑提交及调用示例，再增量实现；S7 分批集成并发布候选身份，不需要等所有人结束。接口缺失时核对最新提交、列精确责任和下一步，同时继续独立工作；不能重复沿用已解决的旧阻塞。需要语义修改的集成冲突由模块负责人修复提交。
5. 自动验证仅用独立 headless/offscreen 进程和独立测试数据，初始化禁用 requestPointerLock，保持窗口隐藏且不聚焦。禁止真实鼠标/键盘、Playwright click/fill/mouse/keyboard、窗口激活、用户浏览器操作；禁止 tests/browser.mjs 和 tests/modules-browser.mjs。音频仅后台解码/离线验证。
6. 原生测试只管理本测试可核验身份的进程；禁止按进程名或裸 PID 结束进程，禁止凭名称前缀清理未知目录。所有删除目标先验证绝对路径、归属和持久操作身份；失败保留证据。
7. 使用与改动相称的测试；保留首次失败、最终输出、准确源码/数据/构建身份。正常返回错误与进程突然退出分别验证；实际界面、真实模型与作者样例分别记账，不删断言、不清失败分母、不填造用量。未知能力和费用保留 unknown。
8. 每个行为同步专属 spec/ADR/E2E；vendor 代码、注释、文档与提交信息用英文。专项测试放 tests/godot-round3/本编号/，报告与证据放 docs/dispatch-reports/godot-round3/本编号/，不要争写总报告。
9. 所有最终验收从已提交、正式登记的综合源码构建。S7 负责综合基线/候选清单与独立验收，S8 负责实际发行物。单个模块必须参与消费者联合验证，不能把缺失实现转给验收者。阶段提交可交接，但未达到下述结束条件必须明确未完成。
10. 不推送、不对外部署/上传、不购买或重置额度、不覆盖用户安装。真实模型仅使用用户现有已配置服务，S7 统一安排批量验收，其余任务先联合一条实际需求。不要替主任务操作 Goal 或创建自动循环任务。

交付统一包含：干净分支与提交号、源/核心/broker/引擎/插件完整身份、正式调用入口、实际命令和可读原始证据、完成条件逐条结果、已定位但仍未解决项。仅报告“测试通过若干条”不构成交付。

## 接续与边界

继承 C=f35c5c7 和 B=5cf65eb。旧树分别为 D:/Craftmine World-worktrees/godot-remaining-c-20260910 与 D:/Craftmine World/test-results/godot-remaining-b。阅读 C/REPORT_C.md、INTERFACE_C.md，B 的 REPORT_B.md、INTERFACE_B.md、BROKER_PROTOCOL_V1.md。C 23 项正常、27 项失败记录使用旧核心/旧 broker，不能借给新二进制。

你独占 desktop/godot/sandbox/**、插件 godot-executor.cjs、main.cjs、host-requests.cjs、私有执行/检查服务、electron/main/plugin-runtime.ts、plugin-host-process.mjs、godot-build-verifier.ts、electron/preload/godot-check.ts、相关 electron.vite.config.ts 和 desktop/build-world-plugin.mjs。manifest 仅服务/后台贡献归你，agentTools 归 S6。Electron main/index.ts 的服务注入由 R2 实际落地，不能抢写。

## 必须完成

1. 接 B 最终恢复协议，替换 C 仅凭 PID+映像文件名的 tasklist/taskkill 路径。核验 PID 创建 FILETIME、完整映像路径、任务 nonce、broker 存活与目录归属；未知身份拒绝清理。同名进程、PID 复用、损坏账本和活跃任务都不能被误伤。
2. 在服务启动、异常退出、取消及重启对账中实际调用 recover；区分“无最终回包后回收”与“成功完成”。保持耐久任务、profile、进程和核心作业状态一致；同一作业不因观察等待超时被重复启动。
3. 固定最终 broker 协议与二进制副本、Godot/模板/bridge 身份，核对任务 ID/profile 长度边界。用 S1 综合核心重跑真实 import/export/独立 Electron 检查和取消恢复，不引用旧 g6-sandbox 二进制。
4. 正式落 godotWorld.initialize/initStatus、工程/作业/恢复、历史、素材、作品、portable backup 等必要私有路由。参数来自 S1 的实际接口与稳定操作身份，白名单最小化；不要为省接线开放任意 core RPC 给模型/页面。
5. 在 main.cjs 实际构造并注入 S5 素材服务、S3 作品服务与 S6 的采样/budget/恢复选项；接真实宿主采样桥和当前域服务。R2 在 main/index.ts 注入 GodotBuildVerifier 与宿主回调，你在 plugin-runtime/host-process 暴露匹配私有接口，双方联合验证。
6. 模型 build/enqueue/cancel、首个世界作业、运行检查、firstLoad 的可信证据完整串通。缺执行器/版本错误时准确说明并可恢复，普通源码草稿仍按正式能力允许处理；模型不得伪造检查记录。
7. 补独立游戏运行期异常、加载页/空画面/静态有效画面区分、快照恢复、崩溃/回包丢失与清理。保留原生错误；不能仅加超时或删断言解决失败。修复进程泄漏及失效 session。
8. 补本轮需要的资源与执行边界：源码导入、包脚本/预览、Git hooks/filter 不得获得宿主权限；仅用合成资源验证输入/剪贴板边界。采样限制与硬配额准确区分，既定未验要求保留，不更改全机策略。插件与检查 preload 实际打包，并核验调用入口存在。

## 必需验收与结束条件

同一 S7 候选的 core→最终 broker→Godot→独立检查→候选→R2 首次应用成立。真实测试覆盖正常、语法与运行错误、伪造回包、取消、broker/core 重启、启动恢复、PID 复用/同名进程及活跃任务保护；不得杀真实用户进程。证据绑定完整源码与二进制身份。模型、素材、备份正式服务都确有生产构造与调用，不留下待应用接线片段。
