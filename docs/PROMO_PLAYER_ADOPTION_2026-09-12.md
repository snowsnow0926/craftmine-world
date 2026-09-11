# 普通玩家报告的采用与观察

日期：2026-09-12。基线：`8abfa699`。分支：`codex/player-adoption-20260912`。

现有采用和探索驱动新增支持 `craftmine.promo-player/1`。普通玩家报告不需要评测预算，处理过程中不读取、创建或改写 `creation-evaluation-budget.json`，输出也不补造 budget 字段。旧 `craftmine.promo-pilot/1` 的预算与账本一致性检查保留，历史结果不改写。

## 采用前证据

与普通输入 driver 工作线确认字段：worldId、sessionId、packageIdentity、submittedAt、before、latest、endedAt、exitReport、stateIntegrityVerified；before／latest 包含正常状态返回的 observation、job、active、metrics 等内容。

- latest.active 必须为 false，正常结束且退出审计干净，stateIntegrityVerified 必须为 true。
- 必须有真实 check passed、sourceStale=false、非空且全部通过的断言、同世界的候选／构建／job ID。
- job.createdAt 必须是本次 submittedAt 之后、结束之前的实际时间，且 jobId 不能等于 before.job.jobId；不能把以前 PET 的检查当成本次新愿望结果。
- before.observation.worldId 必须对应当前世界。普通玩家探索只能使用原冻结包，候选、正式采用构建和世界也必须对应原报告。

上述时间比对只识别检查所属任务，不新增十分钟或任何试验时长限制。

## 执行与追加模型调用说明

两个驱动继续用 `adoptionEnvironment` 剔除模型／评测配置及凭证，仅发送预览、采用、保存、重开和有限正常观察动作的受校验控制消息；禁止初始化模型、发送愿望、回答问题或恢复任务。

成功完成后记录 `modelCallsAdded=0`、`modelRequestsAdded=0` 和 `noModelExecution`，依据是剥离配置、实际非模型控制调用清单和干净的运行退出审计。普通路径不通过旧评测账本推断这个结论。

普通报告完整性只固定原报告和 profile 标记；探索另外固定采用报告。预算相关输出只在旧诊断格式存在。采用和探索都继续核验包未改变，原证据文件不可改写。

## 验证

19 项离线测试通过，覆盖普通报告无账本、故意放置不可读取的同名账本目录仍不触碰、旧／复用／时间不符检查拒绝、退出和源完整性、同包同候选探索、非模型调用审计，以及原有诊断格式和 checkpoint 回归。两个脚本语法检查与 diff 检查通过。

没有启动模型、profile 或构建产品；没有新增调用次数或模型试验时长限制。实际普通愿望的新报告由另一工作线生成，随后交现有采用／探索命令读取。
