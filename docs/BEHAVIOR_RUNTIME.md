# 新玩法代码运行接口（M1.1）

这是后续 Agent 编写新规则的通用执行基础。当前已经通过独立浏览器测试，尚未接入日常创作输入、世界对象或完整进度存档；用户正在运行的版本仍为 Alpha 0.4。

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

支持的命令为 `object.patch`、`player.impulse`、`hud.message`、`inventory.add`。目前只有命令契约和执行结果检查，**不代表这些命令已连接游戏世界**。主线程实际应用命令时还需检查实时碰撞、完整物体边界、库存范围，并保证整批应用与模块状态一起提交。

## 当前验证

- `npm test`：30 项通过，其中 6 项覆盖源码构建、JSON 状态、上下文、命令范围和预算。
- `npm run test:behaviors`：11 项独立 headless 浏览器检查通过，报告 `test-results/behavior-browser-Ny0f6X/report.json`。
- `npm run test:browser`：原有世界、模块和玩法的 10 项后台回归检查通过，报告 `test-results/background-browser-tOcuNe/report.json`。
- 滑门源码切换自己的开关状态，返回位置和碰撞修改；弹跳板源码按高度计算速度并执行冷却。两者使用同一个执行器，没有按玩法名称分支。这些是人工测试夹具，尚不是模型生成验收。
- 实际执行了顶层死循环、计算死循环、抛错、越权输出、缺少导出、原型 API 访问及动态执行的失败路径。
- 测试禁用鼠标锁定，仅使用独立后台浏览器中的页面脚本，不运行原生键鼠输入。

## 下个接点

1. 扩展场景格式保存行为定义，旧版本的构建哈希和存档继续兼容。为结构化模型输出设计明确的 JSON 参数/状态传输方式。
2. 接入模型输出和候选验证，实际调用模型生成代码；任何验证失败都不能进入已应用状态。
3. 实现游戏事件和命令应用，保存已确认的模块状态及对象变化；用门与弹跳板跑通交互、重载、异常和回退。
4. 随后进入 M2：把源码、状态版本、参数、依赖和验收证据纳入可导入、导出、复用的记忆。
