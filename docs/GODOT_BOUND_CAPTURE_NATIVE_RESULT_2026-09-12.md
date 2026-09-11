# 世界截图新接口成品实测（2026-09-12）

## 结论

冻结包 `e8e373fce6d0-1d527215-7507-489a-9e6e-049e8c774af7` 的新 captureView 接口实测通过：正式世界与正常预览候选各取得真实 PNG，截图前后 host 身份/正式状态、所属窗口和已挂接视图 bounds 完全一致；错误或过期身份正确拒绝。没有使用旧 headlessCapture，没有临时挂接、调整窗口/视图、真实键鼠、Pointer Lock 或模型调用。

成功原报告：`D:/cm-capture-product-acceptance-0912/test-results/desktop-native-complete-SUkBPG/report.json`。真实图片为同目录 `formal.png` 与 `candidate.png`，已分别实际打开核对：正式图是空白底座，候选图是正常安装环境后的草地与天空。两张图都由各自绑定视图 capturePage 产生，不是从桌面或其他世界读图。

- 正式：world-11d4549d025a，instance `3a001ed65dc9a591b23527d2`，正式 build `gbd-d0dfd4d224f9885abc8653d051b0d4e441095eada56ec1f2e903857e940ef635`；capture 前后正式 state 均为 paused。
- 候选：同 world，candidate `gcan-b35d4b9be3edbb2def0c4b04796739a3af9941c6ea0c04fbe49e8bb1e843a036`，instance `ac4c0f87361b6d8f032cfd45`，build `gbd-20f05fc03d2cd8a23ebd518ef87e7b29324d62077c7dfdf5e1fac5e407b0fd12`。来自本包 cw.environment.natural-daylight 的正常 importSource/check/candidatePreview，未伪造候选或身份。
- 真实 view/source/output 尺寸均 1200x800，resized=false。正式 PNG SHA-256 `7dd8c867c21b20235dd5665a19f46a9bce079b46196f9cc3f55c8c522299c098`；候选 `699e085aea7d067f059f3e0394552d007f5e8afd60b1c5bcb5a47fd83b9283e9`。PNG header 与返回尺寸、实际字节摘要一致。

5 个真实拒绝场景通过：错误正式 instance→IDENTITY_CHANGED；候选展示期间请求正式图→BUSY；错误 candidateId→CANDIDATE_CHANGED；正常关闭候选后旧身份→UNAVAILABLE；正常切换到第二个新世界后旧正式身份→IDENTITY_CHANGED。每次拒绝前后只读状态也完全一致。

退出 code 0，violations/pageErrors/shutdownFailures 三数组为空，stateIntegrityVerified=true，冻结包文件与原 marker 保持不变。所有成品进程已正常退出。没有访问 qQcut9 或 VO4Pki，只有本次独立新档案。

## 首次准备顺序失败与修正

首次独立空档案 V56mr6 在截图之前失败：新 profile 没有可游玩的 activeWorld，普通“游玩”按钮按产品设计先进入选世界页面；旧 driver 却先等待 play layout，再创建世界，导致 CAPTURE_ACCEPTANCE_WAIT。该次没有调用 world.create、没有生成任何截图；失败报告、日志保留，正常退出且审计完整，没有改成成功。

根据源码明确原因，仅调整 driver 为“普通 world.create 到 ready → 点现有游玩入口”，再进行正式/候选测试，并在创建返回后及时落盘真实 worldId。之后才执行 SUkBPG 中的首次实际世界/截图流程，没有反复猜测图像参数或另造作品救分。冻结产品没有修改。

## 范围限制

这是新截图 host 在真实成品中的零模型验收，不是“模型已收到并理解图片”的端到端模型试验。正式截图的暂停保持有实际状态证据；候选只核对真实 preview、身份和布局，不能把正式 host.state 解释成候选引擎暂停状态。4K/DPI及缩图、超时、未挂接等其他边界已有静态回归，本次真实屏幕为 1200x800，不据此声称实机 4K 已覆盖。
