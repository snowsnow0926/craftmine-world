# AL0 开源参考真实评估（N）

评估日期：2026-09-10。方法：`git clone --depth 1` 到会话 scratch，读真实源码与
许可文件，未安装依赖、未运行 Godot/Electron/PHP/MySQL，未把上游宣传当成本项目实测。
**未验证项单列在第 5 节。**

## 1. Global Asset Manager（计划中的首选代码研究候选）

| 项 | 值 |
| --- | --- |
| URL | https://github.com/sn1ks0h/Global-Asset-Manager |
| commit | `08e784c0c794dec9e541a41e1ee6a106cc6e62da`（2026-03-30，`main`，浅克隆） |
| 许可 | `LICENSE` 首行 `MIT License`，`Copyright (c) 2026 sn1ks0h`；无 SPDX 行；README 无附加声明 |
| 形态 | Godot 4.6 编辑器插件（`addons/global_asset_manager/plugin.cfg`，version 2.0.1），`config/features=PackedStringArray("4.6","Forward Plus")` |
| 规模 | GDScript 4 文件 1667 行：`asset_manager.gd` 1324、`settings_manager.gd` 200、`preview_controller.gd` 116、`plugin.gd` 27；无测试、无 CI（`.github` 仅 `FUNDING.yml`） |
| 依赖 | 无依赖清单、无 vendored 第三方；只用 Godot 内建 `GLTFDocument/FBXDocument/Image/AudioStreamWAV/OggVorbis/MP3/DirAccess/EditorInterface` |

真实实现要点（含限制）：

- 扫描是**同步递归、主线程执行**：`asset_manager.gd:207 scan_directory` → `:1077 _recursive_scan`，
  全文件无 `Thread`/`WorkerThreadPool`。README 的“异步后台加载、编辑器不卡顿”只对应网格填充
  （`:1050` 每 200 项 `await get_tree().process_frame`），不对应扫描。
- 格式判定只看**扩展名 + 用户启用列表**：`:405 _determine_asset_type`，常量
  `["glb","gltf","fbx"]`、`["png","jpg","jpeg","webp"]`、`["ogg","mp3","wav"]`；不读文件头。
  被禁用格式在扫描期即被丢弃，重新启用必须重扫。`AssetType.SHADER` 分支是死代码。
- 检索用 Godot 内建：引号包裹走 `findn`（大小写不敏感子串），否则
  `is_subsequence_ofn`（字符子序列）；只匹配文件名（`:986-1000`），每次输入遍历整个
  资产字典，无倒排索引，显示每页 100 项。
- 缩略图是**内存字典缓存、无上限、不落盘**（`:44`、`:546-579`），坏文件保持占位图且无日志。

复用判断：许可允许复用，但它是 GDScript 编辑器插件，**不能直接移入 Rust/Node**；
可借鉴的具体点是“扫描→分类→标签→预览队列”的交互拆分和 `process_frame` 让出主线程的做法；
本项目的流式导入、内容寻址、限额与失败状态需自行实现（已按此实现）。

## 2. Allusion

| 项 | 值 |
| --- | --- |
| URL | https://github.com/allusion-app/Allusion |
| commit | `631cfb5fb9c3bb62677e5fd37be28dbfaf4b8e2f`（2023-05-30，`master`） |
| 许可 | `LICENSE` 为 GPL-3.0；**`package.json` 写 `"license": "ISC"`，元数据冲突需记录** |
| 形态 | TypeScript/Electron 图片参考库，与本项目 Node 侧同栈 |
| 复用判断 | **GPL-3.0 代码不得移入本项目**；只可独立重写并借鉴目录监听、标签组织与图片浏览交互 |

## 3. Godot 官方 Asset Library

| 项 | 值 |
| --- | --- |
| URL | https://github.com/godotengine/godot-asset-library |
| commit | `11b303dad6a5b3a4347df2633a03d4338c4db063`（2026-06-26，`master`） |
| 许可 | `LICENSE.txt` 首行 `The MIT License (MIT)` |
| 形态 | PHP/MySQL 服务端 + 前端，README 声明维护模式 |
| 复用判断 | 许可允许，但本地库场景几乎无可直接复用代码；其 REST/分类/提交接口只作为 AL6/AL7 的接口参考，不作为首发本地库依赖 |

## 4. 与现有来源清单的关系

`docs/dispatch-reports/godot-parallel/H/SPEC_H_ASSET_MANIFEST.md`（109 行）已定义
`craftmine.base-assets/1`：每个随包/导出文件必须有 `origin/author/version/license/
redistribution/distribution/bytes/sha256`，`distribution` 取值 `app-bundle`/`user-export`/
`development-only`，失败码含 `ASSET_EXPORT_DENIED`、`ASSET_LICENSE_UNKNOWN` 等。
N 的素材库记录的是**库内资源版本**的来源与许可状态；对外发行判定仍由 H/K 的清单与
预检负责，两者互相引用而不是互相替代。

## 5. 未验证项（不得当作已通过）

- 三个仓库都未在各自真实运行时执行（无 Godot 编辑器、无 Electron 构建、无 PHP/MySQL）。
- 上游 README 的性能宣传（GAM 大目录扫描、Allusion 缩略图吞吐、GAL 检索响应）**均未实测**。
- 均为 `--depth 1` 浅克隆：历史、标签、分支列表未获取，commit 日期取单条提交的 `%cI`。
- Allusion 的 ExifTool 与 wasm crate 许可、GAL 的 vendored Bootstrap/jQuery 许可未逐条核对。
- 未评估把 GDScript 逻辑重写为 Rust 的工作量与风险，只给出可借鉴点。
