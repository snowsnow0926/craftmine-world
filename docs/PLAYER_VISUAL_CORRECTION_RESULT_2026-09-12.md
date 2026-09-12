# preview.14：看图纠正城门遮挡、采用与重开结果

本轮在同一 qQcut9 世界、同一真实会话里，正规重试先前未调用模型的失败输入：

> 看看现在的城门效果，把挡住墙和塔的树挪开，门洞和花草保留。

使用冻结 `f33d37f9cc9b / 0.14.4-preview.14`，模型和思考配置仍为原 `deepseek-v4.1-flash-expires-on-0910 / max`。没有另加 token、请求次数或整轮时长上限。本轮是已有作品的视觉纠正，不是首次成功率对照。

## 结果

模型修改后，两座塔楼完整露出，四棵遮挡或与墙交叠的树移到左右及后方，中央门洞、花草、灌木和石头保持不变。总控实际审阅候选图后，批准正式采用。正常本次预览 → 采用 → 保存 → 冷重开全部完成。

修改前，模型工具实际返回的 PNG：

![模型得到的真实修改前图像](D:/cm-player-retry-0912/test-results/retry-preparation/images/capture-12.png)

修改后，正式采用的实际画面：

![修改后正式世界](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/candidate-adoption-ec144605-194a-4cee-a9c1-ddabd796b5ea/adopted.png)

重开后仍是正式 build `gbd-909bc88ecaeac64999bdbfc6e6d7cff10baf62da3c4e1ea46b352bd65c280802`，源码 revision 5 / manifestHash `e727d076e490bfda5d7f628f3aa246c9b0c3c7286f030f1c3ad1fb9600daf512`；10 个组件条目与采用前后源码清单完全一致。保存进度 revision 10，玩家仍位于 `(0,0.9,15.685)`、yaw 0、pitch 0.15。两次采用/重开进程退出均为 code 0，三类审计为空、报告和 marker 完整性通过。本轮只改树位置，没有重复遍历上批已经通过的中心穿门路线。

## 重试和真实图像链

旧失败 user `363fe039…` 被正常归档为 revision 1，主历史中该愿望仍只有一条，新 user 为 `4c31bf92…`、seq 44。新工作区 `work-d72314…` 的 baseBuild 正确绑定已采用城门 `gbd-a96e…`，旧失败记录未改。

主机记录本轮 **15 次实际模型请求、442.583 秒**（包含权限与 Ask 等待）；模型生成耗时约 187.8 秒。输出 44,868 tokens，其中 reasoning 33,139；其余输入/缓存明细保留在证据中，不能把缓存读取混为新输出。

模型实际得到两次成功 `godot_view_capture` 返回：均含 `[text,image]`、`imageCount=1`，PNG 为 1200×800，正文 SHA-256 均为 `db6c48a66f1e89a68c2511def0c7d3e0e59d142913079ac442a000ff6487e5ce`。它们是同一视角的两次截图，不是两个角度。两张 PNG 从真实工具图像块只读导出并核对哈希。携图上下文后，同一供应商正常返回 assistant 和后续工具调用，没有拒图、静默去图重试或换模型。未另行抓取网络载荷，也不把模型“我看到了”的自述单独当作理解证明；独立源码核对和候选画面支持本次实际改善。

模型还发生两次非成功抓图：首次按需工具需重新激活，随后自行 ToolSearch；检查后尝试抓候选时，没有活动预览实例，被 `GODOT_CAPTURE_CANDIDATE_IDENTITY_CHANGED` 拒绝。这是正确的时序保护。模型明确承认当时没有修改后图像；后续候选图由外部正常玩家预览取得，不冒充模型看过候选。

## 源码与交互证据

只读对比两份真实构建的森林场景，恰好四条 `position` 改动：

| 对象 | 新位置 |
| --- | --- |
| OakFrontLeft | (-9, 0, 6.4) |
| PineFrontRight | (9, 0, 5.9) |
| OakMiddleLeft | (-13, 0, -1) |
| OakMiddleRight | (13, 0, -1) |

将这四行还原后，场景正文与原文件逐字节相同，因此门洞、花草、灌木、石头、其他树、旋转与缩放均未改。新场景文件 SHA-256 `993f416d355bdcfcdd8f5220250dac7b2be952749053428a7b9a719354cdcabe`。模型最终说明表误写了前两棵的旧坐标，实际源码没有该错误；记录以源码为准。

修改场景和精确 revision 5 的 check 各经过一次 `allow-once`。检查由真实执行器完成，sourceStale=false，六项运行断言均通过。模型最后 Ask 的首问把“位置合适、直接采用”绑成同一选项，且当前正规答题桥不支持自由文本；按总控要求首问用 null 跳过，第二问选择保留被墙罩住的草丛，不继续外移树或删除花草。真实答案 `[null,[0]]` 已记录，没有自动首选或提前确认采用。

单独候选预览的第一次测试脚本在挂载世界前过早请求 resume，及时通过取消文件正常退出，未安装/检查/采用；该 harness 记录 `candidate-preview-4ba3…` 保留。纠正顺序后的 `candidate-preview-1a205…` 正常成功。采用使用另一报告 `candidate-adoption-ec144…`，在本次启动重新 preview 获得活动回执后才 apply，没有复用历史预览状态。

## 交付证据

新增 `tests/player-candidate-preview.mjs`：以真实已结束、当轮检查通过的玩家报告为入口，默认只预览；只有显式 `--adopt-reviewed-preview <成功审图报告>` 才开放这一候选的正常采用和保存重开。检查、安装、源码写入、模型启动均不在控制入口内。原报告和所有祖先报告按哈希校验保持不变。

完整原始路径、哈希、用量、实际图像返回、Ask、源码差异、归档及正常采用重开回执见 [结果证据](evidence/PLAYER_VISUAL_CORRECTION_RESULT_2026-09-12.json)。原 profile、密钥和整份带图片的模型会话未提交。
