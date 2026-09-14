# 实际 PI Desktop 多轮创作操作驱动

`create-template-world` 接受 `{ref:{assetId,version,contentHash},title}`，从已经
保存到素材库的确切世界模板创建独立副本并打开。先通过普通入口返回当前世界、
保存/冻结旧进度，记录其只读 contentHash；随后走“我的模板”实际列表，选择
确切版本，填写名称并提交“创建独立世界”表单。列表需要分页时只执行现有
“加载更多”处理器；未列出的版本明确失败，不悄悄选择最新版。

回执包括 sourceRef、archiveSha256、`initialState:"saved-progress"`、新旧
worldId/sessionId、普通保存回执、旧世界内容哈希前后核对和新世界实际运行身份。
必须产生新 worldId，旧世界仍存在且保存内容未被覆盖；新会话继承当前真实模型
配置后再次核对。此操作不会自动发送模型请求，也不会把含位置/探索/互动状态的
模板伪称为空白进度。成功后 driver 的当前世界/会话切换到副本，后续普通创作、
保存、冷开和发布命令作用于副本；`worldCreation` 和 `worldTransitions` 保留
模板来源。模板读和旧世界哈希读均只读，创建写入只走真实 React 表单，未增加
生产 RPC 或数据库/人物位置写入。

每次检查的轻量性能样本异步追加到 `collector-performance.ndjson`，只含计数、
耗时、CPU/内存和身份元数据，不含正文。每条关联 `controllerRunId`、应用启动
序号、真实 app PID、collectorId、世界和会话；同一个 Node 控制器中的冷重开
会得到不同启动/collector 身份。`collectorPerformanceSummary.sampledMax`
保留整个控制器生命周期的观测峰值，不被冷重开后的小值覆盖。每个 collector
的累计收集字节先取已见最大值再求和，不重复加每次快照。缺失 renderer heap
标为 `unknown`/null，并单独统计缺失采样次数；未采到的峰值不推算。
再次运行 Node `--resume` 是新的 controllerRunId，旧样本文件继续保留且可按
身份区分；新报告只汇总新控制器实际采样，不追认此前已覆盖或未记录的旧峰值。
这是测试观察数据，不增加模型、任务时长或调用次数限制，也不要求重新打包应用。

初次连接仍等待自己启动的 renderer 导航到主页面，再安装采集器；headless-ready
只表示主进程已接入，不代表页面 URL 已就绪。运行后的连接故障采用单独的重连与
degraded 流程。首次改采集器时的 0 模型准备失败记录保留，不当作创作失败。

`continue-task` 是无参数的普通任务恢复命令，与继续游玩的 `resume` 不同。
它在当前任务页寻找实际“继续创作”表单，核对闲置模型、当前世界/会话/任务及
generation，并只接受唯一匹配的可恢复任务后 `requestSubmit()`。不调用
release 或 resume 域接口，不重新解除预算，不重置档案。多个恢复目标、任务
变化、禁用按钮或界面错误都会明确失败。提交记录为
`ordinary-player-task-continue-form`，保留前后 task.current 与 recoverable
读回；新消息/轮次按普通后台采集。用于已经解除限制后中断、玩家停止后继续等
真实保留草稿流程；仍需 Core 正常恢复条件成立。

采集器 v2 在自己的 renderer 订阅入口合并高频 `message_update`：每条消息只
保留最新长度/身份、增量字符计数和原事件数量，不把不断增长的整段思考反复入队。
完整 message_end、工具结果、error、status、model_call、澄清/权限等不同请求
仍全部保留，完整会话和每轮最终转录不裁剪。事件批次必须在 Node 持久化后才
acknowledge；CDP 响应丢失可取回同一批次，driver 按 deliveryId 防止重复写入。

报告新增峰值待采记录数、累计输出字节、省略的重复 update 正文字符数（不是
丢弃最终正文）、最大单次正文长度、每次 inspect 耗时、Node CPU/内存和可用时
的 renderer JS heap。旧 65N8WV 原始日志明确记载 `Renderer 1: oom`；分块
审计发现 34,173 条完整消息更新占约 1.021GB。这证明测试观察器存在额外的
二次方累积压力，尚不能独立证明产品 renderer 全部内存故障都由它引起。

