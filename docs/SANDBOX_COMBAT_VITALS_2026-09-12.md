# 造物沙盒战斗接入：玩家生命组件

沙盒当前的玩家控制器、库存和进度结构不同于第一人称底座，不能直接安装第一人称 `MonsterEncounter`。模块 PackedScene 可以通过现有安装流程接入；不必为了新增模块把 `world/creation.json` 的静态生成器 kind 扩成所有动物与武器。

本轮先接入可选 `combat-vitals`：通过稳定组件身份在 `body.components` 保存生命，`body.player` 继续保持原来的位置、朝向、俯仰和地面状态四字段。死亡通过按所有者管理的移动锁阻止移动和跳跃，保留重力与视角；复活不解除别的组件持有的锁，移除组件不留下永久锁。重复给同一玩家配置两个生命组件会拒绝保存。

`take_damage` 和 `revive` 是供实际游戏源码行为使用的接口，暂停时拒绝；没有增加模型/宿主直接设置生命的操作。下一步在这条沙盒接口上连接武器射线、怪物追击/攻击、掉落及可辨识外观，形成可安装玩法包；本轮没有把生命组件单独称作完整战斗。

## 真实验证

- `tests/godot-components/combat-vitals.mjs`：`D:/cm-promo-loop-0912/test-results/combat-vitals-N6fLRn/report.json` 通过。三个独立进程依次保存受伤 65、死亡 0、复活 100；死亡移动锁恢复、暂停伤害拒绝、无效恢复原子性、锁所有者隔离、释放清理、重复生命组件拒绝均通过。
- 首次失败 `combat-vitals-VXDPg6` 保留：Godot JSON 将整数转换为浮点，原始源码设置字典未正规化，导致自有快照拒绝。现于初始化时按真实 JSON 传输格式正规化源码设置，没有放宽数值比较或省略字段。
- `tests/component-state-engine.mjs`：`component-state-MWmIL3`，既有组件状态 26 项回归通过，包括旧档、双实例、回滚及移除重建。
- `tests/creation-story-headless.mjs`：`creation-story-yJpeXk`，真实树/复制/机关、Rust 保存、候选迁移、两世界隔离及备份恢复流程通过。第一次 `creation-story-D2tSzL` 在缺少显式 Rust 二进制路径时停止，补齐测试配置后重跑；不是隐藏产品失败。

组件未加入已发布素材库；修改后的沙盒控制器、新指导和新检索都不在冻结 preview.15 中。发行前还需源码分发记录及完整玩法包的版本、兼容与成品验收。
