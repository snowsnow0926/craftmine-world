# CN6：包内原生验收启动边界

日期：2026-09-11。本记录只说明测试入口与独立审查；新成品尚未在此子任务中生成或运行。

## 审查与修正

CN2 的 `creation-place-native.mjs` 原有包内分支确实启动包内 `Craftmine World.exe`，参数为空、工作目录为包目录；它读取包内 ASAR，核心二进制路径也指向随包资源。该方向正确。

本次补齐四处可验证缺口：在启动前审核 ASAR 中实际的 headless preload 是否包含 Pointer Lock 防护；记录整个成品目录逐文件字节数与 SHA-256，而不只记录 main；在创建世界和修改内容之前检查真实窗口不可见、不可聚焦、离屏且无违规；异常强杀后的退出等待改为有界。强杀仍记为失败，不冒充正常关闭。

公共启动帮助文件 `tests/helpers/creation-native-launch.mjs` 被新无模型造物故事和既有 `creation-native-session.mjs` 复用。包内模式拒绝缺失的 EXE、ASAR、core、host、Godot、broker 或插件资源，拒绝符号链接/目录联接，不回退到源码中的二进制。测试档案独立创建，保留 `CRAFTMINE_EDIT_ACCEPTANCE` 或模型测试显式授权开关；清除继承的桌面/引擎覆写，包内运行不传入源码应用目录。

每次启动前及正常关闭后重新核对目录身份。报告保存 package.json 版本、实际 EXE/参数/工作目录、ASAR 内 main/preload 哈希、包内文件清单和整体清单哈希。重开中若包发生改变，测试明确失败。

## 使用

在本批集成源码目录执行：

```powershell
node tests/creation-place-native.mjs --packaged-root 'D:/Craftmine-World-preview.11/win-unpacked'
```

也支持明确设置 `CRAFTMINE_PACKAGED_ROOT`；与命令行路径冲突时拒绝。省略两者保留开发构建模式，报告中的 `packaged` 为 null，不得将其称为成品包验收。模型恢复帮助函数支持相同参数，但不会因此自动开启模型测试或获得新的模型预算。

## 已执行验证与边界

`node --test tests/creation-packaged-launch.test.mjs`：5/5。使用临时合成 ASAR 和假二进制，验证路径解析、无源码启动参数、继承变量清理、包内身份、缺失 preload 防护拒绝、缺失核心不回退、资源变化拒绝和目录联接拒绝；这些假文件从未执行。相关测试入口语法检查通过。

没有启动旧的 preview.10、用户安装或前台程序。真正的 preview.11 EXE、ASAR、核心、引擎及保存重开验证须在总控生成成品后执行，届时以实际原生故事报告为依据。本记录不声称安装/升级/卸载、真实鼠标键盘或麦克风验收通过。

## 开发构建启动修正

随后由集成 agent 实跑发现，当前 Electron 包在缺少 `path.txt` 时，`require('electron')` 会尝试执行安装器。公共帮助文件已改成只解析 `electron/package.json` 的路径，读取现成 `path.txt` 并核对对应二进制；不存在即报 `ELECTRON_BINARY_NOT_INSTALLED`。显式二进制路径也必须绝对且已存在，不再通过 require 触发下载。新增合成安装目录边界检查后，包内/开发启动约束测试为 6/6；此补验未执行安装器或 Electron。
