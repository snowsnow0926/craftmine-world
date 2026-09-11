# GU5 结构化 Godot 诊断最小切片

模块：`plugins/craftmine-world/godot-diagnostics.cjs`。

导出 `diagnoseGodotBuildRead(record)`，直接消费正常 `godot_build_read` 返回的原始作业对象，输出 `craftmine.godot-diagnostics/1`。它是只读纯转换，没有文件访问、引擎/浏览器/模型调用、网络、脚本执行、重试循环或预算策略，不修改输入。

## 已核实的真实数据链

1. `godot_jobs.rs::read_job` 返回 jobId、worldId、taskId、buildId、sourceRevision、manifestHash、assetManifestHash、outputHash、blockedReason、interruptReason、stage 等字段；requirements::attach 补充 checkRequirements/hash。
2. `godot_builds.rs::godot_build_read` 补充 sourceStale 与 artifacts。插件可直接返回该对象，或经 `godot-build-read-wait.cjs` 增加等待和 creationApplication 字段。
3. `godot-executor.cjs::finishJob` 保存 `craftmine.godot-job-result/1`：output.import.log、output.compile.errors/warnings、output.check.assertions/requirementsEvidence、inputHash 与 engine.evidenceHash。
4. 当前 executor 的 import.log 只保留末尾 8000 字符；错误最多 16 条，每条最多 500 字符。运行断言 detail 也可能截断。原返回没有完整的截断元数据，因此诊断一律标 `upstreamTruncation=unknown`，不能把日志中没看到错误当成没出错。

## 输出与保真边界

- `reportedStatus`、`reportedOutputPassed`、`reportedCheckPassed` 只复制有效类型的原报告值；诊断不重判 job pass/fail，`acceptance` 固定为 `not-assessed`。
- 每项诊断携带 phase、category、errorCode、file、line、message、assertionRef、requirementsRef、source、evidenceRefs 和固定 nextStep。错误分类是便于定位的解释，不表示已经确定模型或作者责任；`attribution=not-determined`。
- `SCRIPT ERROR: Parse Error` 与类型推断问题分别分类；资源加载失败保留实际资源路径。只从实际相邻 Godot `at:` 帧或消息内明确位置取源码行号。C++ loader 路径另列 engineFrame，绝不把 `resource_loader.cpp:317` 伪装成资源文件第 317 行。
- compile.errors 与 import.log 只有消息完全一致且唯一时才关联定位。重复错误跨多个文件、只剩截断片段、孤立错误行，都不猜位置。
- export 日志若通过原 `--- export ---` 分隔符附在 import.log 后，则保留 export 阶段。只有 compile.errors 时，阶段写 compile；不会凭文件名猜测导入或运行阶段。
- 失败断言保存原 `/output/check/assertions/N` 与 id。`runtime.not-run` 明确表示前置失败后没执行运行验证，不当作实际玩法断言运行失败。
- requirement 关联只针对现有 `runtime.creation-requirements`/`runtime.target-feedback`。要求证据格式、instanceId、job/world/build 和 requirementsHash 与原作业吻合；错配时仅保存异常，拒绝关联证据指针。该模块不重新计算需求或采样内容是否正确。
- source 保留原作业身份，包括 revision、源码/资源 manifest、output/input hash、engine evidence hash；缺少值返回 null，不从别的 job、当前工程或日志文字补造。
- sourceStale 明确要求先刷新源码身份。旧诊断仍保留，但不是当前修订的通过证据或直接修改依据。
- 执行器未就绪归入 environment；取消/中断保留原状态，nextStep 要求尊重停止。没有自动续作、修复次数上限或新增玩家 token/请求/整轮时限。
- 成功隔离运行可能输出原生 Windows `ERROR:` 日志；这些只标 observed，不改变原 passed。新编译错误数组与失败断言标 reported-error。

## 原始证据与指纹

每个被消费的原始字符串保存 JSON pointer、SHA-256、可见字符数和最多 1200 字符预览。字符串哈希针对收到的完整值，预览截断单独标记。所有文本标 `untrusted-data`；日志中的命令或“忽略指令”只作为证据文本，下一步说明全部来自固定代码，不执行或拼接日志命令。

`fingerprint` 的版本为 `craftmine.godot-diagnostic-fingerprint/1`，包含 phase、category、code、file、line、规范化完整可用 message 和 assertion id。仅规范化 ANSI 颜色与空白，不删除数字、资源名或具体差异。它排除 job/revision 身份，可用于观察相同错误再次出现；`sourceFingerprint` 额外包含 source，区分每个证据版本。它不能证明两个错误根因相同，也不触发停止或修复次数策略。

为了控制单次证据表示体积，当前只解析最多 65536 字符可用 import.log、每类最多 256 条数组、最多输出 256 个诊断。超出范围记录 omissions。这是诊断表示边界，与玩家模型或任务预算无关。`complete=false` 始终提醒上游已有未明截断；没有宣称已枚举全部问题。阶段只有原结果能证明时才附加，不凭推断合并不同错误。

## 接入建议

总控可以在两个 `godot_build_read` 返回路径统一添加派生字段：

```javascript
const record = await readGodotBuildWithWait(/* existing arguments */);
return {...record, diagnostics: diagnoseGodotBuildRead(record)};
```

直接 core.call 的返回路径也应执行同样包装。先等现有读取、当前世界校验及等待结束，再添加诊断；不能把派生内容写回 core 的 output 或修改 outputHash、原 status、候选、权限、采用状态。creationApplication 是独立事务，本切片不判断采用失败，也不会把采用问题改成编译失败。调用层需要另保留该字段。

错误抛出路径若需要展示诊断，应保留原抛错语义和源调用身份，不能用一个伪造 failed job 替代异常。当前切片主要面向真实返回对象；有 errorCode 但无 job status 的输入会明确保留 unknown status。

## 验证与证据来源

`node --test tests/godot-diagnostics.test.mjs` 覆盖语法、类型推断、资源缺失、原生帧与源码帧区分、重复/缺失位置、runtime 断言、requirements 身份错配、执行器/取消、稳定指纹、成功日志噪声、未知格式、证据截断和 sourceStale。

`tests/fixtures/godot-diagnostics/real-evidence.json` 保存三个原始日志片段和一项真实失败 job 的字段投影：

- P7 `task.log` 第 26–27 行：真实 `Expected parameter name`。
- Windows service `failure-bootstrap-task-1.log` 第 28–29 行：真实 `Cannot infer the type of "location"`。
- Windows export `broker-export-task.log` 第 84–85 行：真实 weapon_pistol.obj 加载失败。
- `docs/evidence/immersive-20260911/root-managed-chain.json#/cases/2/terminal`：真实 authored rule source hash mismatch 与六项失败断言，保留原 job/build/revision/hash。

fixture 附原文件 SHA-256 与行号/指针，测试核对原文件字节哈希和准确片段。其他状态场景为明确的合成契约夹具，不冒充新运行或新模型成功证据。没有在本切片重新调用引擎或模型。
