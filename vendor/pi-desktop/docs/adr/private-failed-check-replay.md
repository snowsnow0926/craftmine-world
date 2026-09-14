# 失败检查原字节诊断重放

目的：当普通检查在校验产物或创建检查窗口之前超时，直接运行成品包内的同一个 `godotVerifier.check()`，减少重新调用模型、重新导出的干扰。

`godotCheckReplay` 只在有效 headless profile、父进程 IPC、offscreen 模式下可用。入口从固定输出目录读取 `replay-packet.json`，必须匹配父进程环境中的 SHA256。packet 保存 SQLite 中失败任务的 `check_input` 原文本及其哈希，并绑定原 job/world/build。完整描述随后由生产 verifier 正常解析、校验。

这一入口不连接或写入 Core，不调用 claim/finish，不注册或采用候选。复用 `index.ts` 已有 verifier 实例，因此并发、退出取消和 30 秒期限全部沿用产品行为。重放结果标为 diagnostic-only，不能替代原失败 job 的状态或普通创作验收。

准备脚本：

```powershell
$env:CRAFTMINE_CHECK_REPLAY_OUTPUT_ROOT = 'D:/cm-product-visual/test-results'
node tests/godot-check-replay-native.mjs '<checkout>' '<runtime resources>' '<原 tasks.sqlite>' '<gjob-id>' --prepare-only
```

准备模式不启动 Electron/Godot。它通过 Node SQLite `readOnly:true` 读取失败 job，保存原输入/输出；对原 artifact 文件逐项检查路径无链接、大小、SHA256，并记录普通 Node 流式读取耗时。结束再次比较原 job 行。它既不复制 Core 数据库，也不重写失败状态。

成品包诊断在总控允许后运行：

```powershell
node tests/godot-check-replay-native.mjs '<checkout>' '<成品目录/resources>' '<原 tasks.sqlite>' '<gjob-id>' --packaged-root '<含 Craftmine World.exe 的成品目录>' --run-replay
```

生成新独立 profile；包内资源、主程序与包清单有身份校验。没有 UI 创建世界、模型调用或业务写操作。正常退出、原 job 行未变化、包清单未变化都是硬断言。可写入输出目录的 `cancel` 文件或发送 SIGINT/SIGTERM 请求正常退出。失败证据始终保留，不增大检查期限。

2026-09-14 只读准备实测：`gjob-bfb4185c34bc1ba6a1cdfb44560986a5a2b9e7db3a556c138476bade39cfe90b` 的存储 descriptor SHA 为 `f9ce0fb596e63a49bfb83dade64834c2c59c1748a99d61e4c985a406a52e8e71`。10 个原产物的大小与 SHA 全部一致，普通 Node 流式读取约 39 毫秒（PCK 约 10.5 毫秒，WASM 约 23.2 毫秒）。报告位于 `D:/cm-product-visual/test-results/godot-check-replay-BQgM6D/report.json`，未启动原生进程。这说明文件原字节可读取，不证明 Electron 成品内部的异步读取、线程池和窗口创建已健康；具体等待阶段应由新的 phase 日志与同包诊断确定。
