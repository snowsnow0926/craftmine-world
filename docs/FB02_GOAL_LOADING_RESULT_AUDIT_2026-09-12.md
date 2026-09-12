# FB02 goal：加载与结果操作链开发复核

本文记录 FB02-001、008、009 的工程修复和本地验证。最终 Windows ZIP 的运行证据由总控集成报告补充；本文件中的有限 host 测试不等同于真实 Godot 候选提交、存档持久化或真人按键验收。

## 修复的断点

1. **加载必须在等待之前出现。** 首次进入、切换、新建和备份恢复后的重载统一经过可见加载层。进入目标世界前先隐藏旧的原生游戏表面，避免它盖住页面上的进度条。目标世界事件不再因为旧世界仍然保留在 `current` 而被丢弃；旧世界的延迟 ready 事件不能盖掉新世界的等待状态。
2. **失败必须有下一步。** 加载失败展示重试；切换/创建失败还提供返回原世界。重试保存失败目标的身份，创建重试沿用 operationId，不重复创建。新建 Godot 世界会提前切换原生实例，因此重新打开时允许旧实例已经不在，不把 `GODOT_WORLD_CHANGED` 当作必须永久停止的错误。
3. **结果不再以“已打开预览”为前提。** 新增 `CraftmineCreationResult`，从 host 的持久 job 与正式 build 读取生成、检查、等待自动继续、自动修复、采用和失败状态。检查完成即显示“预览副本”和“应用到世界”。原 `CraftminePreviewControls` 继续处理已打开预览的采用、返回和不确定结果确认。
4. **任务归属必须明确。** 结果带 world/session/job/candidate/build 身份；私有 main IPC 先确认当前允许查看的会话、选中的世界、最新 job 与 ready candidate 的关联，才进入保留的产品页面。不能从 renderer 传入应用 token、snapshot、路径或任意脚本。后端现有 candidate/coordinator 仍执行正式内容与保存确认。
5. **重进会话不能丢失结果。** `godotBuild.latest` 支持私有 host 按 session 查询跨世界的最新 job。省略 worldId 时 sessionId 必填，找到的 job 仍重新经过 world scope 验证；不依赖 renderer 自建的世界/候选数据库。结果世界与当前选择不同，显示“切换到目标世界”，切回后才能采用。
6. **不能把队列状态当作正式采用。** `applied` 仍由正式 build 与该 job 的 build 一致来判断。持久自动队列只能补充 applying/deferred/repairing 等状态。检查通过与愿望语义验证分别表达。自动检查晚于模型 turn 的结果持续轮询；不再因为观察器运行 30 分钟而停止读取。
7. **失败不可把控件锁死。** 预览 IPC 操作现在向主界面传播失败，主界面保留错误；错误文字本身不再永久禁用下一次重试。依然保留真实 pending、close 禁用与 preview nonce 约束，不允许并行重复提交或在不确定采用期间退出。

## 已运行的验证

| 验证 | 结果 | 范围与证据 |
| --- | --- | --- |
| `tests/godot-startup-loading-headless.mjs` | 20 项通过 | 真正 `world.html` 与打包后的 `view.mjs`，延迟/失败 host RPC；`test-results/godot-startup-loading-luwDe5/report.json` |
| `tests/fb02-creation-result-headless.mjs` | 10 项通过 | 真正 React 结果卡、状态 observer、预览控件及保留的 plugin controller；有限 domain fixture；`test-results/fb02-result-qMzili/report.json` |
| 身份、预览与任务状态测试 | 17 项通过 | `creation-result-access`、`creation-host-task-status`、`creation-task-status`、`craftmine-preview-controls` 四个测试文件 |
| Rust `latest_world_job_is_filtered_by_the_host_session_without_starting_a_task` | 1 项通过 | 真实 core journal 查询，跨世界重开会话、别会话隔离、空 session 和缺 scope 拒绝 |

连续 DOM 验证从原检查列表中的“预览副本”按钮函数开始，打开精确候选、返回原世界；再从对话结果卡直接采用，注入一次保存失败，经过预览 nonce 重试并核对正式结果，重载会话读取 host 事实，切回结果目标世界，切换别会话后不暴露旧候选。有限 fixture 的 `coins=12` 保留只证明组件/控制器未破坏该数据，不是最终游戏存档验证。

所有浏览器测试使用独立 headless profile，初始化禁用 Pointer Lock 和 focus；未发送真实键鼠输入，也未触碰原玩家 profile。截图 `result-ready.png` 已检查，确有目标世界和两个直接动作。其测试页仅挂相关组件，最终客户端样式与原生层叠应以最终包截图为准。

## 总控集成仍须验证

