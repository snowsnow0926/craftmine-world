# Agent E 完工报告

日期：2026-09-09。任务：W2–W5 派工 v1 / E_WINDOWS_DELIVERY.md。结论：**ready_for_integration**；本报告不宣称 W5 已验收。

## 用户能得到什么

Windows 凭据改用当前 Windows 用户的 DPAPI 系统保护，旧密钥先验证再迁移。安装包和程序目录有独立图标与应用身份。新增备份文件授权、恢复确认所需的可信接口、脱敏诊断和升级前保护脚本，并附中文使用说明。备份/诊断按钮和凭据状态 RPC 由 G 接入共享主入口；本组包基于第 5 批，不能当作最终集成产品。

## 完成情况

| 项目 | 结果与证据 |
| --- | --- |
| 凭据保护与旧格式迁移 | 10 个真实 Rust 测试通过，包括当前用户 DPAPI、失败保留原文件、损坏密文和缺失密钥。跨用户失败为注入模拟，未切换系统账号。 |
| 可信备份、诊断、升级保护 | 11 个测试通过；真实 Windows PowerShell 对合成档案完成快照/哈希验证、损坏拒绝、数据库占用拒绝。A 的领域调用使用契约夹具，最终事务由 G 验证。 |
| 产品身份与发行材料 | 独立 appId/目录/图标，禁用上游自动更新；源码、LGPL、依赖与字体许可随包；未改项目许可证。 |
| 文件夹与 NSIS 构建 | 成功，源码为 2cf0f69；822 文件、414897979 字节；安装包 152916650 字节。实查 Authenticode 为 NotSigned。 |
| 包装后的原生客户端 | 独立离屏档案、真实 Rust 服务和世界插件、合成模型响应、退出保存及重启检查全部通过，见 native-packaged-report.json。 |
| 干净 Windows、实体安装/覆盖升级/卸载 | **未验证**；没有安装到用户主机，也没有修改系统安全设置。 |

## 源码与交付

仓库基线 `dispatch/w2-w5-v1`：`2f71e128fd9ff9c49ee4e466138f4949b6bce862`。分支 `codex/parallel-e-20260909`，工作树 `D:/Craftmine World-worktrees/parallel-e-20260909`。

- `f2fc01c8d3db2bdca8137057f1fb56ca1125fac5`：DPAPI 密钥迁移和测试。
- `575b000f4d91ad5067c1eb41424068e71592d436`：备份/诊断/升级保护、独立资源、构建和材料。
- `2cf0f69cb88099ca7a4545fa9d2f668b62586e88`：准确报告导出失败和固定构建来源。
- `378e863ab96da5a74f3f7119f21c83936807531d`：快照字段改为 credentialStoreIncluded，并解释会话文本保留边界。此小改动没有重打包；最终 G 包必须从集成源码重建。

主要入口：host-core/src/secrets.rs、secrets_windows.rs、host-core/Cargo.toml；Electron 新增 craftmine-backup-service.ts / craftmine-diagnostics-service.ts；desktop/build-client.ps1、windows-package-tools.mjs、windows-upgrade-guard.ps1、windows-brand-assets.mjs；Windows 图标和 NSIS include、package.json；测试 tests/dispatch/e/windows-services.test.mjs。未修改共享入口/锁文件。secrets.status 为 integration.patch 交接，G 已确认接线。没有合并 master、推送、安装或清理分支。

## 实际验证和复现

命令均在本组隔离工作树；Cargo/pnpm 命令工作目录为其 vendor/pi-desktop。日志保存在 `docs/evidence/dispatch/E/`。

| 类型 | 完整命令 | 结果 / 证据 |
| --- | --- | --- |
| Rust | `cargo test --locked -p host-core secrets::` | 10/10，credential-tests.log；合成数据，自己的 target |
| 服务/PowerShell | `node --test tests/dispatch/e/windows-services.test.mjs` | 378e863 源码，11/11，1.99 秒，service-tests-final.log |
| TS | `pnpm --filter @pi/desktop exec tsc -p tsconfig.json --noEmit` | 通过，typecheck.log；完整打包再次编译 JS |
| 构建 | `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File desktop/build-client.ps1 -Installer` | 2cf0f69 干净源码，exit 0，package-build-final.log |
| 包内原生 | 设置 CRAFTMINE_PACKAGED_ROOT 为本组 win-unpacked、CRAFTMINE_TEST_APPLICATION=1，执行 `node tests/desktop-native.mjs` | 包为 2cf0f69，exit 0，native-packaged.log / native-packaged-report.json |
| 签名检查 | `Get-AuthenticodeSignature vendor/pi-desktop/apps/desktop/release/Craftmine-World-Setup-0.14.3.exe` | NotSigned |

首次服务测试出现 7 通过、2 失败：异步返回缺少 await 导致原生错误文本未被脱敏；Node 启动的 Windows PowerShell 未解析 Get-FileHash。分别修成等待受控异常、.NET SHA256，随后通过；再增加导出失败状态和诊断路径脱敏两项回归达到 11 项。早先 575b000 包已被 2cf0f69 包替代，不能混用来源。编译有上游大块资源和 E 尚未接线 status 的警告，无构建失败。

## 包与来源

- 程序：本工作树 `vendor/pi-desktop/apps/desktop/release/win-unpacked/`（完整目录）。
- 安装包：同目录上级 `Craftmine-World-Setup-0.14.3.exe`；SHA256 `6eef8af401ac85f614b6f3031e6935babf21490b539411f65dc25a25d1463652`。
- 对应源码：`desktop/build/CraftmineWorld-source.zip`；SHA256 `42cce204ad857ec2c305126bac9fd9a6dd3a6590e2037d132bcbdd380445dff9`。
- 全部文件哈希/大小、Rust/Agent/插件来源：package-evidence.json、build-manifest.json。Node v24.14.0、Cargo 1.96.1、Electron 43.4.0、Windows x64。

没有真实模型调用、调用费用或真实压缩成绩；原生测试使用本机合成供应商。没有读取用户个人档案/密钥、没有发送真实输入或请求 Pointer Lock；没有使用用户浏览器或显示/聚焦测试窗口。测试档案位于本工作树 test-results/desktop-native-h0ERv3，其他合成文件在 desktop/build/tests-e。

## 数据与故障边界

DPAPI 失败保留密钥原文件并返回 unavailable，不以新密钥覆盖已有密文。便携领域恢复仍由 A 的唯一 Rust 事务执行；主进程只管理选择授权、大小/路径/文件哈希、取消和回执。选择文件变化、过期或当前领域哈希变化必须拒绝。诊断采用字段白名单，绝不直接导出原始快照。离线升级副本保留 PI 会话文本，可能含用户自行粘贴的敏感内容，因此只用于本机恢复准备，不能作为可分享诊断。

## 尚未验收

G 需要接完 C/A/E 真实入口、测量入口和 secrets.status，重建最终集成包，再复验真实备份/恢复与任务生命周期。需要隔离 Windows VM/CI 才能验证无开发工具首装、覆盖升级、卸载和跨用户凭据行为；当前不得把这些标为通过。没有实体可见 UI 的人工验收，也没有宣称性能优化收益。对应接口、接线片段和机器清单见 INTERFACE_E.md / integration.patch / DELIVERY_E.json。禁止运行 tests/browser.mjs、tests/modules-browser.mjs。
