# Godot 第二轮交付审计与下一步｜2026-09-10

**结论：这一轮有实质进展，但还不能按“只剩 R2”安排收尾。** R1、R3–R9 均有干净的交付分支；其中仍有未接入产品的能力，以及安装格式、备份恢复、预览取消等需要修复的问题。下一步应集中做集成和缺陷修复，再进行真实模型与安装包验收。R2 继续工作，高阶能力和社区暂不占用这批关键人力。

本次检查日期为 2026-09-10（北京时间），03:17 的准确源码与工作区状态见 [snapshot.json](snapshot.json)。主线为 `bcebeb1`，这些产品交付尚未合入主线。R2 `451033b` 有 9 个已跟踪文件修改及 1 个新测试文件，属于正在进行的工作；报告中的旧阻塞已按实际源码复核。

本次做了 Git/源码审计、既有原始证据核对、关键产物哈希复算和无副作用的内存反例。没有重跑完整产品测试、调用付费模型、修改产品代码、停止其他任务或恢复暂停的 Goal。以下测试数字来自核对到的原始记录，不是本次重新跑出的结果。内存反例的原命令、返回值和证明范围见 [REPRODUCTIONS.md](REPRODUCTIONS.md)。

## 1. 用普通话看进度

| 任务 | 本轮确实前进的部分 | 距离可交付还差什么 |
| --- | --- | --- |
| C 执行器 | 真实构建、独立运行检查到候选的 23 项记录通过；失败/取消等 27 项通过 | 换用最终隔离器与新核心联合验证，修复进程回收身份校验，补产品调用 |
| R1 核心/Git | Git 已进入默认构建，25 个 content RPC；176 通过、2 忽略，33 条 RPC 无错误 | Git 内容版本与实际世界应用尚未形成完整事务；非 main 分支无法写入 |
| R2 客户端 | 预览、取消、应用、重启的原生候选测试 7 项通过；正在接素材导航 | 新世界首次构建到可玩、历史/素材/备份等正式通道还没全通，且有路径转换错误 |
| R3 底座 | 四底座原生生命周期、挖掘 45 项、场景安装 8 项 | 同版本产品验收缺失；实体身份可被覆盖，安装失败可能留下半成品 |
| R4 创作包 | 静态包实际带正文，可以在新目录往返；有安装规划器 | 资源锁格式冲突，门/宝箱实际进入草稿、跨世界复用和升级未完成 |
| R5 备份 | 归档现在真的带正文，来源原路径移名后可恢复；专项 10 通过、1 忽略 | 进程崩溃和回包丢失恢复、目录归属核验、正式回收保护及最新 Git 世界恢复仍缺 |
| R6 素材 | 素材 UI、目录、图片/WAV 解码和原始测试证据已补 | 生产服务未完整接通，重试/取消会与核心状态规则冲突，模型真实画面/OGG 解码未交 |
| R7 模型工具 | 92 项逻辑、9 项真实核心记录；35 工具的插件确已构建 | 实时采样与预算未注入正式调用，三次真实压缩后继续创作未验 |
| R8 模型验收 | 已有真实 PI 模型通过插件和核心写源码的记录 | 仍是源码级检查，执行器报告不可用；冻结的运行时故事未通过 |
| R9 发行 | 许可材料、Git 文件和证据索引整理可追溯 | 安装器仍是旧文件，没有带上新 Godot/模板/broker 和本轮功能，需重新构建 |

R5 的正常恢复、R8 的真实模型调用都比上一轮前进了，不能继续写“备份只有清单”“真实模型调用为零”。同样，模块测试通过也不能替代整个游戏可玩、存档可靠和安装器完整的证明。

## 2. 先统一正在联调的版本

R2 当前是主要的客户端集成树。它已经包含 R1、R4、R5 的交付；R8 又包含了 R2 的该次提交。但还缺以下内容：

| 来源 | R2 相对该交付还缺什么 | 处理 |
| --- | --- | --- |
| C `f35c5c7` | 最后一项进程回收与导出失败修复 | 先修本报告第 3.7 节的身份问题，再合入 |
| R3 `cf4704f` | `bf48b25` 托管挖掘、`95de732` 场景物化、`6d8578b` 探针修复及报告 | 是真实功能差异，不能只同步文档 |
| R6 `6494874` | 最后的验证报告刷新 | 当前主要功能已进入 R2，避免重复搬代码 |
| R7 `bba7847` | 模型工具、实时观察、恢复和事实注入的功能提交 | 合入并实际注入服务，不能仅增加 schema |
| R8 `d726ec3` | 验收驱动与记录 | 集成代码稳定后消费，不以新增源码评分代替旧题集 |
| R9 `dc6e338` | 发行工具和材料 | 最后接入并从统一源码重建安装器 |