- 从最终 ZIP 解压出的程序、真实旧世界副本以及新会话开始，验证原检查列表按钮到真实候选预览、退出、采用、保存、关闭并重开；核对 formal build、content applied/head、原有草稿和 snapshot。
- 验证 Godot 新建世界（初始化状态）、切世界失败/返回、恢复后重开，加载卡不会被 native sibling view 盖住。
- 普通工作台与沉浸对话分别挂载结果卡；纯对话创建仅对同一 session/world 的正式 applied 事件显示完成。
- 自动生成、检查、修复、应用使用同一持久归属，不把本文件对有限 host 的验证替代实际全自动模型流程。

原反馈和失败复测保留；本文件不把整个 FB02 批次标记为完成。

## 后续补充：真实原生运行与 Rust 持久数据

以下使用统一开发构建，实际运行 Craftmine Electron、Godot Web 原生子视图和 Rust core。每次先只读复制来源 profile，然后仅操作 `test-results/desktop-native-candidate-*` 独立目录。未修改原玩家 profile、测试时的应用 out 或 resources。最终 ZIP 仍应使用同一脚本复验。

| 证据目录 | 真实运行结果 |
| --- | --- |
| `desktop-native-candidate-KMePFx` | 用户截图对应 creation-sandbox 世界。原列表按钮打开保留的 ready 草稿 `gcan-ea4…`；返回保持原 formal 和全部 progress；再次预览后用真正 main 预览条采用；保存退出，再启动确认 build、appliedOid、main head 和完整 snapshot。5 项通过，两次退出均 code 0。 |
| `desktop-native-candidate-FOdVEY` | 在上一链基础上等待采用旧草稿触发的地面维护完成，比较保留草稿 21 个文件：只有精确 stock `creation_world.gd` 被换为柔和地面版本，其余 20 个文件哈希和 bytes 不变，包括玩家的 `pomeranian_pet.gd`。全部 snapshot 保留；第三次完整启动后合法后继 build 与进度稳定。7 项通过。 |
| `desktop-native-candidate-J8xoAB` | 来源固定为 `desktop-native-fb02-gjdMTq/profile` 的旧 stock 世界。维护开始后从原候选按钮进入预览，实际维护被取消；返回后正式实例 ID 保持不变；无需重新打开世界，维护自动恢复、实际导出检查并采用。全部 snapshot、未采用的 main 草稿 head 保留，地面脚本为新 hash，实际 native 截图为柔和绿。3 项通过。 |
| `adoption-lineage-core-o0d5Tv` | 从 FOdVEY 的关闭后数据再复制独立 domain，运行最新 Rust core 与真实 Git。验证原玩家 candidate 是当前维护后继的祖先；先前维护的另一支虽曾采用却不是当前祖先；当前 candidate 与 formal 一致。3 项通过。 |

对应报告均为各目录的 `candidate-lifecycle-report.json`，最后一项为 `report.json`。原型检查表中的“有限 host fixture”范围只适用于上半部分 DOM 测试；本节不是 stub 或伪造 executor evidence。它验证保留作品的真实预览采用，没有声称重新调用模型生成了这些作品。

### 采用后的状态语义

实测发现，采用旧的合法草稿后，后台维护可以正常生成更新的地面版本。不能因为 formal build 已变为其后继，就把已完成的生成任务重新标为“待采用”，让玩家重复回退。

已补充 Rust `godotCandidate.read.adoption`：绑定 world/candidate/build/currentBuild，读取持久 applied 事实，并对实际 formal commit 与 candidate commit 做 Git 祖先验证。结果卡对合法后继显示“已采用，当前世界还包含后续更新”；对于曾采用但当前切到别支或回滚的结果，显示“已采用过，当前世界使用其他版本”，不产生新的应用邀请。被取消、失败或错误身份的候选不能依赖该提示绕过原应用事务。对应状态回归测试新增 1 项。

### 明确保留的验收发现

- 第一次中断恢复尝试 `desktop-native-candidate-xmQkD5` 的逻辑和真实采用已完成，但末尾产品 `godotCaptureView` 因请求 1280×720、实际收到 2560×1440 帧而失败，该报告仍标失败。后续 J8xoAB 用 `CDP noDefaults` 直接捕获同一个实际 attached native page，不改 viewport、不模拟焦点，得到有效像素。此举没有把产品捕获 API 的尺寸问题宣称为已修。
- KMePFx 的 main 截图发现聊天绝对定位顶栏遮挡预览提示文案。负责工作台布局的 agent 已把提示移入顶栏后的统一容器；最终构建需复核提示标题在顶栏下方，不能只因按钮可点就忽略文字被遮挡。
- 全部成功原生运行的退出报告 `violations`、`pageErrors`、`shutdownFailures` 都为空。保留的原型失败报告不删除、不混作最终成功证据。
