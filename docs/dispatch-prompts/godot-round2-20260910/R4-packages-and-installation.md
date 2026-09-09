# R4｜作品包真正安装、升级和跨世界复用

建议交给：原 H，或专责作品包 agent。优先级：高。相对工作量：大（不是工期承诺）。

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

继承 H=da41621 的已提交成果；只修改 packages/reuse/legacy/作品服务范围，backups 相关文件转交 R5 独占。读 H/REPORT_H.md、INTERFACE_H.md 和主目录最新 CREATION_PACKAGE_DEVELOPMENT_PLAN.md。旧报告承认 parts 只是声明与哈希，未写入 Godot 工程；这是你的产品安装职责，不归 I 验收负责人。

你独占 library.rs、library/packages.rs、library/reuse.rs、legacy 转换、library-service.mjs、新包 ZIP 编解码/安装器和作品专属 UI。N 原素材正文/预览归 R6，SDK/场景物化函数由 R3 提供，RPC 登记由 R1。

本轮必须完成：
1. 与 R1/R6 冻结 CP0 七类资源、craftmine.package/1 / resource/1、固定依赖和目录/哈希/重复键/Unicode规则，用相同 Rust/JS 向量验证，旧四类格式显式迁移不按名字猜。
2. 实现带实际正文的 ZIP 导入导出，覆盖 raw/data 静态包新目录离线往返；缺依赖、坏哈希、路径逃逸、同名冲突、链接和解压膨胀均拒绝。分享、完整备份、独立游戏是三种用途。
3. 真正把 module/object/scene 源码、场景、资源锁和实体映射安装进草稿，调用 R3 的物化器，经 C/R2 形成候选和正式应用；不能直接改正式世界或只登记数据库。
4. 自动门/宝箱两个世界复用、同世界两个实例只改一个、保存变体；v2 发布不自动改 v1。升级/卸载保留局部覆盖和兼容状态，处理 UID、输入动作、脚本类、任务/库存依赖冲突及一次性奖励。
5. 与 R1 的 Git 内容提交和部署事务接通，操作幂等、取消、晚到结果、失败回退实际测试；用声明式迁移保持进度，必要脚本迁移只走 C/R10 已验证路径。
6. 旧 Web 包/世界转副本保留原始字节/来源/检查未知，不支持脚本明确列出；CP3 玩家底座/世界包与 R3 SDK 联合登记，CP4 独立运行包交 R9，完整备份由 R5。
7. 实际登记 RPC/服务并由 R2 接作品 UI、R7 接模型工具；不能交一个待合入 match 片段后称功能完成。

结束条件：自动门和宝箱的创建、保存为包、全新数据目录导入、两世界独立复用、局部改动、升级保持状态全链路成立；包不依赖原机缓存、不带凭据或私有游玩进度。继续按 CP0–CP6 明确后续未验项，不能把少量包通过等同整个生态完成。
