# 宣传六组截图实测：CITY01（2026-09-12）

结果：**未交付城市**。模型提出范围与实现方式问题，等待玩家回答至本次 10 分钟时限；测试入口不能回答 AskTool，本轮未绕过、未代选、未追加愿望。只有正式空白世界截图，没有可采用城市候选。

## 固定输入与环境

- 唯一原句：我想复刻奥格瑞玛。
- `prepare-only` 确认 CITY01，零请求；随后只运行一次 `promo-wish-native.mjs --live`。
- 驱动基线 `dd6fdee4`，工作树 `D:/cm-promo-city-test-0912`，独立新 profile。
- 固定成品：`D:/cm-promo-loop-0912/desktop/build/releases/43203d8e6202-1a5c7fd2-b609-48c2-b999-fa1bf7a4d267/output/win-unpacked`，未修改。
- 模型 `deepseek-flash`、high；上限 40 请求 / 10 分钟；实际 5/40 请求，剩余 35，未续跑或重置账本。
- 最终 `TIME_STOP`，北京时间 2026-09-12 02:20:47 正常退出，无 forcedStop；退出审计 `violations`、`pageErrors`、`shutdownFailures` 均为空。

## 实际提问与停滞证据

模型先读项目目录，随后发出 `asktool`。运行中的报告只持久化至 `godot_project_index`，当时 `active=true`、5 个请求均已返回，尚不能确认等待类型。超时正常 abort 后，session JSONL 记录了真实 AskTool 参数、等待 578,963 毫秒和 `answers=[null,null]`，由此确认停在提问环节。

问题一：**奥格瑞玛很大，你希望这一版复刻到什么范围？**

- 全城骨架：环形城墙 + 正门塔楼 + 三谷（力量谷/智慧谷/荣誉谷）分区与道路。
- 只做正门与入口广场：尖刺门楼、双塔、旗杆、通道（最标志性的第一眼）。
- 力量谷核心：格罗玛什要塞 + 银行 + 木屋群与兽人棚屋。
- 先给一个兽人营地风格的小样（几座棚屋+火堆+栅栏），确认风格后再扩城。

问题二：**建筑怎么实现？沙盒现有可摆放物件只有树/岩石/箱子/门/标记，没有建筑类型。**

- 写普通 GDScript 程序化生成兽人建筑（红色木墙、尖顶、獠牙装饰、可走进去），走源码+检查流程。
- 只用现有物件（岩石/树/门/标记）在沙盒里摆一个“像奥格瑞玛”的营地，快但很抽象。
- 两者结合：源码生成建筑主体，再用现有物件补火堆、箱子、门等可交互道具。

以上是受测模型原始提问，未代替玩家选择。本轮没有源码补丁、构建检查或采用，因此没有运行采用/探索脚本，不宣称可步行城市范围、整城复刻或 1:1 还原通过。已目视截图：只有原正式空白底座，不能作为城市效果图。

## 原始文件与用量

- 报告：`D:/cm-promo-city-test-0912/test-results/desktop-native-complete-DDjj6B/report.json`。
- 唯一截图：`D:/cm-promo-city-test-0912/test-results/desktop-native-complete-DDjj6B/formal-world.png`。
- 提问证据：`D:/cm-promo-city-test-0912/test-results/desktop-native-complete-DDjj6B/profile/sessions/ee839a69-03e4-4dab-881d-7810adea0bf9.jsonl` 最后一条 `asktool` 消息。
- 原报告用量：输入 76,162，缓存读取 82,560，输出 3,421，其中 reasoning 2,086；总计 162,143 tokens。总计包含缓存读取，不作为费用估算。

本次提交仅中文记录。未修改产品或模型作品，没有真实鼠标键盘、Pointer Lock、前台操作、裸引擎运行生成代码或用户 profile 操作。rain 组已有证据保持不变。
