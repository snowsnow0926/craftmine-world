# 同会话有限继续驱动（2026-09-12）

CITY01 新成品已完成体验澄清，却在第 9 次请求出现 `EMPTY_MODEL_RESPONSE`。重新建立 profile 会重复消耗准备上下文；本次增加一个独立测试驱动，复用已有产品的 `CRAFTMINE_EVAL_SESSION` 重开入口，只发送一次明确的新玩家跟进，不修改原始愿望。

## 接口

```powershell
$env:CRAFTMINE_PROMO_CLARIFICATION_MODE='recommended-or-first'
node tests/promo-wish-continue.mjs <原始或上次续报的绝对路径>
# 以上仅只读准备，不读取密钥、不启动成品、不发送模型请求。

$env:CRAFTMINE_LIVE_CONFIG='D:/Craftmine World/.craftmine/secrets.json'
node tests/promo-wish-continue.mjs <同一报告的绝对路径> --live
```

澄清默认关闭，只有显式设置上述模式才按推荐或首项选择；复用原有受保护 `headlessAskPending/Resolve`，完整保留问题、原选项、选择原因和回执。桥错误立即停止，不绕过、代写自由答案或重试愿望。

唯一跟进文本为“继续完成刚才的愿望。”，这是新增玩家消息。原报告和原 `wish` 保持不变；续报单独记录 `followUp`、原报告哈希、实际新增请求数和原始愿望。不能把有跟进或有澄清的结果归入首次无介入成功。

## 校验与边界

- 只接受正常退出、审计干净的错误模型任务或 `TIME_STOP`，要求还有剩余请求。拒绝未结束、强制终止、完整性失败、已知仍在排队/运行的检查以及没有错误的成功任务。
- 从原报告定位原目录中的 `profile`；通过现有 headless marker 验证隔离，固定选择原报告里的成品路径并核对实际包清单。不支持复制 profile、切换成品、覆盖模型或限额。
- 原报告、会话注册表、愿望账本、世界观察必须对应同一个 session/world/model/provider。重开后再核对真实会话、权限模式、原始用户消息、正式构建和剩余预算；任何变化在新消息发送前拒绝。
- 请求额度继承原账本实际 `limit`（1..40），不限于 40。之前消耗仍计入，运行中和结束后校验账本前缀，只允许原序列后追加。10 请求检查点也能保留原剩余预算。
- 每次明确的继续最多 10 分钟；独立定时器在到时请求正常 abort，避免较慢的观察或澄清 RPC 延后模型停止。该时间是本次新增跟进窗口，不重置累计请求额度。
- 沿用既有 evaluator 的 initialize → 原 session.get/provider 校验 → 正常 wish/agentPrompt 路径，没有新产品操作权限、没有强行解除租约或跳过任务恢复检查。源码/进度冲突由产品正常拒绝并保留报告。
- 原报告按哈希建立不可覆盖的单次 claim，profile 同时只允许一个继续驱动；不确定提交也不会自动重发。进程异常留下 claim 时必须先审查，不自行删除后重试。
- 续报以排他创建方式写入原 profile 的父目录 `continuation-UUID.json`；正式世界截图写同名前缀 PNG，旧报告/截图不覆盖。只统计日志字节，避免流式片段泄漏密钥。
- 续报保持 `craftmine.promo-pilot/1` 格式。真实检查通过、模型停止且账本匹配后，可直接传给既有 `promo-wish-adoption.mjs`，再正常探索。采用合同对这种续报额外要求原报告未变、账本只追加、无完整性或收尾错误；即使残留检查通过也不能绕过已知失败。没有检查候选不补写场景或伪造效果。

## 本次离线验证

新增合同测试覆盖原 10/40 额度继承、真实 evaluator budget 重开与耗尽拒绝、同会话/世界/权限/原始消息绑定、账本篡改和限额变化拒绝、排他 claim、原报告字节不变、环境注入隔离以及采用报告兼容性。连同已有澄清、采用测试共 **20 项通过**；两个新脚本语法检查通过。

对真实 CITY01 报告 `D:/cm-promo-city-retest-0912/test-results/desktop-native-complete-eokghq/report.json` 执行了 prepare-only：识别原 session `1d24450f-6955-4444-abd4-6e8bb56af9c8`、world `world-fa9771a1b259`、DeepSeek/high、9/40 已用及 31 剩余，实际包清单匹配。没有创建 claim、续报或模型消息。**本次未执行 live，真实同会话继续仍待总控审核后验证。**
