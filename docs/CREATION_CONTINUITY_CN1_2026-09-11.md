# CN1：最近结果与稳定对象回选

日期：2026-09-11。基线：`fa9f7247`。本记录对应《连续造物与 preview.11 成品开发计划》的 CN1；不覆盖 CN2–CN7 的集成及交付结论。

## 实现

目标面板新增“最近结果”。列表从当前正式构建导出的操作日志读取，沿用原有内容哈希、构建、源码版本与世界一致性检查，不读取未采用草稿或模型文字。列表按最近操作去重，最多展示 32 个对象，使用稳定实体 ID 区分同名物体。当前实际观察判定对象是否仍存在、可见及可用；删除、暂时不可见的结果保留说明并禁止选择。

玩家明确选中一项后，宿主重新观察当前实例，并固定对应对象。捕获中的 `source: recent` 表示“最近结果”，`source: ray` 表示当前射线；两者传到宿主绑定记录，界面也显示来源。显式对象选择的法线仅为对象向上的约定值，不声称发生过射线命中；CN2/CN3 的放置必须另行要求射线地面，不能把最近结果坐标当作“这里”。

选择保存于宿主目标服务目录，按项目、会话、世界隔离。重开会重新核对正式日志和实际对象；过期结果不会猜选另一棵同名树。新草稿第一次形成会话时，只将已明确选择的对象交给该会话。副本世界不继承旧世界的选择；来源世界不匹配的历史回执不成为当前世界的选择授权。列表以当前世界的正式操作为依据，不是所有可见对象的总目录。

## 接口

复用 `godot.creationTarget`：

- `{sessionId}`：重新采样，恢复此范围内已有的显式选择；否则使用当前射线。
- `{sessionId, selection: {worldId, entityId}}`：在该世界正式结果中选择具体对象。
- `{sessionId, selection: null}`：清除该范围的显式选择，返回当前射线。

输出保持原有 `captureId/worldId/target`，增加 `source/recent/reason`。没有射线命中时仍返回世界与最近列表。渲染器提交后续愿望仍只携带宿主生成的 `captureId`，不能改写冻结坐标。并发采样有序号保护，已被后续请求替代的结果不能覆盖持久选择。

`index.ts` 只修改目标服务的正式日志依赖，以及既有 `godot.creationTarget` 的参数接线；直接编辑、要求解析和采用过程由其他工作包负责。

## 验证

- 目标及最近结果宿主/解析测试：21/21，其中最近结果新增 7 项。覆盖无射线、多同名对象、宿主重开、会话和世界隔离、新会话交接、隐藏/删除/重复 ID/未采用对象拒绝、读取期间源码改变及并发选择。
- 真实 React 组件、hook 与页面回调：9/9。通过独立 headless 数据目录和脚本调用回调，未使用鼠标键盘、Pointer Lock 或前台窗口。报告位于 `test-results/creation-recent-ui-Nwjtmw/report.json`；截图已查看。
- 测试中的传输和正式日志是明确标注的夹具，不声称已经完成真实引擎或成品包验收。真实采用、回选、复制及重开链路由 CN5/CN6 统一集成。
- 工作树 TypeScript 首次检查受未构建的 workspace 包声明影响，报 `@pi-desktop/i18n/plugin-sdk/plugin-devkit` 缺失及其级联类型错误；没有把该次检查记为通过。总控构建依赖后，本树执行 `tsc -p tsconfig.json --noEmit`，退出码 0，完整类型检查通过。

可复跑命令：`node --test vendor/pi-desktop/apps/desktop/test/creation-recent-results.test.mjs vendor/pi-desktop/apps/desktop/test/creation-target-service.test.mjs vendor/pi-desktop/apps/desktop/test/creation-target.test.mjs`、`node tests/creation-recent-ui-headless.mjs`。全过程模型请求为 0。
