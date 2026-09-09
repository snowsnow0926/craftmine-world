# 本次审计的内存反例

以下是本次审计实际执行过的命令及返回值。仅进行 URL 转换或调用无写入的纯函数，不启动客户端、浏览器、游戏引擎或真实输入。工作目录对应当时的源码提交；未来源码更新后结果可能变化。

## 1. R2 物化模块地址被重复转换

读取依据：R2 `451033b` 的 `electron/main/index.ts:923` 与 `godot-world-creation.ts:256`。工作目录为 `D:/Craftmine World`。

```powershell
node -e "const {pathToFileURL}=require('node:url'); const p='D:/Craftmine World-worktrees/godot-round2-r2-20260910/desktop/godot/shared/materialize.mjs'; const first=pathToFileURL(p).href; console.log(JSON.stringify({caller:first,loader:pathToFileURL(first).href,equal:first===pathToFileURL(first).href}));"
```

输出：

```json
{"caller":"file:///D:/Craftmine%20World-worktrees/godot-round2-r2-20260910/desktop/godot/shared/materialize.mjs","loader":"file:///D:/Craftmine%20World/file:/D:/Craftmine%2520World-worktrees/godot-round2-r2-20260910/desktop/godot/shared/materialize.mjs","equal":false}
```

此命令复现调用方和加载函数使用的两次转换，不是启动主程序后采集的完整异常日志。源码中的动态 import 使用第二个地址；该地址不再指向实际模块。

## 2. R3 身份覆盖与 CRLF 输入动作

工作目录：`D:/Craftmine World-worktrees/godot-round2-r3-20260910`，HEAD `cf4704f`。

```powershell
@'
import {
  planSceneInsertion,
  applySceneInsertion,
  planInputActions
} from './desktop/godot/shared/scene_materializer.mjs';

const scene =
  '[gd_scene format=3]\n' +
  '[node name="Root" type="Node2D"]\n' +
  '[node name="Old" type="Node2D" parent="."]\n' +
  'entity_id = "old-id"\n';

const plan = planSceneInsertion({
  sceneText: scene,
  scenePath: 'scene.tscn',
  spec: {
    mode: 'script-node',
    script: 'door.gd',
    identityField: 'entity_id'
  },
  entityId: 'new-id',
  overrides: {entity_id: 'old-id'}
});

console.log(JSON.stringify({
  accepted: plan.ok,
  duplicateIdentityOccurrences:
    (applySceneInsertion(scene, plan.edit)
      .match(/entity_id = "old-id"/g) || []).length,
  crlfExistingActionReportedMissing:
    planInputActions('[input]\r\ninteract={}\r\n', ['interact']).missing
}));
'@ | node --input-type=module
```

输出：

```json
{"accepted":true,"duplicateIdentityOccurrences":2,"crlfExistingActionReportedMissing":["interact"]}
```

它证明规划器接受重复身份覆盖，以及将 CRLF 文件中已有的动作判断为缺失；没有启动 Godot，不能据此宣称已经验证重复身份的全部游戏后果。

## 3. R4 锁格式互不兼容

工作目录：已合入 R4 的 `D:/Craftmine World-worktrees/godot-round2-r2-20260910`，HEAD `451033b`。未修改其在途文件。

```powershell
@'
import {validateLock} from './plugins/craftmine-world/package-format.mjs';

for (const [name, lock] of [
  ['r1', {
    format: 'craftmine.assets-lock/1',
    assets: []
  }],
  ['planner', {
    format: 'craftmine.assets-lock/1',
    direct: ['door@1'],
    closure: ['door@1'],
    graph: {'door@1': []}
  }]
]) {
  try {
    console.log(name, validateLock(lock));
  } catch (error) {
    console.log(name, error.message);
  }
}
'@ | node --input-type=module
```

输出：

```text
r1 LOCK_DIRECT_REQUIRED
planner OBJECT_REQUIRED
```

第二个输入依据 Rust `library/installer.rs:281` 的返回结构构造，是最小结构反例，没有现场调用 Rust planner。结合两端源码，它证明现有 JS 校验器拒绝该结构；最终修复还必须验证真实 Rust/JS/素材消费者的往返。