B 的最终隔离器 `5cf65eb` 尚需进入本轮联调。C 当前通过记录使用旧核心 `e462147` 和旧 `g6-sandbox` broker，broker 哈希为 `C9CD3496…15B331`，并非 B 最终记录的 `76932e69…2258`。这些测试有价值，但不能直接作为新核心、新 broker 的通过证明。

主任务应基于 R2 的已提交成果建立独立集成分支，保留所有贡献的历史；R2 的未提交工作继续由原负责人完成。不要直接修改 R2 树，不要把各树正在变化的二进制或源码复制成所谓最终包。

## 3. 需要先修的具体问题

### 3.1 R2：默认新世界流程有确定的断点

- [index.ts:923](</D:/Craftmine World-worktrees/godot-round2-r2-20260910/vendor/pi-desktop/apps/desktop/electron/main/index.ts:923>)把磁盘路径转换为 `file:` URL 后传给 `loadMaterializer`，而[加载函数:256](</D:/Craftmine World-worktrees/godot-round2-r2-20260910/vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation.ts:256>)再次调用 `pathToFileURL`。纯 Node 复现得到包含 `file:/D:/` 和双重 `%2520` 的错误路径，不能加载实际底座物化模块。统一参数为路径或 URL，并从真实主入口验证一次。
- [host-requests.cjs:86](</D:/Craftmine World-worktrees/godot-round2-r2-20260910/plugins/craftmine-world/host-requests.cjs:86>)尚无 `godotWorld.initialize/initStatus` 路由；当前 `main/index.ts` 未构造并注入 `GodotBuildVerifier`。工厂在[第 287 行](</D:/Craftmine World-worktrees/godot-round2-r2-20260910/vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation.ts:287>)调用初始化后就返回，没有接工程登记、首次检查与 firstLoad。测试直接调用核心的成功，覆盖不到这些缺口。
- 工厂[第 294 行](</D:/Craftmine World-worktrees/godot-round2-r2-20260910/vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation.ts:294>)对所有异常都删除物化目录。若核心已提交但响应丢失，会留下世界记录并删除源码。应先按稳定操作身份查询结果；只有证明尚未登记且目录属于该操作，才能清理。

出口：正式客户端从空白底座创建一个世界，完成首次检查、可游玩、一次修改与确认应用，再退出重开。首个流程不允许手工填入已应用记录。R3 已补的初始进度应直接消费，旧报告的缺少起始状态不能当永久阻塞。

### 3.2 R1：内容版本与游戏部署仍然分开

[content.rs:490](</D:/Craftmine World-worktrees/godot-round2-r1-20260910/vendor/pi-desktop/crates/craftmine-core/src/content.rs:490>)接受调用方的 `appliedOid`；[apply.rs:333](</D:/Craftmine World-worktrees/godot-round2-r1-20260910/vendor/pi-desktop/crates/craftmine-core/src/content_history/apply.rs:333>)核对 OID/Git 引用后即可标记 committed，没有读取对应的正式 Godot 应用和进度确认。RPC 记录中传入的 `host committed deployment` 是说明文字，不能证明游戏实际部署过。

另外，[godot_projects.rs:1072](</D:/Craftmine World-worktrees/godot-round2-r1-20260910/vendor/pi-desktop/crates/craftmine-core/src/godot_projects.rs:1072>)明确拒绝非 main 分支写入。两个分支能创建、能读，还不等于能分别修改并应用。

下一步：将 Git 内容、检查结果、最新正式进度、运行实例确认绑定到同一耐久操作；补分支写入、声明式迁移与回退，以及强杀/丢回包后查询原结果。保留原历史和玩家最新进度，不能用重建空世界规避恢复问题。

### 3.3 R4/R3：安装前先统一锁和实体身份

当前存在三种同名资源锁结构：R4 的[安装器:281](</D:/Craftmine World-worktrees/godot-round2-r4-20260910/vendor/pi-desktop/crates/craftmine-core/src/library/installer.rs:281>)生成 `direct/closure` 字符串数组；R4 自己的[校验器:439](</D:/Craftmine World-worktrees/godot-round2-r4-20260910/vendor/pi-desktop/crates/craftmine-core/src/library/package_format.rs:439>)要求对象；R1/R6 共用结构则使用 `assets` 和固定内容哈希。内存反例分别产生 `LOCK_DIRECT_REQUIRED` 与 `OBJECT_REQUIRED`。

