# 花园训练场示例

这些是固定内容样本，供安装和验收，不预置到玩家的空白世界。

| 文件 | 用途 |
| --- | --- |
| oak-tree@1.json | 可碰撞树干和非阻挡树冠 |
| wild-flower@1.json | 0.05 米细茎、花瓣、小数几何，全株可通行 |
| thin-grass@1.json | 三片薄叶，高度 0.32–0.52 米，可通行 |
| garden-training@1.json | 花草树、生命值、近战、射击、奖励和吸血行为组合 |
| training-drain@1.extension.json | 固定版本吸血扩展，按实际伤害回血 |
| training-scene.json | 可复现组合源场景，地面 y=6 |
| content.mjs / build-packages.mjs | 固定样本源码及确定性构建脚本 |

训练枪射程 30 米，伤害 20，3 发弹匣，换弹 0.4 秒、冷却 0.2 秒。训练剑射程 2 米，伤害 25、冷却 0.3 秒。G 调用吸血扩展。启动获得 1 枚训练币，击破训练靶再得 1 枚；重开同一实例不会重复发奖。训练币是明确共享物品，并非每个实例独立的一种货币。

先加载 `ext:training-drain@1`，再安装精确版本 creation；没有扩展时应拒绝。示例不携带模型密钥，也不携带用户应用证据。安装成功仍须新世界的草稿检查、需求评审、应用。

复现：`node examples/dispatch-d/build-packages.mjs`。实际无输入检查：`node tests/dispatch/d/headless.mjs`。禁用 Pointer Lock 和焦点，无鼠标/键盘模拟。画面证据证明实际几何已绘制，美术喜好仍由玩家预览判断。
