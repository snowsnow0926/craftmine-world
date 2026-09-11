# 绑定世界视图的只读截图

`GodotWorldViewHost.captureView({worldId,buildId,instanceId,candidateId?})` 只读取已经挂接到当前所属窗口的现有 Godot WebContentsView。未提供 candidateId 时只允许正式 current；提供时只允许正在展示的 pending 候选，且必须匹配由可信 stageCandidate(descriptor,{first,candidateId}) 在启动阶段保存的身份。原 stageCandidate 调用可不提供候选 ID，但那样不能截图候选。

截图前后核对实例引用、world/build/instance、候选绑定、view/WebContents、所属窗口、挂接状态与完整 bounds。切换、启动、关闭、保存/检查点进行中拒绝；已经暂停或冻结的正式画面可以读取，状态保持不变。候选可见时不会把候选冒充正式世界。没有挂接的 headless 视图同样拒绝，测试应先经正常 UI 显示游戏视图。

唯一像素来源是目标 WebContents.capturePage()。不调用窗口或视图 resize、attach、focus、show、resume、输入、JS、invalidate 或桌面截图。异步读取上限 4 秒，超时后不重启实例；如果原 native 读取仍未结束，同视图后续截图立即报 pending，防止不断积累后台任务。晚到结果不作为成功回执。

源图和视图单边最多 8192，面积最多 16*1024*1024；view 最小 320x240 DIP。NativeImage 像素可因 DPI 与 view 尺寸不同，只接受有限同轴比例（0.5–4，容许单像素舍入误差）。先检查源尺寸，再复制完整 bitmap；透明空图拒绝，真实纯黑/单色画面允许。

为有限单图传输，仅对已经捕获的 NativeImage 等比缩小至 1920x1080 范围。若 PNG 仍超过 4MiB，最多再从原截图生成一次 1280x720 范围版本；仍超限拒绝。不会改变运行中的任何窗口、视图或游戏 canvas。输出 PNG header 与实际输出像素尺寸一致，SHA-256 针对返回的真实 PNG 字节。

返回 format=craftmine.godot-view-capture/1、worldId/buildId/instanceId、candidateId(null或字符串)、scope(formal/candidate)、capturedAt(宿主 UTC ISO时间)、viewWidth/viewHeight、sourceWidth/sourceHeight、width/height、resized、pngBase64、sha256。没有附加世界观察，也不宣称截图与物理观察在同一个 tick。NativeImage 尺寸/编码语义参考官方 https://www.electronjs.org/docs/latest/api/native-image ，本实现不使用 resize 修改世界视图。

11 项无窗口/无输入测试覆盖正式暂停、可信候选ID、错误身份与不可用状态、过程中视图/尺寸/实例变更、超时及并发积累防护、纯色/空图/超限、4K/DPI与截图后缩小、原始异常消息清洗。成品集成还需独立正式/候选实际 WebContents 像素验收，不得用旧 headlessCapture 的临时挂接能力冒充新接口成功。
