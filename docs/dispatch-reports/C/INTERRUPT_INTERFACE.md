# 恢复启动失败：宿主中断接口

G 授权的追加修复，仅修改 recovery.rs、新增 recovery_tests.rs。main.rs 由 G 注册：

`"task.interrupt" => return journal.task_interrupt(params),`

参数严格为 `{context:{projectId,sessionId,turnId},reason}`，不能暴露给模型或renderer。reason 只接受 `^[A-Z][A-Z0-9_]{0,79}$`，例如 RESUME_LAUNCH_FAILED，不接受原始错误文本或路径。

调用顺序：Rust task.resume成功 → 宿主尝试保存续作消息/解析provider/启动sidecar → 失败时先 task.interrupt → 再正常 workspace.endTurn(error)。首次调用要求当前task仍running并持有自身lease；因此不要先结束任务后再首次调用。已成功interrupt的相同请求，可在end(error)之后重复查询回执。

返回 `{kind:'task-interrupt',status:'interrupted',reason,taskId,toolCallId:'@host:interrupt',revision,draftHash,binding,generation,budget,modelReplay:false}`。`@host:interrupt` 是宿主保留的内部回执ID，不用于模型工具callId。预算是该次中断原子提交时的快照；后续真实usage结算可继续精化当前账本。

同上下文与同reason幂等；reason变化返回INTERRUPT_REPLAY_MISMATCH；会话已经进入新代际后即使同reason也拒绝STALE_TURN。未知字段、伪造身份、非代码reason、已不running/丢失lease都拒绝。

同事务只取消此任务的verification/review/prepared application和worker token；reserved请求转unknown且保留预留估算。草稿/修订/预算owner/代际不重置。正常新workspace.open会明确要求恢复；再次显式resume保留累计已知与未知用量、压缩次数和原始目标。

workspace_end_turn已只操作running状态/lease，不会清除recovery，故无需修改该热文件。未改数据库schema/备份表，也不创建第二套任务存储。
