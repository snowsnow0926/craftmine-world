# 造物沙盒战斗连续流程

## 本轮完成

造物沙盒现在可以在同一个真实场景中挂载玩家生命、射线武器、怪物和宠物。怪物使用原创低多边形几何，沿平地追近玩家；玩家通过当前摄像机中心射线攻击，实际碰撞遮挡会阻止穿墙命中。击败怪物后从准星交互领取一次奖励，奖励进入沙盒原有字典库存；宠物保持独立状态，不会被误伤或串改。

玩家生命、武器、怪物和宠物都通过 `body.components` 的稳定身份保存。受伤、武器弹药/冷却/射击次数、怪物死亡/掉落/冷却、宠物位置和互动次数在第二进程恢复。非法放置会整体拒绝并回滚；重复领取不会增加奖励；暂停时攻击和伤害停止。

这批已生成确定性的 `cw.module.sandbox-combat@1` 源码预制包，包含生命、武器和怪物脚本及接口声明；尚未导入内置资源目录或 Windows 成品。内置宠物包从 v1 升到 v2 只为绑定新的托管适配器哈希，v1 冻结字节保持不变。下一步应完成资源目录导入、候选检查和成品安装，再补怪物攻击动画、受击效果、声音和更多武器。

## 真实证据

命令：

```powershell
$env:CRAFTMINE_GODOT_CACHE_DIR='D:/Craftmine World/desktop/build/godot/4.7.2-stable'
$env:CRAFTMINE_TEST_OUTPUT_ROOT='C:/cm-combat-integration-results'
node tests/godot-components/sandbox-combat.mjs
```

报告：`C:/cm-combat-integration-results/sandbox-combat-xWCsDv/report.json`，`passed=true`。

- 第一阶段真实物理追近，玩家生命从 100 降到 84。
- 三次真实射线攻击各造成 20，冷却中的第二次射击被拒绝，怪物生命归零。
- 准星交互领取 `monster-token` 一次，第二次仍为失败且库存不变。
- 现有宠物快照保持不变；非法把怪物放到玩家碰撞体内时恢复被拒绝且所有状态回滚。
- 第二独立 Godot 进程恢复库存、怪物掉落状态、玩家生命及武器弹药/射击次数。

同场景测试是开发者布置的真实引擎夹具，没有模型调用、鼠标键盘、Pointer Lock 或前台窗口。它证明组件协作和保存合同，不等价于模型首次自然输入成功率或最终成品手感。
