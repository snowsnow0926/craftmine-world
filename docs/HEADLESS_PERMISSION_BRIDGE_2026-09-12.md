# 普通玩家流程的后台权限答复

普通会话保持真实的 `inherit` 权限设置。当前全局未设置覆盖时回退到 `ask`：读取等低风险工具自动通过，世界源码修改、构建等中风险工具仍走原有审批。测试不能把权限改为 `auto` 或自动批准所有请求。

新增两个有限控制方法：`headlessPermissionPending` 接收 `{sessionId}`，仅投影该会话队首的 `requestId/sessionId/toolCallId/toolName/risk/argsPreview/reason`；`headlessPermissionResolve` 接收 `{sessionId,requestId,decision}`，仅接受 `allow-once` 或 `deny`。测试控制器先读取原始预览，由测试 agent 根据已授权场景审阅后明确答复。预览沿用产品已有内容截断，并遮蔽明确命名的凭据字段，不包含 provider 或其他 store 状态。

宿主入口要求既有隔离 profile、父 IPC、隐藏且不可聚焦的 offscreen 主窗口，并拒绝评测模式。renderer 仅在既有 headless guard 下安装桥。答复必须匹配已读到的同会话、同 requestId、同队首投影；随后调用原 `store.resolvePermission`，由其调用正规 `toolResolvePermission` IPC 和 `permissions.resolve`。不改变权限等级、超时、模型、预算或队列规则。

同一次请求一经尝试答复，成功、失败或回执未知均不重放；旧队首、跨会话、变更后的参数、额外字段、会话级授权都拒绝。host 仍是最终权限和过期状态的权威。测试只运行纯逻辑夹具，不运行产品、模型或真实输入。

验证：`node --experimental-strip-types --test tests/headless-permission.test.mjs`，覆盖正常投影与原 resolver 接线、允许一次/拒绝、身份与参数变化、重复/并发/失败回执、父权限及 renderer guard。
