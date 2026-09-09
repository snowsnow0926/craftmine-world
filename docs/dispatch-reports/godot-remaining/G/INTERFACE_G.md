# G｜接口与集成片段（mining-sandbox）

完整契约在底座内：`desktop/godot/bases/mining-sandbox/docs/SPEC.md`（冻结）、
`docs/INTERFACE_BC.md`（给各负责人）、`docs/ADR-0001-mining-sandbox.md`（决策）。
本文件只列**需要别人动手的最小改动**。

## 1 底座对外身份

| 项 | 值 |
| --- | --- |
| `baseId` / `baseVersion` / `baseProtocolVersion` | `mining-sandbox` / `1.0.0` / `1` |
| 引擎 / 语言 / 渲染 | `4.7.2-stable` / GDScript / `gl_compatibility` |
| 入口 | `res://scenes/main.tscn` |
| world / state / progress / chunk / probe / snapshot | `craftmine.godot-mining-sandbox-*`（见 `manifest.json`） |
| 存档根 | `user://worlds/<sha256(worldId)>/`（可被 `CRAFTMINE_MINING_SANDBOX_PROGRESS_ROOT` 覆盖，仅测试用） |
| 复用 | `side-view` `1.0.0`（运动/摄像机/输入抽象，`docs/REUSE.md` 有逐文件 SHA-256） |

## 2 给 F（共享适配器与物化器）

1. 复制 `desktop/godot/bases/mining-sandbox/contracts/shared-adapter.mining-sandbox.gd`
   → `desktop/godot/shared/adapters/mining-sandbox.gd`（文件名必须等于 baseId）。
2. `desktop/godot/shared/materialize.mjs` 的 `configs` 加：
   ```js
   'mining-sandbox': { version: '1.0.0', examples: ['blank', 'mine-camp'] },
   ```
   参数形状与 `top-down` 相同（`--template <t> --world-id <w> --name <w> --out`）。
3. `desktop/godot/shared/tests/progress.mjs` 矩阵加 `['mining-sandbox', 'mine-camp']`，
   并加一个坏状态：`{format: 'craftmine.godot-mining-sandbox-state/1', stateVersion: 99}`。
4. `desktop/godot/shared/README.md` 补一行说明其原生 body 含地形分块。

适配器依赖的底座方法（已在 SPEC 9 冻结并实现）：`bind_world`、`capture_managed`、
`restore_managed`、`snapshot`、`save`、`restore`、`dig`、`place`、`craft`、`tile_at`、
`inventory_report`、`terrain_hash`、`set_paused`。

## 3 给 C（执行器/运行服务）

```powershell
<godot> --headless --path <world> -- --probe --probe-request=<req.json> --probe-response=<res.json>
```

- 退出码：`0` 已跑完并写出响应；`64/65/66` 探针基础设施失败；玩法是否通过由调用方读响应判定。
- 读存档前必须先停实例（无跨进程文件锁）。
- 加载整体拒绝的 reason 码：`bad_json`、`bad_format`、`bad_state_version`、`bad_world_id`、
  `bad_seed`、`bad_map_size`、`bad_state`、`missing_chunk`、`chunk_corrupt`、
  `chunk_hash_mismatch`、`chunk_out_of_range`、`chunk_world_mismatch`、`index_hash_mismatch`。

## 4 给 A / H（存储、迁移、备份）

- 地形改动与背包是**玩家进度**，不是源码：不得进 Git 内容历史，分支合并不得合并它们。
- 托管 body 自包含（含分块 cells），受共享 `state_guard` 1 MiB 限制；超限底座返回
  `managed_body_too_large` 而不是截断。
- 复制/迁移世界必须分配新 `worldId`（存档根随之变化）；新世界从模板初始进度开始。
- 版本变化一律整体拒绝，没有隐式迁移；迁移器必须单独开发并单独验证。

## 5 给 E / K（产品入口与发行）

- E：创建入口用 `tools/new-world.mjs`（或 F 的物化器）；底座无独立 UI。
- K：复制 `docs/dispatch-reports/godot-remaining/G/delivery/base-assets.mining-sandbox.json`
  → `desktop/delivery/base-assets/mining-sandbox.json`（86 条 entries + 2 份引擎声明）。
  另需在 `desktop/delivery/preflight-selftest.mjs` 的夹具列表与底座数组加 `mining-sandbox`。
- 产品枚举：`plugins/craftmine-world/manifest.json` 的 `godot_project_create.baseId.enum`
  加 `"mining-sandbox"`；`plugins/craftmine-world/main.cjs` 的 `labels` 加
  `'mining-sandbox': '横版挖掘沙盒'`。

## 6 给 I（真实模型验收）

冻结断言表在 `docs/SPEC.md` §8（G01–G36），独立矩阵在
`tests/godot-remaining/G/a16-acceptance.mjs`。模型创作验收应从 `templates/mine-camp`
新建世界，让模型改 `world.json`（配方/矿脉/材料）或 `scripts/base/*.gd`，然后用同一矩阵
复跑；不得放宽现有断言，也不得用探针直接写"预期状态"。

## 7 本次未接线的部分（明确标记）

共享适配器、物化器登记、共享进度测试、产品底座枚举、发行清单、持久化审计用例、
Rust 侧登记、真实宿主端到端、真实模型验收、可见窗口与手感——均未完成，
详见 `REPORT_G.md` 第 6 节。
