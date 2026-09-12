# GU5：已验证的原生导入崩溃诊断

本增量以 GA27 原始失败作业为回归来源：`docs/evidence/ga27-legacy-bases-20260912/side-view-failed-jobs.json` 及同目录 `side-view/executor-ledger.json`、`source-manifest.json`、两个 `im-*` 日志目录。原作业 `gjob-e2cf1872e38556c0fc3ae90add0bedeeb082904357c74225a7395ed25c9866d6` 保持 failed，outputHash 保持 `346d3011d0cbf87a18489913b04c1846f28184e4cd546d3d7b48d7aec7e970aa`。本轮不重跑引擎、不运行模型，也不改写旧证据或把后来的同源成功算入旧作业。

原缺口：普通 `godot_build_read` 只投影到通用 `GODOT_BROKER_TASK_FAILED`、若干 Windows ERROR 观察和 `runtime.not-run`。原生进程的 3221225477 / `0xc0000005` 不在 Core 的 job output 里。仅凭通用失败或日志文字无法证明原生崩溃。

## 生产链

`main.cjs` 将同进程 executor 的 `nativeDiagnosticEvidence(record)` 作为私有 `executorNativeDiagnosticEvidence` service 传入 `createWorldTools`。`godot_build_read` 的 direct/wait 两路径均先完成既有 world/job 校验，再调用该只读投影；await 后再次核对当前 world 和 turn。没有新模型工具、参数或公开 receipt 协议。缺 provider 在现有 service wiring 报告中列为缺失；诊断的 `nativeEvidenceBinding` 为 unknown，不能假定有证据。

executor 仅从 host 配置的 dataPath 读取既有 ledger，以及 Core 固定布局 `godot-builds/SHA256(worldId)/buildId/manifest.json`。build ID/job ID 先做固定格式验证，各级目录和文件拒绝链接；文件大小保护只作用于诊断读取（ledger 64 MiB、build manifest 2 MiB），超出返回 unknown。这不是玩家执行预算或停止条件。读取不会调用 start、broker、recover、claim、finish、enqueue、cancel，不写 ledger，不新增重试，不要求新的原生运行。没有私有路径、stderr、令牌或完整 ledger 返回模型。

可信边界是同进程私有 service 与 Core 返回的作业。Core `godot_jobs.rs::read_job` 已验证存储 output 字节与 outputHash；RPC 对解析后的 JSON map 排序，不能用 JavaScript 重新序列化后直接重算这个 hash。诊断保留 Core outputHash 和 inputHash，绑定投影到同一 job/world/build/revision/manifest/output 身份，并以同一 output 的实际 log hash 匹配验证记录。模型提供的额外 nativeEvidence 字段由工具 schema 拒绝，output/日志中自称已验证的文字不提供任何证明。

## 分类条件与限制

在 failed check 作业中，私有 ledger 必须同 job/world/mode/state/outcome；原 build manifest 必须匹配 world/build/revision/manifest/base（可用时也匹配 baseBuild/assetManifestHash）。对 manifest 所有 source、asset 和 host 文件重新计算 broker 使用的 sourceDigest，匹配原验证 stamp；不以当前源码或缺少 host 文件的 project index 代替原 build snapshot。

原执行器只有在验证实际 broker receipt、process/network/cleanup、resource enforcement、recovery、日志大小/hash/无解析错误以及固定 broker hash 后，才写入 `retryDecision.reason=VERIFIED_NATIVE_IMPORT_CRASH`。新增诊断必须同时找到该历史 stamp、相同 sourceDigest、当前 host 固定 broker pin、相同实际 output log SHA，并核对原 attempt 的 import 操作、transport exit 0、engine exit 3221225477、精确 native error、clean cleanup/recovery、无 enforcement/timeout/cancel。没有 stamp 的原始 exit 值不算验证。

满足条件在既有 `craftmine.godot-diagnostics/1` 内追加 `category=native-crash`、`errorCode=GODOT_NATIVE_IMPORT_ACCESS_VIOLATION`，保留稳定 fingerprint、原 source 和原 evidence refs。`nativeProcess.scope=historical-validated-attempt-in-this-failed-job` 明确只证明历史尝试；GA27 第一尝试有 stamp，第二尝试无 stamp，绝不把第二次退出也升级为已验证。它不改变 passed/status/check/candidate/outputHash，不验证后续成功，不给 root cause，不给文件/行号，不归咎模型或源码。

`sourceParseDiagnostic=not-observed-in-matched-log` 仅表示匹配的可用日志中没有识别到脚本解析诊断。若有脚本/类型/资源/运行错误，native-only 分类保守降为 unknown，原脚本诊断照常展示。完整根因、引擎缺陷或环境缺陷均未知；`complete=false` 和 upstream truncation unknown 保留。缺文件、换包 broker pin、旧无 stamp、格式不匹配、不同 source/output/log 身份都不补造证明。当前切片不覆盖没有既有 validated stamp 的其他 native 崩溃。

## 验证

先在该 checkout 打包生产插件（需正常项目依赖可解析）：

```powershell
node desktop/build-world-plugin.mjs --output test-results/native-diagnostics-plugin
node --test tests/godot-native-diagnostics.test.mjs tests/godot-diagnostics.test.mjs tests/godot-build-read-wait.test.mjs tests/godot-round3/S6/tool-services.test.mjs tests/godot-remaining/L/broker-contract.test.mjs
```

可用 `CRAFTMINE_DIAGNOSTIC_PLUGIN` 显式指定本 checkout 的真实打包输出。测试核对五个生产模块的实际打包字节；Core RPC 使用原归档 row 的明确 fixture，私有 executor 读取独立临时 dataPath 内的原 ledger/manifest，而不是模拟回调直接塞入 native 分类。不会称作新一次 Core/LPAC/普通玩家实跑。

反例包括无验证 stamp、非零普通退出、broker transport 混淆、wrong world/job/build/revision/manifest/source/broker、output identity mismatch、修改日志、parse、timeout、cancel、resource enforcement、cleanup 未验证、缺文件、路径 junction、缺 service、await 后 world/turn 切换、后来同源成功，以及模型伪造参数。direct/wait 均验证仅原失败作业获得第一尝试的窄分类、返回原 output/hash，原 ledger 字节不变。
