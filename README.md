# 最中幻想 · craftmine world

**Windows 双世界版本：** 默认玩家入口收敛为一个 Godot 3D 世界和一个 Web 世界。进入后通过 F2 对话创作，Esc 暂停、切换世界或保存退出。旧作品保留在设置中的高级存档管理。

[当前 Windows 交付与复盘](docs/CURRENT_WINDOWS_DELIVERY.md) · [双世界玩家操作说明](docs/TWO_WORLD_PLAYER_GUIDE.md) · [收敛方案与范围](docs/TWO_WORLD_SIMPLIFICATION_PLAN_2026-09-13.md) · [Windows 客户端构建说明](desktop/README.md)。成品验收与源码实现分开记录，构建成功不等于玩法或真人验收通过。

2026-09-10 的 `8276b45` 四底座客户端是历史快照，其 [当时验收范围](docs/dispatch-reports/plan-loop/827-package/REPORT.md) 和 [Git 归档说明](docs/GIT_CLOSEOUT_2026-09-10.md) 保留供追溯。下文是早期独立 Web 运行器的开发启动与使用资料；Windows 成品玩家请使用上面的双世界操作说明。

从一个能走动的空白 3D 世界开始，用自然语言逐步创造内容。

**本地创作 Alpha 0.8：把自己的素材变成世界里可运行的创作。** 支持本地图片与静态 GLB、固定版本、外观替换、带源码与素材的完整作品迁移。保留自然语言源码生成、模块记忆、长期约定、差异试玩与有限自动修复。

## 启动

在 Windows 中双击根目录的 `start.cmd`，保持启动窗口打开，然后用 Chrome 或 Edge 打开：

