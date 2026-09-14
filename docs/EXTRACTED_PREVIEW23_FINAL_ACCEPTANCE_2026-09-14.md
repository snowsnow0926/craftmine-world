# 正式 ZIP 解压副本最终验收

2026-09-14，两轮串行验收均通过。运行的是正式 ZIP 实际解压出的 `76e8c0a9` EXE 和包内资源；没有使用源码 out、原构建目录 EXE 或外置 Core 替代。七次客户端启动全部正常退出，模型调用为 0，所有退出审计的 violations/pageErrors/shutdownFailures 为空，测试前后完整包清单一致，最终城市 ZIP 原字节未改变。

实际解压根目录：`D:/Craftmine Releases/Product-preview23-76e8c0a9.verify-d9e47e3c-4637-4ae5-a312-fbe10681715b/Product-preview23-76e8c0a9`。应用位于 `output/win-unpacked/Craftmine World.exe`，resources 均取同一包内目录。

| 验收 | 结果 | 实测耗时 | 应用启动次数 |
| --- | --- | --- | --- |
| 视觉编辑、撤销、分享及独立用户复现 | PASS | 346.706 秒，约 5 分 47 秒 | 5 |
| 最终城市模板独立导入、游玩、保存冷开 | PASS | 63.420 秒，约 1 分 3 秒 | 2 |

耗时从每轮首个应用启动标记到最终报告写入计算，包含普通退出和包清单复核；不包含之前的构建/压缩时间。两轮约 6 分 50 秒，不作为持续真人操作帧率或跨机器性能基准。

## 视觉编辑与分享

原报告：`D:/cm-final-visual/test-results/desktop-native-rt-kVZ6RG/report.json`，SHA256 `11104e7d51fdce2ade32aaaae11640ca6f4eed97c2e9eecd03ce1eea8e512a90`。

通过真实 PI 操作完成：创建新世界、素材库直接使用已发布博美、空消息会话冷开、实际树木放置预览/取消、放置检查采用、移动 0.5m 与旋转 45°、撤销恢复、最终尺寸/颜色编辑、作者保存冷开、普通模板导出、独立 profile 导入、游玩保存冷开。

放置预览和移动旋转预览分别出现 38,330/32,426 个变化像素；取消后完整 progress 不变。实际检查/采用后的树木保持同一实体，最终位置 `(-1.4418883,≈0,3.4455709)`、朝向约 45°、尺寸 1.25、颜色 `#88bb44`；独立用户冷开仍保留树和真实博美组件。

作者世界 `world-463a3b9883b4`；独立导入世界 `world-6ea4aa3193f3`。导出本次真实 UI 完成状态为 completed=true、busy=false、error=null，所选模板 `player.world.84c63e94ba9e4f4b853a459213957228` v1；UI archive SHA 与最终 7,525,488 字节文件一致后才归档，验证了此前导出复制竞态的修复。

## 最终城市模板

输入为解压根内 `examples/city-flight-and-companion.zip`，SHA256 `780615c946006035c82d7002c9ff814180027b84cd65cfbb3bfa83d11e3af25e`。预期来自真实最终保存状态：`D:/cm-product-agent/test-results/desktop-native-product-5N6HZ2/final-city-template-expectations.json`。

原报告：`D:/cm-final-city-import/test-results/desktop-native-rt-T4m5Dv/report.json`，SHA256 `3627e4901d5ff31984270454bf8431704ba1606d865f8b95bebbecc76f1a233e`。新世界 `world-296ce3b567a9`，构建 `gbd-345aa0a2e15bc3fc7c38e1f6570c0c3420559cfa9270e72bb507f94f74fb137a`。

普通导入、保存、冷开三个阶段各 30 项检查全部通过。完整 progress 冷开精确一致，新 instance、同一 build；3/3 任务、五项库存、飞机已飞行/一次降落记录、小麦 E 互动次数 2 与等待设置全部保留。此模板从作者完成后的真实存档开始，不是 0/3 默认态。

最终城市普通检查耗时 13.402 秒，实际文件校验 Worker 37ms、主线程等待 96ms、Worker exitConfirmed=true/exitCode0；没有 artifact-verification 超时。两轮所有 8 个普通 Godot 检查任务均通过，原生退出和快照检查有效。

## 身份与范围

- 包 main SHA256：`6c0a337893f08099c6bbb1168ddd16a44ac743ca5e0ffa140e0b734dfd4cb0d9`。
- 包内 Core SHA256：`6f7218996c688259f41f8da7ac418a2d98c0f562bc320e61f92632e1e602f509`。
- 包内 Host SHA256：`07bfcbd6b90944518cee89fdc75011aa8f4baa09ebc155f80eab8b9a137f08c8`。
- 两轮同一完整包清单 SHA256：`51de0dbb2605896fe6c03e897446999dd89385f53e692c82ab07d4dbad68002d`。

此两轮使用独立 offscreen 进程和独立 profile，禁止真实鼠标、键盘、激活窗口和 Pointer Lock。stock 可视编辑及实际素材复用已验证，不宣称任意脚本 GLB 支持全部编辑操作。博美 E/H、穿行和跟随行为已在同 76 包原档案的 `play-144..169` 单独实测，本轮城市导入验证这些保存结果的复现，不重复宣称重飞或主动撞墙/撞机。

完整紧凑证据：`docs/evidence/extracted-preview23-final-20260914/summary.json`，包括两份原报告哈希、精确计时、七次退出审计、包内二进制路径与哈希、预览/撤销结果、最终城市完整进度、八个原生检查诊断和原始截图路径。两轮完成后所有测试进程正常结束，GPU 已释放；未清理工作树或原始失败证据。
