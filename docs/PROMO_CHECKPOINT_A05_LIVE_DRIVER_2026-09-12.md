# PET01 检查点派生 A05 第二次尝试：模型驱动

本轮交付独立驱动与离线验证。没有启动产品或调用模型。

## 试验定义

- 来源是已经成功恢复的 PET01 采用检查点。
- 本轮是第二次基于该检查点的主线 A05 尝试，标记 `trialKind: checkpoint-derived`、`derivedAttempt: 2`。
- 唯一模型输入为：**我希望狗换成白色博美犬。**
- 愿望 ID 固定为 `PET_CHECKPOINT_A05`。不接受外部提示词、文件名或实现步骤。
- 这不是独立清单 PET02「叫它团子」，也不代表完整主线通过。原失败／耗尽试验报告不改写。

## 使用方法

默认只读准备，不加载模型密钥、不启动成品、不创建报告或预算：

```powershell
node tests/promo-wish-checkpoint-live.mjs "D:\...\restore-root\report.json"
```

总控明确决定运行后，给出已有 DeepSeek 配置文件，并加入 `--live`：

```powershell
$env:CRAFTMINE_LIVE_CONFIG = "D:\...\local-config.json"
node tests/promo-wish-checkpoint-live.mjs "D:\...\restore-root\report.json" --live
```

只接受成功 restore 报告绑定的同一冻结成品；实际 inventory 必须一致。模型沿用原报告的 DeepSeek model ID，思考强度固定 high，额度固定 10 次真实请求。不得设置旧 `CRAFTMINE_EVAL_SESSION` 或更高限额。

## 执行边界

先核对 restore 报告、原报告／预算等 SHA 和新 marker；新评测预算必须起始 reserved 0。驱动不会删除或重建旧账本。`model-report.json` 在 restore root 独占创建，已有该文件即拒绝再跑；原 `report.json` 不覆盖。

正常 evaluator initialize 创建新的桌面 session/provider，拒绝 reopened session，随后以真实 snapshot 再验证 reserved 0、limit 10 和模型未运行。正常 resume 和有限 godotExplore wait 30 物理帧仅让场景稳定，不改狗、玩家位置或视角，不向模型提供源码答案。

原句只提交一次，即使回执丢失也不自动重试。模型停止后若 check 仍 queued/running/recovering，继续通过 `promoPilotProgress` 等待；从提交开始总限时 10 分钟，随后停止。恢复、lease 或活跃任务阻塞如实报告，不自动 resume/discard 旧任务。

## 报告与后续采用

输出 `restoreRoot/model-report.json`，格式保持 `craftmine.promo-pilot/1`，保留原有 adoption 工具定位 parent/profile 的约定，并增加检查点来源、SHA、旧／新预算、原 world/build/source、派生尝试身份、完整隔离退出审计。

提前结束时保留真实剩余额度，不为兼容旧工具补耗请求。旧 adoption 工具若强制 remaining 0，需要单独扩展其「模型已停止＋检查通过＋零模型调用」前置条件；这个驱动不伪造预算。

模型及运行快照统一递归脱敏，替换实际 API key 与 headless token；进程标准输出只记字节数，避免跨 chunk 密钥残片写入日志。最终再次核验旧证据和冻结成品 SHA，记录实际新账本保留的请求数量及哈希。

## 离线验证

测试命令：`node --test tests/promo-wish-checkpoint-live.test.mjs`。

9 项离线测试覆盖：固定原句和显式 live、恢复与隔离证据、预算不重置、旧 session／设置／已存在报告拒绝、来源篡改、queued check 等待、脱敏、结构化恢复错误、prepare-only 不触发产品或模型。语法及 diff 检查通过。真实模型试验由总控在成品冻结后执行。
