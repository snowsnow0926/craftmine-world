# 预制世界模型验收的提交前阻断（2026-09-12）

本次自然愿望尚未发给模型：**再放一棵橡树在左边，和已有的树错开。** 初次命令在成品启动前发现独立工作树缺 electron-builder；通过既有隔离依赖脚本补齐后启动了 bafb5b18 冻结成品。

实际运行报告为 `D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/player-d052dbdb-eaee-4b20-9464-bddd91e72d62.json`。结果 RUN_FAILED / OWNED_WORLD_UI_RESPONSE_TIMEOUT，sessionId 与 submittedAt 均不存在；退出后只读 SQLite 确认 sessions 仍为 0。没有模型请求、没有新增会话、没有资产安装或作品源码修改。

驱动在准备普通 sessionCreate 时，会枚举独立 Electron CDP 的所有 target 做 Runtime.evaluate。实际列表包含普通主 renderer、世界视图、Godot 游戏页及多条 WASM worker；只有主 renderer 需要被查询，其他 target 无须参与且可能不及时响应。旧代码未记录具体超时 target，因此不能进一步断言一定是哪条 worker 挂起。

最小修复：只有 type=page、file: 协议、路径为现有 /out/renderer/index.html 的普通主 renderer 才进入探测，同时保留同一个独立 loopback 端口和 headless 标记检查。新增 fixture 把 Godot 页面和 worker 排在主 renderer 之前，若连接它们便立即失败；8 项普通入口与恢复来源回归全部通过。

本次通过隔离实例自身的普通 windowControl.close 收尾，没有真实输入、没有置前、没有强杀。最终 exit code 0，violations/pageErrors/shutdownFailures 三数组为空，stateIntegrityVerified=true；旧六份来源文件 proof 均保持。此字段仅证明已执行的退出和文件完整性检查，不代表模型创作成功。

按总控最新安排，不再重开 bafb 包。等待同时包含 60 秒安装事务修复与组合场景的新冻结包，再进行一次普通玩家输入。仍复用同一成功冷重开证据链与原 profile，不新增模拟答案或资产 ID/坐标提示。
