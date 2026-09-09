# Batch 07 delivery / telemetry interface

The injected service is `electron/main/craftmine-telemetry.ts`, factory `createCraftmineTelemetry({observe,clock?,processStartedAt?})`. Production `observe` is `craftmineDiagnostics.observe`; clocks are only injectable for tests. Main's default process start estimate uses monotonic performance.now minus process.uptime.

G integration is supplied as `delivery-integration.patch`, limited to main index.ts:

1. Create immutable packaged build identity with `readCraftmineBuildIdentity(process.resourcesPath)` and expose it in the existing diagnostic snapshot. It reads only bounded `resources/source/build-manifest.json`. Development absence stays absent; manifest hash is not a whole-package hash.
2. Create telemetry after diagnostics; snapshot closure includes `telemetry.status()`. Dispose at will-quit.
3. `attachWindow(window.webContents)` immediately after constructing the main window, before navigation. First did-finish-load records startup. Bounded frame windows begin at document load and every 30 seconds, maximum 120 callbacks / 3 seconds, with at most one pending window. Hidden documents yield no frame samples. No focus, show, gesture or input API is used.
4. Feed actual `agent.event` envelopes to `observeAgentEvent`. It keys by session+turn; duplicate starts cannot reset the clock. End/error records elapsed workflow time. `finishAgentJob(sessionId,turnId,status)` handles cancellation/crash/finalization when no normal end event arrives. Late duplicate endings do not manufacture samples.
5. Wrap the existing `completeOneShot` call in `measureCompletion(() => ...)` to include actual review completion/failure time. It returns the original value or rethrows the exact error. It does not modify model, timeout, tokens or request hooks.

Diagnostics retain format `craftmine.diagnostics/1`. Metrics now carry bounded sample count, p50/p95 only when samples exist, `bySource` groups and outcome counts. Sources are fixed: renderer_document_load, desktop_animation_interval, agent_turn, one_shot_completion. The complete Agent workflow includes tools/network; grouped one-shot timing is distinct. Source names/outcomes are validated; no session ID, model prompt, error message or source path is exported. Sampling counters and definitions explain omissions and actual meaning. Ring capacity is 200 per metric, not lifetime statistics.

The frame timing script is also used by the independent fixed-load browser benchmark; that benchmark records its own environment, windows, load and references. Diagnostic samples are not benchmark acceptance. No claimed optimization is made without a before/after comparison.

Windows read-only entry: `desktop/windows-readiness.ps1 -NoIsolatedMachineAvailable`. Explicit disposable CI entry: `desktop/ci/windows-isolated-validation.ps1` (default not-run; Execute is refused outside a GitHub-hosted ephemeral Windows runner). No installer has been executed locally. The NSIS silent-error path now uses a default button and exit code 2, following the bundled upstream NSIS templates' silent-dialog convention; final package compilation is still required after freeze.

## 玩家累计 token 配置

Rust `TaskJournal::budget_configure` 输入 `{projectId,sessionId,worldId,taskId,generation,operationId,maxTokens}`，输出 `{operationId,budget,previousMaxTokens}`。`maxTokens` 必填，null 表示无限累计，整数范围 1..9007199254740991。主进程单独路由 `budget.configure`；禁止加入模型 `budget_call` 或 proxy 工具白名单。当前中断任务可以先调限再恢复，完整输入幂等。备份 schemaVersion 改为 3，兼容 1/2，未知未来版本拒绝。
