# GU3 模块参数：普通封包玩家验收路径

只读审计基线 2a584796。新 bootstrap 仅复用现有受保护 API，没有产品修改、
任意 eval、源码写后门、synthetic capture、模型设置或模型请求。

## 可直接复用的接口

| 阶段 | 现有文件 / 行 | 实际调用 |
|---|---|---|
| 隔离和封包核验 | tests/helpers/creation-native-launch.mjs:51；craftmine-headless-profile.ts:4 | 原始封包 inventory、offscreen/Pointer Lock guard；marker/token 专用 profile |
| 原生创建模式和世界 | ordinary-player-bootstrap.mjs:50–55 | primaryMode(create) → worldNavigationReady.ready → world.createOptions → world.create |
| ZIP 安装并实际检查 | formal-package-client.mjs:79–84 | worldPanel package.request/importSource → worldNavigation godot.historyJob → sourceJob |
| 候选采用 | formal-package-client.mjs:85–90 | runtimeSave(freeze) → candidatePreview → candidateApply → 新 build 的 godotObserve |
| 创建普通空会话 | craftmine-headless-player.ts:15–33 | playerCreateSession → 普通 sessionCreate/sessionGet，modelRequestsStarted=0 |
| 普通愿望提交 | craftmine-headless-player.ts:62–68 | playerPrompt 先真实 creationTarget，再 agentPrompt(requestContext.captureId) |
| 原生目标捕获 | Main index.ts:6460–6470 | Main frame 的 godot.creationTarget；creation-target-service.ts:77–84 核对 live weakref |
| 原生步行/转向与画面 | craftmine-headless.ts:136–150；craftmine-godot-exploration.ts:65–100 | godotExplore 的 look/walk/wait，godotObserve，godotCaptureView |
| 冷开 | formal-package-client.mjs:95–99 | quit/clean audit → 同 profile 启动 → create 模式 → navigationReady → 普通 world.open |

行号对应本次审计版本。worldPanel 的有限白名单没有 godot.creationTarget；
可由现有 worldNavigation 从 Main frame 调用
`piDesktop.pluginPanelInvoke("craftmine.world","godot.creationTarget",{sessionId,selection:null})`
进行只读准星预核对。后续 playerPrompt 自己会重新捕获并绑定，不能把预核对
返回值替换成指定对象或跨 runtime 重用。

目前没有“直接执行某个模型工具”的受保护 headless API。module-parameters /
module-parameter-preview 及 godot_project_patch/check 必须由普通 active player
turn 执行；Main 的 craftmineCreationTarget provider（index.ts:1148–1152）会核对
活动 session/turn/project。不能通过 worldNavigation 伪造通用 Core/tool RPC。

## 两阶段真实愿望

1. 正常安装两份原版 building.zip，各自检查、采用并保留真实 instance/entity ID。
   默认实例可能重叠，不能据此认定选择器不可用，也不能以 harness 挪动节点后
   冒充玩家布局。创建普通会话后，由正常 playerPrompt 表达：

   “把这两栋重叠的房子分开放到我面前，左右各一栋，留出走路和以后放大的空间；
   保留原来的房子，不要重新做两个替代品，也不要改变玩家位置。”

   这一步可以走模型已有的普通 source query/read/patch。导入模块不属于
   creation_operation 的五类结构化 entity，不能强行使用它的 move/modify。
   即使当前准星因重叠不确定，creationTarget 仍可提供普通请求上下文；
   检查两份既有父场景实例而非替换共享 module 场景，是本步验收对象。
   采用前后核对两个显式 entity ID、共享文件和玩家 progress，确认只调整布局。

2. 在已采用的新 runtime 中，先用 godotObserve 获得新 world/build/instance。
   必要时用现有 godotExplore look 微调方向，按实际相机/画面确认左栋。
   读取实际 sceneObjectTarget/Refs 并可通过 Main creationTarget 预核对，不能
   通过动态实例名字猜命中。再发送普通愿望：

   “把左边这栋房子放大为原来的 2.5 倍，转 90 度，变成可以穿过的；只改这一栋，
   另一栋保持原样，保存后重新打开也要保留。”

   正常 playerPrompt 再次捕获；应从实际 tool 回执验证模型使用受限查询/预览或
   普通源码操作，source patch 只改 A 父节点，保持 B/共享资源和玩家进度。
   后续真实 check → 手动普通 candidate preview/apply。sceneObject 目标在
   creation-target-service.ts:206 明确 autoApply=false、
   SCENE_OBJECT_SOURCE_REVIEW_REQUIRED，不应绕过采用。

