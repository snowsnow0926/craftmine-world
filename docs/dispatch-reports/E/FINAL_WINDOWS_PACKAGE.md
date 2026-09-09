# 最终整合 Windows 构建报告

2026-09-09，E 为根 Agent G 执行冻结版打包。结论：**程序目录与 NSIS 构建成功，40 项包内离屏验收通过**；W5 的干净系统安装/升级/卸载仍未验收。

## 来源

根冻结提交 `0f6eaa87742b05a1b2d10c97e22b3dd3d7281fc3`。E 合并后实际打包提交为 `aaa5dc7da06a7f160537f720460056a94389cafd`，差异仅两份 E 报告：DELIVERY_E.json 和 MAINTENANCE_ADDENDUM.md。**产品源码完全相同**，没有打包临时 overlay。构建开始和结束均为同一干净提交。最终报告是打包之后的文档提交，不包含在此源码归档中。

工作树 `D:/Craftmine World-worktrees/parallel-e-20260909`，分支 `codex/parallel-e-20260909`。CARGO_TARGET_DIR 明确指向本工作树 vendor/pi-desktop/target，没有共享输出。Windows 10.0.19045 x64，Node v24.14.0、Cargo 1.96.1、Electron 43.4.0、electron-builder 26.15.3；依赖保持锁定。

## 可运行交付物

| 交付物 | 绝对路径 | 大小 / SHA256 |
| --- | --- | --- |
| 完整程序目录 | `D:/Craftmine World-worktrees/parallel-e-20260909/vendor/pi-desktop/apps/desktop/release/win-unpacked` | 825 文件，共 416871430 字节；每文件 SHA256 在 package-evidence.json |
| NSIS 安装包 | `D:/Craftmine World-worktrees/parallel-e-20260909/vendor/pi-desktop/apps/desktop/release/Craftmine-World-Setup-0.14.3.exe` | 154098909 字节；`b73c0b3feeb626698e337bc0d6eac03503b81bebf92814f1efecdaa0912f4624` |
| 对应源码归档 | `D:/Craftmine World-worktrees/parallel-e-20260909/desktop/build/CraftmineWorld-source.zip` | 38127257 字节；`8f2dc35576bca18c1e7ab1f812c3c155e972997d08fcad78304f90462ac9a155` |
| Rust 宿主 | 程序目录的 resources 下配套资源，来源 target/release/pi-desktop-host-core.exe | 9084416 字节；`18d7b0003f23673683030b6926f7d8181221eef1b0c43916458963e824f7527a` |
| 世界领域 Rust 服务 | 配套 craftmine-core.exe | 3118592 字节；`53b657cf91394386503f4862560257f11bdb5b45e7f4bb8b15cc4a6afe78a34c` |
| Agent bundle | 配套 sidecar.js | 5188027 字节；`4dfdb88758a51e227b38a63add79d7bf044aaad05f37d1bb576c8ffd2a81e3eb` |

程序目录须完整保留，不能只拷贝主 EXE。旧 source 2cf0f69 的 E 独立验证包已被此整合产物替代，不能混用旧 hash 或旧验收成绩。

**包内指南勘误：** 对应源码的 windows-USER_GUIDE.zh-CN.md 保留了原阶段一句“当前 E 独立验证包基于第 5 批，未包含其他并行组全部成果”。这句话不适用于本次产物；本包已经包含冻结的 A–G 整合产品代码。为保持 F 正在验收的同一程序包与哈希，此处和交付外层 README 明确更正，不修改包内内容或重打包。这也不表示所有 W 阶段门槛都已验收。

## 实际执行

在上述 E 工作树执行：

```powershell
$env:CARGO_TARGET_DIR='D:/Craftmine World-worktrees/parallel-e-20260909/vendor/pi-desktop/target'
powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File desktop/build-client.ps1 -Installer
```

exit 0，包含实际 Rust release 编译、完整桌面 JS 构建、Agent 打包、源码和许可材料归档、NSIS、包内逐文件与关键服务 hash 核对。没有为了构建修改冻结产品代码。编译中的上游分块体积/文档语法警告没有当作失败；electron-builder 的 signtool 日志也没有被当作已签名证据。

然后在本工作树设置 CRAFTMINE_PACKAGED_ROOT 为上述 win-unpacked、CRAFTMINE_TEST_APPLICATION=1，清除本进程的 live review/config 标记，执行 `node tests/desktop-native.mjs`：**exit 0、40/40 通过、mode=packaged**。独立档案位于 `test-results/desktop-native-Z1E0c4`。运行的是安装目录主 EXE 与实际 Rust/插件；模型回复来自本机固定夹具，不是真实联网模型。验证包含世界草稿与应用、PI 单次评审、异常持久化处理、写锁解除后退出保存、完整重启以及零真实输入/显示/焦点调用。F 已在包完成后第一时间收到同一稳定目录，另行执行真实模型包验收，其成绩由 F 报告。

证据目录 `docs/evidence/dispatch/E/final-package/`：integrated-package-build.log、integrated-native-packaged.log、native-report.json、build-manifest.json、package-evidence.json、signature-status.json。F 工作期间未重写这些程序产物。

## 身份、许可与未验收项

appId 为 world.craftmine.desktop，资料目录 CraftmineWorld，更新源为空；独立图标与安装器资源已包含。包内保留 PI-Desktop LGPL 文本、第三方/字体版权与许可清单、对应源码归档和构建/中文使用说明。没有改变项目许可证，也没有公开发布或推送。

通过 Windows Get-AuthenticodeSignature 实查，安装器和主程序均为 **NotSigned**。本次仅构建安装包，没有实际安装/覆盖升级/卸载用户程序，没有显示测试窗口、调用真实鼠标/键盘/Pointer Lock，未操作用户浏览器或个人 PI 档案。安装器构建生成自身卸载 stub 不等于进行用户安装。

尚未验证：无 Node/Rust/pnpm 的干净 Windows 首次运行、真实安装与覆盖升级/卸载、实际跨 Windows 用户凭据行为、可见原生窗口的最终合成。没有把程序包构建成功或离屏验收通过替代这些要求。E 本次打包与固定夹具不产生真实模型调用费用。
