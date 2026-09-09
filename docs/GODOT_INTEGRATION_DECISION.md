# Godot 接入选型记录

日期：2026 年 9 月 9 日。对应 [开发计划](GODOT_MULTIBASE_DEVELOPMENT_PLAN.md) 的 GD0/GD1；当前是有实际证据的候选方案，GD0 尚未全部完成。

## 当前选择

继续采用固定 Godot 4.7.2 stable、Windows x64、GDScript 和 Compatibility 渲染器。中央呈现的当前候选为 **多线程 Web 导出 + 独立游戏来源 + 有界消息接口**。工程导入与构建仍需单独的操作系统隔离。项目的 PI/Rust 工程工具、原生 Electron 接线和发行打包尚未完成，不能把这次固定工程验证当作产品已经内置引擎。

| 路线 | 已观察结果 | 结论 |
| --- | --- | --- |
| 原生 Godot 无窗口运行 | 3D/2D 实际物理与完整进程重启保存，13 项通过 | 用于工程逻辑检查；没有验证中央原生窗口嵌入 |
| 单线程 Web | 同一批场景可渲染、交互及保存，但每次退出出现 WorkerThreadPool Group 未释放错误 | 当前固定版本不选作默认；失败原样保留 |
| 多线程 Web | 实际桌面 React 布局内 33 项通过，含全部退出日志及合成画面检查 | 选为继续接线的候选；需要明确的跨源隔离配置 |
| 原生嵌入 / LibGodot | 本轮没有完成实际中央呈现 | 保留比较项，不用独立可见窗口代替嵌入验收 |

