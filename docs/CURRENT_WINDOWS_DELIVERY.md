# 当前 Windows 测试交付

当前版本为 **0.14.4-preview.24**，继续使用原 PI Desktop 界面。程序源码提交为
`c04cef7e13e30e77460ae12f1bd29546173aeea1`，修复 preview.23 玩家报告的加狗／应用黑屏
和网页世界 Codex 创作拒绝问题。之后的测试、验收文档提交不改变密封程序。

## 继续原来的试玩

先保存并关闭旧应用，再运行：

`D:/Craftmine Releases/PlayerFix-preview24-c04cef7e/docs/CONTINUE-PREVIEW23.cmd`

该入口使用原 `%LOCALAPPDATA%/CraftmineWorld-FirstCreationPreview23` 档案，继续已有的
世界、聊天、素材和设置。不要同时用两个版本打开同一档案。根目录的
`START-PLAYER-PREVIEW.cmd` 则使用独立 preview.24 档案，适合从头测试；在那里看不到
旧世界不代表旧世界丢失。

完整 ZIP：`D:/Craftmine Releases/PlayerFix-preview24-c04cef7e.zip`，约 **1.14 GB**，
完整解压约 **2.23 GB**。SHA256：
`179de9ef34b1ad64c813711ab627a1aba012c649744c5f0c217cba1731363c74`。
ZIP 实际解压后的 8,456 个文件已逐一比对一致。请完整解压运行，不要只复制 EXE。

## 本次修复

- 加狗：补全工具分页说明、素材查询默认值与已交付世界的指导兼容；全自动作者可通过
  明确安装动作复用素材，继续原有检查与采用。素材卡片根据真实采用状态自动更新，
  区分安装提案、检查通过与已加入世界。
- 预览／黑屏：刷新先对账遗留候选，再打开正式世界；候选锁定时拒绝冲突切换，不再
  先改变标签再被拒绝。保留未知采用结果的保护，避免重复提交。
- 网页世界：Codex 根据实际世界类型使用已有网页创作工具，补齐同一模型的真实评审，
  保留预览、应用和保存边界。不会替换玩家的模型或转换已有世界。

原有四个认可世界仍在 `examples/` 中：庭院、伙伴与雨天、博美与编辑后的树木、
城市／歼二十／博美。使用方式见 [preview.23 玩家指南](PRODUCT_PREVIEW23_PLAYER_GUIDE_ZH.md)
及[本次修复说明](PLAYER_FLOW_FIX_PREVIEW24_GUIDE_ZH.md)。

## 验证与边界

真实 `gpt-6-astra / xhigh` 原话“再给我生成一只小狗”已完成自动采用，两个独立狗实体
同屏且保存冷开保留。最终 ZIP 解压包又通过真实预览中刷新、返回、采用、再次刷新和
保存冷开；八项检查、七张实际附着非黑画面通过，恰好一个采用事务。

网页空白世界的原话“生成一个树”已完成真实 Codex 创作、评审、普通预览和应用，
实际树形画面通过核对。完整存档冷开证据与测试边界见
[本次验收记录](PLAYER_FLOW_FIX_ACCEPTANCE_2026-09-14.md)及
[候选恢复记录](PLAYER_CANDIDATE_RECOVERY_ACCEPTANCE_2026-09-14.md)。

测试均使用独立后台进程，不抢占真实鼠标键盘；原用户档案和失败证据保留。本包是未签名
本地预览版，外部干净 Windows、全新账号安装和真人长期手感仍需实际测试。
旧交付见 [preview.23 记录](PRODUCT_COMPLETION_DELIVERY_2026-09-14.md)。
