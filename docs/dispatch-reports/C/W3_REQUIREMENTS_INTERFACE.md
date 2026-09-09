# W3 追加任务：原始需求读取接口

G 授权修改 durable.rs/durable_tests.rs；main.rs/world-tools.cjs/manifest.json 由 G 接线，本文件提供具体修改点。

1. Rust router 在 task.context 旁增加：`"task.readRequirements" => return journal.task_read_requirements(params),`。
2. world-tools 对 `requirements_read` 调用 `core.call('task.readRequirements',{context,...args})`，在既有未知字段校验之后。context 是已有 hostContext(invocation)，模型只允许传 requestId/start/limit。不要允许模型填写 context/worldId/taskId 等字段。
3. agentTools 新增低风险 requirements_read。schema：requestId 字符串 1–240；start 整数 >=0；limit 整数 1–4000；均可选；additionalProperties=false。描述说明：读取当前任务的原始要求/纠正，truncated 时按需读取，可指定已有 requestId，否则按时间遍历当前日志；必须跟随 next，直到需要的原文读取完成。
4. B 提示词保留首条 request 为原始目标，最近三条 correction 为纠正。当其中 truncated=true 或需要更早纠正时使用 requirements_read，不能猜测被缩短的末尾。

返回 `{binding,worldId,items:[{id,kind,text,start,totalChars,truncated}],start,next,totalChars,totalRecords}`。外层 start 是过滤后日志所有原文 Unicode scalar 字符串的累计偏移，内层 start 是该条记录自身偏移。每页文本总计最多4000字符、32段，不以 bytes/JS UTF-16 code units 计数。末页 next=null。requestId 未指定则从全部当前任务日志读取；指定后仅该条。所有字段与身份由 Rust 再检查。

投影按“首个 request + 最近3条 correction”排序并去重，保留1000字符限制和truncated。新写入采用单任务单调时间值避免同毫秒纠正乱序；旧表与原文不迁移，旧时间相同记录按requestId稳定排序。显式恢复复制原文，普通新任务不继承旧任务要求。

本接口不允许任意历史任务读取，不增加 UI 通道、预算重置或模型请求重放。