每个 CDP 操作以无敏感内容的标签记录耗时/失败位置。观察传输超时不会自动
取消仍运行的模型；driver 尝试重连原进程的同一 renderer，保留原 collector。
三次自动重连失败后明确进入 `degraded-awaiting-operator`，在报告/标准输出
给出 `reconnectFile` 和取消文件。创建 reconnectFile 才再次重连；创建取消
文件仍正常停止任务和应用。这是观察连接恢复策略，不是模型次数或任务时限。
若 renderer 已替换而 collector 消失，报告标明 captureGap；若应用已经退出，
保留真实退出码与缺失审计，不伪造恢复或正常退出。

只读分块重放 65N8WV 的 34,222 条原事件，按原 timestamp 的 1.5 秒采集间隔，
旧文件 1,021,449,631 字节对应新表示 324,426 字节、149 条记录；所有非更新
事件顺序与内容 SHA 完全一致，峰值待采记录 11。详细证据保留在本轮工作树
`test-results/events-audit-65N8WV.json`、`events-audit-oUgGvo.json` 和
`events-collector-replay-65N8WV.json`。这是离线数据重放，不是新模型试玩、
真实 renderer 内存峰值或产品 OOM 已修好的证明。

`--starter blank` 使用普通新建世界页，明确选择 `creation-sandbox` Godot 基础
和“空白”起点，填写名称后提交真实创建表单。它不会从宣传片示例复制、注入玩法
或直接创建数据库记录；基础运行所需地面/角色等由产品的空白模板决定，不能据此
宣称初始场景文件绝对无对象。默认名称为“空白世界 · 自由创作测试”。
此入口支持新的独立 profile；provider 在配置冷开后由普通世界会话继承并验证。
准备完成仍不发送模型请求，操作员用 `draft-composer`/`send-composer` 提出新
创意并逐轮修改，其他保存、冷开、虚拟游玩、作品发布命令不变。`--resume`
此类报告会重开原空白世界及原会话，不再创建另一个世界。

用户明确将后续玩家测试上下文提升至 1M。新增显式 `--context-window 1000000`
用于新测试阶段；最大输出 384000、max 思考、图像/文档开启保持不变，不新增
调用次数或整轮时限。未给参数仍复现原 500K，旧报告和原失败保留。新 1M
阶段使用新的独立 profile/retained bootstrap 新建 provider；直接把已有 500K
配置报告带此参数 resume 会拒绝，不修改旧 provider 或把旧用量伪称为 1M。

`release-task-continue` 无参数命令用于旧任务遇到本地次数/时长限制后的普通恢复。
先核对模型、闲置状态及真实 `task.current` 的 world/session/task/generation，
通过 `world.surface` 打开任务页，在本进程自己的 loopback CDP 端口中定位
`plugins/craftmine.world/views/world.html` 并核对 headless 标记与当前世界。
只有唯一、可用的 `form[data-release-execution-limits="true"]` 才执行
`requestSubmit()`；driver 不直接调用 release 或 resume 域接口。
记录原任务、表单文字、提交回执、之后任务读回与新消息/turn 身份，submission 为
`ordinary-player-execution-limit-release-form`。显式界面报错会中止等待并保留
错误，不自动代答问题。短时 CDP 连接在 finally 中关闭；不涉及真实输入或焦点。

2026-09-14 增加真实 DeepSeek 玩家配置入口，与原 `--codex` 互斥：

```powershell
node tests/product-agent-operator-native.mjs `
  --application-root '实际构建工作树绝对路径' `
  --runtime-resources '实际成品/resources绝对路径' `
  --packaged-root '实际成品绝对路径' `
  --provider-config-file '用户授权附件绝对路径' `
  --output-root 'D:/cm-deepseek-player/test-results' `
  --starter promo-mainline
```

附件为三行：HTTPS DeepSeek endpoint、原始模型 ID、API key。驱动只在自身
进程内读取，通过普通 `providersCreate` 的 `secretValue` 写入这次独立 host
的密钥存储。不得把附件复制到报告目录、写进命令行或环境变量。日志、CDP
异常、JSON 记录统一脱敏；管道按完整行脱敏，避免密钥跨 chunk 泄漏。只采集
绑定的游戏画面，不采集含密钥的设置页面。原始独立 profile 的应用内部数据
仍按私有测试数据保管，不作为可公开的脱敏报告。

