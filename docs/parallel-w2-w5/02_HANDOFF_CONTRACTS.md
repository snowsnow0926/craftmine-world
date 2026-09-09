# 交接接口约定 v1

这是 A–F 并行开发采用的最小协议草案，**下列新增接口尚未在基线中实现**。不要把本文的方法名当成已经可调用的 API。先检查既有实现；能直接复用时由负责组提供兼容适配，避免同时维护两份可写数据。

本文件由协调者维护。各组在自己的 `INTERFACE_<ID>.md` 提出必要修订；在其他组尚未收到修订前保留 v1 适配层。最终以 G 集成并通过跨组测试的版本为准。

## 1. 已存在且应继续使用的事实

Rust `craftmine-core` 已拥有 worlds、workspaces、verifications、reviews、applications 的事务与持久记录；模型不能填写成功证据。正式应用仍走第 5 批的玩家应用链。不得另建 JSON 文件当作同一个桌面世界的可写主库。

既有作品由 `app/memory.mjs` 校验：`craftmine.module/1..4`，kind 为 object/gameplay/creation，格式取决于是否包含创作组、素材和扩展能力。既有类型化记忆为 `craftmine.memory/1`，状态 proposed/validated/needs_revalidation/retired。新索引应包裹这些格式，不能把“换存储”变成全盘改包格式。

地表 y=6，源对象、行为状态和实际绘制 mesh 是不同观察；隐藏时逻辑对象保留而 drawable mesh 可以不存在。来源于模块夹具的 mesh 字段不能代替真实渲染器证据。

## 2. 身份、版本和错误

- 可信绑定由宿主注入，包含现有 projectId/sessionId/turnId/taskId/baseBuild、toolCallId/executionId；新增 generation 与 requestId 由 A/B/G 在宿主侧生成与核对。模型参数不能替换这些值。
- 展示接口可以接收玩家明确选择的 worldId；写入接口必须再次核对任务绑定、写入租约、版本与当前代际。异步回复不能用“此刻选中的世界”重定向。
- 世界版本、草稿版本、作品版本和源码哈希各自明确。作品引用使用 `{id, version, hash}`，安装不能默默取 latest。
- 已有错误格式保持兼容。新错误需要稳定 code、可理解 message、retryable 与可选 expected/actual；不得把程序栈、密钥和完整数据塞进普通 UI 提示。
- 公共边界拒绝未知字段；大源码、包和证据使用有界分页或分段读取，工具返回短结果与引用。

## 3. A 提供的领域接口

RPC 仍由 Rust 服务私有通道处理；名字是本派工约定。私有操作不等于给模型开放同名工具。

| 新接口 | 必需语义与返回 | 消费者 |
| --- | --- | --- |
| `library.search` | query、kind/tags、scope、offset/limit；返回不可变引用、名称、短描述、依赖摘要、证据状态及分页，不返回整包源码 | B/C |
| `library.read` | 精确 id/version/hash，分段或有界读取旧格式兼容的作品包；不存在、损坏、版本不符分别报错 | B/C/D |
| `library.capture` | 私有操作，从真实应用记录和明确选中的资源组提取作品；包哈希、素材/扩展/共享物品依赖及证据必须核对；同一 operationId 不重复创建版本 | C/G；可由可信应用后策略调用 |
| `library.prepareInstall` | 精确作品引用、目标草稿 revision、位置/参数；输出待提交 operations、ID 重绑与依赖映射、冲突和包 hash，不写正式世界 | B/C，经既有草稿事务提交 |
| `memory.search` / `memory.propose` / `memory.retire` | 类型化记忆、真实来源和世界/项目作用域；validated 只能由宿主核对真实证据后赋予，不接受模型自填通过 | B/C |
| `task.context` | 短快照：绑定、状态、当前需求/纠正引用、world/draft revision 与 hash、改过的资源、回执/作业/证据引用、租约和预算；大正文按引用读取 | B |
| `task.resume` / `task.discard` | 玩家明确操作；崩溃后不自动重放。resume 获取新代际并核对旧提交，discard 不覆盖已应用世界 | B/C |
| `budget.inspect` / `budget.reserve` / `budget.settle` | 按任务持久账本；请求/摘要/评审/重试共享额度，幂等预约与结算，压缩不能归零 | B/E 诊断 |
| `backup.export` / `backup.inspect` / `backup.restore` / `backup.status` | 以一致快照保存世界、进度、作品和必要来源/证据；有界作业、哈希清单、格式检查、取消与回执；恢复在临时区域校验后原子提交 | E/C |

