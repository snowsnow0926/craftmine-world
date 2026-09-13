# 实际 PI Desktop 多轮创作操作驱动

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
| `export-template` | `{assetId}`，通过真实模板导出表单导出，并保留带唯一名字的 ZIP 证据。 |
| `open-world` | `{}`，导出后经真实“我的世界”页签及当前世界打开表单返回，验证原world/session。仅打开已有当前世界，不换世界或创建会话；需要冻结时随后显式save。`reopen`用于世界运行时的保存冷开，导出停留入口时应先用open-world。 |
| `abort` | 普通 `agentAbort`；驱动保持运行，便于检查中断结果。 |
| `quit` | 会话停止后正常退出；有活动模型时要求先完成或显式取消。 |

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
