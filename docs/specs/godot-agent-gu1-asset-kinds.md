# GU1：资源分类与 Core 合同对齐

2026-09-12，基线 `a9b4c0e2`。Core `asset_catalog/contract.rs` 已有七种标准分类：`base/world/module/object/scene/raw/data`；输入别名 `creation` 映射为 `module`，`world-template` 映射为 `world`。模型工具原本只接受 `raw/object/creation/world-template`，因此无法用 Core 返回的部分分类继续检索。

已用固定 a9 sealed Core 和原打包插件在独立临时库复现：直接 `asset.search(kind="module")` 返回 `kind-module`，随后实际 `asset_library` broker 相同过滤报 `INVALID_ASSET_KIND`。修复仅补齐 `ASSET_KINDS`、manifest 的 kind enum/说明，以及作品面板的七类下拉选项；工具仍接受两个旧别名。未改变风险级别、只读权限、宿主身份、安装与执行接口，也没有新增分类。

真实回归显式创建七类及两个旧别名的目录记录，逐条将 Core 返回的 kind 原样传入打包模型工具过滤，并确认对应 ID 命中。旧别名查询与标准分类查询完全一致，非法分类仍拒绝。准备数据使用相同的已有审计 building.zip，仅用于验证目录分类；不意味着该 ZIP 实现了七种作品类型，也没有执行或安装 ZIP。

```powershell
node desktop/build-world-plugin.mjs
$env:CRAFTMINE_CORE_BIN='<a9 sealed package>/resources/bin/craftmine-core.exe'
node --test tests/godot-agent/asset-kinds-core.test.mjs tests/godot-final-install-assets/catalog-source-ui.test.mjs tests/godot-round2/R7/library-and-intents.test.mjs tests/godot-remaining/L/capability.test.mjs
```

实际打包通过；上述37项测试通过，无跳过。UI 用真实 Main gateway 的 DOM 状态测试验证全部七类逐项转发，没有模拟真实鼠标/键盘。核心与打包 broker 回归使用新的独立数据目录，不访问玩家 profile，不调用模型或引擎。

固定 Core：`desktop/build/releases/a9b4c0e299c7-f362dff8-51bc-4b62-93e0-dc3588619234/output/win-unpacked/resources/bin/craftmine-core.exe`。精确二进制摘要、原失败和修复后的真实查询结果见 [归档目录](../evidence/gu1-asset-kinds-20260912/identity.json)。原失败 `asset-kinds-wvLTAw` 与成功 `asset-kinds-3rMjON` 分开保存；更早的 text/plain 不支持和直接 Core 查询缺 offset 是测试准备错误，留在私有 test-results，不算产品缺陷。

这是 a9 之后的独立增量，不能回填为此前 a9 成品包25步安装/应用/冷启动验收的一部分。本轮没有另跑完整桌面成品包或普通玩家创作。
