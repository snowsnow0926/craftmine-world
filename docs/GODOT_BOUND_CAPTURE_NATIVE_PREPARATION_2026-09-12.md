# 新截图接口的成品零模型验收准备（2026-09-12）

本轮仅准备驱动与必要私有接线，尚未启动任何冻结成品或模型。独立 worktree 为 D:/cm-capture-product-acceptance-0912，基于已提交 1f35c10a；没有复制总控未提交工作，也没有访问 qQcut9 或 VO4Pki 档案。

新增私有 headless 命令 godotCaptureBoundView 严格透传 worldId/buildId/instanceId/candidateId 到真实 GodotWorldViewHost.captureView；godotCaptureBoundState 只读正式/候选身份、正式 host state、所属窗口与已经挂接的子视图 bounds。两者只在既有已验证 headless 授权下可用，字段有限，不接受 JS、视图尺寸或附加操作，仍由正常 host 拒绝错误身份/未挂接等状态。index 只修改 installHeadlessControl 底部接线，已与主机桥 agent 协调。

入口为 `node tests/godot-view-capture-native.mjs --packaged-root <新冻结包绝对路径>`，默认 prepare-only；加 `--run` 才执行。每次强制创建新的独立 profile，不接受旧报告或 profile 参数。移除所有模型/评测配置，正常 UI 选择 play，再创建空白造物世界。正式截图前通过普通 runtimeSave(freeze:true) 暂停保存，核对截图前后真实 host state、身份和所有已挂接 view/window bounds 不变。

随后用该新包中确切 cw.environment.natural-daylight ZIP，经正常 importSource/check/candidatePreview 创建候选。candidateId 来自真实候选记录，instanceId 来自可信 host candidateInstance；不自行编造。读取候选截图并核对相同的前后身份/布局；正式分支不能误抓候选。关闭候选后旧候选身份必须拒绝，再正常创建第二个世界并验证旧正式身份拒绝。

截图唯一入口是新的 captureView，驱动方法白名单没有旧 godotCaptureView/headlessCapture，也没有任何临时 attach、resize、focus、PointerLock 或 OS 输入。如果正常 UI 没有挂接世界视图，实际验收应失败保留证据，不能调用旧截图函数补救。

暂停证据必须区分：正式截图记录 freeze 后的暂停/保存状态保持；候选正常预览内部会 resume，所以只核对候选预览身份/布局及正式 host state 不变，不把正式 state 冒充候选引擎暂停。新截图代码本身无 pause/resume 的行为已由禁止动作回归覆盖，不为这项再扩游戏接口。

14 项无输入回归通过（11 项捕获 host＋3 项私有转发），完整 desktop TypeScript 检查通过，驱动语法和无包 prepare-only 通过。初次类型检查因本隔离树缺工作区包 dist 不可解析；按既有本地源码构建 shared/plugin-sdk/i18n/agent-runtime/plugin-devkit 后复查通过，没有使用其他 worktree 的产物替代源码。

实际正式/候选 PNG、尺寸、摘要、前后状态和拒绝场景仍待总控新冻结包运行。本准备不能记为成品截图已经通过。
