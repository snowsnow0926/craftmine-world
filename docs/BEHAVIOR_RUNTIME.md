# 新玩法代码运行接口（M1）

这是 Agent 编写新规则的通用执行基础。Alpha 0.5 已接入真实模型输入、候选检查、世界交互和完整进度存档，并通过模型生成滑门与弹跳板的实际物理验收。Alpha 0.6 增加 M2 的跨项目源码记忆和实例绑定，详见 `ALPHA_0_6.md`。

## 代码产物

`app/behavior-contracts.mjs` 定义 `craftmine.behavior/1`：

| 字段 | 含义 |
| --- | --- |
| id / name / description | 稳定标识、显示名称、规则说明 |
| code | ES 模块源码，必须导出 `step` 函数 |
| stateVersion | 状态格式版本；后续迁移不依赖猜测字段 |
| initialState | 新实例的初始 JSON 状态 |
| params | 可调参数，如开门距离、弹跳高度 |
| targets | 允许影响的世界对象 ID |
| permissions | 声明需要的对象、玩家运动、提示、物品权限 |

源码接收 `step({frame, params, state})`，返回 `{state, commands}`。世界时间、事件、玩家与对象数据通过 `frame` 显式传入。持久状态放入返回的 JSON，不能依赖模块全局变量跨重启保留。定义、状态和参数有大小与复杂度上限。

`compileBehavior` 在 Node 中只校验数据并解析 JavaScript 语法，不执行用户源码。规范化后的完整定义计算 SHA-256。语法通过不能证明行为正确，因此产物中的检查说明明确保留这一差别。

## 执行和故障恢复

`BehaviorRunner` 在现有的独立来源游戏 iframe 内创建 Blob Worker。Chromium 中该 iframe 的 module Worker 入口不能载入，已改用 classic Worker 引导，再动态导入 ES 模块；引导代码先保存内部通信方法，再关闭模块不需要的全局及原型 API。仍保留 iframe 隔离，没有增加 `allow-same-origin`。

游戏页 CSP 仅增加 Blob 脚本和 Worker，网络连接仍为 `connect-src 'none'`，工作台仍禁止 Worker。Blob Worker 继承创建页面 CSP 的行为见 [MDN Worker 文档](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy)。

默认初始化限时 2.5 秒，每次计算限时 150 毫秒。主线程检查整批命令、目标范围、权限、数值及可保存状态，全部通过才返回结果并更新已确认状态。异常、非法输出、失控循环或卸载会结束对应 Worker；不会在主线程执行模型代码，也不会把源码交给 Node 运行。该切片没有完成任意第三方代码的全面资源隔离，跨世界分享代码需要后续依赖、来源及资源预算验收。

支持的命令为 `object.patch`、`player.impulse`、`hud.message`、`inventory.add`。`BehaviorState` 在整批命令通过实时物体边界、玩家与实体重叠、库存范围检查后提交；`BehaviorSession` 管理 Worker、事件与失败恢复；`world-runtime.mjs` 将结果连接实际网格、碰撞、物理和 HUD。空命令只更新已验证的模块状态，不重建整个世界。

场景 `/3` 保存行为定义，旧 `/1`、`/2` 的内容和构建哈希仍兼容。模型输出使用 `initialStateJSON` 与 `paramsJSON` 字符串传输任意 JSON 对象，验证后还原为实际参数和状态。`progress/3` 保存代码版本、已确认状态、相对对象原点的偏移、错误与库存；相同 `stateVersion` 的代码和外观修改保留进度，不兼容版本拒绝应用。

生成与导入源码使用独立 headless 浏览器访问无工作台凭据的检查页，限时30秒执行接口、事件和恢复检查。此检查不能代替语义验收：首次真实生成的门虽然通过接口检查，仍被画面检查发现悬空，随后用真实模型反馈修复并重新验收。

## 当前验证

- M1.1 初始底座有 30 项核心测试；完整 M1 的新增测试和最新证据见 `ALPHA_0_5.md`。
- `npm run test:behaviors`：11 项独立 headless 浏览器检查通过，报告 `test-results/behavior-browser-Ny0f6X/report.json`。
- `npm run test:browser`：原有世界、模块和玩法的 10 项后台回归检查通过，报告 `test-results/background-browser-tOcuNe/report.json`。
- 人工夹具和真实模型产物分别验收。真实生成报告在 `test-results/live-code-mudUMw/`；真实反馈修正与物理验收在 `test-results/live-code-repair-kAdtMv/`，弹跳高度为 2.899 米。
- 实际执行了顶层死循环、计算死循环、抛错、越权输出、缺少导出、原型 API 访问及动态执行的失败路径。
- 测试禁用鼠标锁定，仅使用独立后台浏览器中的页面脚本，不运行原生键鼠输入。

## 下个接点

M2 已增加 `craftmine.behavior/2` 的 `requires` 和 `binding`。宿主通过 `BehaviorBinding` 转换对象身份和坐标，原始源码、参数与 JSON 状态保持作者坐标约定；结果转换后再次通过实际世界校验。`behavior-state/2` 保存已卸载进度，兼容版本恢复原状态，未实现通用迁移的状态格式变化会拒绝应用。

M3、M4 已完成，当前继续 M5，完整证据见各版本交付文档。检查的接口事件通过不等于玩法语义通过，真实需求仍要实际运行验收。

## M5 共享背包与持久任务接口

使用新接口的源码采用 `craftmine.behavior/3`，增加 `capabilities` 数组，保留 /2 的 `requires`、`binding`。只声明实际需要的能力：

| 能力 | 接口 | 约束 |
| --- | --- | --- |
| `inventory.read@1` | `frame.inventory`，例如 `{wood:3}` | 只读本步快照，缺少 ID 视为零；按场景顺序读取前面模块已提交的库存 |
| `inventory.items@1` | `{type:'inventory.define',item:'wood',name:'木材',description:'用于制作'}` | 需要 `inventory.write`；名称 40 字、说明 200 字；同 ID 首次定义保留 |
| `hud.panel@1` | `{type:'hud.panel',key:'quest',panel:{title:'营地任务',lines:['木材 1 / 3']}}` | 需要 `hud.message`；每模块最多 3 个，标题 48 字、最多 6 行且每行 120 字；`panel:null` 删除自身面板 |

背包计数仍由 `inventory.add` 改变，最多 128 种物品、每种 0–9999；物品定义目录最多 128 项，即使计数归零仍保留名称。库存不足应由源码返回正常提示，不能直接提交负库存。扣料、物品定义、对象变化、持久面板及状态在整批检查通过后一起提交。注册可在 start 执行，奖励须使用已保存的状态标记，不能因加载再次发奖。

`behavior-state/3` 增加共享 `items` 与每份模块进度的 `panels`。旧世界继续输出 /2；出现新源码或已经保存 /3 进度时才使用 /3。面板以 DOM `textContent` 绘制，有独立高度限制和滚动区域；不解释 HTML。卸载时隐藏并归档，兼容恢复时继续，移除面板能力时不保留活动面板。

带新能力的完整创作使用 `craftmine.module/4` 与 `craftmine-web/5`，能力写入依赖列表。旧模块约定和旧内容哈希不变。M5.1 验证与限制见 `M5_WORLD.md`。
