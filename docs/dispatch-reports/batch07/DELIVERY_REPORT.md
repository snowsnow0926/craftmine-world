# 第 7 批 Windows 交付与诊断报告

最终结果：本轮 Windows 程序目录、NSIS 安装包和对应源码归档已构建完成；同一程序包的 40 项隔离离屏验收全部通过。干净系统安装/升级/卸载仍未验证。

## 已完成

- 真正接到桌面生命周期的采样适配器：启动到首次页面加载、可见文档动画回调间隔、Agent turn 和单次模型作业耗时。适配器不保存提示词、模型输出或会话标识；缺少样本时不提供 0 毫秒占位。主入口已在冻结源码中接入真实加载、Agent 事件、结束和单次模型调用生命周期。
- 诊断包读取包内固定构建清单，输出源码提交、源码包 hash 和清单 hash；没有数据时保持空缺，不伪造整个安装包 hash。
- 独立 headless 性能基准、Windows 能力只读检查、隔离托管 CI 安装/升级/卸载脚本。CI 脚本在本机执行 `-Execute` 会在任何文件操作之前拒绝。本轮没有执行任何安装或修改系统。
- 玩家可配置累计 token 预算：新任务默认无限累计；旧任务可以由玩家明确调整。保留真实和未知用量、原预算归属、压缩次数和请求计数。配置回执持久化，模型无配置入口。升级数据库和恢复旧备份保留旧限额；备份 schema 3 含配置审计并兼容 1/2。

## 实际验证

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| 诊断、备份服务测试 | 16/16 通过 | 含启动、隐藏样本、失败/中断、来源分类、秘密排除 |
| 增补的本机安装执行拒绝与上述采样测试 | 6/6 通过 | 本机拒绝在安装器解析及文件操作之前发生 |
| 私有 host deadline 回归 | 3/3 通过 | 首次调限、丢响应重试、已有用量无新计时、字段防伪 |
| Rust core 数据库回归 | 49/49 通过 | 新增累计预算、中断恢复、数据库迁移、备份兼容等 7 项 |
| Desktop TypeScript | 通过 | 适配器本体与当前基线；最终入口由主任务整合验证 |
| 独立 headless 基准 | 已测量，3 类负载 | 结果见下；不等于 Windows 客户端性能验收 |
| 当前系统能力和签名检查 | 已只读完成 | 无可用本机签名证书，用户明确无隔离机器 |
| 清洁 Windows 安装/升级/卸载 | 未执行 | 无独立 Windows/VM；仅提供未来隔离入口 |
| 本轮目录包与 NSIS | 构建及逐文件核对通过 | 精确冻结提交 5ac3f1a，825 文件 |
| 本轮包内离屏验收 | 40/40 通过 | 固定模型服务；外部测试解析适配后重跑同一包 |
| 新测试解析拒绝对照 | 2/2 通过 | 拒绝垃圾尾、伪结果、重复 facts 和替换来源 |

性能测量于 2026-09-09 08:13 UTC 完成，Windows 10.0.19045 x64、i7-14700KF、约 32 GiB RAM、RTX 4070 SUPER、Chrome 147，视口 1200×800。每类先预热 1 秒，再采 3 个窗口，共 360 个动画回调间隔，每窗约 840 毫秒。

| 负载 | 对象/几何数 | 加载 | 间隔 p95 | JS 堆 |
| --- | --- | --- | --- | --- |
| 空世界 | 0/0 | 203.3 ms | 7.0 ms | 13.4 MB |
| 花草 | 48/264 | 166.2 ms | 7.0 ms | 29.7 MB |
| 树林 | 128/384 | 212.2 ms | 7.0 ms | 59.9 MB |

预先定义的本机参考值为加载 ≤10 秒、间隔 p95 ≤50 毫秒、至少 90 个样本，各负载均满足。整次进程约 12.2 秒。该结果是开发机 headless 动画调度间隔，不是 GPU 绘制时间、真实输入延迟、可见 Electron 合成耗时或最低配置承诺。JS 堆也不是整个浏览器内存。没有据此宣称性能优化收益。

测量发生在遥测文件尚未提交时，原始报告的 `sourceCommit` 为当时 HEAD `a4944be`，并额外记录实际三个运行文件的 SHA256；这不是声称该提交已含新遥测代码。后续基准脚本增加 `sourceDirty`，并分开基准耗时与进程耗时。

## 交付与剩余验证

开发提交：`ed32592`（遥测与隔离入口）、`9871d1c`（预算配置及备份 schema 3）、`9f1b4d4`（首次请求 deadline 与私有路由）。另含 `5e640f9`（原预算回执查询及备份账本校验）。最终产品与本报告后的测试修复来源详见下节。

当前没有 Windows Sandbox 可执行文件或相应 VM 服务，也没有可用的本机代码签名证书/配置。该检查不声称硬件无法虚拟化，也不代替外部签名服务检查。没有下载 VM、变更系统功能、创建测试用户、安装证书、操作真实鼠标键盘或启动显示测试窗口。

隔离入口：`desktop/ci/windows-isolated-validation.ps1` 默认 dry-run；未来需明确提供包路径/hash，并在临时 GitHub-hosted Windows runner 上显式 Execute。脚本检查静默安装、升级快照、数据库忙时升级拒绝、卸载后保留合成数据。托管 runner 自带开发工具，也不能直接记为清洁 Windows 验收。

保留当前独立工作树与分支，交由主任务整合；未推送、未执行主分支合并或清理。


## 最终包来源与文件

根任务交付冻结时的整合证据为 Rust 57/57、Node 整合 30/30、runtime 330/330、基础领域 276/276 和完整 build:js 通过；这些是 G 的整合结果，非 E 重复执行。

