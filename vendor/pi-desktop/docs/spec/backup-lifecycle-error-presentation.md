# 备份恢复生命周期错误提示

日期：2026-09-12。

恢复前的视图/主进程生命周期函数有时抛出没有 code 字段的 Error。原服务只读取 errorCode/code，使明确的前置拒绝变成 BACKUP_OPERATION_FAILED。本轮仅允许三个确切 message 值提升为公开 code：BACKUP_PROGRESS_CHANGED_REINSPECT、WORLD_BUSY、ACTIVE_TASK_EXISTS。

已有合法结构化 code 继续原样保留。路径、任意说明、带后缀/换行的文本、未知全大写消息均不得从 message 直接透出。工作台对这些码及标准 pi-plugin-panel-invoke 的确切 Electron 错误包装显示固定短提示：先保存并重新检查备份，或等待当前操作完成。没有通过文本包含匹配推测错误类型。

恢复前检查仍先于备份激活；expectedCurrentHash、授权有效期、文件指纹、操作编号与显式重试语义不变。本改动不自动保存、忽略进度差异、更新 CAS、丢弃数据或执行恢复。

验证包含 4 项新增错误/提示合同测试、7 项既有备份文件/授权/CAS/丢回包/取消回归，以及桌面 TypeScript noEmit。实机具体失败码需要新包验证，不能仅凭报错包装认定未保存进度就是原试验根因。
