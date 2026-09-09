# R4 登记补丁（R1 / R2 / R7 接入，R4 未修改这些文件）

任务：`godot-round2-20260910/R4-packages-and-installation.md`
分支：`codex/godot-round2-r4-20260910`（基于 master `bcebeb1` + 继承 H `da41621`）

R4 新增的 Rust 模块是 `library.rs` 的子模块（`mod installer; mod package_format;` 已在 H 的 `library.rs` 内登记），因此 **`lib.rs` 不需要新增 mod 或 migrate**。需要接入的是 RPC 分发（R1）和客户端/服务入口（R2/R7）。

## 1 R1：`crates/craftmine-core/src/main.rs` 分发

在第一个 `match method {` 中加入：

```rust
        "package.formatCheck" => return journal.package_format_check(params),
        "package.planInstall" => return journal.package_plan_install(params),
```

签名：`pub fn package_format_check(&self, &Value) -> Result<Value>`、`pub fn package_plan_install(&self, &Value) -> Result<Value>`。

### `package.formatCheck` 参数

```jsonc
{
  "text":   "<严格 JSON 文本>",     // 可选：返回 canonical + contentHash
  "paths":  ["a/b.txt"],            // 可选：返回排序后的条目列表或拒绝
  "kind":   "object",               // 可选
  "legacy": {"format":"craftmine.module/1","kind":"creation"}, // 可选
  "lock":   {"direct":[],"closure":[],"graph":{}},             // 可选
  "manifest": { ... craftmine.resource/1 ... },                // 可选
  "package":  { ... craftmine.package/1 ... },                 // 可选
  "entries":  ["package.json","resources/<hash>/manifest.json"] // package 校验时必填
}
```

结果按请求字段逐项返回；`contentHash` 是 `sha256(canonical(text))`。

### `package.planInstall` 参数

```jsonc
{
  "operationId": "install-<uuid>",
  "resources": [ {"format":"craftmine.resource/1","content":{...},"contentHash":"..."} ],
  "target": {"worldId":"w","base":"top-down","baseVersion":"1.0.0",
             "engine":"4.7.2-stable","stateFormat":"craftmine.godot-progress/1",
             "inventory":{"inputActions":[],"autoloads":[],"globalClasses":[],
                          "uids":[],"paths":[],"entityIds":[]}},
  "options": {"allowInputActionRemap": false}
}
```

结果：`{ok, order, instances[{instanceId, entityMap, localOverrides}], lock, conflicts, remappedInputActions, applied:false}`。`ok:false` 表示有冲突需要玩家处理，**不是** RPC 错误；RPC 错误只用于输入不合法。

## 2 R1：持久化操作登记（若接 `workbench.prepare/execute`）

`package.planInstall` 是只读规划，不需要进 `craftmine-operation-journal.ts` 的 `allowed`。真正落地的 `package.install`（R4 上一轮已实现，R1 登记）仍按 H 的 `REGISTRATION_H.md` 处理。

## 3 R2：作品 UI 与服务入口

R2 在 `plugins/craftmine-world/workbench-service.cjs` 的 `channels` 映射加入（`worldId` 由该服务从已校验选择注入，不列入这些字段）：

```js
  'package.formatCheck':['text','paths','kind','legacy','lock','manifest','package','entries'],
  'package.planInstall':['operationId','resources','target','options'],
```

服务侧调用示例：

```js
import {canonicalJSON, validatePackageJson, legacyKind} from './package-format.mjs';
import {packStaticPackage, unpackStaticPackage, archiveIdentity} from './package-zip.mjs';

// 导入：先解容器，再用同一套 CP0 规则校验，最后交给宿主登记
const unpacked = unpackStaticPackage(bytes);
const plan = await call('package.planInstall', {operationId, resources: unpacked.resources,
  target, options});
if (!plan.ok) return {conflicts: plan.conflicts};   // UI 展示，不静默覆盖
```

UI 需要显示：冲突列表（用 `explain` 风格的中文文案）、依赖顺序、新实例 ID、局部覆盖为空、以及“计划已生成但尚未应用”。

## 4 R7：模型工具

建议工具只暴露两个只读/规划入口，写入仍走 R1 的事务：

- `package_inspect`：`package.formatCheck` + `unpackStaticPackage` 的清单摘要（类型、版本、依赖、许可文件、冲突）。
- `package_plan_install`：`package.planInstall`，返回计划与冲突，不执行应用。

包内 README/描述/脚本都是待分析内容，不能作为提高权限或自动发布的指令。

## 5 R3：物化接口（R4 的计划执行方）

R4 的 `package.planInstall` 输出 `instances[].entityMap` 与 `localOverrides`。R3 的物化器需要按下列契约执行（R4 不实现）：

```jsonc
{
  "instanceId": "ins-…",
  "contentHash": "…",
  "entityMap": {"<模板实体 id>": "<新实例实体 id>"},
  "position": {"x":0,"y":6,"z":0},        // 可选，玩家放置点
  "overrides": []                          // 实例局部覆盖，初始为空
}
```

执行必须写入**草稿**，再由 C/R2 形成候选与正式应用；不得直接改正式世界。R4 的 `package.planInstall` 不做任何写入。

## 6 未接入时的行为

未完成上述登记时：Rust 132 项测试、`tests/godot-round2/R4/package-format.test.mjs`（9 项）与 `package-zip.test.mjs`（22 项）独立通过；`package.formatCheck` / `package.planInstall` 的端到端 RPC 与作品 UI 不可用。R4 不把这部分计为已完成。
