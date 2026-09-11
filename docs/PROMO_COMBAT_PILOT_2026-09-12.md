# 宣传战斗组 COM01：首次真实愿望摸底

日期：2026-09-12。驱动基线：`2b1278a4`。独立工作树：`D:/cm-combat-pilot-0912`。

**结论：预算停止，已写入草稿，尚未检查、采用或实际游玩。不能据此评价怪物视觉、攻击或战斗是否成立。**

## 输入与环境

prepare-only 确认本次只提交 COM01 原句：**“给我生成一些怪物。”** 未加入后续巨大怪物、怪猎、AK47 或实现答案。

使用固定 Windows 成品 `43203d8e6202-1a5c7fd2-b609-48c2-b999-fa1bf7a4d267/output/win-unpacked`，包目录位于总控 `desktop/build/releases/`。实际 inventory SHA-256：`3b59f8d34baf393cbdda343107eff99611936a82144d99b04ad61e9809ceb967`，结束后重新计算一致。

模型：DeepSeek `deepseek-flash`，high。一次试验最多 10 次产品模型请求、10 分钟；新建独立 profile 和空白 creation-sandbox 世界。仅这一轮，没有加预算重跑。

## 实际结果与用量

| 项目 | 记录 |
|---|---|
| 停止状态 | `BUDGET_STOP`；模型已停止 |
| 产品模型调用 | 10 次，全部有用量回报；剩余 0 |
| 总 token | 527,803 |
| 输入／缓存读取／输出 | 173,966／317,568／36,269 |
| 推理 token | 27,254，已包含于输出，不重复相加 |
| 模型任务墙钟 | 149.920 秒 |
| 整个驱动 | 约 176.8 秒，包含初始化与正常退出 |
| 工具调用 | 25 次，工具状态成功、无 isError 结果 |
| 检查任务／候选 | 无；`latest.job=null` |
| 采用、保存重开、探索 | 未执行，因没有通过检查的候选 |

模型先进行了项目事实、能力、指南、源码、库及 API 查询；包含 9 次文件读取、3 次指南读取、3 次文档查询及 3 次工具搜索。最后一次成功 patch 写入 `scripts/monsters/monster.gd`、`scripts/monsters/monster_horde.gd`，修改 `scenes/creation.tscn`。随后预算耗尽，尚未提交构建检查。

这次明确暴露的是**10 次请求内检查前的准备占用过多**。代码已写入不等于能编译或能玩；需要将当前失败保留为样本，后续优化工具／指南组织时对照。不能把它写成战斗能力永久失败，也不能用未检查源码补拍成片。

## 证据与边界

- [原始试验报告](D:/cm-combat-pilot-0912/test-results/desktop-native-complete-18WNRB/report.json)
- [原始工具会话](D:/cm-combat-pilot-0912/test-results/desktop-native-complete-18WNRB/profile/sessions/af6b9ea7-3592-42d0-b395-9bcfe028ec75.jsonl)
- 世界：`world-88566760dc0a`。草稿保留在同一隔离 profile，未提交 profile 或凭据进 Git。
- 退出审计的 violations、pageErrors、shutdownFailures 全为空；无真实输入、Pointer Lock 或前台操作。
- 没有怪物成果截图：本次未到检查和采用阶段，没有通过驱动绕过检查执行生成代码。
- 未执行巨大怪物、AK47、射击命中、受击死亡等后续愿望或交互。原型视觉与攻击交互均未验收。

本轮只提交开发记录；没有修改产品源码或模型生成的作品。
