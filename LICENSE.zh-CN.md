# 许可证与使用说明

[English](LICENSING.md) · [AGPL 正文](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)

版权声明：Copyright (c) 2026 craftmine world / 最中幻想 contributors。

本页说明许可范围，方便中文读者使用；具体授权以英文适用范围、标准许可证正文及原文件声明为准。

本页链接以源码仓库为基准。成品包内可在 `resources/source/` 的源码归档中找到对应路径；抄录的第三方文本另位于 `resources/licenses/`。

## 项目代码怎么授权

项目自有源码和配套文档默认采用 **AGPL-3.0-only**，即 GNU Affero 通用公共许可证第 3 版，不包含自动选择未来版本的授权。范围包括 `app/`、`plugins/craftmine-world/` 的自有创作代码、项目工具、测试，以及原始 `world-workshop-3d/` 原型源码。完整正文在根目录 [LICENSE](LICENSE)。

项目所有者已于 2026-09-15 确认：上述自有代码和原始交接代码由本人创作，或具备修改及按既定 AGPL／MIT 方案开源发布的授权。本次确认针对代码，不代表已经核清所有 AI 模型输出、参考图片、商标和导入素材的权利。

更具体的已有许可优先保留；以下内容分别处理：

| 内容 | 许可 |
| --- | --- |
| 自有创作工作台、世界插件和开发工具 | 默认 AGPL-3.0-only。 |
| 明确列出的自有 Godot 导出运行时代码 | MIT，具体范围见下表。 |
| `vendor/pi-desktop/`，含当前 `craftmine-core` 和受上游许可覆盖的修改 | 保留已有 LGPL-3.0-or-later，不因本次新增根许可证撤销旧授权。 |
| Blender 及 `desktop/blender/bridge/driver.py` | 保留适用的 GPL-3.0-or-later 与第三方组件许可。 |
| Godot、MinGit、Electron、字体、Kenney 等第三方内容 | 保留各自许可证和版权声明。 |
| 图片、模型、音频、参考资料及用户导入内容 | 按素材本身的明确许可和来源处理；不能用代码许可证补齐未知权利。 |

## 哪些导出运行时代码采用 MIT

仅对项目拥有授权的原创代码和场景／资源定义，以下范围采用 [MIT](LICENSES/MIT.txt)：

| 路径 | 覆盖文件 |
| --- | --- |
| `desktop/godot/bases/`、`components/`、`shared/`、`probes/`、`sandbox/` | 递归目录中后缀为 `.gd`、`.tscn`、`.tres`、`.godot` 的文件。 |
| `desktop/godot/web/` | 仅 `bridge.js` 和 `shell.html`。 |

宿主端的 `runtime.mjs`、共享目录的 `.mjs` 创作逻辑、原生构建代理及编辑／检查服务不在这个 MIT 范围中。场景引用了一个模型，也不代表该模型随场景一起获得 MIT 授权。已有第三方或更具体的文件声明继续适用。

未来发行使用的 MIT 文本副本为 [CRAFTMINE-RUNTIME-MIT.txt](desktop/godot/licenses/CRAFTMINE-RUNTIME-MIT.txt)。用户原创或 AI 独立生成的代码须按实际来源处理，不自动被本工具统一授权。

## 能用它做商业游戏吗

可以使用社区版制作和销售作品。项目不会仅因你出售自己制作的游戏而额外收取工具授权费或游戏流水分成。

使用工具本身，不会让你的原创作品自动变成 AGPL 作品。MIT 运行时可以用于闭源作品，但要保留相应版权与许可声明。作品实际包含的上游代码、素材或其他受 AGPL／LGPL／GPL 覆盖的内容，仍需按对应许可和实际组合方式处理。

AGPL 允许商业使用。分发受覆盖的软件，或让用户通过网络与修改版交互时，可能触发其对应源码提供义务；企业身份和收入本身不是额外付费条件。具体条件见 [AGPL 第 13 条及完整正文](https://www.gnu.org/licenses/agpl-3.0.html#section13)。

## 商业授权与贡献

需要对符合条件的自有创作代码取得另一种集成或分发权利时，可通过 [项目仓库](https://github.com/snowsnow0926/craftmine-world) 联系维护者洽谈。商业授权须另行书面约定，不覆盖第三方权利，也不是目录中商业合同草稿的自动生效。

贡献时请说明外部来源并保留许可证。新的原创贡献适用目标文件的许可，另有书面约定除外；提交代码不等于转让版权、签署尚未生效的 CLA，或授予没有约定的商业再授权权利。

## 现有版本和资料

此前已经合法授予的许可继续有效。已经封存的 preview.27 ZIP 不会被本次文档修改覆盖或冒充新包，具体版本以包内源码提交与声明为准。

旧许可清单是 2026-09-09／10 的审计快照。本次明确适用的自有代码许可，以 [LICENSING.md](LICENSING.md) 和 [本次实施记录](docs/LICENSE_APPLICATION_2026-09-15.md) 为准；第三方和素材仍未核对的项目继续保留，不批量标记为已完成。
