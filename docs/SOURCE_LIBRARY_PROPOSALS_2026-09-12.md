# 现代 Godot 素材库与安装提案接线

2026-09-12。本轮让模型能发现已入库的现代源码 ZIP，读取真实包内容声明，向当前世界提出安装建议。玩家在 Godot 作品面板确认后，复用现有源码安装、检查、预览和采用流程。未改写用户的素材库与创作包计划，也未调用产品模型或启动前台窗口。

## 已确认的旧缺口

`asset_library` 的搜索/读取/版本可进入 Rust 素材索引。但 `package_library` 仍连接旧 `craftmine_packages`：其 `package.check` 要求旧 `{id,version,hash}`，模型接口却提供现代 `{assetId,version,contentHash}`。这两套数据不是仅改字段名称就能互换。能力报告现在把该旧 check 模式明确标为 `LEGACY_PACKAGE_REFERENCE_ADAPTER_REQUIRED`，其他旧查询保留，不迁移旧存储。

现代源码包已经有 `package.installSource → package.planInstall → godotProject.applyFiles → godotBuild.start`。本轮把发现与玩家确认接到该链路，不另建安装器。

## 最小协议

新增 `godot_source_library`，三种模式：

- `search`：可选 query/offset/limit，仅搜索当前素材索引 `local-library` 中 `mediaKind=package` 的记录，保留来源与标签。默认素材仍通过现有 `asset.import` 登记。
- `read`：输入准确的素材索引 `ref={assetId,version,contentHash}`。宿主通过 `asset.read/asset.bodyPath` 读取已核验正文，再验证 ZIP、文件哈希与包清单。输出 `archiveRef`、包内 `rootRef`、各资源的 kind、entry/sceneInstall、接口、兼容条件、状态、许可及文件清单。两种哈希不混用，不给模型宿主绝对路径或 ZIP Base64。
- `propose`：同样输入 ref，可选显式 `position={x,y,z}`。世界与源码 revision/manifestHash 来自当前宿主调用身份；proposalId 来自宿主上下文和 toolCallId。提案保存于当前 profile，重开后可查，创建本身不安装、不采用。

`package.request` 新增 `sourceProposals` 和 `installSourceProposal`。确认只能提交 worldId/proposalId，不能改包、源码身份、坐标、路径或执行上下文。原安装器增加 expectedSource；首次执行核对当前源码版本，后续仍依靠原 CAS 事务与安装 journal。重复调用或丢失回执沿用同一 operationId；跨世界、改过的 ZIP、陈旧源码均拒绝。

作品面板显示待安装提案、默认位置或具体坐标。点击后进入现有检查作业查询；检查通过仍要预览、采用。安装回执保留实际 instanceIds，模型之后可以通过正常源码编辑继续调整。

## 位置边界

显式 position 沿用现有有限坐标校验：三项有限数、各绝对值不超过 80。只用于恰好一个可安装的 3D 组件，通过 `planSceneInsertion` 写入该实例的 position，不修改共享资源。二维节点或多个场景实例的歧义安装拒绝位置参数。缺省沿用模板位置。

这是明确坐标安装，不是自动理解“这里”。没有从玩家视角猜坐标，也没有把模型坐标伪装成宿主捕获落点。模板默认位置和显式位置均在提案/面板中说明。

## 内置包集成约定

包正文复用 `packStaticPackage`：`root={id,version}`，资源为 `craftmine.resource/1`，content 包含 assetId/version/kind/files/dependencies/entry/interfaces/compatibility/state/licenses，由 `contentHash(content)` 生成身份。object/scene/module 需要现有 sceneInstall 声明和一个可赋值实体身份；脚本与场景路径遵守现有 addons 命名规则。

索引登记复用 `asset.import`，包装 ZIP 使用 `mediaType=application/x-godot-package`、`mediaKind=package`；source 为 origin/author/license/licenseStatus，后者为 verified/unverified/unknown。Root 提供精选素材及启动登记；本轮 `main.cjs` 没有绑定具体 seeder。`createSourceLibraryService` 预留可选 `ensureBuiltin`，每次 search/read/实际安装读正文前等待它，便于备份恢复切换索引后重新补齐默认素材，不缓存跨数据库目录身份。

## 验证与未覆盖

43 项定向测试通过，覆盖真实 ZIP、现代索引与包根哈希区分、许可/来源保留、冻结位置、跨世界/非法路径/变更正文拒绝、源码陈旧拒绝、丢失回执、重启重试、玩家确认 UI 状态机、宿主回执裁剪和能力报告。包含一个使用固定 `32cd879d` 包内 Rust core 的全新隔离数据目录测试：真实 asset.import → 搜索 → 提案 → 原安装器 → 源码事务/锁文件/Vector3(3,0,-4) → 构建检查请求。该测试不启动引擎，没有把排队或阻塞的检查标为通过。

桌面 TypeScript 检查通过；此前直接检查缺少本工作树 workspace dist，按依赖顺序构建本地声明后重跑通过。未改共享源码、未启动用户 profile。

尚未验证新成品的实际图像、当前 creation-sandbox 上的完整素材组合或真实模型选材；由 root 集成精选内容后继续验收。现代库不含任意节点访问、脚本执行或绕过采用的入口。
