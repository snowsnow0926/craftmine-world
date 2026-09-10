# 原 CA01 产物的零模型保存与重开补验

本记录关联原始 [CA01 报告](D:/cm-nb-root/test-results/desktop-native-complete-73fuxT/report.json)。原报告保持 `failed`：其16次真实模型请求已生成、检查并采用树，但验收器将 runtimeSave 发给 worldNavigation，被产品正确拒绝为 PERMISSION_DENIED。没有改写原报告或把这次错误隐藏。

## 独立补验结果

在新的测试目录复制已停止的原 profile，重新设置本目录专属 headless marker；复制当前主机构建与core/host可执行文件到独立目录，不更改原模型源码、正式build或原存档。通过实际 Electron 的 worldPanel 调用 godot.runtimeSave，干净退出并重新启动。

**12项检查通过，两次客户端退出码均为0，输入、页面错误及关闭审计均为空。** 原树的稳定ID、目标位置、可见性、实际碰撞和构建身份不变；保存后的完整进度与重开后逐字段一致。前后实际任务统计均为16次已报告模型调用，全部用量一致；预算请求ID文件字节不变。因此新增模型请求为0，不是一个新的模型run，也没有人工代写世界。

补验后再次核对，原始73fuxT的报告与整个profile所有文件SHA-256均保持不变。复制目录中的凭据和数据库没有提交；[去敏证据](evidence/creation-next-batch-20260911/ca01-recovery/report.json)保存原报告hash、模型产物source/build身份、实际统计、完整进度、检查及退出审计。

## 保留的验收器问题

补验首轮的简化应用副本缺少sidecar所需相对目录，未完成启动；改用原workspace布局。第二轮在重开自动加载期间再次请求打开世界，命中WORLD_BUSY；改为等待当前世界实际加载，不改变产品。两次尝试均保留原报告与hash，不算模型新尝试或玩家失败。最终证据目录为 D:/cm-nb-edit/test-results/desktop-native-complete-xG8ZlT。

复跑入口：tests/creation-model-recovery-native.mjs。它只调用既有会话初始化/只读统计和世界保存重开，不调用prompt。原CA01历史失败与本补验结论分别保留，由整体模型评测按“验收器故障后的原产物补验”解释，不能误计一次新的首次成功。
