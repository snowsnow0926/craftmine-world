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
