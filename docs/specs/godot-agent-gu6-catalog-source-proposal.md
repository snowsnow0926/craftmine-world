# GU6：模型提出固定目录源包建议

基线 `5ea4a7da`，2026-09-12。本切片新增 `package_library` 的 `mode="propose-source-install"`，没有新增工具，也没有给模型安装权限。与另行开发的 host/UI `importCatalogSource` 共用精确 `ref`。

```json
{
  "mode": "propose-source-install",
  "ref": {"assetId": "资源库返回的精确ID", "version": 1, "contentHash": "资源库返回的64位catalog摘要"}
}
```

参数须来自实际 `asset_library` 查询；示例字符串不是可提交的真实身份。该模式先校验固定 ref，再通过当前调用的宿主 context 调用 `task.context`，仅取其绑定 worldId。无当前绑定就失败，不读取全局选中世界，不调用 `workspace.open` 获取草稿租约。

随后只调用一次规范 `asset.read({assetId,version})`。不使用自定义 library read override，也不调用 `asset.bodyPath`、`asset.probe`、`package.check`、安装器或任何私有写接口。读回必须满足：

- `version_.assetId/version/contentHash` 与提议精确一致；此处 contentHash 是 **catalog hash**，不是 ZIP 文件 SHA-256，也不是 ZIP 内 resource hash。
- `files.length === fileCount === 1`，唯一文件 MIME 为 `application/zip`。
- 文件 bytes 为1–5 MiB内的整数，版本总 bytes 与其一致，文件 SHA-256 为64位小写十六进制。这里只检查元数据格式，不宣称已重算文件摘要或验证 ZIP。
- source 模式的 assetId 非空、UTF-8不超过120字节、无控制符或 `*`/`?`，拒绝 `latest`；version 为1–1,000,000的整数。旧提案的验证语义保持不变。

成功结果只含建议字段 `format/proposal/method/ref/worldId/applies/requiresPlayerAction/note`，其中 `method="importCatalogSource"`、`applies=false`、`requiresPlayerAction=true`。没有 operationId、context、owner grant、blobPath 或 archiveBase64。提案说明玩家可以在现有 Godot 作品面板的资源库入口选择该精确版本进行检查；宿主在玩家选择后创建新的操作身份并重新验证。模型建议不是授权凭证，也不证明归档有效、内层资源身份、兼容性、已采用状态或当前世界安装成功。

若 canonical asset.read 未注册，返回 `available=false/DEPENDENCY_NOT_WIRED` 和所需接口，不虚构提案。模式在能力表中显示为带一次 `asset.read` 元数据读取的 proposal，依赖 `sessionDrafts + assetCatalog`；不依赖旧 library bundle 的 `creationPackages` 标志，不把私有安装入口说成模型可直接调用的工具。宿主动作显示为 `proposedHostMethod`。已结束回合在异步读取前后均拒绝返回结果。

旧 `mode=propose` / `proposeInstall()` 仍针对 library bundle，指向 `package.install`。它们与新 CP0 ZIP 源包建议不能互相代替。

## 验证

实际执行 `node desktop/build-world-plugin.mjs`，打包后的五个修改模块/manifest与源文件逐字节一致；随后运行：

```powershell
$env:CRAFTMINE_CORE_BIN='<固定09f sealed包的craftmine-core.exe>'
node --test tests/godot-agent/catalog-source-proposal.test.mjs tests/godot-round2/R7/library-and-intents.test.mjs tests/godot-remaining/L/capability.test.mjs
```

上述34项测试通过，无跳过；追加 `tests/godot-remaining/L/broker-contract.test.mjs` 后共53项通过。覆盖缺失/不匹配身份、latest/wildcard、非ZIP、多文件、大小或hash格式错误、缺失接口、未绑定会话、结束回合、只读能力可达性、旧提案语义和真实打包路由。

真实 core 使用 sealed `09f7443a1aeb`，二进制 SHA-256 `2363c06d8dc715a7f5551be2fe602ea5239c4a4a1a23ea7743512e6dcd93e71d`。测试显式创建独立临时 world/catalog，导入既有审计 `building.zip` 作为准备步骤，再通过**实际打包的模型工具路由**提出建议。成功调用与错误ZIP-hash调用分别记录，每次均只有 `task.context` 和一次 `asset.read`；其他调用在测试代理中直接拒绝。catalog hash为 `515544d0…`，ZIP SHA为 `351f4774…`；将后者放进ref会拒绝。无模型请求、无 Godot 执行、无安装，也未访问玩家 profile。

独立真实证据在 `test-results/catalog-source-proposal-*/report.json`，提交的精简副本见 [模型源包建议证据](../evidence/gu6-catalog-source-proposal-20260912/report.json)。这只证明模型建议层；新host/UI的实际安装、操作绑定和应用验收由对应集成任务单独验证。
