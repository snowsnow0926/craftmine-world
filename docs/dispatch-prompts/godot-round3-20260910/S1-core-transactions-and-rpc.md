# S1｜核心事务、分支创作、正式 RPC 与统一引用

新 agent；立即启动。继承 R1，承担 Rust 共享入口的唯一接线责任。

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

继承 R1=62a700f（旧树 D:/Craftmine World-worktrees/godot-round2-r1-20260910）以及 R2 的已提交集成历史。读旧 R1/REPORT.md、INTERFACE.md。默认 Git 登记已经完成，不从头重写。保留 R5/R6 已合入的模块声明。

你独占 craftmine-core 的 content.rs、content_history/**、godot_*、worlds/workspaces/recovery/durable/budget 相关核心实现、main.rs/lib.rs、共享 DB 迁移/启动登记和总回收。backups.rs/backups/** 归 S4，asset_catalog/** 归 S5，library/** 归 S3。唯一 contract 与跨消费者公共向量由你维护；消费者由各模块负责人修改。

## 必须完成

1. 统一 AssetRef/ContentRef/BuildRef/ProgressRef/OperationContext 和 craftmine.assets-lock/1，与 S3/S5 固定七类内容、版本及哈希转换。同名格式不能并存 direct 字符串、direct 对象、assets 三套语义。给 Rust/JS 正反向向量；旧数据显式迁移，未知格式拒绝，不能仅改报告宣称一致。
2. content.apply.confirm 不再接受调用者文字/OID 自证部署。将 Git 内容、SQLite 部署、检查结果、最新正式进度和可信运行实例确认绑定到一个持久操作。Godot 正式应用路径实际驱动内容状态，模型/页面不能授予检查或应用权限。
3. 实现两个方案分支分别修改、检查和应用；移除当前仅 main 可写的产品限制并保留任务分支绑定、写租约、预期 HEAD/锁与迟到结果校验。分支内容恢复与游玩存档恢复分开；不将地形等游玩进度并入 Git 文本合并。
4. 与 R2/S2 完成世界初始化的持久操作顺序：登记世界/源码、首次作业、检查、firstLoad、正式可玩。响应不确定按稳定 ID 查询；不能重试时又建一个世界，也不能删掉已登记世界的源文件。向 R2 交真实可调用的增量提交。
5. 补声明式状态迁移、确定回退、连续修改保留最新进度、Git 后端的世界复制/backupSnapshot。恢复旧内容后仍可读源码、构建和继续创作；不可兼容时保持旧实例。
6. 正式登记 content/asset/package/portable backup 等 RPC、迁移和启动恢复；S3/S4/S5 提供模块方法，你实际落 main.rs/lib.rs。与 S2 核对宿主白名单/参数，与 R2 核对使用入口，禁止临时登记测试后撤销。
7. 核心内部汇总世界、候选、草稿、活跃任务、分支、命名版本、迁移和备份 pins，再批准回收；调用方漏传/伪造 protectedBuilds 不能解除保护。你统一协调，S4 供 pins，S5 执行批准后的素材回收，Git 回收由你实现。正文写入、构建物化与回收并发不得误删。
8. 原任务 resume 与 discard 后另开任务分别支持；累计模型用量、预算和失败分类接 S6，压缩/重启不重置账目。随包 Git 与 S8 固定，正式运行不依赖用户 PATH。

## 必需验收与结束条件

- 默认构建具备完整已交模块；真实二进制经正式 RPC 跑公共锁向量和模块入口。
- 从实际客户端创建世界，在两个分支分别修改并应用；恢复旧内容后最新进度保持，继续修改成立。
- 在 Git/数据库/实例确认每个持久边界真正结束独立测试进程，重启、重试与丢回包均查询同一操作，不重复应用/发奖励，未提交候选不变正式世界。
- 最新 Git 世界复制及新目录备份恢复后可 index/read/build；漏传保护集、并发写入和回收不能删除被引用正文。
- 与 R2/S2/S4/S5/S6 联测，记录 S7 综合候选身份。176 项旧测试和 33 条 RPC 只能作回归基础，不代替上述流程。
