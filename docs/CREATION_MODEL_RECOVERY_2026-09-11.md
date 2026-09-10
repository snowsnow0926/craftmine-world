# 原模型产物补验与有限续测记录

本次保留原始 CA05 失败分类，单独验证它已经实际生成、检查并采用的采伐脚本。补验不属于新的模型样本，也没有把测试脚本当作模型答案写入世界。

## 原始证据与预算

原始目录为 `test-results/desktop-native-complete-IjZqHs`，原报告 SHA-256 为 `62444302afcf44f45d9f7a8750fe6d07e1e90e6318b11c39cf9e18c63c4497f3`。原始客户端已正常退出，预算已使用 25 次预约，上限为 40。补验前后逐文件核对原目录的路径、大小与 SHA，原报告、profile 和全部原始证据均未变化。

`tests/creation-model-continue-native.mjs` 只在新建的独立测试 profile 中补验。全部运行通过隐藏、不可聚焦的 Electron IPC 和真实 Godot 完成，未发送真实鼠标、键盘或 Pointer Lock 请求。保存冻结之后显式恢复运行，重开之后立即暂停，再核对状态。

## 已完成结果

- 零模型补验报告：`test-results/desktop-native-complete-K7eooB/report.json`。16 项检查全部通过，三次客户端退出码均为 0，输入及窗口隔离审计无违规，预算仍为原始 25 次，预算文件字节完全一致。
- 实际按交互动作采伐原树后，木材增加 1，原树不可见且没有碰撞；在五秒生长过程内保存退出、重新打开，所有其他进度保持一致。倒计时允许真实启动期间经过的物理帧推进，本次减少 6 帧，处于独立观测的 14 帧内；暂停后的第二次快照完全一致。
- 再推进实际 300 个物理帧，同一棵树恢复显示和碰撞，无额外木材奖励。再次退出重开后完整进度一致。
- 新案例报告独立保存为 `test-results/desktop-native-complete-K7eooB/continuation-report.json`，不覆盖零模型补验报告。CA06 首次成功，实际新增 6 次模型请求，累计预约 31/40。
- CA07 在模型调度前被 `CREATION_TARGET_STALE` 拒绝，新增模型请求为 0；HOLDOUT01 尚未执行。副本捕获指向副本世界，而原会话开启的创作事务仍属于原世界，因此宿主正确拒绝跨世界目标。需要产品完成副本会话交接后再从真实的新会话捕获，不能强制重绑旧会话。原拒绝证据保留。

## 续测约束

`tests/creation-model-followups-native.mjs` 只使用已成功补验的同一 profile，不重新复制原始 25 次预算。原报告摘要对应唯一续测登记，登记绑定 profile、报告和预算身份；每个案例在发请求前先持久登记，已尝试案例不自动重放。预算必须保留全部原预约身份，累计不得超过 40 次。每例最长十分钟，模型与思考强度保持 `deepseek-flash/high`。

当前脚本在 CA07 前置拒绝后停止。未来如需继续这个未送达模型的愿望，须增加明确的前置拒绝核对及会话交接证据，沿用当前 31 次预算，不删除已有尝试记录。CA05 补验始终与新增样本分开计数。

两个入口分别使用以下显式环境变量，密钥仅从已授权的本地配置读取，不写入报告或命令输出：

```powershell
$env:CRAFTMINE_SOURCE_ROOT='D:/cm-nb-root'
$env:CRAFTMINE_LIVE_CONFIG='D:/Craftmine World/.craftmine/secrets.json'
$env:CRAFTMINE_CONTINUATION_ORIGIN='D:/cm-nb-root/test-results/desktop-native-complete-IjZqHs'
node tests/creation-model-continue-native.mjs

$env:CRAFTMINE_CONTINUATION_RECOVERY='D:/cm-nb-root/test-results/desktop-native-complete-K7eooB/report.json'
node tests/creation-model-followups-native.mjs
```

纯约束测试 `node --test tests/creation-model-continuation.test.mjs` 共 4 项通过，覆盖原始运行关闭状态、案例只尝试一次、继承预算身份与上限、重开仅允许实际倒计时推进。两个入口及公共会话工具均通过 `node --check`。

## 仅针对模型调度前拒绝的恢复入口

增加 `CRAFTMINE_CONTINUATION_RECOVER_REJECTED=CA07` 后，续测工具仅允许恢复这一条明确的目标过期拒绝：旧报告必须显示未提交、0 次模型调用、`promptResult.ok=false` 及 `CREATION_TARGET_STALE`；只读宿主数据库中的对应最终事务必须错误一致、0 调用、0 token、无统计缺口或中断，且只存在这一条原话用户消息。其他失败、网络状态不确定、已提交或已调用的案例一律不可重放。

