# GU3：受限模块参数捕获与源码预览

新模块：plugins/craftmine-world/godot-module-parameters.mjs。
它是纯函数层，没有文件系统读取/写入、运行时 configure、脚本执行、任务创建、
构建或应用能力。宿主路由负责获取被 Core 验证的 source index、必要文本和新鲜
live observation；模型不能借助这个 helper 获得额外写入权限。

## API

`requiredModuleParameterPaths({source,capture}) → string[]`

先提供 project.godot 的文本 bytes 和完整 manifestFiles，即返回去重的六个路径：
project.godot、run/main_scene、craftmine.instances.json、craftmine.assets.lock.json，
以及所属模块的 module.tscn/module.gd。该步骤只计划安全读取，不代表捕获有效。

`captureModuleParameters({source,capture,live,now?}) → result`

`previewModuleParameters({source,capture,live,binding,changes,now?}) → result`

source：

- worldId、revision、manifestHash：当前 Core index 的准确身份。
- manifestFiles：完整 Map(path → {path,bytes,sha256})，也接受同形状数组。
- files：Map(path → Buffer)，只需要上述六个文本。每个解析文本上限 1 MiB。
  必须与 index 的长度/SHA-256 一致，且是无 BOM/NUL 的合法 UTF-8。

capture 为已有冻结 CreationCapture，至少包含 format、snapshotId、worldId、
buildId、instanceId、sourceRevision、manifestHash 和 sceneObjectTarget。后者
必须保留 host 标注的 identityScope=runtime-instance、sourceUse=context-only、
objectId、nodePath、nodeClass、scriptPath、scenePath 及 ancestors。

live 为本次重新采样的 {worldId,buildId,instanceId,sampledAt,sceneObjectRefs}；
路由可把实际 sample.creation.sceneObjectRefs 提升为顶层字段。不能用自行声明
的 verified:true 代替真实 references。采样须在 30 秒内，允许最多 5 秒时钟偏差。
纯测试可显式提供 now，产品默认 Date.now()。

源 revision/manifestHash 必须严格等于 capture 的 sourceRevision/manifestHash；
本层不推断“文件看起来相同，因此允许使用别的 revision”。live world/build/
runtime instance、target reference 及祖先也必须一致。空资源路径在原生观察中
可能是空字符串，host capture 已转换为 null；只对 scriptPath/scenePath 做这种
等价归一，不接受节点路径、类或 objectId 的变化。

返回 result.binding，内部含 bindingHash，以及 source/runtime/capture 身份、
owning scene/node/entityId、packageInstanceId、resourceRef、installPath、lockHash、
已重算的 parsedFiles 和经完整 Core index 对齐的 sharedFiles。bindingHash 在
`result.binding.bindingHash`，不在 result 顶层。preview 必须获得重新捕获后的
完整 binding 并与 caller 绑定一致；路由可只让模型回传 bindingHash，再自行核对。

## 支持范围与解释

只支持两份已审计原版资源 kenney-city-building@1 和 kenney-city-road@1，
并分别绑定原始 CP resource contentHash、module.gd、module.tscn 的准确 SHA-256。
重打包、脚本更改或复杂继承不自动继承此能力，仍可使用原始源码通道。

真实碰撞命中 StaticBody3D 时直接匹配其 owning instance；solid=false 导致
选择器命中 MeshInstance3D 时，可通过一致的 live ancestor 找到唯一模块 body。
然后：

1. 解析父主场景，要求是非 inherited 的普通场景。
2. 定位唯一、直接位于根下的 PackedScene 实例；禁止 script override、
   额外 child override、重复节点或 entity_id，以及未知实例属性。
3. 用显式 entity_id 对齐已有 craftmine.instances.json 的 entityMap、实例 ID、
   assetId/version/contentHash/installPath，再核对 canonical asset lock。
   registry 的 version 为 number，asset lock 的 version 为 string，分别按真实
   契约核对，不能混用 catalog/ZIP/CP resource hash。
4. 解析实际四属性 literal，缺失项来自已审计脚本默认值。sceneInstall 输出
   中已有的 position/rotation/scale/transform 只保留，不由本接口修改或重复施加。

参数沿用现有四个 export 名称与类型，不引入新的参数 DSL：

| 属性 | 值域 | 作用 |
|---|---|---|
| model_scale_percent | integer 25..800 | Visual 与重建碰撞的局部比例 |
| quarter_turns | integer 0..3 | Visual 与重建碰撞的局部旋转 |
| solid | boolean | 该实例的碰撞启用状态 |
| label | string，最多 80 个 Unicode 字符，无控制字符 | 模块元数据；不是可见重命名 |

result.values 是有效**源码初始值**，valueSources 区分 instance-override 与
audited-script-default，并附相应路径/hash；defaults 给出脚本默认值。
runtimeValuesVerified=false：其他世界脚本仍可能在运行时覆盖变量，不能仅凭
源码捕获宣称屏幕或实际碰撞已验证。实际效果须由正常候选检查证实。

GLB、纹理、许可等共享文件不搬入 helper 内存；它们的存在和 hash/bytes 来自
同一个 Core immutable source index，并与现有 asset lock 对齐。
sharedBinaryEvidence=core-source-index 明确表示没有独立读取验证二进制内容。
本层不使用新增 sourceDeclaration metadata 扩大权限；metadata 的保全与 setter
可信性是不同问题。旧 registry 没有该扩展字段仍可按固定 wrapper 范围处理。

## 修改建议

preview 只接受四个 scalar changes。禁止 entity_id、文件路径、共享材质、
configure、根 transform 或任何未知字段；复核完整 binding 后才生成：

```js
{
  applied: false,
  changed: true,
  checkRequired: true,
  operations: [{op: "put", path: "scenes/creation.tscn",
                text: "...", expectedHash: "原父场景 SHA-256"}],
  changeSummary: {
    scope: "single-source-instance", entityId: "...", nodePath: "...",
    changes: [{property: "solid", before: true, after: false}],
    sharedResourcesModified: false, progressStateWritten: false
  }
}
```

保留原 LF/CRLF，拒绝混合换行以免改写无关节点；整数仅接受十进制整数字面值。
只替换目标块对应属性，缺失覆盖值插入该块末尾。重新解析后再次
核对 entity_id 和四项值。其余节点、共享文件和输入 Buffer 不修改。同值变更
返回 changed=false、operations=[]、checkRequired=false，不伪造写入或检查回执。

源 patch 建议不是保存或应用：模型仍需通过既有 godot_project_patch 写草稿、
按新 source pin check，再正常 preview/apply。saveImpact 明确不写 progress，
只在采用后的场景重建中提供新的源码初始值。不将 configure 返回 ok 当作持久化。

## 验证和未覆盖项

`node --test tests/godot-agent/module-parameters.test.mjs` 共 9 项：
两份真实 ZIP 的 declarations/files、真实 planSceneInsertion 在 stock creation
场景的输出、单实例 patch/peer 与 transform 保留、缺省/CRLF、Mesh 子节点祖先、
stale/ref/bytes/binding 拒绝、重复 ID/未知继承/共享修改拒绝、四参数边界和无 IO/
确定性。二进制 Buffer 特意不提供，确保没有借缺失 binary 误报资源不存在。

本交付没有运行新引擎或玩家模型；上述测试验证纯 capture/preview，不宣称正式
源事务、实际碰撞、候选采用或冷开通过。路由集成后的正式验收仍须使用两个独立
实例，实际应用只改 A 的 source patch，检查并冷开，确认 A 保留而 B 与共享资源
不变，并覆盖源/现场身份变化、未知回执和新几何与玩家存档冲突。
