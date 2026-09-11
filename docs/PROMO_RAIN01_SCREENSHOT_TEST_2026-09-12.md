# 宣传六组截图实测：RAIN01（2026-09-12）

本轮暂停产品开发，只提交 rain 组第一条原始愿望，未追加提示、答案或后续愿望。模型产物通过检查后，已正常采用、保存并冷重开；真实雨符交互也已触发。截图显示雨停、倒流、余韵三个 HUD 阶段，但未据此宣称逐滴运动轨迹或电影视觉效果已验收。

## 输入与固定环境

- 唯一愿望：我想要《惊天魔盗团》经典场景中让雨停在半空、然后倒流向上的技能。
- 驱动基线：`dd6fdee4`；独立工作树：`D:/cm-promo-rain-test-0912`。
- 受测成品：`D:/cm-promo-loop-0912/desktop/build/releases/43203d8e6202-1a5c7fd2-b609-48c2-b999-fa1bf7a4d267/output/win-unpacked`。
- 成品清单 SHA-256：`3b59f8d34baf393cbdda343107eff99611936a82144d99b04ad61e9809ceb967`。
- `prepare-only` 确认 RAIN01，零请求；随后只运行一次 `promo-wish-native.mjs --live`，DeepSeek `deepseek-flash`、high，隔离新 profile，最多 40 请求 / 10 分钟。
- 原始模型阶段：北京时间 2026-09-12 01:59:59 至 02:04:10；最终 `TASK_SETTLED_UNVERIFIED`，模型停止，17/40 请求，剩余 23，不继续消耗预算。

## 检查、采用与探索结果

1. 检查 `passed`，`sourceStale=false`，六个固定运行时断言全部通过。它们覆盖启动、帧、错误、快照、隔离、恢复，不覆盖雨滴视觉效果。
2. 原模型没有自动采用。使用既有 `promo-wish-adoption.mjs` 正常预览、采用、保存、冷重开，通过同世界 / 同构建 / 新实例验证。
3. 首次探索保持出生位置，虽然准星选中雨符，普通 `interact` 仍返回 `out-of-range`。保留此报告，不把交互失败记为技能成功。
4. 第二次探索通过普通 `look`、向前 `walk` 15 physics 帧、`wait` 后再次交互，返回 `interacted=true, entityId=rain-seal`。随后按固定等待采图：累计次数从 0 到 1，HUD 依次显示「雨停／雨滴悬在半空」「倒流／雨水向上回涌」「余韵／3.5秒后可就绪」。这证明真实产品交互与可见阶段切换已到达；静态截图不足以独立证明雨滴逐帧悬停和向上运动。
5. 两次探索分别使用 307、263 个动作 physics ticks，均在每请求 600 ticks、16 步、4 图的限制内。采用与探索新增模型请求均为 0；原报告、请求账本和固定包保持原字节。各运行退出审计的 `violations`、`pageErrors`、`shutdownFailures` 均为空。

正式构建为 `gbd-8db0ddf23293e25c58a73f4455b34867f57e47cfe7101433d182fe1dc20d366e`，世界为 `world-a335de91e60e`。没有修改受测产品或模型作品，没有真实鼠标键盘、Pointer Lock、前台操作、裸引擎运行或用户 profile 操作。

## 截图与原始证据

证据根目录：`D:/cm-promo-rain-test-0912/test-results/desktop-native-complete-pHRKO4/`。以下路径均相对该目录，原始文件未纳入 Git。

| 文件 | 内容 |
| --- | --- |
| `report.json` | 唯一模型任务原始报告、预算、会话、检查与审计 |
| `formal-world.png` | 模型任务结束时尚未采用的正式空白世界，不能用于宣称技能已交付 |
| `adoption-75d0744f-b481-4624-a892-9bbad1be190f/report.json` | 正常采用、保存、冷重开证据 |
| `adoption-75d0744f-b481-4624-a892-9bbad1be190f/adopted.png` | 采用后降雨与雨符 |
| `adoption-75d0744f-b481-4624-a892-9bbad1be190f/reopened.png` | 冷重开后的画面 |
| `exploration-b4928b88-3182-4f6d-ac9b-9408ba7e639e/report.json` | 初次交互超出距离，保留真实失败 |
| `exploration-e75d1742-d3db-4774-b621-027e2cac9257/report.json` | 靠近后真实交互与四次采样，审计通过 |
| `exploration-e75d1742-d3db-4774-b621-027e2cac9257/view-1.png` | 常雨，施展前 |
| `exploration-e75d1742-d3db-4774-b621-027e2cac9257/view-2.png` | 交互后雨停 HUD，累计 1 次 |
| `exploration-e75d1742-d3db-4774-b621-027e2cac9257/view-3.png` | 倒流 HUD，累计 1 次 |
| `exploration-e75d1742-d3db-4774-b621-027e2cac9257/view-4.png` | 余韵 / 冷却 HUD |

## 画面观察与边界

已目视采用图和阶段截图：浅蓝空白场景中可见雨符与浅色雨线，整体雨幕较稀、对比度较低，没有电影场景的环境氛围。模型使用世界坐标雨滴投影到画布绘制，自述没有深度遮挡；本轮未另建遮挡验收。模型还提供 R 键入口，但本轮只经正常实体交互触发，没有模拟键盘。施展次数的再次冷重开持久性和重复施展冷却行为未另行验收。

用量按原报告原样记录：输入 331,771，缓存读取 998,912，输出 47,179，其中 reasoning 36,475，总计 1,377,862 tokens；17 个已报告请求、0 个 pending。总计的聚合包含缓存读取，不等同新增付费输入或费用估算。本轮只提交中文记录，不修功能、不对效果不足补源码。
