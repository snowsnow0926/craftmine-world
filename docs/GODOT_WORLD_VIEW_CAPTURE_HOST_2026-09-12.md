# 世界截图 Host 实现（2026-09-12）

独立 worktree D:/cm-world-capture-host-0912，基于已提交 ad77b5e1。只修改 godot-world-view-host.ts、新图像 helper、专属测试和文档；没有改 index/plugin-runtime/模型工具或用户 profile，没有启动模型或成品。

新增 captureView 接口，正式与候选显式区分。候选 ID 原先不在 host descriptor 内，本次由正常 stageCandidate options 私有保存，丢弃、采用、关闭时清除；主机桥集成须将 coordinator 已知的 candidateId 传入。不能由截图请求临时声明候选归属。

仅对绑定自身、已经挂接的 WebContents 执行一次 capturePage，前后核对完整身份与 bounds。暂停和冻结状态不变；读取超时不重启、不累积同视图 pending 截图。4K 与 DPI 画面支持有限原图像素，仅缩已捕获 NativeImage 供传输，所有输出仍由真实截图派生。没有调用旧 headlessCapture 的窗口缩放/临时挂接逻辑。

最终返回字段：format、worldId、buildId、instanceId、candidateId、scope、capturedAt、viewWidth/viewHeight、sourceWidth/sourceHeight、width/height、resized、pngBase64、sha256。源上限 8192 单边/16Mi像素，输出 1920x1080 内/4MiB PNG；必要时仅一次更小的 1280x720 图像编码。不会更改模型累计额度。

11 项专属回归通过，helper strict TypeScript 检查通过。另尝试原 tests/godot-remaining/P3/godot-world-capture-readiness.mjs，18 项均在构造器因旧 fixture 未注入 NO_IMMERSION 而失败（未进入截图方法）；这是该 fixture 对此前沉浸字段的依赖漂移，本轮没有混入修复或放弱测试，不能报告旧套件通过。完整 desktop TS 由桥集成 agent 合入本接口后联合检查。

上述测试使用原 host 类和可审计 compositor 替身，禁止窗口/输入/JS/runtime动作；不等同真实 Electron 成品截图已验收。后续成品应走正常 UI 使视图附着，再检查新接口；detached 状态直接拒绝，不用测试专用 attach 路径绕过。

总控集成时补齐旧 P3 fixture 所需的真实 `NO_IMMERSION`、`createImmersionPauseController` 和 `PRIVATE_PLAY_OPS` 导入，未改生产行为或旧断言。原 18 项随后全部通过，证明私有验收截图原有的空帧等待、超时和资源恢复未被本次新接口破坏。此前缺依赖失败仍保留为发现过程。