这次真实愿望验收的是比例、旋转、可穿过三项，不人为要求玩家理解 label 内部
参数，也不能说完成了四参数体验。label 仍由单独源测试覆盖，且不是可见重命名。

## 配置、恢复和权限

tests/promo-real-player.mjs:15–24 的 prepare-only 不调用模型；仅 --live 会发送。
必须先核对实际玩家的 provider/model/thinking/context 配置。现有 playerSetup
（craftmine-headless-player.ts:53）只支持 DeepSeek 官方 endpoint 和完整模型绑定；
如果当前实际选择不同，不能悄悄替换模型或使用另一个受限评测器。

该 harness 使用普通 ask/permission 交换文件（promo-real-player.mjs:92–119），
保存真实问题与回答，不自动机械选择首项。SIGINT/SIGTERM 和 cancel 文件走
playerAbort，再正常 quit。没有额外模型轮数或整轮时间上限。

世界 create/open 属于写入/生命周期操作，未知响应或 timeout 不应盲重试。
先等待 ordinary navigation ready；仅由既有契约明确为 WORLD_BUSY 的 preflight
拒绝才可按相同目标重试。playerCreateSession 的失败尝试会由宿主保留，driver
不能因丢回复再造一个会话。

## 新 bootstrap 的职责

tests/godot-agent/module-player-bootstrap.mjs：

- 必须指定 --packaged-root 和完整 CRAFTMINE_EXPECTED_PACKAGE_COMMIT。
- 创建专用 test-results/desktop-native-* profile 和 marker，复制唯一审计
  building.zip 到受保护 picker 的固定 component.zip。
- 仅用 ordinary importSource 两次，每次新 operationId；真实 executor check
  必须 passed，逐项验证 source/check/candidate/build 身份后普通采用。
- 保留每次采用前后的基础 snapshot，核对相等；读取最终 source identities。
- 普通 playerCreateSession，输出 bootstrap.json 的 worldId/sessionId，随后
  clean quit。该报告可作为普通 player harness 的既有世界/会话输入。
- bootstrap 自身不布局、不捕获创作目标、不调用 query/patch、不配置 provider，
  不进行游戏冷开或玩家模型验收。默认重叠截图仅作启动上下文。

新的 contract 模块限定所有 controller calls；错误的 world、raw source、
任意 eval、playerPrompt/playerSetup 和 synthetic capture 都被拒绝。正常退出
还必须通过原 assertCleanHeadlessShutdown；强制退出会明确记失败。

## 剩余验收边界

- godotObserve 当前不直接返回导入模块四个运行参数；源码 query 的
  runtimeValuesVerified=false 必须保留。实际大小/朝向用同 runtime 截图核对，
  可穿过用受保护 godotExplore 的真实步行/碰撞行为核对，不能只断言源字符串。
- 若需要自动精确读出导入模块运行属性，需要受限、固定且可审计的只读 observer，
  不应添加任意 eval 或脚本执行入口。本 bootstrap 没有引入这样的能力。
- 实例 root transform 与 Visual 参数是两层：布局阶段改父实例位置，第二阶段
  比例 2.5 倍不能同时再乘 root scale。检查源 diff 和实际画面确认没有重复缩放。
- 操作前后保留 B 的源码块、显式 ID、共享 GLB/纹理/script/scene hash；冷开产生
  新 runtime objectId 是正常现象，使用 source entity identity 重新对齐。
- 冷开前正常保存并干净退出，等待 navigationReady 后 world.open；比较同采用
  build/source pin、最新保存的基础 progress，并重新做视觉/物理验证。不能把
  同实例 restore 或 Core restart 当成游戏冷开。

本提交只运行 3 项 controller/receipt 契约测试和脚本语法检查，没有启动封包、
引擎、浏览器或模型。正式 bootstrap 与后续两阶段愿望由总控执行。
