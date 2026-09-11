# 雨技能的普通玩家跟进实测

2026-09-12：原雨世界收到一次自然反馈后，模型产物通过新检查，已正常采用、保存和冷重开。雨滴明显更醒目，能够看到悬停水珠和随后向画面上方消退的雨线；仍像白色细杆的二维覆盖，不能称为电影效果或完整三维雨景。

## 唯一输入与环境

玩家原句：**雨太淡了，看不清楚。我希望能明显看到雨停在半空，然后倒流向上。**

沿用 `world-a335de91e60e`、会话 `c4d19640-bc81-4f2a-aa61-0fcab3ddf398` 和原 `desktop-native-complete-pHRKO4` profile。prepare-only 核对身份和原句后，仅提交这一次普通聊天输入。无新世界、无额外技术答案、无评测入口及测试模型次数/token/总时限；既有产品保护不变。

冻结成品为 `32cd879d364d-c0acf0e3-b793-467e-9dcb-1b8572953512/output/win-unpacked`，清单 SHA-256 为 `db710608e91eed54274bd66341482cba3bcf1518d0d822f6f10e80052e113d25`。采用实际玩家配置 `deepseek-v4.1-flash-expires-on-0910`、thinking `max`、contextWindow 1,000,000、单次 maxTokens 384,000；这不等同任务累计额度。未遇到 prop 输入缺陷。

模型阶段北京时间 04:11:17 至 04:13:35。两次逐项 `allow-once`：只修改原 `scripts/creation/rain_view.gd` 与 `scripts/creation/rain_trick.gd`，再检查 revision 4。零澄清；测试者未手改作品。

## 实际结果和边界

- 新作业 `gjob-241a4225862daf0c6dfd9fa55b568eeec35807fd0aca88f0bebaa411e1f526cc` 为本次输入后创建，`passed`、`sourceStale=false`，六个固定断言通过。断言覆盖运行时和保存恢复，不覆盖雨滴审美或轨迹。
- 正常预览、采用、保存、冷重开通过；正式构建 `gbd-371902f76c8e7b28740abcbbd66515a28f05e4e40b7763113b89a2d3137c6760`。原施展次数 1 保留，两次后续合法雨符交互分别变为 2、3。
- 第一组使用原雨符视角与普通走近/交互取得常雨、雨停和倒流截图。第二组触发后固定稍向上的视角，间隔 30 physics ticks 的两张悬停图中水珠位置目视不变；随后两图可见长雨条移至上方并消退。此为有限截图采样，不是逐滴连续运动测量。
- 比旧版淡雨更清楚，但描边长线像细杆，雨幕仍为世界坐标投影到画布的二维覆盖，缺少深度遮挡，部分雨线直接覆盖雨符。不能把模型对拾取器限制的解释直接当作产品缺陷结论；本轮不修改底座或补场景。

## 模型有没有看图自验

按本次玩家 messageId 切分实际会话工具记录，只出现 `godot_project_facts`、`godot_project_index`、`ToolSearch`、`godot_project_patch`、`godot_build_start`、`godot_build_read`（前五个产品工具均带 `plugin_craftmine_world_` 前缀，ToolSearch 除外）。六个返回的 `content.type` 全为 `text`，没有 image、image_url、pngBase64 或 data:image 结果；没有截图读取调用。

因此模型本轮是在代码与文字/JSON 检查结果上完成，不是收到实机图像后自我视觉验收。本记录的目视评价来自随后零模型的正式采用/探索截图，不能算模型已经看过这些图。

## 原始证据

证据目录：`D:/cm-promo-rain-test-0912/test-results/desktop-native-complete-pHRKO4/`。旧 `report.json` 与旧试验全部保留。

| 相对此目录的文件 | 含义 |
| --- | --- |
| `player-d11cbf88-7a84-4d88-9b52-67846bd84cff.json` | 本次普通玩家输入、工具返回、权限、用量、检查与退出记录 |
| `adoption-f2ac528c-f6a7-48de-8899-98910dd9e4de/report.json` | 正常采用、保存、冷重开与成品完整性 |
| `exploration-4bc9aff9-f2ec-4c4a-81eb-ad413a3e570b/view-2.png` | 接近原视角的雨停对比图 |
| `exploration-4bc9aff9-f2ec-4c4a-81eb-ad413a3e570b/view-3.png` | 同视角倒流阶段 |
| `exploration-ea3c962e-7b76-472e-8299-df47d8b470d5/view-2.png` | 更清楚的悬停水珠，建议画廊展示 |
| `exploration-ea3c962e-7b76-472e-8299-df47d8b470d5/view-1.png`、`view-3.png`、`view-4.png` | 同固定视角的前一悬停帧和后续上升消退采样 |

两组探索各 203 action physics ticks，均 `ok:true`；正常采用及两组探索新增模型调用均为 0。所有退出审计 `violations/pageErrors/shutdownFailures` 均为空，原报告、marker 和成品完整性通过，无真实输入、前台窗口或 Pointer Lock。

本次模型用量：5 个已报告请求、0 pending；输入 209,366，缓存读取 325,632，输出 17,925（其中 reasoning 11,745），总计 552,923 tokens。模型阶段 wallTime 132,851 ms。总计含缓存读取，不等同新增计费输入或费用。