实际创建并冷重启读取的配置固定为附件精确模型 ID、500000 上下文、384000
最大输出、max 思考、auto 权限。不会将 `deepseek-v4.1-flash` 悄悄换成
其他模型。另保留已核对的玩家配置：`thinkingLevels=["max"]`、
`supportsImages=true`、`supportsDocuments=true`，并在冷开和发消息前核对。
这些是玩家的显式能力覆盖配置，不是对上游实际图像或文档支持的验证结论；
API 拒绝时保留真实失败，不关闭能力选项来绕过。默认仍使用附件原名；仅在显式传入
下文有官方依据的 `--api-model-id` 时解析名称，接口拒绝的原结果保留为失败。
驱动在设置之后正常退出重启，
再从当前普通世界选择器进入；每次发消息核对 provider、模型及配置。这里的
上下文和输出数值是复现玩家配置，驱动不额外设置评测预算或模型整轮时限。

权限核对按产品的有效配置计算：会话为 `inherit` 时使用当前全局默认；显式
会话权限优先。报告同时保留 `sessionPermissionMode` 原值、
`defaultPermissionMode` 和 `effectivePermissionMode`，只接受最终有效 auto，
不会把显式只读或默认只读当作全自动。最初鲜建示例被错误判为权限变化的
0 模型准备失败记录保留，不算模型或产品创作失败。

官方在 <https://deepseek.com/news/deepseek-v4-1-flash/> 明确说明最新 V4.1 Flash
通过 `deepseek-flash` 调用。保留原附名真实 400 失败后，操作员可显式增加
`--api-model-id deepseek-flash`：仅允许官方 DeepSeek 端点且附件精确名称为
`deepseek-v4.1-flash` 的这一项映射。未给该参数仍原名发送，不自动重试或回退。
报告同时记录 `requestedModel`、`apiModelId`、`resolutionSource`；附件和旧
转录中的模型名称、usage 均不修改。

转换阶段使用新的 retained bootstrap，保留上一阶段报告路径作为复制清单
证据，且不带上一阶段的 `providerConfiguration`。随后仍通过普通新建 provider、
设置 default 和正常冷重启接入相同复制会话。原会话若显式绑定旧模型会拒绝，
不会重写其配置。直接 `--resume` 已配置旧模型的报告并更改 API ID 会被拒绝，
防止将两个配置阶段混为同一次验收。

DeepSeek 入口不自动创建玩法组合草稿、不发送请求、不代答澄清。新增
`draft-composer` 命令 `{text}` 使用实际 Composer 的 `onInput` 创建草稿，
仅接受空草稿并等待正常可发送；随后显式 `send-composer` 才走实际发送处理器。
也保留原 `prompt` 的公开 API 路径，两者在报告中有不同的 submission 字段。

已有玩家档案由总控通过只读原数据和 SQLite online backup 另行复制，排除原
密钥。驱动不接受活跃用户 profile，也不自行改写数据库。总控可在新的
`test-results/desktop-native-product-*` 目录放以下 bootstrap JSON，通过
`--resume` 进入其副本中的原世界和原会话：

```json
{
  "format": "craftmine.product-agent-operator/1",
  "out": "D:/cm-deepseek-player/test-results/desktop-native-product-UNIQUE",
  "sourceTemplate": "retained",
  "retainedCopy": {
    "format": "craftmine.operator-retained-copy/1",
    "markerToken": "与 profile/headless-profile.json 的 token 一致",
    "manifest": "只读复制证据清单的绝对路径"
  },
  "worldId": "实际复制世界 ID",
  "sessionId": "实际复制会话 ID",
  "turns": [],
  "commands": []
}
```

`profile/headless-profile.json` 使用原 headless 标记格式，`legacySource`
必须为同一输出目录的 `legacy`。驱动验证真实目录与声明路径相同、无符号链接
或 junction 成员、标记 token 匹配且复制清单存在。bootstrap 的空 `turns`
只表示本驱动尚未发起新轮次，不删除原会话历史；旧失败不会伪造为新测试轮次。
原会话 provider/model 为 null 时按真实当前 default 验证；显式不同模型则拒绝。
首次接入写入新 provider、重启并进入原会话，不自动继续旧任务。后续冷开保留
同一 provider、世界与会话，持续保留原始失败、检查、采用、虚拟移动与保存证据。

