# 作品安装后的检查等待

`craftmine-package-service.ts` 新增页面请求 `package.request` / `sourceJob`。
参数仅 `{worldId,jobId}`；jobId 必须为 `gjob-` 加 64 位小写十六进制。
宿主在查询前后核对当前世界，通过已有私有 `godotBuild.read` 查询，并校验
回执 worldId/jobId/status。返回仅 `{worldId,jobId,status,terminal}`；不返回
源码、request、token、文件路径或完整输出。没有新增核心或模型权限。

面板收到 check-queued 后锁住导入和重复安装，轮询该次 job。
`passed/failed/cancelled/interrupted` 才视为终态并允许再次安装。
`blocked` 在核心注册执行器后可能重新排队，因此显示阻塞并停止自动轮询，
提供手动重查；查询失败同样保留此次安装和 job，重查不会再发安装请求。
失败检查保留源码，用户可查看检查记录。面板 clear 清理 timer，拒绝迟到
响应；同世界重新打开会续查已知 pending job。世界切换不会挪用旧授权。

验证：

- 本地 `node --test --test-isolation=none tests/godot-final-install-assets/package-ui-pending.test.mjs`
  **2/2 通过**，纯 DOM 形状对象和可控时钟，覆盖等待、终态、查询失败、
  blocked、卸载和迟到响应。它是状态机 fixture，不是完整客户端验收。
- 宿主测试首次本地因 esbuild 子进程 `spawn EPERM` 无法启动；主任务随后在
  同一树实跑 `package-native.test.mjs` **6/6 通过**，原始日志
  `test-results/final-package-pending-native.log`。包括参数拒绝、跨世界拒绝、
  投影无私有字段及 blocked/terminal 语义。
- 既有 `package-ui-headless.mjs` 的固定请求适配器已补 sourceJob 响应；本轮
  未启动浏览器重跑，不能把该文件改动当成真实 E2E 通过。
- UI、headless 测试脚本语法检查和 `git diff --check` 通过。

后续完整客户端步骤：导出一个真实对象，在另一世界导入后立刻查看重复安装
按钮应禁用；检查结束后再安装第二实例；关闭再打开面板应续查而不重复安装。
此前完整客户端源码复用的验收不替代本轮 UI 等待行为的实际客户端验证。
