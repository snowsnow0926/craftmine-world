# 201 候选包：完整城市模板独立导入预验收

2026-09-14 使用真正 `201faf9db13c` Windows 候选包 EXE，在全新独立 profile，通过普通 PI 模板导入、创建世界、实际行走、普通保存和冷开。最终通过，模型调用 0；两个客户端进程正常退出，violations/pageErrors/shutdownFailures 全空，完整包文件清单前后未变。

此项是候选包预验收，不是最终交付验收或博美修复验收。输入是修复前轻雨城市的完成态模板，没有采用原档案的 `9f` 草稿，也没有向原 profile 的 `play-144` 及之后发送命令。

- 候选目录：`D:/Craftmine Worktrees/product-world-kits-20260914/desktop/build/releases/201faf9db13c-dd7a04fc-53e4-4248-ac27-67edc734a7bf/output/win-unpacked`。
- 包 main SHA256：`6c0a337893f08099c6bbb1168ddd16a44ac743ca5e0ffa140e0b734dfd4cb0d9`。
- 全包清单 SHA256：`28b352b9188a37a6e14efa96295493886229d7e7da6bb2815452d1fb4a72cb74`。
- 输入 ZIP SHA256：`a36aaaf4fffb10c95c1cff83c29e6e69b1a62d42696da7388004a87e70c8f094`，10,059,483 字节，原文件未改变。
- 原始报告：`D:/cm-201-city-import/test-results/desktop-native-rt-fwBT94/report.json`。
- 世界：`world-0eb2abf9d197`；构建：`gbd-914f085cece71a91ab808a4f4ed95c3b9e877fc8bfdf524b7902c6f898c580e1`。

新导入、普通保存、冷开三个阶段各 30 项检查通过。6 城区/22 建筑、3/3 任务、五项库存、博美交互/等待设置、飞机已飞行/一次降落记录保持；冷开新 instance、相同 build、完整 progress 精确相同。实际步行有位移，冷开原生截图已目视确认轻雨、小麦和任务 HUD。

普通创建 job `gjob-e0d0a1d85b9b34a667dcbdf96d272bdcd535617646205f2e51b5e9c75100ca46` 的真实包内文件校验 Worker 完成：`workerStarted/messageReceived/exitConfirmed=true`，`exitCode=0`，Worker 耗时 44ms，主线程等待 117ms，主线程心跳最大延迟 8ms；验证 10 个文件，共 52,674,944 字节。

Godot 检查总计 17,228ms：文件校验阶段 119ms、server 8ms、窗口 7ms、load 54ms、ready 14,107ms、runtime-check 2,933ms。真实 3 帧/3 distinct，快照一致、guard 0/0、正常回收，诊断无错误且未截断。

完整紧凑证据见 `docs/evidence/candidate-201-city-import-20260914/summary.json`，包含原报告哈希、包内二进制身份、Worker 诊断、全部检查编号、保存/冷开完整状态和原生截图路径。新档案检查通过不替代原档案工具链升级恢复与博美修复验证。
