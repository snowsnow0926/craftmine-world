# R1｜把核心和 Git 历史真正接通

建议交给：原 A 或 M，选一位。优先级：最高。相对工作量：大（不是工期承诺）。

你负责最中幻想第二轮专项收尾。用户已授权开发；这次要把上一轮的实际缺口补成可使用的功能，不能只再次提交接口、适配草案或报告。

启动前只读：
- D:/Craftmine World/AGENTS.md，涉及 vendor/pi-desktop 时读其 AGENTS.md。
- 主目录 docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md，以及 VERSION_MANAGEMENT、ASSET_LIBRARY、CREATION_PACKAGE、COMMUNITY_PLATFORM、LICENSING_STRATEGY 对应计划（均在 docs/，以当前文件为准）。
- docs/dispatch-prompts/godot-round2-20260910/README.md 和本任务列出的上一轮交付报告。原 A01–A17 是 Godot 故事，V、AL-A、CP-A、CC-A 分别记账。

工作约定：
1. 优先由原负责人接续。涉及两个旧角色时只启动一位本轮负责人，另一位保持停止；不要同时恢复两个重叠任务。从最新本地 master 建唯一 codex/ 分支和独立工作树，再保留历史地合入下文列出的旧交付及所需已提交依赖。旧树只读，禁止重写、删除或清理它们。
2. C 仍独占自动执行器、私有插件服务、godot-build-verifier、godot-check preload 和相关构建入口；不接管、不修改 C 的工作树，不复制它正在变化的源码作交付。等其提交后按提交号消费。
3. 本轮 R1 独占 Rust main.rs/lib.rs/共享数据库登记；R2 独占 Electron main/index.ts、插件 view.mjs 和 App/导航；R7 独占模型工具及 manifest 的 agentTools，C 只改自己的后台服务声明。各自实现本模块代码，登记或接线由明确负责人实际落地并联测，最终不能只留未应用的 .patch 声称完成。
4. 主目录 README、总计划及现存未提交文档均属于其他工作，禁止覆盖或顺手提交。源码、用户数据、共享引擎缓存、旧工作树不作为临时清理目标。依赖只能只读复用，二进制按稳定副本和哈希记录。
5. 自动验证仅用独立 headless/offscreen 进程和独立测试目录，初始化禁用 Pointer Lock 和焦点抢占。禁止真实鼠标键盘、Playwright click/fill/mouse/keyboard、激活窗口、操作用户浏览器；禁止 tests/browser.mjs 和 tests/modules-browser.mjs。音频仅后台解码/离线验证。
6. 先给依赖方一个可消费的逻辑提交，再继续收尾。每个行为同步专属 spec/ADR/E2E；vendor 文档/注释与提交信息用英文。报告放 docs/dispatch-reports/godot-round2/<编号>/，测试放 tests/godot-round2/<编号>/。
7. 依赖缺失先核查它的最新提交和报告，不能继续引用上一轮已经过时的阻塞理由。接口实现与实际调用方联合验证，测试实例不能手工登记为“已通过”绕开正式路径。真实模型不能由作者样例替代。
8. 保存原始失败、最终输出、源/引擎/构建/数据身份和每项证明范围。进程级等待只依据实际句柄/进程终态；日志暂时不更新不是已经结束，不重复启动同一作业。
9. 分别报告模块验证、正式产品接线、真实模型、发行与手感。未完成保留为未完成，不删断言、不填造用量、不过度声明。不推送、不部署外网、不购买服务或额度、不替换用户客户端。
10. 交付干净分支、逻辑提交、实际联测命令和原始证据、仍需外部输入的具体项。主任务统一最终合并；每个 task 完成不等于 GD/VM/AL/CP/CC 总计划全部完成。

## 本轮任务

继承 A=7906c5b、M=de9f4b0。旧树分别为 D:/Craftmine World-worktrees/godot-remaining-a-20260910 与 godot-remaining-m-20260910。报告在各自 docs/dispatch-reports/godot-remaining/A/REPORT.md、M/REPORT_M.md。A 的 128 项测试是其版本证据；M 当前交付树没有 content_history 模块登记，不能拿临时接线的 152 项当交付树结果。

你独占 craftmine-core 的 godot_*（包括 godot_storage）、worlds/workspaces/recovery、content_history、main.rs/lib.rs 及共享登记。asset_catalog 由 R6 写，library/packages/reuse 由 R4 写，backups 及完整归档由 R5 写。你只维护唯一共享引用模块；R6 修改其 asset_catalog 消费者，不由你同时修改。Git 历史界面由 R2 实现，你提供实际查询、操作与状态。

本轮必须完成：
1. 正式编译登记 M 模块，把现有 Godot 工程读写接到唯一 Git 内容历史；旧修订/资产 API 做迁移兼容，禁止继续生成第二套事实。补真实 RPC、单分支写租约、预期 HEAD/素材锁校验和过期候选。
2. 与 R6/R4 逐项比较现有两份 contract，冻结唯一共享 AssetRef/ContentRef/BuildRef/ProgressRef/OperationContext 及素材锁、七类包引用测试向量；消费者都运行同一向量，不能只是改文档宣布一致。
3. 将首个 Godot 世界初始化、构建、首次加载确认、正式应用接通 C/R2/R3。只能在真实检查及加载确认后可游玩，失败保留可恢复创建记录。
4. 应用和恢复旧内容必须保持最新正式进度；补声明式迁移接入与确定的回退路径。修复 saveProgress 可接受无实际应用记录的自述构建问题，同时保留受管理的初始化路径，不能为测试开放通用例外。
5. 验证 Git 引用、SQLite、素材、实例切换每个持久边界的崩溃恢复及回包丢失；迟到结果不复活，重复操作不重复应用。保留原历史，内容恢复与游玩存档恢复分别操作。
6. 将累计模型账目/恢复接到 durable 和 R7，未知值保留；将长期配额与 R5 的引用保护/回收作业接通。新任务不能清掉累计历史。
7. 为 R4/R5/R6 实际落 RPC 与迁移登记，交稳定二进制和源码哈希给 C/R2/R8。随包 Git 的版本/来源由你和 R9 联合固定，正式交付不能依赖 PATH 回退。

结束条件：使用默认构建命令即包含所有已接模块；真实 RPC 中创建两个分支、修改/重启/恢复成立；联合 C/R2 完成至少一个真实 Godot 世界的首次应用及继续修改，完整状态与源码身份可追溯。未联测不能写“初始化已全完成”。
