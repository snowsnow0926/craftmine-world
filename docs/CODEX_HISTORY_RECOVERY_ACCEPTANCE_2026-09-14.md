# 长会话中止后的 Codex 恢复验证

同一城市世界 `world-7a2bad903a26`、同一 PI 会话 `da57da5e-063e-46a0-99a7-7b3ba27fd35e` 在中止后恢复失败。真实错误来自 `turn/start`：`-32602`、`Input exceeds the maximum length of 1048576 characters.` 旧适配器把完整历史复制进一次新输入，超过了 CLI 的单次输入限制。

修复提交 `4ccb16e0` 使用本机 CLI 公开的 `thread/inject_items` 分批恢复完整历史，每批确认后再发送当前请求。保留历史来源、角色、状态、原话和图片；不回放旧工具，不更换模型，不增加模型预算，不修改可见 PI 对话或世界存档。部分恢复失败时不重试同一批次，也不发送新的模型请求。协议说明及针对性场景见 [ADR](../vendor/pi-desktop/docs/adr/codex-full-history-native-injection.md) 和 [E2E 场景](../vendor/pi-desktop/docs/e2e/codex-full-history-native-injection.md)。

## 真实恢复结果

北京时间 2026-09-14 09:59:08，从普通创作入口发送继续检查请求。该请求之前有 **207 条真实历史消息**；只读投影验证可逐字重组，历史图片使用独立图片块。实际 CLI 接受完整分批恢复，随后原 `gpt-6-astra / xhigh` 正常回复并执行项目事实、作品目标、指南、失败报告及续检工具。

- CLI：`0.154.0-alpha.6.2`，SHA-256 `081e4de4be8e38fac6ed4d95e3b1a0b9f6d31c090ddc36e1696b349fe406f575`。
- 恢复轮：`f600a8e9-8512-440c-9e94-f8988b7d2e7d`，正常结束，主机耗时 **306.640 秒**。
- 本轮终态用量：未缓存输入 1,010,213、缓存读取 1,653,888、输出 1,590，总计 **2,665,691 tokens**；推理明细 588 已包含在总量中。费用、内部请求数、纯生成 TPS 未提供。
- 真实检查作业：`gjob-6c2e8a0d200a840dc9cc508b3ccfa921afb3f5033cea732a6abf977ce4697fda`。

**完整历史恢复通过，世界候选检查仍失败。** 新增完整诊断明确显示：`artifact-verification` 阶段在 30.141 秒后超时，尚未进入运行窗口或引擎就绪阶段。因此不能把这个检查故障归因于博美脚本，也不能声称修复候选已经采用。Agent 如实报告失败，修订 14 草稿和原正式世界保持不变。后续自动回合为继续定位应用问题而正常中止，其已有 186,981 tokens 另行保留，不并入上述单轮数字。

## 证据与范围

原始目录为 `D:/cm-product-agent/test-results/desktop-native-product-5N6HZ2/`：

- `continuation-220faa5e-79cb-4dfa-b913-46d1315802d4.json`：普通请求、模型身份、回合 metrics、正常关闭和完整性通过。
- `turns/f600a8e9-8512-440c-9e94-f8988b7d2e7d.json`：原工具、回复及终态用量。
- `history-recovery-build-4ccb16e0.json`：实际 agent-runtime 文件哈希。
- `responses/030-continue-after-history-fix.json`、`031-stop-for-artifact-diagnosis.json`、`032-quit-for-artifact-progress.json`：普通请求、取消与退出回执。

此次应用为源码模式混合诊断构建：主程序和 Core 来自 `98e559a3`，agent-runtime 来自 `4ccb16e0`。这证明实际 CLI 和应用会话的恢复路径，不能代替最终 Windows 成品测试。原超限失败、完整阶段日志、后续中止和未采用状态均保留；后续文件校验故障需要独立修复与验收。
