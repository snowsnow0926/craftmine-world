# 原会话纠正为现成橡树：实际通过（2026-09-12）

## 结果

原玩家自然纠正“新放的这棵树样子不对，我要和原来那两棵一样的橡树，位置保留。”已经在原会话完成。模型自行识别默认生成器与现有橡树模型的区别，撤销错误默认树，再通过正常源码 patch 实例化已有橡树 PackedScene。真实检查、采用、保存冷重开和画面对比通过；位置 (-7.5,0,-2) 保留，原两棵橡树的身份与 transform 未变。

纠正后最佳截图：`D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/exploration-c3307bb8-5f96-4b39-b401-3236d24001a1/view-2.png`。相同视角的纠正前对比：同根目录 `exploration-00b0a388-9c16-4228-9f35-160c1742c313/view-2.png`。原失败记录不覆盖。

## 范围与真实过程

受测产品是冻结 `fc58b4237f5a-9efd801e-dfc5-45cc-8b15-04583b907eb0`，未改包。原 session `219eabdb-7df5-4d44-925e-660cb0311a71`、原 VO4Pki/profile，没有新建会话。使用实际 DeepSeek v4.1-flash-expires-on-0910 / max 配置，不添加评测 token、调用次数或整轮时长上限。只发送这一条自然纠正，没有额外技术 ID、资源路径或实现提示，没有第二轮模型补救。

新采样目标如实为 boundary；没有把上一张选择截图伪装成新的捕获。模型依靠原会话最近结果和实时源码识别该替换对象。本次未再调用 AskTool。三项操作均核对本世界后单次允许：撤销旧 place、修改 scenes/creation.tscn、检查新源码。

模型公开说明：底座 tree 分支使用 Box 树干和 SphereMesh 树冠，真正橡树来自现有 cw.nature.tree-oak.tscn。随后普通 undo 将源码 revision 7→8，world/creation.json 中旧默认树移除；普通 patch 将 revision 8→9，增加第三个同款 PackedScene 引用，保持位置。全过程未调用素材库 search/read/propose，也未安装新的 ZIP；直接复用已安装资源符合本轮目标。

新包包含指导 1.6.4 和工具语义修正，但这轮没有新增 godot_guidance 调用。已有上下文、自然纠正措辞和新工具说明同时存在，不能把结果归因于单项提示修复，也不能用本轮 8 次对上一轮 14 次推断效率提升或首次愿望成功率。

## 源码和身份核验

新源码 revision 9 / manifestHash `831d7d9ae1d039fbdef44ebdc86c1ba2ac0a71943b057c1ee7c2e729abe6a9db`。新普通场景节点 `ins-7c4e1a90b3d5f6820a1e9d47-e0` 位于 (-7.5,0,-2)，引用 `res://addons/cw.nature.tree-oak/scenes/cw.nature.tree-oak.tscn`。旧默认实体 `created-487d1e872c2bdba2145352a1` 已撤销：**对象身份改变，不是同 entity 原地编辑**。

从实际检查产物 source 逐项比对：原 12 个场景节点的 header 与 properties 全部不变；原两棵橡树仍为 ins-1bcdf4a04681c1a5ba8d4b8a-e0 / (-4,0,0)，以及 ins-d4bbe2355aa09513fa50c2e1-e0 / (4.5,0,-1)。新增节点沿用同一个 wrapper，wrapper/GLB/script 的原始字节全部一致：

- wrapper SHA-256：`f0b5828fcba333380fa56fcd131ee9de0987461c42a053812968647aade33841`。
- tree_oak.glb SHA-256：`d7fd8773674928c50c11b66d12c636d49bdcc15a8b1c7fbb98e6f63a3439a3f3`。
- wrapper script SHA-256：`1ccd6ec06d85ec0bc6a80cfd69ea85b8ba57668048772f9b9494e53cb294112b`。

craftmine.instances.json 与 asset lock 字节保持原样，新节点未登记为包安装器管理的新实例。这是能正常渲染、保存并被通用观察器识别的**普通源码实例**，不能称为完整新增包安装登记。本轮没有手补元数据。

## 检查、采用和真实选择

check `gjob-162fa9990fb82026c9181f707205f8552401467ec59871a633e58b660ad53b01` passed，candidate `gcan-2dd3614cb9a987f7d24714a3af44709bb37372a44345e61cb1f4aa660d9b8b0c`，采用 build `gbd-051621e346a0f9977e4bbd76d728062e3322b96ba4cf28e4b434e264780a8d05`。

- 本轮原始报告：`D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/player-320e5cd9-4563-4b70-af6f-576f07e704d6.json`。
- 采用/保存/冷重开：同根目录 `adoption-22eaae4e-6183-459a-b84f-17d9a2870ec8/report.json`，ok=true，原报告与 marker 字节保持。
- 真实 look/capture：同根目录 `exploration-c3307bb8-5f96-4b39-b401-3236d24001a1/report.json`，ok=true。view-1 的 sceneObjectTarget 实际命中 `ins-7c4e1a90b3d5f6820a1e9d47-e0/Visual/tree_oak`（MeshInstance3D），祖先绑定真实 GLB、wrapper 场景与脚本路径。旧 target 字段仍是 boundary，不应与 generic sceneObjectTarget 混读。view-2 用于三树外观对比，那里准星不再指向新树。

退出审计三数组均为空，所有进程已正常结束。后续采用与观察模型调用为 0，无真实键鼠、Pointer Lock 或前台窗口操作。没有修改模型作品或给它补写源码。

本轮 8 次模型请求全部有正常用量回执；inputTokens 206624、cacheReadTokens 594560、outputTokens 14675（其中 reasoningTokens 10594）、totalTokens 815859。提交北京时间 06:11:12，原报告结束 06:14:18。实际工具：facts 1、index 2、ToolSearch 1、file_read 5、creation_operation 1、project_patch 1、project_query 1、build_start 1、build_read 1。这里只作本轮记录，不与首轮组成效率对照。

源码逐项核对的独立机器记录在本工作树 `test-results/corrected-oak-source-evidence.json`。后续若继续应使用本次最新 player 报告、原 profile/session 和实际当前源码，不再使用旧 revision 7 的准备状态。