R3 的[场景物化器:140](</D:/Craftmine World-worktrees/godot-round2-r3-20260910/desktop/godot/shared/scene_materializer.mjs:140>)先写新实体身份，[第 150 行](</D:/Craftmine World-worktrees/godot-round2-r3-20260910/desktop/godot/shared/scene_materializer.mjs:150>)又允许 overrides 覆盖它。反例中用新 ID 安装并覆盖为旧 ID，规划仍返回成功，两个节点可具有相同身份。

还需处理[组件写入:353](</D:/Craftmine World-worktrees/godot-round2-r3-20260910/desktop/godot/shared/components.mjs:353>)逐文件修改造成的部分安装、已有文件未校验哈希，以及 Windows CRLF 的 `[input]` 识别。安装测试的原生 ERROR/资源泄漏应独立处理，不能仅以退出码和节点数量判全通过。

出口：唯一共享锁向量被核心、包和素材共同使用；门/宝箱实际进入草稿，经检查和应用后，在两个世界与同世界两个实例中保持独立；中途失败不留下半安装状态。

### 3.4 R5：正常错误回滚还不能处理进程突然退出

[portable.rs:1553](</D:/Craftmine World-worktrees/godot-round2-r5-20260910/vendor/pi-desktop/crates/craftmine-core/src/backups/portable.rs:1553>)先把正文移到最终位置，稍后才提交数据库；目前清理依赖函数返回错误。中间强杀会绕过回滚，重试可能被 `BACKUP_TARGET_NOT_EMPTY` 拒绝。恢复 operationId 尚无耐久回执，成功后丢回包也无法可靠确认。

[第 1108 行](</D:/Craftmine World-worktrees/godot-round2-r5-20260910/vendor/pi-desktop/crates/craftmine-core/src/backups/portable.rs:1108>)仅凭 `.portable-staging-` 名称前缀递归删除目录，没有核验归属。应拒绝未知目录，只按持久操作身份清理本任务拥有的暂存目录。

备份保护引用仍由测试手工转换后传给回收器；[godot_storage.rs:185](</D:/Craftmine World-worktrees/godot-round2-r1-20260910/vendor/pi-desktop/crates/craftmine-core/src/godot_storage.rs:185>)没有强制从正式备份 pins 汇总保护集。Git 回收同样需消费备份引用。Portable RPC 与恢复启动接线还未进入当前 R2 正式主入口。

现有成功样本正文约 15 KB；[Git 对象收集:674](</D:/Craftmine World-worktrees/godot-round2-r5-20260910/vendor/pi-desktop/crates/craftmine-core/src/backups/portable.rs:674>)会一次捕获全部可达对象输出，不能声明内存与归档大小无关。R5 自身没有最新 Git 后端世界，需在统一版本上恢复后继续调用 `godotProject.index/read/build`。

出口：持久恢复作业、归属核验和原回执查询成立；在不同持久边界强杀后均能继续或明确撤销；最新 Git 世界、素材及选定进度在来源不可读的新目录恢复后可以继续创作。

### 3.5 R6：预览重试和取消的状态不能只靠 UI

[asset-service.mjs:95](</D:/Craftmine World-worktrees/godot-round2-r6-20260910/plugins/craftmine-world/asset-service.mjs:95>)把完成操作 ID 固定为 `preview-${cacheKey}`。同一素材失败后重试，结果变化会触发核心 `OPERATION_CONFLICT`；重放相同旧结果则可能让新一次 begin 留在 pending。

[取消入口:108](</D:/Craftmine World-worktrees/godot-round2-r6-20260910/plugins/craftmine-world/asset-service.mjs:108>)只写取消状态，没有结束或淘汰旧 worker。核心完成接口也未将结果绑定到当前尝试，晚到成功仍可能覆盖取消。现有 fake core 服务测试覆盖不到正式幂等规则。

当前素材模块已进入默认库声明，但 R2 正式 `main.rs` 仍无 `asset.*` 分发，`createAssetService` 没有生产构造调用；成功的 20 项 RPC 记录来自临时登记构建。作品 `package.planInstall/formatCheck` 同样未正式登记。应分清模块编译、正式 RPC 和面板调用三层。

