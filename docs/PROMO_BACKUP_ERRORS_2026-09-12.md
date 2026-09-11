# 宣传片开发：备份恢复前置错误可见性

日期：2026-09-12。基线：43203d8e。

## 证据与范围

只读报告 desktop-native-complete-0XlwZg 显示备份检查 ready、恢复返回笼统 BACKUP_OPERATION_FAILED。产品代码确有信息损失：beforeRestore 调用 view.beginRestore；后者可能抛出 plain Error 的 BACKUP_PROGRESS_CHANGED_REINSPECT 或 WORLD_BUSY，主进程还可能抛 ACTIVE_TASK_EXISTS。backup service 原先只保留 errorCode/code。

**目前确认的是错误信息传递缺陷，尚未确认该实机试验实际抛出了哪一个生命周期码。** 总控正在区分 legacy 视图与通用恢复链，具体根因及修复后实机结果待新包验证。

## 已完成

- 三个精确 message 码被转为已有的安全结构化错误，其余任意消息保持通用失败。
- 工作台显示“先保存，再重新选择并检查备份”或“等待当前操作完成”；识别标准 Electron 包装，不从任意私密文本中查找错误码。
- 未改变恢复顺序、未保存进度比较、备份 CAS、文件指纹、grant、操作编号和显式重试规则。

## 验证

4 项新增合同测试、7 项原备份文件/授权/恢复回执回归通过；桌面 TypeScript 检查通过。使用独立合成文件，不运行用户 profile 或模型，不进行真实输入。合同测试不代表原实机恢复已经成功。

## 另行报告的只读风险

view.mount 将核心返回 snapshot 的 JSON 字符串作为 lastSaved，loaded 消息不更新它；app/game.js 构造 progress/3 时采用固定字段插入顺序。对象值相同但字段顺序不同仍可能被字符串比较判为变化，关闭重开会重新设置该基线。初始 progress/1 到 /3 的规范化则是另一种结构变化，不能简单忽略。

已将此风险交给总控。若后续修正应采用保留全部数值和数组顺序的规范比较，不能把 loaded 时的未持久化状态直接当作已保存。本次错误码修复没有夹带比较逻辑变更，也没有把这一风险认定为原报告根因。
