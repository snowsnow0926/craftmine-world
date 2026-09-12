# 内置 Godot 开源资源复用：首轮筛选与试验

日期：2026-09-12。对应开发计划 GU6；工作树 `D:/cm-agent-godot-0912`。

## 结论

值得投入。现成资源最有价值的部分是已经配合工作的模型、材质、动画、控制器和玩法组件。Agent 可以从修改参数、组装场景和补齐规则开始，减少重复编写基础系统。实际能节省多少开发时间或模型调用，目前没有同需求对照数据，不能给出可靠百分比。

首轮已下载并固定 Kenney FPS、Kenney City Builder、Beehave 的源码版本，检查主要脚本、项目设置和许可。两个 Kenney 项目已通过现有 LPAC 执行器进行导入及 Web 导出，并在独立 headless 浏览器启动。FPS 已目视出现持枪视角、准星、平台和敌人；城市项目初次启动只有 UI 和空背景，追加测试副本调用原项目的样例加载函数后，已显示道路、建筑、树木和喷泉。城市样例可显示仍不等于可行走整城已经完成。

这些是开发者兼容性试验，未调用玩家模型，未通过普通玩家创作流程采用作品。没有替换现有世界、玩家控制器、任务协议或存档。普通玩家后续验收继续使用用户确认的 `deepseek-v4.1-flash-expires-on-0910` / `max`，不额外添加 token、模型调用或整轮时长限制。

后续进展：建筑和道路已抽成现有格式的独立源包，保留 GLB 外部纹理、原许可和来源摘要。在两个源码世界完成导入及导出往返后，又在独立 sealed 客户端中走通普通源包导入、真实核心检查、候选预览、应用、保存与冷开，20 个流程步骤通过。该正式流程没有调用玩家模型。详见 [模块试验](specs/godot-agent-gu6-kenney-modules.md) 与 [正式检查和应用](specs/godot-agent-gu6-formal-packages.md)。

整合上述改动后的 `09f7443a` 完整客户端又完成了一轮新的正式复验，22 个步骤全部通过，两次正常退出；源码归档及 1,614 个资源文件也已核验。这次仍是开发者沿普通产品流程导入，不是模型自主找包并安装。后续衔接已整理成 [固定资源引用安装增量](specs/godot-agent-gu6-catalog-install-next.md)。

实际接入还暴露了一个影响 Agent 编辑的缺口：GLB 使用的 ArrayMesh 被旧准星选择器拒绝，`sceneObjectRefs` 为空。新版已在独立放置建筑的派生工程中通过 37 项真实 LPAC/Web 检查，普通 `observe` 能返回准确对象引用和不同实例身份；旧版 44 项回归也通过。新版只声明静态基准三角形，未验证当前渲染 LOD 或逐像素一致。正式包重新验收、模型编辑及模块参数存档仍未覆盖，详见 [选择器试验](spec/godot-arraymesh-picker-v2.md)。

资源检索补充：真实核心复现了本地库拒绝 `application/zip`、目录扫描忽略 ZIP 的问题。已在开发分支补齐现有库的 ZIP 入库与检索，原始字节不解包、不执行。两个固定源包经显式宿主入库后，可被模型现有的搜索、读取和版本接口找到，核心重启后保持，错误版本覆盖被拒绝。它们仍显示未预览、未检查、未应用；界面提示走已有作品检查流程。该测试不是普通玩家自动找包安装，检索引用直接安装的衔接仍需继续实现。详见 [资源库 ZIP 说明](../vendor/pi-desktop/docs/spec/asset-library-source-archives.md)。

该衔接现已实现并完成新的完整包验证：Agent 可只读提出固定版本建议，作品界面可选择确切旧版本，宿主从库内 ZIP 进入原安装器。`a9b4c0e2` 中的 25 步实际产品测试通过，包括删除测试下载副本后安装、真实检查和应用，以及冷开后的原操作幂等恢复。它仍不等于普通玩家模型自主完成复用；各层验证范围见 [固定资源复用验收](GODOT_AGENT_CATALOG_REUSE_PROGRESS_2026-09-12.md)。

## 优先候选

