# 当前 Windows 测试交付

当前版本为 **0.14.4-preview.23**，基于原 PI Desktop 的 Windows x64 免安装测试版。程序源码提交 `76e8c0a9ba6abf875db3302c313542a7d27b5654`，已完成玩法组合、多轮目标保留、可视化调整、Codex 接入及朋友试玩反馈五项功能。

## 打开与开始使用

本机入口：`D:/Craftmine Releases/Product-preview23-76e8c0a9/START-PLAYER-PREVIEW.cmd`。

可复制的完整 ZIP：`D:/Craftmine Releases/Product-preview23-76e8c0a9.zip`，约 **1.14 GB**；完整解压约 **2.23 GB**。SHA256：`06e60c0fc2c2e5629de2be5193937f16a85590497f187a737f8cde8da961694b`。实际解压的 8,453 个文件已经逐一比对一致。

请完整解压后运行启动器，不要只复制 EXE。启动器使用 `%LOCALAPPDATA%/CraftmineWorld-FirstCreationPreview23`，与旧预览版档案分开。游玩、导入模板、直接复用兼容素材和受支持的编辑无需 AI 账号；自然语言创作在“设置 → 世界创作后端”连接自己的兼容 Codex CLI 并登录。CLI 和开发者凭据不随包分发。

## 随包世界与功能

从“我的模板”导入 `examples/` 中的 ZIP，再创建独立世界：

- `matched-courtyard.zip`：庭院组合。
- `companion-and-rain.zip`：伙伴与雨天。
- `pomeranian-and-edited-tree.zip`：博美与经过编辑的树木。
- `city-flight-and-companion.zip`：轻雨城市、博美和歼二十，保留 3/3 收集、一次起降及博美互动后的实际存档。

界面仍使用原有世界列表、创作对话和素材库。详细入口、编辑能力与分享方法见[玩家指南](PRODUCT_PREVIEW23_PLAYER_GUIDE_ZH.md)，城市按键和保存起点见[城市指南](PRODUCT_PREVIEW23_CITY_PLAY_GUIDE_ZH.md)。

## 实际验证与记录

最终 ZIP 实际解压副本通过编辑／撤销／分享／独立导入冷开，以及最终城市导入／保存冷开；七次应用正常退出、文件清单未改变、模型调用均为 0。城市完整复现该轮约 **63 秒**。同一成品在原长会话中完成真实 `gpt-6-astra / xhigh` 构建检查与采用，并通过博美穿行、抚摸、跟随／等待及保存恢复验证。

这是未签名本地预览版，外部干净 Windows、全新账号安装与真人长期手感仍待实际测试。所有测试均使用独立后台进程，没有抢占真实鼠标键盘。随包保留源码与第三方材料；`DELIVERY.json`、`seal.json`、`package-evidence.json` 和 `EXTRAS.json` 固定发行身份。

[完整交付记录](PRODUCT_COMPLETION_DELIVERY_2026-09-14.md)、[最终解压验收](EXTRACTED_PREVIEW23_FINAL_ACCEPTANCE_2026-09-14.md)与[真实时间／用量](PRODUCT_AUTHORING_USAGE_2026-09-14_ZH.md)区分源码验证、实际成品验证和未知计数。本轮合入本地 `main`，未自动推送 GitHub。preview.21／22、此前认可世界和原始失败证据保留；旧版交付见[preview.22 记录](FIRST_CREATION_COMPLETION_DELIVERY_2026-09-14.md)。