出口：每次尝试都有受信代际和独立操作身份；失败重试、取消后晚到结果、切世界均经真实核心验证；正式客户端可以导入、查看、取消和复用素材。

### 3.6 R7：服务参数和真实模型入口要接到同一版本

[main.cjs:60](</D:/Craftmine World-worktrees/godot-round2-r7-20260910/plugins/craftmine-world/main.cjs:60>)构造工具时未传入第六参数，[world-tools.cjs:107](</D:/Craftmine World-worktrees/godot-round2-r7-20260910/plugins/craftmine-world/world-tools.cjs:107>)所需 `sampleLiveState` 和预算因而缺失。请求 hook 已加入事实注入，但构造快照测试不证明连续三次真实压缩后仍能创作。

下一步在统一客户端注入真实采样、预算与域服务，绑定当前世界/构建/实例；用正式模型请求完成创建、观察、修改，以及三次压缩和一次重启接续。R8 已有真实模型调用，不能继续沿用“没有模型可用”的旧阻塞。

### 3.7 C/B：进程回收要按完整身份核验

C 最新[reapTaskProcess:314](</D:/Craftmine World-worktrees/godot-remaining-c-20260910/plugins/craftmine-world/godot-executor.cjs:314>)读取记录后，只比较 PID 与映像文件名，再在[第 340 行](</D:/Craftmine World-worktrees/godot-remaining-c-20260910/plugins/craftmine-world/godot-executor.cjs:340>)执行 `taskkill /T /F`。它没有核对创建时间与完整路径；PID 被复用且进程同名时，可能终止另一任务的 Godot。这是代码可达风险，本次没有执行该路径或终止任何进程。

B 最终版已有带创建 FILETIME、路径、任务 nonce 和存活 broker 检查的 `recover`。应由 C 接这个经过验证的恢复入口，补同名 PID 复用、启动恢复及活跃任务不误杀的联合反例；不继续维护较弱的第二套清理流程。C 目前的正常链路通过可保留，但最新回收提交不宜未经修复直接进入发行。

## 4. 真实模型与安装包的证据边界

### R8：已经调用真实模型，仍未证明游戏功能

归档五次尝试报告分别记录 7、18、23、8、6 次模型调用，共 **62 次**。报告另述驱动修复期 15 与 18 次，目前缺对应归档；不能将 95 次全部称为完整可核验证据。14 条源码文件记录的字节数与哈希重新核对一致。

所谓最终规则下 1/3 成功，是新增 R15.1/R15.2 的源码启发式检查；原运行时断言与完整冻结故事仍未通过。[实际观察](</D:/Craftmine World-worktrees/godot-round2-r8-20260910/docs/dispatch-reports/godot-round2/R8/evidence/attempt-2-pass/evidence/R15.2/observation.json:57>)明确为 `GODOT_BROKER_MISSING`、`available:false`、`checked:false`。使用的插件只有 25 工具，没有 R7 新版的 `godot_jobs`，也没有 C 的最新修复。

下一轮应先跑一个真实需求：写源码 → 构建 → 独立检查 → 候选 → 正式应用 → 运行观察 → 再修改。通过后再扩大到冻结题集，补足完整核心 SHA、插件文件清单、准确构建源码身份、所有失败分母。不要继续在执行器缺失的环境消耗整批模型验收。

### R9：解包目录的整理没有进入安装器

证据索引 25 文件、随包 Git 385 文件的哈希均吻合，是有效交付。许可检查当前为 **0 failure、19 pending、exit 3**；从原先 67 failure 降到 0，部分源于 conditional 分类变化，并非所有权利事项已解决。

但 `Craftmine-World-Setup-0.14.3.exe` 的 SHA 为 `a7e194e7…872a3a5`，与原 batch07 安装器完全相同；旁边解包目录中新增 Git/许可材料没有重新进入安装器。包中核心、源码 ZIP 与[构建说明](</D:/Craftmine World-worktrees/godot-round2-r9-20260910/desktop/build/r9-restaged-preview/resources/source/build-manifest.json:3>)仍属于旧源码 `5ac3f1a`。

[release-manifest.json:254](</D:/Craftmine World-worktrees/godot-round2-r9-20260910/docs/dispatch-reports/godot-round2/R9/evidence/release-manifest.json:254>)的 broker 为 absent；Godot、模板和 bridge 条目指向外部缓存/仓库，没有包内路径。当前包内也未找到 Godot 引擎和 broker。因此不能接受报告中“固定工具链随包完成”的结论。

