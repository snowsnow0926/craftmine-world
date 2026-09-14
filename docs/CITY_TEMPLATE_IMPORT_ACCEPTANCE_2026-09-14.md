# 修复前轻雨城市模板独立导入预验收

2026-09-14 实测通过：在全新独立 profile，通过 PI 普通模板导入及创建表单，创建世界、实际行走、普通保存与冷开；三个阶段各 30 项检查通过，保存后的完整 progress 与冷开完全一致，模型调用为 0。

这次运行使用总控冻结的混合诊断源码客户端：source out `eb92ecfd`，实际 main SHA256 `ecf76da49d6709b888afb9db45839956de12c6d5126f7abae6d50b8b7c5d2d3f`；Core 为 `98e559a3` 编译，SHA256 `d807f3913c7a11bb84df3ffbbb4902ecaacd60e2f6f4a9635fd32006e7d30a54`；runtime-resources stage 标记 `98e559a392a0bd92e11433a891bbeabdf8e2d488`。它不是最终交付包，也不是博美碰撞修复验收。

## 输入与结果

- 输入 ZIP：`D:/cm-product-agent/test-results/desktop-native-product-5N6HZ2/captures/weather-baseline-completed-export-a36aaaf4.zip`，10,059,483 字节，SHA256 `a36aaaf4fffb10c95c1cff83c29e6e69b1a62d42696da7388004a87e70c8f094`。
- 冻结预期：同目录上层 `weather-baseline-completed-template-expectations.json`，根据真实完成态 snapshot/status 生成，未制造默认态或修改存档。
- 原始报告：`D:/cm-city-import/test-results/desktop-native-rt-Q3o2mz/report.json`。
- 独立世界：`world-fe4885cc3afa`，模板 `player.world.71abd33f7e4e4b11a35dd995b826acae`。
- 普通构建：`gbd-1606a6ecbd67699f50121f88205a12b9da4da9b7e1302e9d5e9f151d568db8c7`。
- 两次客户端正常退出，exit code 0，violations/pageErrors/shutdownFailures 全空；没有真实鼠标、键盘、focus 或 Pointer Lock。

任务 3/3、五项库存、6 城区/22 建筑、博美交互与等待设置、飞机已飞行与一次降落记录均保留。实际行走位置从 `(226.2559,0.90076,60.9014)` 变为 `(225.5284,0.90076,61.3809)`。普通保存后冷开同一 build、新 instance，并精确比较完整存档。原生截图目视确认轻雨、真实小麦模型与 3/3 HUD。

## 与原检查阻塞的关系

此新档案普通创建 job `gjob-fd835ab1e29b2ca2dee5c463b84e7bee8055b42d710ca6dbb4587ce0e005346e` 检查通过。逐阶段记录：文件校验 75ms、runtime server 8ms、窗口 7ms、load 53ms、ready 14,255ms、runtime check 2,911ms，总计 17,309ms；真实 3 帧/3 distinct，快照一致、guard 0/0、正常回收，diagnosticLog 无 error 且未截断。

这说明同规模内容可在普通新玩家模板导入路径完成检查，不能据此解释或抹掉旧档案中 artifact-verification 30 秒超时。此前修复前城市的博美通路 audit 仍记录 capsule-sweep-blocked；本次未采用 `9f` 修复，也没有宣称博美穿行已修复。

首轮 `desktop-native-rt-RcwD7T` 在 ZIP 导入阶段报 `ZIP_BAD_CENTRAL_DIRECTORY`。该 7,864,320 字节归档是上述完整 ZIP 的精确前缀，源于导出驱动仅等待文件出现便复制的竞态。失败文件和报告保留；驱动修复 `afd9e912` 改为等待本次真实导出完成提示并验证界面 archive SHA。完整文件来自原真实 UI 已完成的导出，没有重新生成或篡改内容。

可移交的紧凑证据见 `docs/evidence/city-template-import-20260914/summary.json`，包含原报告哈希、实际二进制身份、全部状态断言、完整保存/冷开存档、检查诊断及原始截图链接。
