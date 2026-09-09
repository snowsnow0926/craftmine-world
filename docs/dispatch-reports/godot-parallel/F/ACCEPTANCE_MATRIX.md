# 俯视底座验收矩阵（任务 F）

对应需求："离开交互范围不能购买；实际碰撞和区域进入；购买后钱物一致；库存边界；
任务奖励仅一次；跨场景与完整重启状态保持；两个小镇实例状态独立。"

全部由 `tools/verify.mjs` 在独立 headless 进程、独立测试数据目录里执行；
不发送真实鼠标键盘、不创建或激活窗口、不请求 Pointer Lock。
原始证据：`evidence/verify/report.json` 与 `evidence/verify/evidence/*.json`。

| 需求 | 断言 | 检查 id | 结果 |
| --- | --- | --- | --- |
| 离开交互范围不能购买 | 进入商店但未走到柜台时 `buy` 返回 `out_of_range` | shop-02 | 通过 |
| 同上 | 走到柜台后又离开，再 `buy` 返回 `out_of_range` | shop-06 | 通过 |
| 同上 | 交付任务在 NPC 范围外返回 `out_of_range` | quest-01 | 通过 |
| 同上 | 采集在草药丛范围外返回 `out_of_range` | zone-01 / zone-04 | 通过 |
| 实际碰撞 | 从路面向上撞商店砖墙，玩家顶边停在墙底边（`after.y - 6 >= 127.5`） | town-02 | 通过 |
| 实际碰撞 | 空白起点地图生成了真实矩形碰撞体（`collisionShapes > 0`） | blank-01 | 通过 |
| 实际碰撞 | 移动由真实 `move_and_slide()` 产生位移（`distance > 20`） | blank-02 | 通过 |
| 区域进入 | 走进草药丛后真实重叠表 `zone-herb-patch = true` | zone-02 | 通过 |
| 区域进入 | 走出后重叠表变 `false` | zone-04 | 通过 |
| 区域进入 | 走进商店门自动切换场景并绑定新场景 | shop-01 | 通过 |
| 购买后钱物一致 | 一次购买后 `coins 40→34`、`bread 0→1`、`stock 3→2` 同时成立 | shop-04 | 通过 |
| 购买后钱物一致 | 返回地面场景后金币/背包/库存与店内一致 | shop-08 | 通过 |
| 库存边界 | 连买 3 次后面包库存为 0，第 4 次返回 `out_of_stock` | shop-05 | 通过 |
| 库存边界 | 金币不足时返回 `not_enough_coins` 且状态不变 | shop-07 | 通过 |
| 任务奖励仅一次 | 首次交付扣 3 份草药、`coins 7→37`、`rewarded = true`、奖励账本写入 | quest-03 | 通过 |
| 任务奖励仅一次 | 第二次交付返回 `already_rewarded`，金币仍为 37 | quest-04 | 通过 |
| 任务奖励仅一次 | 交付后台词与任务状态变为 `completed` | quest-05 | 通过 |
| 任务奖励仅一次 | 未知任务 id 返回 `unknown_quest`，不产生任何状态变化 | quest-01b | 通过 |
| 任务奖励仅一次 | 把任务交给非声明发布者返回 `wrong_giver`，不发奖 | shop-03b | 通过 |
| 跨场景状态保持 | 店外 → 店内 → 店外，金币/背包/库存/任务全部保持 | shop-08 | 通过 |
| 跨场景状态保持 | 场景切换后新场景绑定成功且 `sceneId` 正确 | shop-01 | 通过 |
| 完整重启状态保持 | 新进程读到 `coins 37`、`bread 3`、`rope 1`、`apple 1`、库存 0/0、任务已完成 | restart-01 | 通过 |
| 完整重启状态保持 | 重启后再次交付仍为 `already_rewarded` | restart-02 | 通过 |
| 完整重启状态保持 | 重启后购买仍正常（药水 `coins 37→25`、库存 `2→1`） | restart-03 | 通过 |
| 完整重启状态保持 | 采集次数跨重启保持（`chargesLeft 1`、`gathered = 4`），不能靠重开刷采集 | restart-04 | 通过 |
| 两个实例状态独立 | 第二个小镇实例 `coins 40`、库存满、无奖励账本 | instance-01 | 通过 |
| 两个实例状态独立 | 两个实例 `worldId` 不同；B 采集 1 份草药后 A 的状态不受影响 | instance-02 | 通过 |
| 新世界不继承作者奖励 | 示例玩通后再创建的世界仍是 `coins 40`、任务未领、账本为空 | new-world-01 | 通过 |
| 新世界不继承作者奖励 | 创建工具的模板检查：正常模板通过，带 `rewarded` 或 `completed` 的模板被拒绝 | new-world-02 | 通过 |
| 空白起点可用 | 空白起点带初始进度、可移动、有真实碰撞 | blank-01/02/03 | 通过 |
| 方向动画 | 四个方向朝向正确 | anim-01 | 通过 |
| 方向动画 | 同方向持续移动时行走帧确实在推进（`distinctFrames >= 2`） | anim-02 | 通过 |
| 小镇初始状态 | 初始金币 40、面包库存 3、任务未领、账本为空 | town-01 | 通过 |

