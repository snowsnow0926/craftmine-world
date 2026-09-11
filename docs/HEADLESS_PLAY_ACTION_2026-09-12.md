# 有限引擎动作桥开发记录

本轮解决真实模型脚本 `_unhandled_input` 无法通过原底座 `interact` 验证的问题。保留原业务操作，新增仅隔离测试控制器可用的 `play-action {action:"interact",frames:1}`。

宿主校验已建立的隔离 profile、父进程 IPC、当前世界／构建／实例，以及精确参数。普通请求拒绝初始化、动作、取消三个私有操作。每实例能力默认关闭，令牌不进入观察或模型结果；旧导出明确不支持新动作。

实际 Godot 使用单一 InputEventAction 链，按下和释放后刷新事件缓冲。首次真实引擎测试发现仅 parse_input_event 会延迟处理；修正后全局 Input 持有恰好一个物理帧。暂停、恢复状态、离树与取消释放持有。事件被处理后正常停止，不强行广播给新增脚本。

验证结果：

- 桌面 TypeScript 全量检查通过。
- 动作权限、exploration 及 PCK 完整性测试共 18 项通过。
- 锁定 Godot `4.7.2.stable.official.ed1daf0bf` 原生 headless 夹具 24 项通过，观测到 8 次按下、8 次释放、8 个持有物理帧。覆盖重复、并发、暂停、恢复状态、离树、身份和非法参数。
- 真实 Web 导出 8 项校验通过：新增 helper 与其余保护脚本按原始字节进入 PCK，导出期间篡改脚本或选择器继续被拒绝。

原始本地报告位于 `test-results/headless-play-action-rZYtNO/report.json` 与 `test-results/creation-pack-export-5F4W4p/report.json`；可通过已提交测试入口重跑。没有执行真实鼠标／键盘、Pointer Lock 或前台窗口操作。

这批验证证明事件分发和权限边界，不代表宠物玩法已经通过。实际模型作品的近／远交互、截图及存档恢复由总控集成验收。旧源码升级必须同步加入新版 runtime_bridge 与 headless_play_action，以及完整托管文件 pin；不得通过放松保护兼容。