入口：`tests/product-agent-operator-native.mjs`。只控制自己创建的独立
offscreen 应用和测试数据，通过现有普通 UI、公开 `agentPrompt`、澄清回答、
素材建议、检查采用与保存接口操作。不增加生产 RPC。

输出根目录必须名为 `test-results`；每次运行创建 `desktop-native-product-*`
子目录，profile 和 legacy 均位于其中，严格遵守现有 headless 标记边界。

启动前由总控提供已构建的应用、Core/host 和 runtime 路径。驱动本身不构建、不
更新程序，不为模型增加 token、调用次数或整轮时长限制。单次 IPC 的传输超时
不是模型预算；模型运行期间持续接受操作命令。

```powershell
$env:CRAFTMINE_ELECTRON_BIN = '实际已安装的 electron.exe 绝对路径'
$env:CRAFTMINE_EVAL_CORE = '实际 craftmine-core.exe 绝对路径'
$env:CRAFTMINE_EVAL_HOST = '实际 pi-desktop-host-core.exe 绝对路径'
node tests/product-agent-operator-native.mjs `
  --application-root '实际构建工作树绝对路径' `
  --runtime-resources '实际 runtime-resources 绝对路径' `
  --codex '实际 codex.exe 绝对路径' `
  --output-root 'D:/cm-product-agent/test-results'
```

也支持既有 `--packaged-root` 成品参数，以及 `--resume` 指向本驱动原报告。
恢复只能使用同一输出根目录下、带有真实测试标记的原 profile；世界已创建但创作会话尚未建立的启动中断，也可以继续完成普通会话入口。工作台使用现有“创作”按钮，不要求档案预先存有游玩浮层布局。旧命令不自动重放；
中断的命令标为 `interrupted-on-resume`，旧报告保持原样。总控必须先检查当前
真实状态，再提交新的操作。重复 ID 的不同字节写入独立冲突记录，不覆盖旧结果。

启动会实际验证 Codex 登录和模型，必须为 `gpt-6-astra` / `xhigh`。从普通示例
选择器创建完整 `promo-city` 的个人副本，使用该世界实际创建的会话，不伪造任务。
然后通过素材库的真实玩法组合表单选择 recipe v2：保留当前场景、博美伙伴、
保留天气、收集三个目标。读取组合并交接到 Composer，**此时尚未发送模型请求**。
总控检查报告中的组合和完整城市后，再提交 `send-composer`。

标准输出首先给出独立输出目录、`inbox`、`status.json` 和本次取消文件。
将命令 JSON 先写入临时文件，再原子改名为 `inbox/<id>.json`。每个命令 ID
只能使用一次；结果在 `responses/<id>.json`。操作失败不会继续执行其后续步骤，
也不会代替玩家选择第一项。

```json
{"id":"001-send","command":"send-composer"}
```

```json
{"id":"002-rain","command":"prompt","args":{"text":"改成雨天，再增加一个收集目标。保留现有城市、收集进度、飞机解锁和驾驶玩法。"}}
```

