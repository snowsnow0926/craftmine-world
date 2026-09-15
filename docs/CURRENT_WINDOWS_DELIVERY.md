# 当前 Windows Demo 交付

**0.14.4-preview.28 · Windows x64 · 免安装 ZIP**

2026-09-15，作者已确认完成大赛提交。另提供的评委专用一键连接封装及无密钥教程见 [提交记录](SUBMISSION_COMPLETED_2026-09-15.md)；以下保留普通包的固定交付身份。

本次按 FB04 需求修复启动黑屏，隐藏四个不稳定的新建选项，增加独立新玩家入口，并恢复创建确认查询的短暂超时。详见 [preview.28 验收记录](FB04_DEMO_PREVIEW28_DELIVERY_2026-09-15.md)。

## 成品身份

| 项目 | 当前提交包 |
| --- | --- |
| 文件名 | `Demo-preview28-FB04-7d021e72.zip` |
| 程序源码提交 | `7d021e72aaa9bb3c83498cf56ac09febf4df0be6` |
| ZIP 大小 | 1,173,041,282 字节，约 1.17 GB |
| 解压内容 | 8,491 个文件，共 2,257,988,347 字节，约 2.26 GB |
| SHA-256 | `fe411a9c1e00b2c8964570c85aa0ae3e8d82fbf615948a5ac10a0803d8c1f5e4` |
| 验证 | ZIP 解压逐文件一致；实际程序的空白创建、模板导入、首次进入与冷启动通过。 |

维护者本机：`D:/Craftmine Releases/Demo-preview28-FB04-7d021e72.zip`；本次报名材料：`D:/Craftmine Submission/20260915-final/`。这些是本机交付位置，GitHub 的 Code → Download ZIP 只含源码。程序对应源码与许可随应用提供；封包后文档提交不代表重新编译。

## 启动方式

完整解压后先读根目录 `00-开始试玩.txt`。

- `START-PLAYER-PREVIEW.cmd`：日常使用本版，固定资料目录 `%LOCALAPPDATA%/CraftmineWorld-FirstCreationPreview28`。
- `START-NEW-PLAYER.cmd`：每次创建新玩家，使用独立空资料，原账号、密钥与世界不带入也不删除。后续用 `NEW-PLAYER-SESSIONS/CONTINUE-对应编号.cmd` 继续同一玩家。
- `CONTINUE-PREVIEW27.cmd`：使用以前的 `CraftmineWorld-FirstCreationPreview27`，继续原世界。更早版本入口仍在 docs 中。

新目录看不到旧世界不代表丢档。正常保存并退出后再切换入口，不同时打开同一份资料。

新建保留“造物世界”的空白 3D、宣传片示例及 Web；已有世界和模板仍可打开。需要 AI 创作时连接自己的模型服务；包内不带个人 API key。

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

## 验证边界与历史记录

preview.28 通过最终程序的四次后台启动、显示层级、模板导入与保存恢复核对；本次未调用模型。原生真实画面已检查，未操作用户鼠标键盘。完整模板的运动对象已经继续运行，因此持久字段一致与完整快照相等分别记录。尚未声称完成另一台干净 Windows 或长期真人操作验收。

之前六步真实 DeepSeek 创作与素材复用见 [preview.27 验收](DEMO_PREVIEW27_DELIVERY_ZH.md)；此前最终封包的真实 AI、战斗与模板验证见 [历史提交记录](FINAL_DEMO_SUBMISSION_RESULT_2026-09-15.md)。这些历史结果不冒称在 preview.28 上重新执行。
