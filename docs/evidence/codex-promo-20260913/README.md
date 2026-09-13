# 宣传片方向开发验收

工作树：`D:/Craftmine Worktrees/codex-promo-20260913`；分支：
`codex/promo-agent-20260913`。项目调用真实 Codex CLI，模型固定
`gpt-6-astra`、思考强度 `xhigh`。没有额外施加模型次数、token 或整轮时长上限。

## 已验收内容

| 分镜 | 实际结果 | 证据 |
| --- | --- | --- |
| A02–A03 | 同世界生成树，再增加花草 | `A03-trees-and-flowers.json` |
| A04–A05 | 同一只狗改成白色博美；抚摸、等待、呼唤、跟随 | `A04-applied.json`、`A05-pet-gameplay.json` |
| A06 | 普通怪物追击并造成伤害 | `A06-monster-gameplay.json` |
| A07–A10 | 近战失败后生成 AK47；射偏不扣血，正常战斗击败巨怪，存档保留 | `A10-rifle-victory.json` |
| A10 表现 | HUD 修正、死亡后巨怪消失、再次挑战成功并正常回树林 | `A10-presentation-replay.json` |
| B01 | 下雨、悬停、倒流、恢复及完整自动施法；悬停时仍能移动 | `B01-rain-gameplay.json`、`B01-automatic-rain.json` |
| B02 | 歼-20 实际起飞、转向、爬升、下降、变速、换视角、收起落架；空中保存重开 | `B02-flight-gameplay.json` |
| B02 表现 | 近距离跟随镜头、环境细节、可继续驾驶的 F4 净画面 | `B02-polish-gameplay.json` |
| B03 | 整城六区实际步行到达，探索 6/6；高地连接与坡道往返 | `B03-city-gameplay.json` |

原始报告和 PNG 位于各 JSON 记录的本地路径。交互证据来自独立后台运行的
真实 Godot 实例与普通游戏控制器；操作者没有写入生命、坐标或世界源文件。
所有按键通过固定页面脚本投递到本次绑定的画布，无真实系统输入，无抢焦点
或 Pointer Lock。自动战斗属于程序控制试玩，不作为真人能力或难度评价。

## 平台与交付

- 普通桌面对话后端及实际同会话续做：
  `vendor/pi-desktop/docs/spec/codex-desktop-world-backend.md`。
- 启动期间可取消、保留耐久进度：`gameplay-startup-cancellation.json`。
- 创作期间正式世界暂停：`author-pause-native.json`。
- 大世界进度边界与原生复查：
  `vendor/pi-desktop/docs/adr/godot-source-owned-progress-20260913.md`。
- 失败检查复用不可变导出并运行新的检查：
  `vendor/pi-desktop/docs/adr/godot-failed-check-export-continuation.md`。
- 候选并行启动的图形配置修正：
  `vendor/pi-desktop/docs/adr/godot-concurrent-startup-20260913.md`。
- 模型复用来源与组件字节：`j20-reuse.json`、`runtime-components.json`。

最新逐轮字幕数据为 `test-results/codex-promo/author-ledger.json`，共 19 轮内容
Agent 请求，包含澄清与修复；逐轮 token 是 CLI 累计计数的差值。缓存输入与
推理输出是子集，不重复相加；没有据此估算费用。它不包含开发者 CLI 的代码
开发用量，也不把检查通过等同于采用、可玩或成片。

四个原生备份位于 `test-results/codex-promo/exports/`：

| 文件 | 字节数 | 保留的演示状态 |
| --- | ---: | --- |
| `mainline-ready.craftmine` | 21,542,591 | 同一白色博美、树林和怪物；修订后的首次巨怪胜利界面 |
| `rain-ready.craftmine` | 16,118,326 | 已完成完整施法，恢复正常降雨 |
| `flight-ready.craftmine` | 15,416,570 | 改进镜头与净画面功能，空中状态可继续 |
| `city-ready.craftmine` | 22,619,962 | 六区探索保留，角色沿道路回到中央广场 |

备份按 Rust 原协议恢复整个隔离档案，并正常重建世界。手动试玩入口将绑定
已恢复的独立档案，位于 `test-results/codex-promo/playable-demo/`；无需把它们
恢复到用户已有档案。封存包与最终桌面验证信息记录在
`test-results/codex-promo/promo-delivery-report.json`。

白色博美和歼-20 复用了前一轮已验收的 Blender 资产，不计为本轮从零建模。
图像流程为 AI 参考图 → Codex 编写 Blender 脚本 → GLB → Godot 世界；尚非
产品内自动生图，也不是图片直接重建三维网格。

这是可玩原型、实机截图和拍摄数据准备，尚未录制剪辑为完整宣传片。主线是
一个连续世界；雨、飞机和城市各有独立世界。城市为风格化整城原型，不是
经过测绘的一比一复刻。梦境结尾、音乐来源和精确剪辑节拍仍待确定。