旧工具没有保留拒绝前完整的 31 条预约身份快照，因此此处不声称存在历史逐字比较。历史报告的前后 31 次、数据库中的零调用与原始 25 条前缀共同证明此前拒绝；从恢复入口开始，另行冻结当前 31 条预约文件的真实字节，并在启动、真实复制与新会话准备、再次捕获目标之后逐字核对，最后才允许发送未到达模型的愿望。

恢复入口先冻结旧报告为 `continuation-rejected-before-model.json`，新的最终报告使用 `continuation-recovered-report.json`；新证据使用 `recovered-` 前缀，不覆盖旧部分证据。原尝试继续保存在 `attempts` 中。新报告承接 CA06，因此汇总时应使用恢复后的报告替代此前续测报告作为新增样本统计来源，不能重复累计 CA06 的 6 次调用。

恢复经实际复制按钮回调创建新副本及其独立会话，保留旧失败副本与原会话历史。评测控制器返回真实新会话 ID，后续客户端重开沿用该 ID 和同一 profile；预算总上限仍为 40，剩余 9 次只用于 CA07 与 HOLDOUT01。恢复资格在发请求前持久登记，一旦已尝试便不自动重放。

新增拒绝恢复约束后共 7 项纯测试通过，并已对现有失败 profile 完成只读谓词验证；此补丁提交时尚未重新调用模型，等待包含 `copy-world` 固定入口的产品最终编译。

## 副本交接修复后的实际续测

在总控明确启用最终编译后，真实复制按钮创建了新副本和独立会话；准备结束前 31 条预约文件逐字未变。CA07 新增 6 次模型请求，实际检查通过并采用新构建，累计预约为 37/40。

随后重开验收遇到 `EVALUATION_SESSION_MISSING`：新会话被产品自动命名为“放置树木并保留原有内容”，测试控制器仍要求初始化时的固定标题。模型和思考强度仍正确为 `deepseek-flash/high`。这是测试控制器使用可变标题识别会话的问题；保留本次 CA07 失败分类，不重新发送已经执行的愿望。HOLDOUT01 仍未执行。

本次第五次客户端初始化失败后，旧 runner 的清理逻辑先查询评测快照，又因尚未初始化而抛错，导致跳过退出。已验证该 Electron 的父进程属于本次 runner 后定向终止，父进程退出码 1，无其直接子进程残留；这次不计为正常退出。独立记录在 `continuation-shutdown-supplement.json`，原报告不覆盖。工具现已修正为即使评测快照失败，也单独调用原生退出入口，避免依赖评测初始化成功。

## 最终有限评测结果

总控将测试会话身份改为稳定 UUID、实际 provider、模型与思考配置验证，并完成最终编译后，运行 `tests/creation-model-final-native.mjs`。使用同一个 K7eooB profile、真实新会话、原来的 37/40 预算；没有重新发送 CA07，也没有新建预算。

`test-results/desktop-native-complete-K7eooB/final-continuation-report.json` 的 CA07 零请求补验共 15 项通过，包含实际采用构建、新树及碰撞、完整进度重开一致、原世界构建与全部对象及完整进度未变。补验前后 37 条预约文件字节完全一致，原 CA07 失败报告仍保留。

随后仅执行原话颜色修改案例 HOLDOUT01。该名称是历史标识，此表达已用于开发，不应宣传为未见过的独立保留集。实际发生 3 次模型请求，累计预约 40/40；下一次模型调用被 `EVALUATION_REQUEST_LIMIT` 在网络前拒绝。目标颜色未改变，也未完成新的检查采用，因此结果记为 `failed`，原因是本次有限预算内未完成。没有追加请求、额度或替模型写入答案。

此次两次客户端退出码均为 0，窗口与输入隔离违规、页面错误和退出失败均为空。原 IjZqHs 报告、profile 与全部文件 SHA 仍不变。最后入口的唯一尝试登记会阻止再次执行；这份最终报告只含新增的 HOLDOUT01 一个模型样本、3 次调用，CA07 补验不计模型样本。

最终新增模型请求合计为 15：CA06 为 6，CA07 为 6，HOLDOUT01 为 3；加原始 25 次恰好达到共同 40 次上限。汇总应取 `continuation-recovered-report.json` 中的 CA06/CA07，加 `final-continuation-report.json` 中的 HOLDOUT01，保留两次原产物补验与历史失败说明，不重复累计旧续测报告。

```powershell
$env:CRAFTMINE_SOURCE_ROOT='D:/cm-nb-root'
$env:CRAFTMINE_CONTINUATION_RECOVERY='D:/cm-nb-root/test-results/desktop-native-complete-K7eooB/report.json'
$env:CRAFTMINE_LIVE_CONFIG='D:/Craftmine World/.craftmine/secrets.json'
node tests/creation-model-final-native.mjs
```

该命令已经执行完成，仅作为可复核入口记录，不可在现有 profile 中重新获取预算或重放案例。
