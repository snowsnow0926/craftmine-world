# 工作台截图尺寸误拒绝修复

## 真实问题与定位

新截图接口在 e8e373fc 成品的 play 模式已通过正式、候选实测（见 `GODOT_BOUND_CAPTURE_NATIVE_RESULT_2026-09-12.md`）。复用本 agent 独占的 SUkBPG 测试档案，普通进入 create 工作台后，同一接口返回 `GODOT_VIEW_CAPTURE_DIMENSIONS`。

原始报告：`D:/cm-capture-product-acceptance-0912/test-results/desktop-native-complete-SUkBPG/workbench-capture-57debdfe-23ba-4d24-b0c2-b721e8f1baee/report.json`。实际游戏 view 为 `(275,150,525,650)`，已挂接；owner content 为 1200×800；截图前后 world/build/instance、窗口、视图与状态一致。之后尝试返回 play 时驱动等待超时，因此该诊断总报告 `ok:false`，不伪称完成双模式对照。正常退出 code=0，三类审计为空，旧成功报告、marker 与冻结包完整性校验通过；已有 play 成功证据保持原样。

使用仓库真实 Electron 43.5.0，在全新独立 profile 创建 hidden/nonfocusable owner 与离屏 child，加载自己的无输入静态页面。owner content=1200×800、child=525×650 时，**同一个 child WebContents.capturePage() 返回的 NativeImage 为 1216×865**。图片为自有页面，已实际查看；捕获前后所有绑定、bounds、可见性、焦点不变。该结果证明 source 像素不能被强制解释成 view DIP 的等比例缩放，不据此声称所有平台都返回这一尺寸。

原始 Electron 证据：`test-results/electron-bound-capture-fbc5e22d-da83-45fb-8995-66199dab78be/report.json`（相对于本独立树）。修复后真实 NativeImage 通过生产 helper 的证据：`test-results/electron-bound-capture-fixed-8f53abf6-5391-49e8-91cc-47d8a4a35d2f/report.json`，`ok:true`，输出 1216×865，PNG SHA-256 为 `a123a15260498df256dc990c33e8e5bab4a686554a2cfa707b3c3d3d35bf2fdb`。

## 同窗口内容范围对照

为排除“尺寸来自 owner，所以可能截到聊天/旁栏”的风险，在同一隐藏窗口同时挂接两个真实 WebContentsView：主页面铺满 1200×800，洋红背景及 `OWNER_PRIVATE_MARKER`；子页面仍为 `(275,150,525,650)`，绿底橙框及 `CHILD_CAPTURE_ONLY`。两者均为本测试自建静态页面，禁用 Pointer Lock，未访问任何玩家内容。

对照报告：`test-results/electron-bound-capture-isolation-fd6708e7-f515-4549-92bc-5510fd7abc8e/report.json`。已实际查看保存的 `owner.png` 与 `capture.png`：主图只有主标记，子图只有子标记；子图虽然仍为 1216×865，却没有主页面内容。完整 BGRA 像素统计：主图洋红色 1,043,663 个像素，证明主页面确已绘制；子图洋红色 **0**，子图绿色 672,970、橙色 344,980。绑定与 bounds 前后完全一致，生产 helper 对同一真实 NativeImage 返回成功，PNG SHA-256 `a6faa126bef447983d01d4055e7f7a6a7c55237b3d3eaf4840997b7a3fa1a618`。

因此本次实证支持读取 child 自己的绘制表面，不能将其误解为 owner 合成整窗截图；也不按 child 布局坐标猜测裁剪区域。该结论限于本次仓库 Electron 43.5.0 的真实离屏夹具，新成品仍需正常 Godot 工作台再验。

## 最小改动与边界

仅删除 source 与 view 的比例/宽高比约束，不新增 headless 特例。不改变前后身份、WebContents、挂接、bounds 校验；不修改窗口、视图、相机、暂停、输入。继续拒绝非法整数、空尺寸、源图单边超过 8192 或面积超过 16MP、截断 bitmap、透明空图、错标 PNG；输出仍仅对已经捕获的 NativeImage 等比缩小到 1920×1080 范围且 PNG ≤4MiB。view/source/output 三组尺寸分别保留。

验证：13 项宿主/图像测试加 3 项有限 headless 入口测试通过；完整 desktop TypeScript 通过；真实 Electron 图像经修改后的生产 helper 验证通过。测试没有模型调用、真实键鼠、Pointer Lock、用户浏览器或用户档案访问；没有修改冻结包，也未接触 qQcut9。**新成品的 Godot 工作台截图仍待总控统一构建后验证**，本次不把独立 Electron 夹具当作新成品实测。
