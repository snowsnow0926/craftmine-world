# 战斗组 COM01：独立 40 请求效果轮

日期：2026-09-12。驱动基线：`dd6fdee4`。这是用户授权的新效果轮，**独立于此前 10 请求摸底**；没有修改或重置旧报告、旧 profile 和旧账本。

输入保持 **“给我生成一些怪物。”** 使用同一 preview.12 固定 Windows 成品，DeepSeek `deepseek-flash`／high，全新 profile，上限 40 次请求、模型任务最多 10 分钟，不要求用满。

**结果：因正常需求澄清缺少测试驱动答复入口而等待至 TIME_STOP；不是请求耗尽，也不是怪物能力失败。没有交付怪物。**

## 可查看截图

![COM01：未交付，当前正式世界为空白场地](D:/cm-combat-effect-0912/test-results/desktop-native-complete-HZQwoI/formal-world.png)

这是实际成品采集的 1280×720 正式世界截图，已人工查看：空白场地、准星和游戏提示，没有怪物。未编写替代内容，也未运行未经检查的生成源码。不可将该图用作怪物、攻击或战斗已经实现的宣传证据。

## 实际经过与边界

模型完成能力与源码读取后提出两个问题。问题在终止后才作为 asktool 记录持久化：

1. 怪物做到哪一步：游荡、追逐、贴身击退、E 击杀并重生；追逐反馈但不能击杀；或只游荡。
2. 存活／击杀状态是否跨重开保留：重置；或接入持久进度。

总控授权按普通玩家方式做最小澄清，但当前冻结包的受保护 headless／creation evaluation 控制器均未提供 pending ask 查询和 resolve 入口。正式产品虽有 `askToolResolve → asktool.resolve`，测试侧无法在现有通道合法调用。未用任意 IPC、脚本注入或换包绕过。

澄清答复次数为 **0**，asktool 最终答案为 `[null,null]`。模型共 5 次请求，余额 35；没有源码 patch、检查任务或候选，因此未采用、未执行后续探索。巨大怪物、AK47、攻击交互与死亡因果未测试。先补齐有限的正式澄清驱动，再另行冻结新试验，不能把这一轮写成无需交流的自主成功。

## 用量与证据

| 项目 | 记录 |
|---|---|
| 模型请求 | 5／40，剩余 35 |
| 总 token | 208,483 |
| 输入／缓存读取／输出 | 75,285／118,272／14,926 |
| 推理 token | 12,856，包含于输出 |
| 总驱动时间 | 约 10 分 30 秒，包含初始化与正常退出 |
| 安全审计 | violations、pageErrors、shutdownFailures 全为空 |
| 包完整性 | 结束后 inventory 哈希与开始相同 |

- [原始报告](D:/cm-combat-effect-0912/test-results/desktop-native-complete-HZQwoI/report.json)
- [正式世界原图](D:/cm-combat-effect-0912/test-results/desktop-native-complete-HZQwoI/formal-world.png)
- 世界：`world-ba94f15cbe33`。独立 profile 保留在报告同目录，不提交 profile 或凭据。
- 固定包 inventory SHA-256：`3b59f8d34baf393cbdda343107eff99611936a82144d99b04ad61e9809ceb967`。

本轮没有修改产品源码或模型作品，没有真实鼠标键盘、Pointer Lock 或前台操作。
