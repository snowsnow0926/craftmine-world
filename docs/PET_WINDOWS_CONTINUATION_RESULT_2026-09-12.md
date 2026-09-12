# Windows 宠物预制包完整续验结果

## 已完成

在冻结 Windows `0.14.4-preview.15` 上，原档案中的 `cw.module.pet-companion@1` 已完成正常安装、检查、候选预览、采用，随后同档继续跟随、瞄准、一次 E 抚摸、保存、正常退出、第二进程重新进入。重开后的完整状态与保存时逐字段严格一致：同一宠物身份、名字、外观、跟随模式、位置、互动次数以及玩家进度均保留。两次进程退出码均为 0，违规、页面错误、退出失败列表均为空。

续验没有重新安装、检查或采用，没有修改产品二进制、原始报告或档案标记；通过普通游戏操作继续原先已经采用的世界。冻结成品全部文件清单哈希前后相同。测试无模型调用，因此不代表模型发现和自主安装模块的成功率。

## 原始证据与失败纠正

- 原安装及采用报告：`D:/cm-pet-product-demo-0912/test-results/desktop-native-complete-jBieXB/report.json`。首次测试错误地把安装实例 ID 当实体 ID，原报告保留。
- 最终续验：`D:/cm-pet-product-demo-0912/test-results/desktop-native-complete-jBieXB/continuation-946d7d8b-6ffb-45d0-a95e-9629a5391120/report.json`，`ok=true`。
- 互动图：同目录 `interaction.png`；重开图：同目录 `reopened.png`。
- 原成品清单 SHA-256：`57f4fc490e0ef21bcdeeb10547d5bd054736d94f7db3244a38f09cecc78e161a`。
- 世界：`world-4b44111816ac`；实体：`ins-ee570fd5da166076d42ae806-e0`；最终保存修订 16。

续验过程中几次失败来自测试脚本：隔离根目录配置错误、单步等待帧数超合同、运行代码仍发送 `pitch:0`、把保存回执误判为不存在的 `status:'persisted'`。这些失败不改写为成功记录。总控重新读取实际执行脚本和调用参数后修正，未把猜测的“模型无法互动”或“产品不能重开”当成结论。

实际相机眼高为玩家位置加 `CameraRig` 的 0.65 米，普通犬碰撞体中心为脚部位置加 0.385 米。以当前实际坐标计算 yaw/pitch 并通过正常有限动作瞄准，抚摸反馈出现。新续验脚本给每次进程独立退出监听，严格限制调用为读状态、进入游戏、有限游玩、保存及退出；禁止重新安装、检查、采用和模型请求。

## 复现入口

```powershell
node tests/pet-product-continue.mjs 'D:/cm-pet-product-demo-0912/test-results/desktop-native-complete-jBieXB/report.json' 'D:/cm-promo-loop-0912/desktop/build/releases/9c15948da1c8-d6d615ce-dec4-4906-b535-83cfb57844ab/output/win-unpacked'
```

复现会在原独立测试档案中继续一次正常移动和抚摸，增加一次互动计数，再保存重开。此流程不操作用户浏览器或真实键鼠，不请求 Pointer Lock，也不增加玩家模型的评测 token 上限。
