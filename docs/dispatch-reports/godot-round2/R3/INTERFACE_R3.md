# R3｜接口与可消费交付

完整契约在 `desktop/godot/bases/README.md`、`desktop/godot/shared/README.md`、
`desktop/godot/bases/mining-sandbox/docs/SPEC.md`。本文件只列别人要用的入口。

## 1 底座清单（R2 / E）

`desktop/godot/bases/base-catalog.json`（`craftmine.godot-base-catalog/1`）现含四个底座：

| baseId | 版本 | blank | example | 创建命令 |
| --- | --- | --- | --- | --- |
| `first-person` | 0.1.0 | `blank` | `training-range` | `tools/new-world.mjs --template …` |
| `mining-sandbox` | 1.0.0 | `blank` | `mine-camp` | `tools/new-world.mjs --template …` |
| `top-down` | 1.0.0 | `blank` | `town` | `tools/new-world.mjs --template …` |
| `side-view` | 1.0.0 | `blank` | `ruins` | `tools/new-world.mjs --world …` |

托管布局用 `desktop/godot/shared/materialize.mjs`：

```js
materializeBase({ baseId: 'mining-sandbox', worldId: 'my-mine', template: 'mine-camp', out: 'D:/tmp/my-mine' })
```

未通过 `validateBaseContract` 的底座不会出现在目录里，创建清单也就消费不到它。

## 2 组件安装（R4）

`desktop/godot/bases/component-catalog.json` 的每个组件新增 `install` 块：

```jsonc
"install": {
  "mode": "instance" | "script-node",
  "scene": "scenes/overworld.tscn",   // 默认目标场景；调用方可传 scene 覆盖（例如 blank 世界的 scenes/world.tscn）
  "parent": ".",                      // 场景内父节点路径
  "nodeType": "Area2D",               // script-node 模式的基类
  "script": "scripts/base/door_zone.gd",
  "sceneFile": "scenes/props/pickup_item.tscn",  // instance 模式
  "identityField": "entity_id",
  "identityType": "string" | "stringname",
  "groups": ["entities"],
  "exports": { "target_scene": "\"\"", "target_spawn": "\"\"" },
  "inputActions": ["interact"]
}
```

调用：

```js
import { loadComponentCatalog, planInstallation, applyInstallation } from './desktop/godot/shared/components.mjs';
const catalog = loadComponentCatalog('desktop/godot/bases/component-catalog.json');
const plan = planInstallation({ catalog, componentId: 'td.door', projectDir, entityId: 'door_a',
  scene: 'scenes/overworld.tscn', placement: { x: 96, y: 240, target_scene: 'res://scenes/shop_interior.tscn' } });
const receipt = applyInstallation({ catalog, plan, sourceDir: 'desktop/godot/bases/top-down', projectDir });
```

- `plan.sceneEdits[0]` 是 `craftmine.godot-scene-edit/1`，可先审阅再应用；重复节点名或身份值会在写盘前抛错。
- `receipt.sceneApplied` 列出写入的场景/节点/ext_resource；`receipt.inputsApplied` 列出补进 `project.godot` 的输入动作。
- 单独使用 `desktop/godot/shared/scene_materializer.mjs` 也可以：`parseScene` / `planSceneInsertion` / `applySceneInsertion` / `planInputActions` / `applyInputActions` / `scriptUid`。

## 3 观察与受限操作（R7 / R8）

`desktop/godot/shared/observation.mjs` 的 `BOUNDED_OPERATIONS['mining-sandbox']`：

- 只读：`snapshot`、`tile`、`inventory`、`hash`、`chunk`
- 可变：`move`（轴 ∈[-1,1]，steps ≤600）、`wait`（frames ≤600）、`dig`、`place`、`craft`、`cancel`（requestId ≤128）
- **拒绝**：`set-position`、`restore-managed`、`reset-to-initial` 以及任何 `set-*`；适配器 `ALLOWED_OPERATIONS` 与 schema 由 `observation.test.mjs` 交叉校验。

`observe()` 返回：玩家（tile/position/facing/health/toolTier/equipped）、背包、工具、`stations[]`（稳定 id/type/tile/recipes/present）、chunk id 列表、editCount、terrainHash、worldRevision、cursor、lastAction、bootError。

## 4 持久与版本分离（R1 / R5）

- 托管 body 是 `craftmine.godot-progress/1` 的 `body`，自包含地形分块（`chunks`）与状态（`state`），受共享 1 MiB 限制；超限返回 `managed_body_too_large` 而不是截断。
- 原生存档只写在进度根（`CRAFTMINE_MINING_SANDBOX_PROGRESS_ROOT` 或 `user://worlds/<sha256(worldId)>/`）；世界工程目录内不含任何进度/分块文件（G41）。
- 地形游玩进度**不进 Git 内容历史**，分支合并**不合并**它；复制世界必须换 `worldId`。
- 原生拒绝码与托管拒绝码见 `mining-sandbox/docs/SPEC.md` §5–§6。

## 5 发行（R9 / K）

- `desktop/godot/bases/mining-sandbox/delivery/make-base-assets.mjs` 生成 `craftmine.base-assets/1` 清单（默认输出到报告目录，避免落在自己的 `sourceDirectory` 内）。
- `desktop/godot/bases/mining-sandbox/assets/ASSET_MANIFEST.json` 声明无第三方素材（程序化绘制）。
- 三个原有底座的 `delivery/base-assets` 覆盖情况未在本轮改变。

## 6 本轮明确未交付

- `tests/godot-runtime-native.mjs` 的三底座真实 Web/Electron/Rust 同版本复跑（缺 R1/C 提交与依赖路径，见 `REPORT_R3.md` §5）。
- mining-sandbox 在该原生测试中的分支（等 R2 集成树重编核心后加）。
- R4 的完整新目录包往返联调、R7 的真实消费、CP 玩家底座治理、真实模型创作（R8）、可见窗口/手感。
