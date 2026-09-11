# 连续预制组件安装超时定位与修复（2026-09-12）

只读检查 VO4Pki 原报告、intent、executor ledger 与日志，没有启动档案、重试城墙安装或调用模型。

## 直接原因

主程 requestCraftmineHost 的源码长事务分类未包含 package.request，因此 installSource 只等待 15 秒。前三次树/门洞安装从各自 staging source 创建到写完 intent 约 13.6、14.0、14.1 秒；城墙从 05:16:14.220 到 05:16:30.743 约 16.5 秒，超过期限。

传输超时只删除主程 pending 回执，不取消插件操作。城墙 operation `44f72ddf-871d-4ca2-a849-eec09943eea1` 实际已有源码 revision 6 和检查任务 `gjob-e5ca9b690e45296e970c35809c0bc28afe602cebe4612f06b015feab3433479e`。executor 在 05:16:30.796 启动，驱动收到 TIMEOUT 后于 05:16:30.804 退出；3 秒后 PLUGIN_HOOKS_CLOSE_TIMEOUT。后次重开正常把没有最终回执的检查标为 interrupted。现有证据不足以把 framebuffer 警告认定为安装超时根因；候选预览期间的 GODOT_CANDIDATE_ACTIVE 也不是此次源码写入失败。

原始报告：`D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/resume-202ec43f-2e20-4467-a9cb-be42fa2a3a42-report.json`。源码 intent 位于同 profile 的 `plugins/data/craftmine.world/package-source-installs/8342a8c11f5564405e5e150c6c5bebde99bd4d815429283ecc87901d08c82a31/intent.json`。

## 最小修复和验证

只有私有 package.request 的 installSource/installSourceProposal 改用现有 60 秒源码事务期限；包读操作维持 15 秒。未改变模型累计预算、调用次数、权限、源码 CAS 或采用边界，也没有自动重试。

4 项测试通过：既有私有 API 可达性；两种安装等待 16.5 秒后仍各取得一次正常回执；普通包读取仍在 15 秒超时；60 秒传输超时之后仍可能发生底层迟到保存，transport 不重试、不伪装回滚。测试抽取真实生产 adapter、sendToChild 和 handleChildMessage，用虚拟时钟模拟服务响应，不等待真实 60 秒。

## 原城墙的正常恢复入口

不安装新的实例。原 profile 已有 revision 6，先由独立成品主 renderer 的普通 piDesktop.pluginPanelInvoke 调用 godot.historyLoad，取当前 main 分支的 index 并确认 revision/manifestHash 与原 intent 一致。然后 godot.historyCheck({worldId,branchId,revision,manifestHash}) 对该确切源码重新检查；由正常历史服务创建操作上下文，godotBuild.start 自动交给现有 executor。用 godot.historyJob 查询真实结果，通过后再正常 candidateRead/Preview/Apply、保存和冷重开。

该路径来自 godot-history-panel-service.ts 和 host-requests.cjs，已告知负责实机恢复的 agent。本轮只核对接口，未运行它；不能把此次传输修复写成城墙已重新检查或已采用。