单线程错误与固定版本任务池实现中无线程分支跳过任务组完成回收的代码相符，这是基于源码与运行日志的推断，尚未完成最小上游复现。没有屏蔽该错误或修改引擎二进制。多线程使用同一官方归档内另一个已核对哈希的模板，通过相同场景验收。[固定版本任务池源码](https://github.com/godotengine/godot/blob/4.7.2-stable/core/object/worker_thread_pool.cpp#L668)

## 呈现与通信边界

宿主页和游戏页均配置 COOP `same-origin` 与 COEP `require-corp`，游戏响应明确允许跨来源资源嵌入；iframe 保留 `allow-scripts allow-same-origin` 沙箱并声明 `cross-origin-isolated`。游戏与宿主来源必须不同，不授予桌面原生桥。CSP 限制连接到自身来源，允许 WebAssembly、同来源 Worker、需要的内嵌字体与临时图像；不以关闭浏览器安全机制解决载入问题。[Godot Web 要求](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html)、[COEP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)

当前端口接口只承载已建立会话的请求与结果；固定的 worldId、buildId、session 约束每个句柄。请求与响应限制为 65,536 个字符串码元，最多 16 项并发，启动及请求都有截止时间；诊断保留最近 32 项。循环对象、BigInt、过大数据、过期身份、超时与销毁均有 MessageChannel 回归。它不提供主机命令、文件读写、发布或批准能力。

`worldId` 进入 Godot 存档目录，存档同时包含格式和世界身份。恢复先检查全部字段类型、有限值和范围，再修改状态。退出先停止接受新操作，等待已接受的变更/保存完成，再请求引擎退出。真实验收包含并发购买、保存、退出，及随后重启恢复。

FileAccess 写入成功与浏览器持久化完成是两个时点。当前证据通过优雅退出后关闭整个独立浏览器进程，再用同一测试配置和来源重启，证明这个路径的实际恢复；它没有证明强制崩溃、磁盘满、配额耗尽或 IndexedDB 不可用时的恢复。GD2 需将版本、工程与玩家进度接入主机管理的事务，不能只依赖浏览器缓存。[Godot Web 持久化说明](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html)

同源的两个可信实例用于检查世界编号的存储分区；恶意工程仍可能读取同源数据，因此产品还需要稳定的逐世界来源/存储分区。测试服务器的临时端口不能直接成为产品存档身份。来自游戏的状态与能力声明是待校验数据，不能替代主机授权、构建清单核对或真实结果验收。

## 证据与适用范围

- [Web 33 项](evidence/godot-cycle-02/web-preview.json)：真实 Godot WASM、真实场景和物理、真实桌面 React 组件；会话与 WebContentsView 传输为夹具。
- [原生逻辑 13 项](evidence/godot-cycle-02/native-headless.json)：固定作者场景、真正的无窗口 Godot 进程、重启保存。
- [通信 21 项](evidence/godot-cycle-02/transport.log)：Node 的实际 MessageChannel 与 port transfer，帧对象为最小夹具。
- [实际中央画面](evidence/godot-cycle-02/desktop-godot.png)、[俯视场景](evidence/godot-cycle-02/desktop-top-down.png)、[游玩展开](evidence/godot-cycle-02/first-person-expanded.png)。返回创作同时等待 DOM 边界与实际游戏视口更新，额外在导航空白区采样合成像素。
- [失败记录](evidence/godot-cycle-02/failures/README.md) 与 [哈希清单](evidence/godot-cycle-02/manifest.json)。曾经逻辑通过但截图不正确的中间报告不作为最终画面证据。

实际模型调用为 **0**。固定作者样本验证准星、挂点、装备、伤害与重建能力，不能替代 GD3 的真实模型开发。当前俯视场景只有物理与商店探针，不是 GD4 的完整小镇底座。没有运行历史鼠标键盘测试、请求 Pointer Lock、抢占窗口焦点或替换用户正在使用的客户端。

## 当前测量

最终记录使用独立 headless Chromium 和 SwiftShader；系统文件缓存已经热身，浏览器第一次启动使用新测试配置。以下都是当前开发机的小样本，不能作为硬件 GPU、干净首装或最终生成速度保证。

| 项目 | 观察值 |
| --- | --- |
| 官方 Windows 编辑器压缩包 | 86,013,866 字节 |
| 主引擎可执行文件 | 180,858,888 字节 |
| 官方全平台导出模板归档 | 1,281,349,702 字节，只用于准备缓存 |
| 选中的多线程 Web release 模板 | 10,290,815 字节 |
| 3D / 俯视导出目录文件，含许可声明、不含生成的 build.json | 39,300,938 / 39,298,721 字节 |
| 最终验证 7 次 Web 载入 | 277–710 毫秒；其中首次为 710 毫秒 |
| 导入与导出 | 每次约 2 秒，逐次原始值保留在报告 |

工程目前重复带有同版本 Web 引擎文件；后续可在主机验证后按内容哈希共享引擎资产，同时保持世界状态隔离。最终包体增量、内存峰值、原生嵌入对照、冷启动和正式性能门槛仍需测量并在发行验收前固定。

## 操作系统隔离：未通过

已实现并离线编译 [独立 Rust AppContainer 原型](../desktop/godot/sandbox/README.md)。它创建任务专属 profile/SID，只给当轮新目录授予必要权限；设置无网络能力、创建时 Job、子进程限制、内存和等待上限。没有改变已有工作区/默认桌面的 ACL。

两次运行确认子进程 token 为 AppContainer，但在 main 前以 `0xC0000142` 退出；拆分纯子进程二进制后结果相同，原因尚未定位。两次临时 profile 均已清理。文件、网络、子进程拒绝断言尚未执行，Godot 也按失败门槛没有启动。[实际结果](../desktop/godot/sandbox/evidence/results.json)

因此，普通 probe runner 的目录与环境隔离不能承担任意生成工程。下一步独立定位受限进程初始化，再验证只读引擎/模板、可写任务目录、合成越界读写、实际网络与子进程阻断、取消/超时，以及 `@tool`、导入插件和导出插件。正向控制与失败类别也须核对，不能把任意 I/O 错误都当作隔离成功。LPAC 与交互桌面隔离仍是独立待验收项。[AppContainer 实现](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)、[进程属性](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)

## 后续接线顺序

1. 完成受限进程初始化与隔离验收，同时定义主机工程、构建和进度的数据模型。
2. 用受管理作业连接 PI/Rust 的创建、文件修改、导入、构建、检查、预览、应用、回滚；稳定逐世界来源与构建身份。
3. 在原生 Electron 中复验中央 Godot 呈现、完整客户端重启、取消/失败与旧世界共存。
4. 开始 GD3 的真实模型准星/持枪/装备需求；随后推进俯视、横版、玩法分支、作品复用与高阶能力。GD1 未完成的世界导航与辅助入口仍保留在原计划中。

Godot 及第三方声明已经随固定 Web 导出复制。发行阶段还需单独完成原有 PI LGPL、素材来源、独立作品导出与 Windows 安装升级验收；本轮没有生成或发布新的发行包。


## 第 3 轮补充：源码接线与实际隔离结果

Rust 已增加绑定世界的 Godot 工程文件集、不可变清单版本、分页源码读取和原子补丁；PI 插件新增四个源码工具。工程保存在现有领域数据库和按哈希索引的独立源码文件中，不把源码塞进旧世界的 2 MB JSON。旧世界的正式内容、候选和玩家进度继续由原事务管理；当前 Godot 工程状态明确为 source-only、未验证、未应用。

同一份新 Rust 二进制通过 69 项回归（其中 12 项 Godot 源码测试），Windows junction 验收因夹具创建失败明确未验收。六组实际插件源码/Rust 进程联测通过，包括切换界面世界后保持原绑定、Unicode 分页、历史版本、幂等、冲突和完整进程重启后的显式恢复。模型上下文同步说明：旧 verification_submit 不会构建 Godot。详情见[本轮记录](GODOT_DEVELOPMENT_LOG.md)和[证据](evidence/godot-cycle-03/validation.json)。本轮产品模型调用为 0。

隔离探针已能在标准用户下打开不可见的会话窗口站并创建任务私有桌面；不修改原窗口站或默认桌面的 ACL。工作目录只读确认 Medium 完整性，实际 AppContainer 子进程仍在 main 前以 0xC0000142 退出。对新子进程记录的有界加载事件只看到映像、ntdll、kernel32、KernelBase 和退出，不能将最后一个 DLL 等同于故障来源。全部临时 profile 已删除。代码中的文件/网络/子进程/UI 拒绝断言尚未执行，Godot 导入/导出仍不可开放给任意模型工程。

目录必须降低到 Low 的早期推断已更正：微软明确允许获得 package SID 授权的 AppContainer 访问 Medium 或更低完整性的资源；仍须通过真实写入正例和拒绝反例确认。[Microsoft AppContainer 说明](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)

后续先厘清当前启动环境和 0xC0000142 的实际来源，或验证适用普通账户的另一个执行方案；再连接工程构建作业、原生 Electron Web 世界视图、主机进度事务和真实模型创作。源码备份、二进制素材、累计历史空间配额/清理、掉电一致性仍需实现或验收。多底座交付与 GD3–GD8 不因源码接口通过而完成。
