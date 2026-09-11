# COMBAT 原目标复验与战斗画面（2026-09-12）

**普通怪物目标捕获已在实机修复。战斗版已生成、检查、采用并保存重开；怪物追击及玩家实际扣血已观察到。玩家攻击、击杀和死亡复活尚未验证。** 没有为取得通过结果修改模型作品。

## 原目标与普通玩家输入

- 输入仍是“这些怪物应该会追着我攻击，我要和它们战斗。”，复用原世界 `world-9c77672f23a8`、原会话 `bce3d5ec-cf1b-432f-a0a2-c875eb0b4cdb`，没有转头避开 Monster_3。
- `before` 仍为原 `surface=prop` 和相同位置/法线。正常提交返回 `Monsters/Monster_3`、StaticBody3D、祖先 `res://scripts/monsters.gd`；结构化 target 为 null，普通对象引用保持 `runtime-instance/context-only`。模型回复明确确认看到了正式版本里的这个目标。
- 原零调用捕获失败保留在 `player-21cd0faa-02bc-44df-9219-b32b7302e97e.json`。本轮使用修复后的固定 `594f698b` 成品，不把旧错误归入模型失败。
- 固定包：`D:/cm-promo-loop-0912/desktop/build/releases/594f698b5206-9011ed17-969b-4a70-93fc-c799edbecc02/output/win-unpacked`；清单 SHA-256：`96d43d1c086c057527b93f2feebba1379addb28eb5b7c2b528ccfae31858fe87`。
- 使用实际玩家 `deepseek-v4.1-flash-expires-on-0910`、max、完整配置和 inherit 权限；没有 CREATION_EVAL 或测试追加额度/整轮时限。

模型提出一批四个玩法问题，按战斗目标明确回答：怪物可击败且本局不再复活；玩家会死并回出生点满血复活；左键和 E 都可攻击；中等追击强度、每口约 8 血。选择索引 `[[0],[2],[2],[1]]`，完整问题与 file-response 保留；没有机械首项选择或无敌/静态替代。

## 生成、采用与观察

模型只改写已有 `scripts/monsters.gd`，将静态怪物换成 CharacterBody3D，并实现追击、近身伤害、玩家血条、攻击和复活逻辑。只审阅并单次批准本世界 patch 与 check 两个权限请求。第一次检查即通过，6 个固定断言通过，候选无源码过期；这些断言不等同完整战斗验收。

模型任务正常结束后，经正常预览、采用、保存及冷重开，正式构建为 `gbd-b1c7d797a5d766b6a17964b1276f53f032a77c6fe97005337ac7b5b524d9820f`。正常采用与探索的新增模型调用均为 0。

真实探索通过 wait → 后退 60 physics 帧 → 等待 120 帧 → 再等待 120 帧，合计 302 个动作 physics ticks。玩家从约 `(1.178,0.900,3.821)` 后退到 `(5.372,0.900,5.452)`，水平净位移约 4.5 米。截图中怪物追上来，HUD 血量依次为 **100 → 100 → 52 → 4**，显示“被怪物咬中 -8”，受伤画面泛红。该变化由原模型游戏逻辑产生，没有设置玩家血量或怪物位置。

现有探索桥只有 look/walk/wait/interact；本次玩家攻击在普通左键/E 输入回调中，未用真实键鼠、未新增攻击桥或手工调用脚本函数。因此攻击、击杀、复活和完整战斗循环仍未验，不把三只怪物和血条截图当成全部玩法通过。战斗状态按本轮明确选择仅在当前运行保留；保存重开只验已采用构建和场景恢复，不宣称保存了战斗死活。

## 原始报告与推荐截图

根目录：`D:/cm-combat-clarified-0912/test-results/desktop-native-complete-n6Q0ia/`。

| 相对路径 | 证据 |
| --- | --- |
| `player-aa4589c7-2f39-4f3b-ba99-11da1f2304e6.json` | 普通玩家任务、实际绑定目标、澄清、两次权限和检查 |
| `adoption-ca18565d-be9e-41d3-a07a-348c0a216425/report.json` | 正常采用、保存冷重开通过 |
| `adoption-ca18565d-be9e-41d3-a07a-348c0a216425/reopened.png` | 冷重开的三只怪物与 100 血 |
| `exploration-d5923583-25fa-41c7-91b2-c2461f218ce4/report.json` | 实际后退及观察身份，零额外模型 |
| `exploration-d5923583-25fa-41c7-91b2-c2461f218ce4/view-3.png` | 推荐画廊：追击到近前，实际血量 52 / 100，咬伤提示 |
| `exploration-d5923583-25fa-41c7-91b2-c2461f218ce4/view-4.png` | 实际继续扣到 4 / 100 |

以上图片均已目视。模型阶段北京时间 04:13:32 至 04:18:56，正常任务 metrics 用时 308,252 毫秒，5 次请求全部返回。输入 113,087，缓存读取 383,488，输出 31,687（其中 reasoning 24,260），聚合 totalTokens=528,262；总计含缓存，不作为费用结论。

普通报告 `stateIntegrityVerified=true`，采用/探索均 `ok=true`，各次退出审计 `violations`、`pageErrors`、`shutdownFailures` 为空。旧失败、旧静态版本与本次真实追击证据都保留，不混成首次无介入成功。未操作其他 profile、前台或用户浏览器；本次提交只有中文结果记录。