产品冻结、构建时 Git HEAD 和包内 manifest 均为同一提交：`5ac3f1a960c7bfb3224674f05a5607f97277e7eb`。构建前后工作树干净，没有 overlay 或产品改动。包含本批所有 G/C/A/E 整合代码，尤其真实 error/aborted 后原预算归属恢复、原回执查询、请求缓存前缀、原生验收辅助代码。

目录：`D:/Craftmine World-worktrees/batch07-delivery-20260909/vendor/pi-desktop/apps/desktop/release/win-unpacked`。这是可运行的完整程序目录；保留全部相邻文件，不能只复制主 EXE。825 个文件，共 **418062454 字节**，每文件 SHA256 在 `final-package/package-evidence.json`。

| 文件 | 字节数 | SHA256 |
| --- | --- | --- |
| NSIS：release/Craftmine-World-Setup-0.14.3.exe | 155076619 | a7e194e79b1f798fac018ebdef511b15151a0cf8626e4ef0745347890872a3a5 |
| 源码：desktop/build/CraftmineWorld-source.zip | 39149380 | 019c758d450a425dd381cc3023f92b734945a0fd130337a822382325f6a8584a |
| Rust PI 宿主 | 9084416 | e043d6cae190410005e04e6748af4877e63295ae1c990c2695b0cb9d97ce638e |
| Rust 世界服务 | 3203072 | 105100e695080c0a9f4b0282fa9d955eb8087a9ff31034cfa7ba1de84ed4f60c |
| Agent sidecar.js | 5190147 | a60faf40a495775c0d2e8e26fffc42b8fddbe71078574e26ab17895dce6c84c1 |

上表 NSIS 位于目录包的上一级；源码归档绝对路径为 `D:/Craftmine World-worktrees/batch07-delivery-20260909/desktop/build/CraftmineWorld-source.zip`，相同 ZIP 也嵌入包内 `resources/source`。manifest SHA256 为 `85b560c260a2d2793bc3aad46ff79bab03c7ed211106b84e84f108bfb0f74d60`。

实际构建命令：

```powershell
$env:CARGO_TARGET_DIR='D:/Craftmine World-worktrees/batch07-delivery-20260909/desktop/build/cargo-budget'
powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File desktop/build-client.ps1 -Installer
```

命令 exit 0，执行 Rust release、桌面 build:js、Agent bundle、源码/许可清单、目录包和 NSIS 生成与核对。依赖和版本保持锁定；Node v24.14.0、Cargo 1.96.1、Electron 43.4.0、electron-builder 26.15.3。`-Installer` 仅生成安装器，未执行安装。构建日志中的 signtool 步骤不表示已经签名。

## 同包验收与首次失败

第一次固定服务验收通过 6 项启动和隔离检查，随后旧测试服务对整条用户内容直接 JSON.parse。新缓存设计把命名 host snapshot 数据附在末端，因此测试服务返回 400。首次报告及日志完整保留在 `final-package/native-first-failure.*`，没有记成通过。

只修外部测试解析：严格要求首个冻结 review JSON 和唯一末尾 `Craftmine host snapshot (craftmine.request/2)` 数据块，核对固定请求来源和快照结构；拒绝额外垃圾、伪评审结果、重复快照、替换请求及非法 generation。原 40 项断言和评审接受规则全部保留。

该测试修复提交为 `cab0da5b499f36911c2ba3bca30f0f2993c41148`，晚于产品冻结；它不在包内产品源码 ZIP 中。复验所用差异另交付 `final-package/post-freeze-fixture.patch`，SHA256 `900a3ec1a2465b0e5c3e98811f7bf980df6da7cb423f99d82a2368390988f292`。没有重打包或修改任何已交付产品文件。

随后以 `CRAFTMINE_PACKAGED_ROOT` 指向上述目录、`CRAFTMINE_TEST_APPLICATION=1` 执行 `node tests/desktop-native.mjs`，exit 0，**40/40、mode=packaged**。独立档案 `test-results/desktop-native-cdIwox`。包含真实 Rust/插件启动、React/preload、草稿检查与应用、原生单次模型服务路径、持久化失败、写锁解除后保存退出、完整重启和零输入/焦点/显示审计。固定回复来自本机夹具，不是联网真实模型。复验后逐文件核对仍得到相同目录字节数、源码和安装器 hash。

根任务与 A 已收到该冻结目录并另行运行同包真实场景；那些结果由其报告负责，本报告不把固定服务结果代替真实模型验收。

## 许可、签名与具体边界

包内 PI-Desktop LGPL-3.0-or-later 许可证与固定源码 LICENSE 的 SHA256 一致：`e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118`。保留 UPSTREAM、版权说明、对应源码 ZIP、构建说明、中文指南、字体许可证和 Babel 许可。796 项 npm 包记录版本及声明许可证，复制实际存在的 LICENSE/NOTICE/COPYING；清单不捏造缺失的许可证文件。中文指南与冻结源码字节一致，包含本轮预算说明。

独立产品身份为 `world.craftmine.desktop`，资料目录 `CraftmineWorld`，更新源为空。Windows 实查安装器和主 EXE 均为 **NotSigned**，见 `final-package/signature-status.json`。

本轮没有干净 Windows/VM，因此未验证实际首次安装、覆盖升级、卸载、跨 Windows 用户凭据行为和可见原生窗口最终合成。未改系统安全/虚拟化设置，未创建用户或证书，未下载 VM，未触发个人程序安装卸载，未操作真实鼠标键盘或用户浏览器。离屏验收、遥测和本机基准均不替代这些仍缺的验收。
