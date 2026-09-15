# 许可证正式适用与双语 README 更新

## 授权依据

项目于 2026-09-09 确认分层方案：自有创作核心 AGPL-3.0-only，可另行商业授权；自有导出运行时 MIT；上游保留已有许可。

2026-09-15，用户要求补齐许可证文件和中英文 README，并在本次对话明确确认：除 PI Desktop、Godot、Blender、Kenney 等已注明的第三方内容外，项目自有代码及原始 `world-workshop-3d` 代码由本人创作，或具备修改、按既定 AGPL／MIT 方案开源发布的授权。

本次据此落实社区许可。它不等于对每个第三方依赖、生成模型、参考图片、商标或贡献者商业再授权权利完成独立核查。

## 生效范围

| 范围 | 本次结果 |
| --- | --- |
| 自有创作代码、配套文档、工具、测试、原始 Web 原型 | 默认 AGPL-3.0-only，根 LICENSE 为未修改的官方全文。 |
| 自有 Godot 导出运行时 | MIT；仅 LICENSING.md 精确列出的路径和文件类型。 |
| `vendor/pi-desktop/`，含当前继承 LGPL 的 `craftmine-core` | 保留已有 LGPL-3.0-or-later，不覆盖旧授权。 |
| Blender Python 适配器 | 保留 GPL-3.0-or-later SPDX 声明。 |
| 已有 MIT 组件及第三方内容 | 保留原许可证、版权、来源与适用范围。 |
| 模型、图片、字体、音乐、用户导入及参考资料 | 不套用代码默认许可；继续按各自记录处理。 |
| 商业合同及 CLA 草稿 | 不自动生效，不杜撰授权主体、费用或已签署的贡献者同意。 |

完整范围见 [LICENSING.md](../LICENSING.md)，中文说明见 [LICENSE.zh-CN.md](../LICENSE.zh-CN.md)。旧方案中“尚未正式适用”对本次明确范围的结论由本记录取代；第三方和素材核查仍按实际证据保留。

## 文件与分发

- 根 LICENSE 提供 AGPL-3.0 官方全文，LICENSES 提供 MIT、LGPL/GPL 全文和来源。
- THIRD_PARTY_NOTICES.md 提供上游、字体、依赖、模型和分发入口。
- 未来客户端与独立 Windows 游戏导出携带适用的许可和运行时范围说明；通用 MIT 文本不能替代原模型或引擎声明。
- 原 preview.27 源码提交仍为 `5073803f`，封存 ZIP 未修改、未冒充重新打包。本次许可及未来打包规则不改写历史成品。

## 项目介绍与文档整理

双语 README 使用“可能是一种全新的游戏方式”“开放世界，能有我开放吗？”和“言出法随”的表达，描述从空白世界出发、通过文字或语音一边创造一边游玩。功能表区分当前 3D 实测、已有 2D 底座和后续社区／多人方向，不承诺任意请求瞬时成功。

当前交付入口更新为 preview.27。原 README 的 Web Alpha 内容保存在 `docs/legacy/WEB_RUNNER_ALPHA_0_8.zh-CN.md`，旧 preview.24 交付页也作为历史资料保留。README 不把 GitHub 源码 ZIP 当作应用下载，不把本机路径当作公共下载地址。

## 核对方式

GNU 全文按原始 SHA-256 核对；MIT 运行时副本与项目 MIT 正文逐字节一致。文档核对相对链接和中英文功能、版本、许可范围的一致性。打包和导出规则采用针对性纯逻辑测试，不启动图形窗口、不调用模型、不重新制作已封存 Demo。

官方资料：[AGPL](https://www.gnu.org/licenses/agpl-3.0.html)、[LGPL](https://www.gnu.org/licenses/lgpl-3.0.html)、[Godot](https://godotengine.org/license/)、[Blender](https://www.blender.org/about/license/)。