| 命令 | 参数与作用 |
|---|---|
| `status` | 保存当前对话、原始待回答问题、权限请求、素材建议、任务阶段、世界观察与 brief。后台也会更新。 |
| `prompt` | `{text}`，使用普通公开 `agentPrompt`，携带当前真实 creationTarget（若可获取）。 |
| `send-composer` | 执行真实 Composer 发送处理器，保留通常的输入清空、上下文与消息生成逻辑。 |
| `composition` | 可选 `{wish}`，重新读取 recipe v2 并填入 Composer，不发送。 |
| `feedback-repair-draft` | `{description,expected,capture?}`，通过当前世界素材库的真实反馈表单预览、确认导出，读回记录并点击实际“交给 AI 检查”按钮。`capture` 默认 `false`；保留原有 Composer 文字和反馈世界/构建身份，返回草稿、反馈编号及导出文件哈希，绝不发送。 |
| `answer` | `{requestId,answers}`，`answers` 为每题的字符串数组或 `null`；支持按真实目标填写自定义答案。 |
| `permission` | `{requestId,decision:"allow-once"或"deny"}`，仅处理当前显示的请求。 |
| `install-proposal` | `{proposalId}`，提交实际素材建议表单；不自动采用检查结果。 |
| `candidate` | `{action:"preview"或"apply",candidateId}`，必须匹配当前会话真实候选。 |
| `explore` | `{steps}`，使用现有 `godotExplore`，绑定刚读取的 world/build/instance 身份；操作集遵守现有驱动契约。 |
| `input-segment` | `{identity:{worldId,buildId,instanceId},segment:{keys?,buttons?,motion?,frames,settleFrames?,capture?}}`，仅走私有父进程验收入口，通过实际 Godot Web 事件处理器输入，记录三阶段证据。 |
| `cancel-inputs` | `{identity}`，释放指定当前世界的私有输入。运行中也可创建 `report.activeInput.cancelFile` 及时停止输入，不停止模型或应用。 |
| `capture` | 保存当前正式世界的绑定原生画面、SHA-256、身份及观察，不修改画面。 |
| `history` | 可选 `{branchId,skip,offset}`，读取普通版本面板和源码索引。 |
| `source-read` | `{branchId,revision,manifestHash,path}`，现有接口只读首个 16000 字符；`nextOffset` 非空表示未读全文，不能伪称完整源码。 |
| `brief` | 通过现有主窗口 `world.brief` 读取用户目标和保留要求。 |
| `goal-add` | `{expectedRevision,kind:"goal"或"preserve",text,operationId?}`，显式添加用户条目。 |
| `goal-review` | `{expectedRevision,id,buildId,accepted,operationId?}`，仅由总控在检查真实结果后明确评审。 |
| `save` | 普通保存；可传 `{freeze:true}` 保存并冻结，收到的是实际持久化回执。 |
| `resume` / `snapshot` | 分别走已有普通继续游玩接口和实际运行时快照读取；虚拟输入不会自行把暂停世界改成运行，也不写入玩家或飞机状态。 |
| `reopen` | 闲置时保存／冻结并读取真实保存时快照，再正常退出、同一 profile 冷重开；保持原世界及会话身份，同时保留恢复快照和作品目标。恢复后已正常推进的物理状态不能当作保存瞬间的同一帧。 |
| `publish` | `{name,description,tags,aliases,includeSavedProgress?}`，提交真实世界模板保存表单，boolean默认true兼容历史。当前产品仅支持已保存进度；传false只会按真实checkbox得到表单拒绝，不支持无进度/0项模板，也不会暗中改成true。连续发布先走“继续保存其他内容”，等待旧结果移除及新表单就绪；每次创建新素材并校验结果属于当前世界和新提交。 |
| `export-template` | `{assetId,version?}`，通过真实模板导出表单导出；先切换真实页签清除旧完成提示，等待本次“已导出世界模板 ZIP。”终态，核对选中 asset/version、无错误、最终字节 SHA 与界面 SHA256 一致，再保留唯一名字的 ZIP 证据。文件出现或 mtime 改变不代表导出完成。 |
| `open-world` | `{}`，导出后经真实“我的世界”页签及当前世界打开表单返回，验证原world/session。仅打开已有当前世界，不换世界或创建会话；需要冻结时随后显式save。`reopen`用于世界运行时的保存冷开，导出停留入口时应先用open-world。 |
| `abort` | 普通 `agentAbort`；驱动保持运行，便于检查中断结果。 |
| `quit` | 会话停止后正常退出；有活动模型时要求先完成或显式取消。 |

启动时另给 `--check-replay-sha256`，才能调用只诊断的 `replay-check`。它读取本驱动输出目录中固定的 `replay-packet.json`，经实际主进程核对父进程指定的 SHA 后，将真实失败作业的原始描述交给同一个生产检查器。此命令不调用模型、不写原作业、不采用候选；必须读取内层 `evidence.passed`，命令返回成功本身不等于检查通过。它用于比较全新档案与已有世界／会话环境，不替代正常 Agent 检查验收。

`input-segment` 操作驱动会显式执行普通继续游玩，再发送有限的虚拟输入；收到结果后立刻释放按键，并通过普通 `runtimeSave({freeze:true})` 保存和暂停世界，记录真实回执及冻结快照。飞机油门等持久控制量不会因松键自动归零，暂停能避免操作员阅读报告时飞机继续飞行。失败也尝试相同的释放与暂停；若身份已变化则拒绝操作新实例。此流程是分段功能检查，不代表连续、不暂停的真人操控手感测试。