作品索引至少包含：引用、类型、名称/标签、sourceWorldId、sourceBuildHash、来源应用/验收引用、依赖、兼容运行器、createdAt。保留 proposed、verified、applied 的来源事实，不能把三个阶段混成一个布尔值。跨世界复用作品是显式行为；规则、用户纠正与任务历史默认不能跨世界注入。

`prepareInstall` 不能只改顶层对象 ID：行为 targets、对象引用、共享 item ID、素材固定版本、扩展依赖都要映射和验证。只有既有草稿事务提交成功才返回安装成功；之后仍需新世界的检查/评审/应用。

预算至少区分 requestCount/toolCallCount/compactionCount、估算预留、供应商实际用量和截止时间。网络结果不明时记录 unknown/reserved，不假装消耗为零。缓存、输入、输出与 reasoning 的供应商统计不能重复相加。

备份默认排除凭据、Chromium 缓存与日志中的私人内容。E 负责可信目录选择和文件访问授权，A 负责内容、一致性和恢复事务。UI/模型传来的任意路径不能直接成为读写权限。备份为可携带作品数据；系统凭据跨机迁移另走 E 的明确说明。

## 4. B 提供的运行器接线

在既有 PI 请求边界增加注入接口，不另写主循环。建议导出一个可注入的 provider，G 负责把宿主真实绑定与 A 的领域调用送入它：

```ts
type DomainCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;
// Parameters are validated at each actual transport boundary.
// Types below name the required responsibilities, not a production SDK yet.
interface CraftmineRequestHooks {
  beforeRequest(input: unknown): Promise<unknown>;
  afterRequest(input: unknown): Promise<void>;
  onBoundary(input: unknown): Promise<void>;
}
```

B 的 INTERFACE 文档必须把 unknown 落成明确类型：beforeRequest 输入包含宿主绑定、requestId、purpose（创作/摘要/评审）、当前模型窗口与完整待发请求估算；输出包含短 context blocks、预算预约引用与本次上限。afterRequest 结算真实 usage/错误/未知结果；onBoundary 处理首次调用、压缩完成、模型切换、停止、恢复和世界切换。

不可把完整世界源码塞进每次请求。必须保留系统/工具/附件/消息/输出预留的计量依据；请求源事实由 A 查询，不从模型摘要反推。PI 一次性评审也通过同一任务预算接线。C 只消费可显示的状态和进度投影。

## 5. C/E 使用的界面与系统端口

保持现有 `pluginBridge` 授权路径。C 的新 UI 通过可注入 `request(channel, payload)` 与只读能力状态工作；A/B/E 未接入时显示可理解的未就绪状态，不虚构成功。

候选的现有 apply/preview/review 语义保持不变。新面板 channel 采用 `library.*`、`memory.*`、`task.*`、`backup.*`、`diagnostics.*` 的业务名称，由 G 显式允许并转发到对应宿主服务；不是通用 `core.call` 或任意 RPC 代理。

E 的凭据服务继续使用 PI SecretStore 抽象。状态投影只显示 protected/fallback/unavailable 与可理解的处理方式，不向渲染器、模型、日志和作品返回 secret。Windows 系统保护故障不能静默换成明文存储。

备份/诊断系统模块依赖注入 A 的 DomainCall 和宿主选择器，可先用契约夹具验证 UI/传输；真实文件导出和恢复事务必须由 A/E 的实际实现共同验证。

## 6. D/F 的运行与证据端口

D 复用现有 ABI、编译器、Worker 和实际游戏事件；新增事件/能力需补准确能力目录与兼容测试。验收环境也必须装载相同版本扩展及素材。扩展自带测试、反空实现、冻结回归与需求断言分别留证据；评审建议不会自动获得执行权限。

F 只在现有严格 headless 原生入口下增加有界场景。新增测试消息通过独立接线补丁交 G 审查；不能添加通用 eval、任意模型调用或高权限公开面板 RPC。模拟按键数据进入已有游戏测试协议可以，模拟操作系统输入不可以。

每条最终证据记录：源码 commit/tree、overlay hash（若有）、binary hash、profile 隔离方式、模型/思考/提示版本、真实用量、草稿/作品/世界及证据 hash、实际观察、失败信息、输入/焦点/页面错误审计。未接线分支与已接线临时树的成绩分开。