**[http://127.0.0.1:8787](http://127.0.0.1:8787)**

也可以在根目录运行：

```sh
node app/server.mjs
```

需要 Node.js 22 或更新版本。生成或导入代码玩法、导入素材还需要 Playwright 与 Chrome／Edge，用于独立后台检查；本机已有这些运行库及已登录的 Codex CLI，查找方式见下文。其他电脑需要先安装 Codex CLI，并在本机终端执行 `codex login`。模型请求使用已登录账号的额度，生成需要联网；游戏和存档保存在本机。

页面提示“另一个窗口正在使用此项目”时，关闭另一个工作台，等待约 15 秒后刷新。如果本地服务已经启动，直接打开地址即可。

## 第一次体验

1. 点击“进入世界”，WASD 移动，鼠标环顾，Space 跳跃，Shift 冲刺。
2. 按 T 打开对话，或直接在右侧输入：**我想要有树**。
3. 发送后可回到世界继续走动；真实生成任务会显示阶段，并可取消。
4. 候选就绪后，可先“查看变化与预览”，在独立副本里试玩；再点击“应用并进入世界”。系统先保存原世界最新进度，再载入新场景。
5. 靠近并将准星对准树干，按 T，输入：**把这棵树变高一点**。也可在“素材”工作区选中对象。
6. “开发”工作区可查看实际执行记录、生成的场景内容，以及准备恢复此前的场景版本。

Esc 释放鼠标。浏览器不允许鼠标锁定时，按住画面拖动仍可环顾。“只讨论”不会改变世界；执行期间的讨论会先记录，当前任务结束后可继续发送。

对话框下方的“创作方向与长期约定”可保存世界方向和特定对象的要求，长对话后仍供助手读取。已应用需求自动保存原文与来源版本；开发记录可查看每次实际读取的上下文。检查失败最多自动修复两次，共用 240 秒总时限。详见 [Alpha 0.7 使用与验收](docs/ALPHA_0_7.md)。

## 创作记忆与玩法

- 花草支持细茎、彩色花瓣、薄叶片和小数尺寸，默认可穿行。可以说“在树旁来点小花和草”。旧版砖花需要生成修复候选后应用，新渲染不会擅自改写存档中的旧定义。
- **素材与记忆**：应用成功后自动记住对象、内置玩法配置与含源码的完整创作。选择历史版本 → “复用到世界” → 应用候选，不需要再请求模型。LLM 在下一次创作时也会检索真实模块定义，开发记录显示读取与引用了哪些记忆。
- 修改实例会保存新模块版本；已有实例嵌入自己的定义，不会随记忆库的更新一起改变。删除世界中的对象也不会删除库中的成果。
- 模块可以单独导出、导入另一个兼容的本地项目。模块库目前在每个项目本机保存，还没有共享社区搜索。
- 可以说“增加 100 点生命值”“增加射击和一个 60 点血量的训练靶”“增加近战剑”。运行器已实现血条、受伤、死亡复活、弹匣、换弹、冷却、射线遮挡和目标伤害。**1** 装备枪、**2** 装备剑、**左键**攻击、**R** 换弹、**F** 近战、死亡后 **Enter** 复活。
- 可以说“做一扇能按 E 开关的滑门，旁边放一个弹跳板”。模型会编写源码，后台检查通过才形成候选；靠近并瞄准物体后按 **E** 或点击“互动”。源码可以改变对象、施加玩家冲量、显示提示和增减物品，受权限、边界与执行限时约束。
- 要把对象连同源码一起复用，选择“完整创作 · 含源码”卡片，或说“再来一扇之前记住的门”。副本拥有独立身份和初始状态，源码在新位置继续运行；普通“对象”卡片复用几何与组件。
- “当前世界 · 玩法”中的完整创作支持切换此实例版本和卸载。兼容的开关、偏移、血量与库存随存档保留；卸载后恢复历史世界可找回实例进度。不兼容的状态格式变更会拒绝应用，保留原世界。

## 使用自己的素材

在“素材与记忆”中导入 PNG、JPEG 或静态 GLB，实际检查通过后可以预览、选择版本和导出。选择世界对象，再在素材卡片点击“用于所选对象”，或告诉助手“把这扇门换成我导入的某某门面”。外观替换先形成候选，保留对象身份、碰撞、源码和兼容进度；新版素材不会自动改动旧实例。

原始文件最大 8 MiB，图片单边最大 2,048 像素；GLB 需要内嵌资源，目前支持静态网格和基础贴图。动画、蒙皮与压缩扩展需先转换，光照不是完整 PBR。素材世界需要 WebGL。详细操作与容量见 [Alpha 0.8](docs/ALPHA_0_8.md)。

## 存档与恢复

新项目默认保存在根目录的 `.craftmine/`，包含版本、对象、位置、任务记录、对话与模块索引。模块定义保存在 `modules/<id>/<version>.json`，素材原始版本保存在 `assets/<id>/<version>.json`。位置每约 3 秒自动保存，应用候选时立即读取最新位置并备份。场景回退与恢复完整存档分别处理。

- 右上角“导出存档”导出当前场景、源码、最新位置和兼容的生命值／弹药／目标／代码玩法状态。实际使用的素材文件及固定版本会一起打包；不包含整个历史模块库、对话或项目约定。可在记忆库中单独导出创作及其所需素材。
- “开发 → 本地数据与完整存档”中可以导入；导入先形成候选，应用前备份当前世界。
- 游戏更新加载失败时恢复旧窗口；连接中断而无法核对应用状态时，提示刷新后从本地已确认版本恢复。

不要删除 `.craftmine/` 来更新程序；重要作品请主动导出备份。

## 可选配置

配置通过启动 Node 进程的环境变量传入，[.env.example](.env.example) 给出不含密钥的例子；它不会被自动加载。更省事的做法是把变量写进数据目录的 `secrets.json`（默认 `.craftmine/secrets.json`），服务启动时自动读取：该目录已被 git 忽略，也不进入源码归档，环境变量优先于文件。

| 变量 | 用途 |
| --- | --- |
| `CRAFTMINE_PORT` | 默认 `8787` |
| `CRAFTMINE_MODEL_PROVIDER` | `deepseek` 或 `codex`；未设置时按是否配置 DeepSeek 密钥推断 |
| `CRAFTMINE_DEEPSEEK_API_KEY` | DeepSeek 官方 API 密钥，只在服务端进程读取 |
| `CRAFTMINE_MODEL` | 可选模型 ID；DeepSeek 默认 `deepseek-v4.1-flash-expires-on-0910` |
| `CRAFTMINE_MAX_TOKENS` | 单次生成的最大输出 token，默认 `32000` |
| `CRAFTMINE_CODEX_PATH` | 指定本机 `codex.exe`，通常会自动找到 |
| `CRAFTMINE_DATA_DIR` | 为另一个独立本地数据目录启动项目 |

例如 PowerShell 中更换端口：

```powershell
$env:CRAFTMINE_PORT = '8788'
node app/server.mjs
```

默认使用 DeepSeek 官方 API：需要 `CRAFTMINE_DEEPSEEK_API_KEY`，模型名可配置，思考模式关闭，JSON Schema 随提示一起发送、结构由本地校验与修复循环兜底。也可以设置 `CRAFTMINE_MODEL_PROVIDER=codex` 复用 Codex CLI 的本机登录和结构化输出能力，见[官方非交互执行说明](https://learn.chatgpt.com/docs/non-interactive-mode)。两种方式都不会把密钥或登录凭据放进页面、场景或导出存档。

## 开发与验证

```sh
npm test
npm run test:browser
npm run test:live
npm run test:behaviors
npm run test:code-world
npm run test:live-code
npm run test:creations
npm run test:creation-ui
npm run test:live-creation
npm run test:repair
npm run test:repair-cancel
npm run test:live-repair
npm run test:review
npm run test:context
npm run test:live-context
npm run test:assets
npm run test:asset-world
npm run test:asset-packages
npm run test:live-assets
```

核心测试仅需 Node.js。浏览器测试需要 Playwright 和 Chrome／Edge；本机可使用已提供的 Playwright 运行库，其他环境可安装 Playwright，或用 `PLAYWRIGHT_MODULE_PATH` 指定模块位置。`CRAFTMINE_BROWSER` 可指定浏览器路径。

`test:live` 会实际请求模型，以独立的旧版场景夹具验证花草修复、树记忆复用和玩法生成。需要检查个人世界的只读副本时，可运行 `node tests/live-memory.mjs --repair-current`，仍不写入个人世界。普通浏览器测试使用人工场景夹具，不计为 LLM 验收。所有测试数据在独立的 `test-results/` 下。

**测试不抢占鼠标：**默认浏览器验收使用独立 headless 进程、禁用 Pointer Lock，通过页面脚本和 HTTP 检查，不发送鼠标键盘输入。旧的输入操作测试已加显式运行保护，不属于默认入口。参见 `AGENTS.md`。

- [Alpha 0.4 设计与验证记录](docs/ALPHA_0_4.md)
- [Alpha 0.5 源码玩法与验收](docs/ALPHA_0_5.md)
- [Alpha 0.6 完整创作记忆与验收](docs/ALPHA_0_6.md)
- [Alpha 0.7 连续创作与独立试玩](docs/ALPHA_0_7.md)
- [M3.1 自动修复与失败记录](docs/M3_REPAIR.md)
- [M3.2 候选差异与独立试玩](docs/M3_PREVIEW.md)
- [M3.3 长期方向、需求与运行上下文](docs/M3_CONTEXT.md)
- [Alpha 0.8 自有素材、源码玩法与完整作品迁移](docs/ALPHA_0_8.md)
- [M4 素材库、世界绑定与验收记录](docs/M4_ASSETS.md)
- [真实模型生成的滑门与弹跳板演示](examples/door-and-bounce.save.json)
- [M5 完整可玩世界实施与验收计划](docs/M5_WORLD.md)
- [最新建议计划：Windows 客户端与 PI-Desktop Harness 源码复用](docs/WINDOWS_CLIENT_REUSE_PLAN.md)
- [玩家创作版本管理开发计划](docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md)（Git 历史、分支、应用与恢复）
- [素材与作品库开发计划](docs/ASSET_LIBRARY_DEVELOPMENT_PLAN.md)（素材版本、作品复用与开源参考）
- [玩家创作包、底座与复用开发计划](docs/CREATION_PACKAGE_DEVELOPMENT_PLAN.md)（七类内容、开发接口、打包与导出）
- [创作社区与内容分发平台开发计划](docs/COMMUNITY_PLATFORM_DEVELOPMENT_PLAN.md)（网站与客户端、上传发布、审核与阶段上线）
- [AI 创作效率与可靠性开发计划](docs/AI_CREATION_EFFICIENCY_DEVELOPMENT_PLAN.md)（思考模式、文档与 Skill、模块复用及四组对照）
- [玩家产品体验与持续创作开发计划](docs/PLAYER_PRODUCT_EXPERIENCE_DEVELOPMENT_PLAN.md)（首次成功、参数调整、问题修复、玩法保护与好友试玩）
- [沉浸游玩模式与造物主世界方案](docs/IMMERSIVE_PLAYER_AND_MAIN_WORLD_DEVELOPMENT_PLAN.md)（双模式、游戏内两级面板、专属主世界与言出法随）
- [宣传定位与文案备忘](docs/PROMOTIONAL_VIDEO_POSITIONING_AND_COPY.md) / [宣传片内容与分镜草案](docs/PROMOTIONAL_VIDEO_STORYBOARD_DRAFT.md)（持续收集创意，区分用户主线与候选建议）
- [Godot 原生运行与多目标交付长期计划](docs/NATIVE_RUNTIME_LONG_TERM_DEVELOPMENT_PLAN.md)（原生运行、中央嵌入、独立导出；暂不排期）
- [上一版 Harness 项目开发计划书与实现记录](docs/HARNESS_DEVELOPMENT_PLAN.md)
- [Codex、Claude Code 与 DeepSeek Harness 参考研究](docs/HARNESS_REFERENCE_RESEARCH.md)
- [Harness 差距评估与优先级](docs/HARNESS_GAP_ASSESSMENT.md)
- [Agent 分层与架构评估（2026-09-11）](docs/AGENT_LAYERS_ARCHITECTURE_REVIEW_2026-09-11.md)（L0–L4、文档差异、真实引擎诊断与修正顺序）
- [C / D / L 愿望框架、模型分工与社区复用总体方案](docs/WISH_CDL_FRAMEWORK_AND_NORTH_STAR_PROPOSAL.md)（北极星、难度评估、小模型、社区检索与效果验证）
- [创作循环：愿景、实测证据与决策记录](docs/CREATION_LOOP.md)
- [历史目标与持续开发记录（已停止）](docs/CONTINUOUS_DEVELOPMENT.md)
- [开发进度记录](docs/DEVELOPMENT_STATUS.json)
- [新玩法代码运行接口与验证](docs/BEHAVIOR_RUNTIME.md)
- [模块记忆设计方案](docs/MODULE_MEMORY_PLAN.md)
- [Alpha 0.3 历史实现记录](docs/IMPLEMENTATION.md)
- [产品想法](docs/PRODUCT_VISION.md)
- [已确认的许可与商业授权方案](docs/LICENSING_STRATEGY.md)（正式许可适用待逐模块核对）
- [早期产品梳理与开发计划（历史）](docs/DEVELOPMENT_PLAN.md)

## 项目基线

正式英文名为 **craftmine world**，中文名为 **最中幻想**，替代旧暂名「世界工坊 / World Workshop」。

`app/` 是新工作台主线。`world-workshop-3d/` 保留 0.2「林间起点」原型及原来的存档和卡带约定，新运行器复用其中的渲染与物理基础。`world-workshop-3d.zip` 是原始交接包。旧原型仍可单独打开，不与新项目的数据混用。

整体方向继续保留开发、游玩、素材三个工作区。持续扩展代码玩法接口、模块记忆与素材能力，再推进多人共创和社区发布。