持续输出：`status.json`、`session.json`、`agent-events.ndjson`；每轮的正式
`sessionTurnMetrics` 与对应转录保存在报告和 `turns`。`captures` 保存实际画面
和导出 ZIP。报告记录实际运行二进制 SHA、源码 bundle 身份、逐轮消息/turn ID、
有效模型事件和正常退出审计。

`mainSha256` 哈希的是 launch helper 返回的实际源码内容，并在源模式下与直接
读取文件字节的哈希交叉核对。每次启动和最终退出检查报告所列 main、preload、
Core、host、Codex 文件；成品模式还检查完整包清单。源模式不宣称检查了全部
依赖文件。完整性失败写入 `finalIntegrity` 后才保存最终报告并返回非零退出码，
不会在报告保存后抛错而留下“验证通过”的假象。

现有 `explore` 接口只支持 `look`、`walk`、`wait`、`interact`、`attack` 和
单帧 interact 的 `play-action`。它没有通用油门、方向舵或天气按键；不得把步行
操作当成驾驶验收。普通历史分页用 `history.offset`，每页读取最多 32 个源码描述。

新增的 `input-segment` 使用与独立 Codex 试玩服务相同的固定虚拟输入控制器，
可以在真实生成世界中测试油门、俯仰和天气键。必须先从当前状态读取完整 identity，
例如 `segment:{keys:["KeyW","ArrowDown"],frames:120,settleFrames:1}`。这不是
真实鼠标/键盘输入，不触发焦点或 Pointer Lock。每段释放可能按下的键，保存
before/during/after 原生快照、观察和 PNG；采样不是同一物理帧，期间实际物理
可能继续运行。`status:failed` 或 `partialEvidence.heldUnreleased:true` 必须处理，
不能把邮箱命令已有响应当成玩法通过；后者会阻止下一段，直到明确释放成功。

创建标准输出中的取消文件或发送 SIGINT/SIGTERM 会请求普通取消，再正常退出。
所有窗口必须始终 offscreen、不可聚焦且不可见；不得真实鼠标/键盘输入、
Pointer Lock 或操控用户浏览器。

驱动只记录实际操作和证据，**不根据 AI 文字、编译通过或画面中的飞机宣告玩法
成功**。总控需要根据真实生成的玩法源码与状态，继续检验收集前锁定、三个独立
目标、解锁、真实跑道和起降、存档重开、多轮修改保留结果及模板复现。

2026-09-14 保留导出复制竞态证据：`captures/world-template-1789352559989-6a178ac5-e1c7-4580-9401-1139857537bb.zip` 只有 7,864,320 字节，是最终 10,059,483 字节 picker ZIP 的精确前缀，普通导入报 `ZIP_BAD_CENTRAL_DIRECTORY`。此前驱动只等文件出现/mtime变化，误在写完前归档。修复同时用于 operator 和首次创作全流程导出；成功必须有本次真实 UI 完成提示及选中版本的 archive SHA，取消、错误、旧提示、换选版本或字节不匹配均不得归档成功。该旧失败保留，不改称成功。

## 通过真实试玩反馈准备独立修复轮

当前模型轮和输入片段必须先结束，再发送显式命令，例如：

```json
{"id":"031-companion-feedback","command":"feedback-repair-draft","args":{"description":"博美在窄路中挡住玩家，正常步行无法通过。","expected":"保留博美跟随与城市玩法，在窄路附近给玩家让出通行空间，并实际检查。"}}
```

命令使用当前选中的世界及其真实创作会话，不能通过参数指定另一个世界、文件
路径或自动发送开关。它填写现有 PlaytestPanel，预览后确认导出到该测试档案
的原生选择器文件，核对 Rust 读回记录，再点击实际修复草稿按钮。返回
`feedbackId`、`context`、`composerText`、唯一证据文件路径、字节数和 SHA-256，
以及 `sent:false`。若事先有 Composer 文字，必须原样保留；会话消息 ID 也必须
未改变，才可报告草稿交接完成。命令不会直接写数据库、伪造导入或执行修复。

只有显式传入 `capture:true` 才附带真实预先捕获的世界画面，导出的 Base64
必须与预览相同。首次画面未准备好时，可按界面提示关闭、重开素材库一次，
保留原文字并记录恢复动作；仍失败就停止命令。总控核对草稿后，再另发
`send-composer` 才会启动真实模型。不要把准备草稿与天气修改等另一轮混在一起。
