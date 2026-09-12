# GU6：已安装实例参数声明往返保全

2026-09-12，基线 `662d6f05`。原 CP0 `content.interfaces.parameters` 已存在，丢失发生在两处：安装生成的 `craftmine.instances.json` 没保存原 manifest，源码 exporter 总是写 `interfaces:{}`。本切片沿原实例文件保全声明，不增加安装 registry、参数 DSL 或编辑权限。

## 安装记录与验证

`reuse-service.mjs` 将已经过原 CP0 ZIP 验证的 `archive.resources[].manifest` 作为 `resourceManifests` 交给 `planDraftInstall`。新实例附加：

```js
sourceDeclaration: {
  format: 'craftmine.instance-source-declaration/1',
  status: 'source-declared',
  resource: originalCP0Manifest,
  managedFiles: [{sourcePath, path, bytes, sha256}],
  scene: {path, nodePath, mode, resourcePath, identityField}
}
```

保留完整 CP0 content 才能用既有 `validateResourceManifest` 重算原 resource contentHash，不能只存 parameters 再自称它属于某个旧 hash。该 hash是原**资源 manifest 身份**，不是 catalog hash、整个 ZIP SHA 或世界 source manifestHash。

managedFiles 来自 planner 实际输出，记录原资源相对路径到安装路径的映射。当前安装器移动命名空间路径但不改 payload 字节；UID 必须随原包提供。helper 校验此可重算映射及输出摘要。合法的导出路径重写、UID 生成发生在新包建立之前，新包 manifest 已绑定这些新字节，第二世界安装不会拿初始包的旧 hash去否定它们。若未来增加安装时字节转换，必须补明确转换验证；当前不接受只改元数据中的 installed hash来绕过原脚本身份。

旧文件和原实例的额外字段在追加实例时保留。旧调用未提供 manifest 时，新记录明确标 `unknown/ORIGINAL_RESOURCE_MANIFEST_MISSING`；旧实例没有该字段也按 unknown处理，不从脚本正则推断原参数接口。

## 只读解析接口

`plugins/craftmine-world/godot-instance-declaration.mjs` 导出：

```js
resolveInstanceParameterDeclaration({worldId, files: Map<string, Buffer>, mainScene, nodePath})
```

调用者必须先通过既有 pinned source reads 构造真实 files；纯 helper 不取得世界权限，也不证明一个任意传入的 Map 是真实世界。源码 exporter 已沿原 `godotProject.index/read` 的 world/revision/manifestHash 和逐文件 hash校验读取。

解析器交叉检查：实例文件格式/world、唯一显式 entityMap、原 CP0 manifest及资源 ref、现有 asset lock及其摘要、实际安装路径和全部资源文件 bytes/hash、显式 sourceRequirements、父节点路径、身份字段及 PackedScene/Script引用。instance 模式的父节点附加 script override也拒绝，script-node模式还校验原节点类型。原 source-declared metadata、锁、脚本或包装引用变更不能继续沿用旧能力声明。

成功返回 `status:'source-declared'`、原 parameters、resourceRef、instanceId及sourceBinding；它们是**源声明数据**，不是已验证 setter/getter、可写授权或运行行为。缺实例文件/原声明/parameters分别返回显式 unknown及原因。已有声明但绑定、hash或当前共享源不一致，抛出 `PACKAGE_DECLARATION_*`，不会静默降级后携带旧参数声明。

## 重导出与局部 override

对通过校验的独立实例，exporter 将原 `interfaces.parameters` 原样放进新 CP0 manifest，并保持原 subtree提取逻辑。父场景里的 `percent=250` 等局部属性随根节点一同导出；共享 module.gd/module.tscn身份保持不变。参数声明范围与当前局部值分别保留，局部值不会改写声明的默认含义或类型范围。

新包有自己的 resource hash；第二世界的实例记录绑定该新包及其实际安装文件。不会堆积无限嵌套的历代 manifest链。此切片只保全 parameters，不推断或扩充其他接口声明。

exportSource私有结果增加 `parameterDeclaration`。Main只向页面投影 `{status,reason?,resourceRef?}`，校验枚举、原因 token及精确资源ref；不泄漏参数原文、源码路径、context或原manifest。旧私有调用没有该字段时保持兼容。

## 验证与边界

47项回归通过、无跳过；实际插件构建和桌面 `tsc --noEmit` 通过。独立打包的 helper可直接载入并返回旧世界unknown。shared-runtime manifest中的 `draft_install.mjs` exact bytes/hash已更新；许可证/权利状态未改。

测试涵盖安装→局部 override→导出→第二世界安装→再次导出、原声明hash关联、不同实例身份、旧记录额外字段保留、旧metadata缺失、错world/ref/hash/managed-file映射、脚本或PackedScene改变、Main路径/上下文过滤，以及原GLB闭包、归属声明、安装事务和host恢复回归。

真实 Core 使用固定 a9 sealed二进制 `2363c06d8dc715a7f5551be2fe602ea5239c4a4a1a23ea7743512e6dcd93e71d`，在独立 A/B数据目录执行原 `applyFiles` 和正常带 operation身份的 `godotProject.patch`。A的 percent从100改250、label改为local A；导出、B安装及再次导出后声明与源码值都保留。两个检查真实状态均为 `source-saved-check-blocked/GODOT_EXECUTION_UNAVAILABLE`，因为本次没有注册执行器。没有引擎执行、模型请求、玩家profile或输入，没有宣称候选通过/正式采用/运行时冷开。

真实记录在 [参数声明Core证据](../evidence/gu6-parameter-declarations-20260912/report.json)。早期测试准备曾因不合法的初始玩家坐标、Git源码patch漏operation而失败；修正测试参数后重新执行，没有将这些尝试计入成功证据。运行时四参数、实际几何/碰撞和正式应用冷开的验证属于后续独立切片。

```powershell
node desktop/build-world-plugin.mjs
$env:CRAFTMINE_CORE_BIN='<固定 a9 sealed core>'
node --test tests/godot-agent/parameter-declaration-roundtrip.test.mjs tests/godot-agent/parameter-declaration-projection.test.mjs tests/godot-agent/glb-dependencies.test.mjs tests/godot-agent/package-attribution.test.mjs tests/godot-round3/S3/draft-install.test.mjs tests/godot-round3/S6/plugin-load.test.mjs tests/godot-final-install-assets/package-caller.test.mjs tests/godot-agent/catalog-source-host.test.mjs
```
