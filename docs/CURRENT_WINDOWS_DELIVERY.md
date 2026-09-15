# 当前 Windows Demo 交付

**0.14.4-preview.27 · Windows x64 · 免安装 ZIP**

英文与中文项目介绍见 [README](../README.md) / [README.zh-CN](../README.zh-CN.md)。本页列出已验收成品的固定身份与使用方法。

## 成品身份

| 项目 | 已验收的 preview.27 |
| --- | --- |
| 文件名 | `Demo-preview27-5073803f.zip` |
| 程序源码提交 | `5073803f06894f096934a45b8908baff4782eff3` |
| ZIP 大小 | 1,172,801,235 字节，约 1.17 GB |
| 解压内容 | 8,476 个文件，共 2,257,773,199 字节，约 2.26 GB |
| SHA-256 | `939af0a0128551403522a991f312a491c262eb3996733d6d70c146e679c4f3de` |
| 验证 | ZIP 解压后逐文件校验一致；真实模型创作、原生游玩、保存重开与模板副本验证见验收报告。 |

成品在维护者测试机的位置为 `D:/Craftmine Releases/Demo-preview27-5073803f.zip`。这是本机交付位置，不是 GitHub 公共下载地址。其他玩家需要取得维护者分享的完整应用 ZIP；仓库的 **Code → Download ZIP** 只包含源码。

本次 README／许可证更新发生在该封包之后，不修改上述 ZIP，也不宣称它已携带后续新增的许可入口。后续重新构建将使用当前源码的正式许可与打包规则。

## 开始试玩

1. 完整解压 ZIP，双击根目录 `START-PLAYER-PREVIEW.cmd`。
2. 打开已有示例，或新建一个空白 3D 造物世界。
3. 需要 AI 创作时，在设置中连接自己的模型服务并选择模型。成品包不包含个人 API key。
4. 世界中使用 WASD 移动、E 互动、F2 对话；具体玩法按键以画面提示为准。

默认使用独立的 `%LOCALAPPDATA%/CraftmineWorld-FirstCreationPreview27` 资料目录。新目录里看不到旧世界，不代表旧世界丢失。

要继续旧版资料，先正常保存并退出旧应用，再使用包内 `docs/CONTINUE-PREVIEW23.cmd`、`CONTINUE-PREVIEW25.cmd` 或 `CONTINUE-PREVIEW26.cmd` 对应入口。不要同时用两个应用实例打开同一个资料目录。没有对应入口的版本，应先导出世界模板或备份，再按具体版本说明迁移。

## 不调用 AI 复现已有内容

`examples/` 中包含以下七份模板 ZIP。在世界入口导入后创建独立副本：

- `matched-courtyard.zip`：庭院。
- `companion-and-rain.zip`：伙伴与雨天。
- `pomeranian-and-edited-tree.zip`：博美与编辑后的树木。
- `city-flight-and-companion.zip`：城市、飞行与伙伴。
- `dark-ranger-tent.zip`：帐篷角色场景。
- `dual-pomeranian-city-navigation-verified.zip`：城市中的双博美与导航。
- `deepseek-six-step-playtested.zip`：树、花草、小怪、重剑、巨兽试炼与 AK47 的实测存档。

最后一份保留真实试玩进度：已击败一只小怪，步枪换满弹，并已退出巨兽试炼。它不是空白起点，也不需要重新执行六轮模型请求。

## 本版重点与验证边界

本版补齐宣传片素材的独立复用与 Agent 检索指导，修复世界更新展示、初始化续作、战斗 HUD、组件朝向恢复和模板保存后的暂停释放，并优化 DeepSeek 跨轮上下文估算。

六步真实 DeepSeek 创作累计约 17 分 31 秒、6,344,573 Token，其中缓存读取 5,566,848。累计量不等于单次上下文长度。原六步发生一次完成的上下文整理，后续优化使用独立任务另行验证，不能写成该轮零压缩。

实际测试运行在独立后台，未占用用户鼠标键盘。最终保存模板后，正常关闭素材库，同一世界实例持续运行；存档副本有独立会话。完整结果见 [preview.27 验收记录](DEMO_PREVIEW27_DELIVERY_ZH.md)。

该成品是未签名预览版；尚未声称完成干净外部 Windows、全新用户账户及长期真人操作验收。旧 preview.24 交付页保留在 [历史资料](legacy/WINDOWS_PREVIEW24_DELIVERY.zh-CN.md)。