| 候选与原始来源 | 可以直接借鉴/复用的内容 | 接入我们项目仍需完成 | 本轮证据 |
| --- | --- | --- | --- |
| [Kenney Starter Kit FPS](https://github.com/KenneyNL/Starter-Kit-FPS) | 武器资源、切枪、命中和生命值、第一人称示例、配套模型 | 映射现有玩家与装备；补追逐/寻路、阵营、任务与存档；示例敌人主要原地攻击，不能充当完整战斗系统 | 固定源码检查；LPAC 导入/导出、Web 启动与画面 |
| [Kenney City Builder](https://github.com/KenneyNL/Starter-Kit-City-Builder) | 建筑模型、格网放置/删除、价格、地图保存与样例布局 | 可行走道路与建筑碰撞、导航、稳定实体 ID、独立实例状态；俯视编辑器不能直接代替主世界 | 固定源码检查；LPAC 导入/导出、Web UI 启动；追加自动加载样例的副本已显示城市画面 |
| [Beehave](https://github.com/bitbrain/beehave) | 行为树结构，适合组织巡逻、追逐、战斗、同伴跟随 | 实现各行为的具体动作、感知和导航；运行闭包仍依赖 global debugger/metrics，未启用编辑插件 | 固定源码、LPAC/Web 与 391 帧实际追随/停止/中断试验通过；墙体反例不能绕路 |
| [Godot 官方示例](https://github.com/godotengine/godot-demo-projects) | 导航、物理、动画、视角、交互等较小且专注的实现 | 选匹配引擎的稳定分支/提交，逐例验证 Web 与我们协议 | 官方文档筛选，尚未下载运行 |
| [Kenney Racing](https://github.com/KenneyNL/Starter-Kit-Racing) | 街机车辆控制、车型、赛道拼块、轮胎烟雾 | 与现有上下车、输入、任务和车辆状态对接；不是飞行系统 | README 标明 Godot 4.6；尚未运行 |
| [Kenney 3D Platformer](https://github.com/KenneyNL/Starter-Kit-3D-Platformer) | 双跳、金币、下落平台、第三人称相机 | 与玩家移动模式和奖励账本对接，避免复制控制器导致冲突 | README 标明 Godot 4.6；尚未运行 |
| [Dialogue Manager](https://github.com/nathanhoad/godot_dialogue_manager) | 分支对话编辑格式和运行时 | 只选择需要的 GDScript 运行时；对话条件/状态变更映射任务状态；完整开发仓库含 C# 测试配置 | 官方 README 与项目配置筛选，尚未运行 |
| [GDQuest Open RPG](https://github.com/gdquest-demos/godot-open-rpg) | 回合战斗、背包、成长、地图切换与 UI 的组织方式 | 适合参考实现和抽组件；作者明确为未完成教学示例，不是通用框架 | README 指定 Godot 4.6.2；尚未运行 |
| [Maaack Game Template](https://github.com/Maaack/Godot-Game-Template) | 菜单、选项、暂停、字幕/署名、场景加载 | 选取局部 UI 功能；现有宿主已有菜单与生命周期，不适合整体替换 | 当前原始 README 标明 4.7、兼容 4.4+；尚未运行 |
| [Kenney City Kit Industrial](https://kenney.nl/assets/city-kit-industrial) | 工厂、仓库、能源建筑等 40 个文件的资源包 | 统一尺寸、碰撞、导航、资源锁、预览与归属 | 官方页面列 CC0；尚未下载运行 |
| [Quaternius Ultimate Stylized Nature](https://quaternius.com/packs/ultimatestylizednature.html) | 树木等 63 个自然模型，提供 glTF 等格式 | LOD、碰撞简化、批量实例化和场景密度实测 | 官方页面列 CC0；尚未下载运行 |

外部页面会变化。上表中只有下述三项已固定本地提交；其余是候选，进入生产前仍需固定实际获取版本和文件摘要。README 声明支持某版本也不等于我们固定的引擎和 Web 环境已经验收通过。

## 第一批固定来源

| 本地名称 | 来源提交 | 已知许可分层 | 当前建议 |
| --- | --- | --- | --- |
| kenney-fps | `185fd2326d74a5cf858cffc616f87cf9696f9cc0` | 代码 MIT；README 将模型/精灵/音效列为 CC0；Lilita 字体另有 OFL 1.1 | 优先抽取武器/目标及模型包，补真实追逐战斗验收 |
| kenney-city | `4535092b740b378b700efd9df9e27a631815b84a` | 代码 MIT；README 将模型/精灵/音效列为 CC0；Lilita 字体另有 OFL 1.1 | 优先抽建筑和布局，补碰撞与第一人称道路验收 |
| beehave | `58a0df12330114e330f47fc1469132f016c056bc` | MIT；保留实际随包许可与归属 | 最小运行时已验证；本次分支 plugin.cfg 为 2.9.4-dev，不能冒称稳定发布版 |

原始克隆位于 `test-results/external-resources-20260912/`，未执行仓库安装脚本、Git hooks 或子模块。原文件逐项摘要见同目录生成的 provenance 清单；开发者试验中使用副本，适配差异与日志另存。

原文件清单共 1044 项，三个克隆均为干净工作树。`provenance.json` 的 SHA-256 是 `7277381796c40acdb11196a6fbe4140e9dc61ba5c1c3e0bbe8c6d9bce21c91b0`。便于后续检索的精简记录保存在 [来源锁定目录](research/godot-open-source-candidates.json)，它是研究数据，不是产品已安装资产。

两个 Kenney 项目的 README 声明与 `LICENSE.md` 年份存在差异时均保留原文，不重写上游归属。字体许可不能被项目 MIT 或素材 CC0 标签覆盖。此处记录实际许可文件，并非把整个 GitHub 仓库统一重新授权。

## 试验方法和证据范围

使用已有 SHA-256 身份清单对应的本地 Godot broker、固定 Godot `4.7.2-stable`，操作是协议内 `import` 和 `exportWeb`。这是文件摘要核对，broker 本身没有 Authenticode 签名。外部项目在 LPAC 中执行，测试数据与用户数据分开。Web 使用独立 headless Chromium，初始化禁止 Pointer Lock 和窗口 focus；没有真实或模拟鼠标键盘操作。

必要适配包括 Compatibility 渲染器、明确的 Web 导出预设、FPS 鼠标模式保持可见，以及不支持的渲染设置调整。原始代码和每次适配差异都需保留。任何测试专用自动加载样例只用于证明样例可显示，不能伪装成玩家完成建造。

首轮证据：

- FPS：`D:/cm-gu6-open-source-0912/test-results/gu6-open-source-272ti3/`。
- City：`D:/cm-gu6-open-source-0912/test-results/gu6-open-source-SQKC6W/`。
- City 样例：`D:/cm-gu6-open-source-0912/test-results/gu6-open-source-Orq3hk/kenney-city-sample-startup.png`。测试副本从 `_ready` 调用原 `action_load_resources`，以可选测试参数跳过按键判断；原空白启动与新增适配均留证。这个动作加载上游地图，并非玩家交互建造。
- 两次 Web 启动 Pointer Lock/focus 计数均为 0、页面异常为 0。native 日志有被 LPAC 拒绝的系统目录/网卡/监听探测；必须保留诊断和 broker 的进程、网络、清理核验，不能把无页面异常扩大为“所有日志零错误”。
- 首轮 FPS 有 Compatibility 不支持屏幕空间抗锯齿的提示，单独适配并复验；原始记录保留。
- 城市样例首次尝试遇到 AppContainer profile 的 `0x80070057`，缩短测试 taskId 后重新执行导入与导出成功。失败记录保留，未更换成无隔离运行。

详细最终结果见 [完整试验报告](specs/godot-agent-gu6-kenney-trial.md)，截图、许可证与回执已归档至 [证据目录](evidence/gu6-open-source-20260912/summary.json)。成功判定的独立 review 发现并修复了请求/源码绑定校验缺口；新增 4 项测试覆盖错误身份、stage 后源码变化和失败退出，6 份历史真实回执由新判定复核均通过。

启动通过只证明这一固定副本在测试环境走通相应阶段。尚未证明自主 Agent 检索/安装成功、完整玩法、碰撞和存档、冷启动恢复、第二世界独立复用或性能收益。

Beehave 后续试验已经实际运行，而非仅阅读代码。原样复制 12 个运行脚本、8 个图标和 MIT 文件，加上宿主编写的目标条件、物理移动及停止动作。真实 391 帧轨迹证明追随、到距停止、目标撤销中断、运动中停用和重新启用；阻墙角色持续碰撞并停在墙前，明确没有自动导航。11 项证据测试覆盖错误位移、传送、停止漂移和归档身份。整合时发现两份原始日志被 Git 换行转换，已恢复原字节并逐项复核，未改摘要来接受变化。详见 [Beehave 完整试验](specs/godot-agent-gu6-beehave-trial.md)。它是可复用的行为调度底座，仍需动作、感知、导航和产品状态协议适配。

## 暂不作为第一批底座

[Terrain3D](https://github.com/TokisanGames/Terrain3D) 和 [LimboAI](https://github.com/limbonaut/limboai) 有值得研究的地形和 AI 能力，但采用 C++ GDExtension/引擎模块。我们当前外部作品的 Web 与原生扩展边界需要另立支持项，不能仅凭 Godot 能打开项目就给 Agent 声明可用。

[Godot TPS Demo](https://github.com/godotengine/tps-demo) 可以参考第三人称和场景效果，但其 [许可文件](https://github.com/godotengine/tps-demo/blob/master/LICENSE.md) 将代码与美术/音乐分开：代码 MIT 条款，美术和音乐 CC BY 3.0。画面、资源规模和渲染成本也需要单独验证。

COGITO 的交互、门、背包和任务方向很贴合我们，但本次常见原地址访问失败，只找到较早的 [r2d2m 镜像](https://github.com/r2d2m/Cogito) 及 fork。镜像 README 自报 2024 年 beta，并包含混合素材许可及一项仅写“CC3.0”的音效声明。先确认可追溯维护来源和精确素材许可，再进入试验队列，不推荐未经核对的同名新仓库。

## 如何真正让 Agent 节省工作

参数复用的后续进展：实际运行证明 `configure()` 修改只保留在内存中，重建
建筑会恢复源码默认值。现已增加受审计建筑/道路的四项源码参数捕获与单实例
patch 预览；原包参数声明也能通过真实 Core 的导出、第二世界安装、再次导出
保全。它们分别是源码工具与源码事务证据，完整参数修改后的引擎检查、采用、
冷开仍在推进。详见 [持久化缺口与验收](spec/godot-module-instance-persistence-audit.md)
和 [参数声明保全](specs/godot-agent-gu6-parameter-declarations.md)。

沿用现有资产库、创作包和世界事务，不另造一套安装/升级注册表。研究目录只保存候选与来源，不赋予安装权限，不把某一世界通过的证据转移给其他世界。

1. 固定资源：URL、提交、文件摘要、许可证与署名、运行依赖、引擎/渲染/目标平台，以及明确的可用与未验证能力。
2. 适配为模块：给建筑、敌人、武器等稳定身份与参数；去除对上游主场景、全局单例和输入映射的隐含依赖。输入经现有控制器映射，保留正式产品的玩家操作语义。
3. 完成实际玩法检查：武器要产生命中/伤害；敌人要按约定追逐；城市要有连续可行走道路与有效建筑碰撞。截图或自报状态不能替代这些检查。
4. 通过既有 `asset.search/read/versions`、`package.check` 和宿主安装事务消费不可变版本。提供简短使用示例、参数含义、依赖和验证场景，让 Agent 查找后适配。
5. 在第二个独立世界复用，验证初始状态和稳定身份；不得复制原作者金钱、背包、奖励和任务进度。安装、升级、移除和恢复都保留现有事务及回执。
6. 用同一原始愿望、用户选定模型和产品配置比较实际完成质量、模型用量、修复轮次及阶段耗时。只有完成质量不降低时，才能计算节省。

建议首批产出三个可验证组合：城市建筑与道路包；武器与可追逐敌人包；同伴感知/跟随行为包。先完成前两个 Kenney 项目的兼容试验，再将有收益的部分转成现有库可以消费的固定版本。整套任意 GitHub 工程自动导入仍是新增范围，不作为本轮试跑已完成事项。