下一步必须从统一集成源码重建客户端和安装器，固定完整载荷，再运行同包 R8、首装/升级失败恢复、实际渲染和性能。当前 PACKAGE VERIFIED 的有限清单和旧包主循环测量不能替代上述验收。A17、独立游戏交付仍保留未完成。

## 5. 下一步执行顺序

| 顺序 | 工作与负责人 | 可以并行的部分 | 完成出口 |
| --- | --- | --- | --- |
| 1 | 主任务建立统一集成基线；R2 继续客户端；C/B 完成隔离器接入 | 合同修复和模块修复可以先进行 | 固定源码、核心、broker、引擎、插件身份，默认入口实际可调用 |
| 2 | R1 补内容/部署事务与分支；R2 补首次创建和 firstLoad | R5 可同时补耐久恢复作业 | 一个新世界从创建到游玩，再修改、应用和重开，进度保持 |
| 3 | R4+R3 修统一锁、身份和安装；R6 修预览尝试状态 | 两组按已有文件边界并行 | 门/宝箱真实安装复用，素材失败重试和取消不串状态 |
| 4 | R5+R1 接完整恢复、保护引用与回收 | R7 同时接采样、预算和正式模型 hook | 新目录恢复最新 Git 世界后可继续创作；崩溃不误删、不丢回执 |
| 5 | R7/R8 在该版本做真实创作验收 | R9 可提前准备清单和打包脚本 | 至少一条真正可玩的模型需求先通过，再覆盖冻结要求 |
| 6 | R9 重建安装器，R8 同包复验，主任务最终审计 | 许可未知项按实际缺项补材料 | 实际包包含新功能与工具链，安装/升级/恢复和说明一致 |

人力有限时，优先保留 R2，并安排核心事务、恢复可靠性与 C/B 联调；R3/R4/R6 的专项修复随后或利用独立人力并行。R8 暂停大规模重复调用，先修驱动环境并补证据；R9 暂不制作“最终通过”报告，等统一源码重建。R10 原提示词可以用于 B 的剩余边界收尾，范围应集中在当前实际问题。

目前尚有多个功能缺口和数据一致性问题，工作量不只是一次合并或最后几处 UI 调整；没有足够证据给出可靠完成百分比或剩余天数。先把上述前三条真实用户流程跑通，剩余工作量会更容易估计。

R11/L3-L4、社区 R12、AI 创作效率新计划继续保留。效率实验应以可执行的稳定链路为基础，不能用调整思考强度解释或替代当前工具接线故障。当前 Goal 保持暂停，后续实施按用户安排推进。

## 6. 原报告索引

- [C](</D:/Craftmine World-worktrees/godot-remaining-c-20260910/docs/dispatch-reports/godot-round2/C/REPORT_C.md>)
- [R1](</D:/Craftmine World-worktrees/godot-round2-r1-20260910/docs/dispatch-reports/godot-round2/R1/REPORT.md>)、[R2](</D:/Craftmine World-worktrees/godot-round2-r2-20260910/docs/dispatch-reports/godot-round2/R2/REPORT.md>)
- [R3](</D:/Craftmine World-worktrees/godot-round2-r3-20260910/docs/dispatch-reports/godot-round2/R3/REPORT_R3.md>)、[R4](</D:/Craftmine World-worktrees/godot-round2-r4-20260910/docs/dispatch-reports/godot-round2/R4/REPORT_R4.md>)
- [R5](</D:/Craftmine World-worktrees/godot-round2-r5-20260910/docs/dispatch-reports/godot-round2/R5/REPORT_R5.md>)、[R6](</D:/Craftmine World-worktrees/godot-round2-r6-20260910/docs/dispatch-reports/godot-round2/R6/REPORT_R6.md>)
- [R7](</D:/Craftmine World-worktrees/godot-round2-r7-20260910/docs/dispatch-reports/godot-round2/R7/R7_REPORT.md>)、[R8](</D:/Craftmine World-worktrees/godot-round2-r8-20260910/docs/dispatch-reports/godot-round2/R8/REPORT_R8.md>)、[R9](</D:/Craftmine World-worktrees/godot-round2-r9-20260910/docs/dispatch-reports/godot-round2/R9/REPORT_R9.md>)

上述索引用于追溯原结论；本审计不接受其中超出原始证据和实际源码的完成声明。R2 仍在变化，下一次集成应重新核对本报告列出的具体代码是否已修复。