合计 **34/34 通过**。

## 对抗评审后的补强

一次独立只读评审（code-reviewer）指出了若干测试覆盖不到的问题，已修复并把它们变成断言：

| 评审发现 | 修复 | 新断言 |
| --- | --- | --- |
| 任务记录不存在时账本写入会中断，可能重复发奖 | `deliver` 先 `ensure_quest` | quest-01b / shop-03b |
| 任务可交给非声明发布者 | 新增 `wrong_giver` 检查 | shop-03b |
| 模板用 `status: completed` 绕过创建检查 | 模板检查同时拒绝 completed | new-world-02 |
| 初始进度负数/畸形坐标会写出永远无法载入的存档 | `apply_initial_progress` 与 `ensure_shop` 做钳制与校验 | town-01 / restart-01 |
| `--force --out` 可能删除任意目录、`--template` 可越权 | 路径守卫 + 模板名白名单 + 只删"看起来像生成世界"的目录 | 手工验证（见 REPORT_F.md） |
| `--name/--description` 可注入 project.godot | 值经 JSON 转义 + 拒绝换行 | 手工验证 |
| 行走帧断言只测到朝向不同 | 新增 `move-capture` 在移动中采样帧号 | anim-02 |
| 采集次数持久化未被断言 | 重启探针采集一次并断言计数 | restart-04 |
| 场景切换失败时自动加载仍持有已释放节点 | 切换前清空场景引用 | 代码审查 + 现有场景测试 |
| 快照假设 `Sprite` 一定是 `DirectionalSprite` | 属性读取改为类型安全 | 代码审查 |
| `reset-to-initial` 留下过期 `scene_id` | 保留当前场景并清空位置记录 | 代码审查 |

## 画面证据（与逻辑证据分开记账）

| 项 | 证据 | 结果 |
| --- | --- | --- |
| 小镇地面真实出图 | `evidence/screens/overworld.png` + `overworld-capture.json` | 320×180 画布，草地/道路/石路/树木可辨认，0 条页面错误 |
| 商店内部真实出图 | `evidence/screens/shop-interior.png` + `shop-interior-capture.json` | 320×180 画布，木地板/砖墙/柜台/地毯可辨认，0 条页面错误 |

两次截图都是 Web 导出后在独立 headless 浏览器里拍的，没有发送任何输入，
只证明"对应构建确实出图"；不代表 GPU 性能或玩家手感。

## 未覆盖

- 真实鼠标键盘、窗口合成、手柄手感：按项目约定不自动执行。
- OS 级隔离（AppContainer）：属于 GD0，本底座不声称解决。
- 长时间运行、大世界、多人：不在本次短流程范围内。
