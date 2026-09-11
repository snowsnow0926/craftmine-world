# 沉浸式造物世界：物件操作与普通源码玩法

指导 ID：`creation-sandbox.authoring`，版本 `1.6.4`。仅匹配
`creation-sandbox` 底座 `1.0.0`、初始 `creation-sandbox-1.0.0` 或已采用的 `gbd-*` build，以及
Godot `4.7.2-stable`，并检查所列运行时接口的真实文件哈希。

这是按源码整理的接口指南。加载指南或示例不会证明模型首次成功、玩法验收或正式采用。

## 指导适用性与源码权限

目录的 `requiredInterface: true` 仅表示“加载这份指导时，要核对该源文件哈希是否匹配”。
它不是只读标记，也不是不可修改文件清单。普通场景与 GDScript 可以按实际
`godot_project_patch` 和宿主写入策略修改；既有任务租约、源码版本、expectedHash、路径和构建检查仍须满足。
修改后若出现 `GUIDANCE_INTERFACE_UNSUPPORTED`，表示这版指导不再覆盖当前源码，
应重新读取实际源码继续判断；不表示合法修改失败，也不要求仅为加载指南而还原修改。

真正的托管边界独立于这个标记：宿主注入的导出预设、Web shell/bridge 不能由项目替换。
带造物要求的检查还固定校验 `craftmine_shared/base_adapter.gd`、`runtime_bridge.gd`、
`state_guard.gd` 及 `project.godot` 中的运行时桥接入口。不能改弱或绕过这些检查；
这不等于整个 `project.godot` 或所有普通脚本都只读。具体可写范围以当前宿主策略与实际调用结果为准。
需要重开保留的变化，应进入实际源码及受支持的 capture/validate/restore 进度路径；
临时附加节点或运行时变量不能代替持久化实现。

## 常见静态外观：先查真实组件

确认世界事实和可用工具后，树木、地表装饰、桥、围栏、城墙等常见静态外观，先用
`godot_source_library` 查找符合玩家风格、尺寸和用途的组件，避免重复用方块从头拼造。
工具尚未暴露时，用 `ToolSearch` 按这个准确名称发现；真正不可用或没有合适素材时，
继续通过普通场景、GDScript 和允许的资源原创，不为迁就库存擅自降低玩家要求。
已有少量精选组件不代表所有动物、城市或飞机都已有素材，能力只以实际返回为准。

**底座生成器和已安装素材是两类对象。** `creation_operation` 的 `place kind=tree/rock/chest/door/marker`
选择 `world/creation.json` 所用的底座生成器，不是素材 ID、GLB 名称或已安装场景引用。
例如默认 `tree` 生成底座几何树，不会因为视野中已有同名树就自动复用它的网格与材质。
`duplicate` 也只复制该 JSON 中已有实体的生成器参数，不能复制任意 addon 节点。
同 kind、同显示名称或操作成功回执，都不能证明外观相同。

玩家要求“再来一个相同外观的物件”或指定已有素材品种时，先读取当前场景的真实实例与资源引用。
复用已经安装的场景应引用同一实际 PackedScene，为新实例设置独立 `entity_id`，通过普通源码 patch
添加实例并保持原实例不变；也可以读取实际 `godot_source_library` 引用后走正常安装提案。
不要猜场景路径、复制原实例的可变进度，或改写共享网格/材质去伪装新增独立实例。
后续仍须检查、采用并核对实际表现；若当前对象由自定义生成器绘制，先读该生成器，不能凭名称推断。

1. **search**：例如 `{"mode":"search","query":"树","limit":6}`。按需要查询名称或用途，
   从 `result.items` 读取真实结果；只在需要更多候选时按实际分页信息传 `offset/limit`，
   `limit` 最多 24，不每次重读全库。
2. **read**：将检索结果中真实的 `assetId`、整数 `version`、`contentHash` 原样组成 `ref`，
   调用 `mode:"read"`。这是资产目录 ZIP 的 `archiveRef`，不是内部组件的 `rootRef`；
   两者身份和哈希不能混用，不写 `latest`、不猜版本或哈希。读取返回的 `resources`，
   核对 `entry`、`compatibility`、`state` 和许可：`entry.placement.dimensionsMm` 是毫米，
   同时看 `entry.collision`、`entry.visualOnlyScene`、`entry.importConfiguration` 的真实声明。
   没有声明就不要猜。静态门不等于开门机关，飞机外形不等于可驾驶飞机，怪物外形不等于战斗 AI。
3. **propose**：选中合适组件后，用同一精确目录 `ref` 调用 `mode:"propose"`，交给玩家通过
   正常作品面板安装。只有玩家明确给定或可信当前观察已确定的坐标，且各轴在 -80..80 内，
   才能传完整 `position:{x,y,z}`；不能猜“这里”、从名称推坐标或默默填零。省略位置就是模板默认位置，
   此提案不自动消费玩家捕获的“这里”指代，不能声称已经放到指定落点。

`propose` 只生成绑定当前世界与源码版本的安装提案，`applied:false` 不表示已采用。
安装仍须经过正常草稿写入、检查和候选采用；后续放置/修改使用实际安装实例身份与最新源码，
源码变化导致提案过期时重新读取并提案，不能绕过版本冲突。归档有效不证明画面、碰撞、精准拾取或玩法成功。
库的 ZIP 与二进制由宿主读取，不在模型上下文搬运 base64、复制整个包正文或调用旧 `package_library`
代替现代源组件流程。同一轮复用已经读到的精确引用和摘要，仅在需求、候选版本或实际读取结果变化时更新；
组件提供外形之后，缺少的机关、交互或战斗仍按后面的普通源码路径实现和验证。

## 外形表现、目标拾取与输入交接

Godot 的渲染能力与宿主当前的目标拾取覆盖范围不同。`scene_mesh_picker.gd`
对网格类型、材质和射线命中的保守检查，是为了避免把不确定的几何认作玩家选中的对象，
不是作品只能使用 `BoxMesh` 的美术限制。不能为了通过拾取器而擅自把玩家要求的外形
降成方盒拼装。普通场景可以使用实际引擎、资源与宿主构建策略允许的网格；是否能准确
拾取需要另看当前源码和实际观察，不能承诺复杂网格已有精准选择支持。
`fallback` 说明当前目标证据不足，不说明该网格不能显示；不得修改托管拾取器、伪造命中
或把碰撞包围盒当作精确可见表面来掩盖覆盖缺口。按玩家目标完成表现，并如实区分外观、
选择与玩法验证结果。

当前静态 `ArrayMesh` 观察支持最多 8 个 surface，分别按实际不透明 StandardMaterial3D
和剔面设置求真实三角交点。单网格最多 4096 三角/12288 顶点，单次观察最多
16384 三角/49152 顶点；仍有节点与候选数量预算。它不通过包围盒猜命中。
带脚本、skin、blend shape、动画、LOD、透明或位移材质等未覆盖情形仍明确回退。
GLB 文件没有动画或 LOD 扩展，并不保证导入后无 LOD：Godot 可能自动生成 LOD。
需依据实际导入网格与观察结果判断，不能承诺所有静态素材都可精准选中，也不能修改托管观察器绕过拒绝。

载具等新玩法需要保留现有玩家控制器的输入启用、鼠标捕获状态、暂停和失焦释放流程。
`DisplayServer.get_name()` 描述显示后端，不能判断谁拥有输入，也不能把非 `headless`
等同于玩家正在前台操作；后台 Web 世界仍可能使用 Web 显示后端。不得在登机、下机、
初始化或自动交互中直接改 `Input.mouse_mode`，绕过当前控制器的状态与捕获通知。
先读取玩家当前控制器和相机的真实实现，再协调玩法状态与既有输入流程。也不能机械地
换成一个捕获调用：例如当前 `set_captured(true)` 会拒绝输入已禁用或世界暂停的状态。
如果现有接口不足以完成输入交接，要明确缺口，不发明 API、不强制取得鼠标；同样不能
靠识别测试环境而跳过正常玩法，或把未能验证的驾驶行为写成已通过。

## 从真实身份开始

调用 `godot_project_facts`、`godot_capability_report` 和 `godot_guidance`
`mode=catalog`。按返回的 ID、version、sha256、源码 revision、manifestHash
分页读取本指南与引用；`nextOffset` 非空时继续读。源文件通过
`godot_project_index`／`godot_project_query` 定位，再用 `godot_file_read`
读取玩家当前文件和确切 SHA-256。接口哈希不匹配时，重新检查实际源码，不能套用指南假定。

本轮上下文的 `creationTarget` 来自主机冻结的运行时观察。`这里` 使用冻结的落点，
`这个对象` 使用冻结的 entityId；玩家之后移动不改变本轮指代。没有目标或目标过期就
需要新的玩家捕获，不能编造目标、坐标、障碍或 snapshot ID。调用工具时不传
`targetSnapshot`；主机通过本轮上下文取得它。
若捕获的 `source=recent`，目标来自玩家明确选回的正式产物，可修改该对象；它不是射线落点，
不能用于“在这里”放置新物件。多个最近结果由玩家明确选择，不按名称猜选。

`creationTarget.sourceRevision` 是捕获时正式构建的源码 revision。工具请求的
`expected.revision` 与 `expected.manifestHash` 使用当前 `godot_project_index` 的结果；
新任务可能为相同正式源码重新编号，工具会由核心完整源码身份校验此重基准。
同轮后续操作使用上次结果 `source.revision` 与 `source.manifestHash`，
目标的 worldId、buildId、instanceId、snapshotId 保持原样。`creationTarget.target.revision` 是 `world/creation.json`
内部场景 revision。两者有不同来源，不能互换。buildId、instanceId、worldId 和 snapshotId
必须使用同一个主机捕获；只查文件得到的几何不是这种授权快照。

## 结构化物件编辑

`creation_operation` 顶层只有 `request`。request 必须包含唯一 operationId、action
和完整 expected；以下为字段映射示意，不是可直接提交的虚构身份：

```js
{
  request: {
    operationId: "create-tree-001",
    expected: {
      worldId: creationTarget.worldId,
      buildId: creationTarget.buildId,
      instanceId: creationTarget.instanceId,
      revision: sourceIndex.revision,
      manifestHash: sourceIndex.manifestHash,
      targetSnapshotId: creationTarget.snapshotId
    },
    action: "place",
    kind: "tree"
  }
}
```

不传 position 时，place 使用冻结命中点。支持 tree、rock、chest、door、marker；
position 为世界坐标 x/y/z，rotationY 为度数，scale 为三轴倍数。
位置 x/z 为 -28..28、底部 y 为 0..16；实体完整包围盒也必须在边界内。
scale 各轴 0.25..4；颜色为六位 `#RRGGBB`；最多 128 个实体。

- `modify`：targetId 必须等于冻结 entityId；changes 可包含 position、rotationY、scale、color、parameters，保持原 ID。
- `duplicate`：targetId 仍须匹配冻结目标；count 为 1..8，offset 各轴 -8..8；工具检查每个新物件与其他物件、玩家的碰撞。
- `delete`：targetId 必须是冻结选中对象，删除有规则引用的对象会明确拒绝。
- `undo`：提供原 undoOperationId，支持本版记录的放置、修改、复制和删除；当前对象必须仍与原操作结束时一致。撤销只改内容，不回退背包、位置或已领奖历史；旧记录和规则修改不支持此快捷撤销。
- `environment`：timeOfDay 为 0..24，通过源码默认时间变更进入候选采用。
- `sequence-door`：为已有门和 2..16 个不同 marker 生成一份普通 GDScript 顺序规则。规则最多 8 个，工具的规则 ID 不可重复使用。

参数按 kind 限定：chest 的 rewardId／rewardCount（1..99），door 的 initiallyOpen，
marker 的 label（最多 80 字符）；树和岩石的 parameters 为空对象。
修改门的 initiallyOpen 是新实例的默认状态，既有门的玩家进度按稳定 ID 保留。

此 Alpha 每个世界最多保存 4096 条结构化操作，日志上限 4 MiB；回执中的
`operationLimit`、`operationsRemaining` 表示操作上限与本次之后剩余次数。旧记录不删除，
达到上限明确拒绝新操作，不能称为无限创造。

同一个愿望的相关编辑先连续写入同一草稿，完成后检查最终版本；不要对每个中间步骤重复导出。不同愿望不能为了合批而改变目标或吞掉取消。调用结果 timing 是真实分阶段耗时，可用于诊断，但不代表检查已完成。

工具写入源码与操作日志，并不等于运行时已采用。重试同一请求使用同一 operationId；
重放冲突时不能用同 ID 换请求内容。源码或目标过期时重新读取主机实际身份，保留别人的修改。

### 常见中文属性愿望的完整检查

宿主支持单个物件的明确颜色、尺寸以及两者组合，例如“把这棵树放大到两倍并改成蓝色”、
“把这个对象缩小到半倍”、“在这里放一棵蓝色的两倍大小的树”、
“在这里放一个箱子，颜色改成#abcdef并尺寸设为半倍”。颜色与尺寸须同时满足；
同一对象用一次 modify 的 changes.color／changes.scale，新物件用一次 place 的 color／scale，
不必先放置再修改。尺寸倍数以捕获时该对象三轴尺度为基准；新物件以默认 [1,1,1] 为基准。
最终各轴仍须处于 0.25..4。明确支持半、一、二／两、三、四及 0.25、0.5、0.75、1.5、2.5、3.5 等数值。

有限颜色词的确定值为：红 #ff0000、橙 #ffa500、黄 #ffff00、绿 #008000、蓝 #0000ff、
紫 #800080、黑 #000000、白 #ffffff、灰 #808080；可带“色”，也可直接指定六位 #RRGGBB。
任务中的宿主冻结要求是实际检查目标，不能另猜颜色值。颜色词不覆盖“深红”“浅蓝”等模糊色调。

只支持一个新物件或同一个捕获对象的上述属性组合。模糊倍数、重复／冲突属性、跨对象组合、
附带未知玩法都保持需求待验证；不能删掉后半句来获得自动通过。已存在物件与游玩进度仍由原检查保护。

## 新增非预置逻辑：普通源码路径

结构化 action 是常用编辑入口，不是所有玩法的菜单。读取当前 `.gd`、场景和合同后，
可用 `godot_project_patch` 在绑定草稿中增加或修改普通 GDScript。每个 put 都写完整文件，
携带当前 revision、manifestHash 与旧文件 expectedHash；新文件 expectedHash 为 null。
引擎 API 以 `godot_docs` 和当前脚本为准。

当前 creation.json 支持 `sequence-door` 与 `entity-behavior` 两种规则声明；不能凭空写其他 kind。
该声明加载的是 `scripts/creation/rules/<规则ID>.gd` 文件，实际逻辑由该普通脚本定义。
脚本必须扩展 Node，并提供 configure、on_entity_interacted、snapshot、validate_state、restore。
声明的 sha256 必须是实际完整脚本 UTF-8 字节的 SHA-256。先写脚本，再从该源码版本的
index/read 返回值取得真实文件 sha256；用下一次 CAS patch 更新声明，全部完成后再 check。
不能手写、猜测或沿用旧脚本哈希。
保留既有规则身份与状态语义；修改已有快照形状需要显式兼容已有进度，不能丢字段换成默认值。

引用 `examples/double-press-rule.gd` 提供一个**新规则 ID**的例子：先操作第一个标记两次，
再操作第二个标记开门。它使用 `{presses, completed}`，而不是预置生成器的 `{cursor, completed}`。
需要现有一个 door、两个不同 marker；声明仍用 sequence-door 和这两个 marker 的 ID。
把样例完整写入新规则文件，并把声明加入现有 creation.json、递增场景 revision、更新 sha256。
样例是可审查源码，不是 `creation_operation` 的新 action，也不是玩家世界已验证的证据。
若玩法需要任意新场景节点，可以直接扩展场景/脚本；必须把需要保存的状态接入当前支持的
容器和真实 capture/validate/restore，不能靠临时变量冒充持久进度。

## 普通对象行为接口

与门无关的行为使用 `{id, kind:"entity-behavior", entityIds:[稳定对象ID], script, sha256}`；
entityIds 必须是 1..16 个已存在对象，一个对象只能归属一个 entity-behavior。脚本路径和哈希
规则与上述相同。它不是预置玩法，奖励、计时和状态机必须由本次普通源码实现。

除了 configure(world, declaration)、on_entity_interacted(entityId)、snapshot()、
validate_state(state)、restore(state)，entity-behavior 必须实现纯读取的
`project_entities(state)`，返回恰好每个声明 entityId 对应的 `{visible:bool, solid:bool}`。
该投影用于恢复前的玩家碰撞验证；不得在投影中改变世界或状态。restore 后真实节点的可见与
碰撞必须与投影一致，否则恢复失败并还原先前状态。snapshot/validate/restore 保存自定义数据，
不能用 configure 默认覆盖已保存进度。计时可用普通 Node `_process`/`_physics_process`，继承世界暂停。

树和石头只有注册了 entity-behavior 才接收真实 E 交互；on_entity_interacted 仅收到自己 entityIds
中的对象。`world.set_entity_presence(id, visible, solid)` 更新节点可见性与真实 Body 碰撞，
不删除实体身份；在物理信号回调中应延后调用，避免引擎正在刷新查询时改形状。`world.inventory`
是既有背包字典；保持稳定物品 ID、非负整数和既有上限，不覆盖其他奖励。是否发放、发多少、
何时重新可交互都由普通脚本和持久规则状态决定，运行时不内置采集/掉落/重生实现。

运行观察返回实际 `visible`、`solid`、主材质 `color` 与节点 `position`/`scale`；关闭碰撞的对象
不再列入 obstacles。行为规则仍经过真实编译、结果检查、候选采用和保存重开。

## 检查、预览、采用与保留进度

对最新源码身份执行 `godot_build_start`，`mode=check`；用返回 jobId 调
`godot_build_read` 直到确有终态。build 只证明导入编译；check 才运行真实固定断言并产生候选。
`status=passed` 只表示检查通过。造物检查还会返回 `creationApplication`：只有 `status=applied`
表示宿主确认采用；`pending/applying` 表示仍在交接，可以继续读取同一 job；
`manual/failed/cancelled/interrupted/unknown` 不表示世界已改变。读取最多等待 30 秒，总预算不增加。
到达等待上限会返回实际阶段，不要重复启动相同检查，也不要在待采用时宣称愿望已完成。
读取 `godot_candidate_read` 确认 build 身份、sourceStale、断言与可预览状态。
检查失败时根据实际错误修复，不修改冻结断言，不把排队/阻塞解释为成功。

预览和正式采用由产品与主机管理。世界的自动采用授权是主机保存的用户选择；指南和模型
不能设置、伪造或推断授权。以实际采用结果确认，不能只凭源码回执声称世界已经改变。
用 `godot_runtime_state` 的 live 观察确认匹配 build/instance 的实体、玩家目标与实际进度；
旧存档快照不等于当前运行状态。通过有界 walk/look/interact/wait 控制与观察检查行为，
随后保存、重开，确认宝箱奖励、门、规则与玩家进度仍一致。

运行时进度格式是 `craftmine.creation-progress/1`，外层是完整
`craftmine.godot-progress/1`。body 包含 worldId、baseVersion、player、timeOfDay、
sourceTimeOfDay、inventory、openedChests、doors、rules。player.position 是胶囊中心；
观察中的 playerBounds.position 是脚底位置。实体 position 同样是物件底部，不是包围盒中心。

旧 inventory、已开宝箱账本、门和规则状态保留；新增门/规则默认必须来自真实候选的 fresh
capture，再由主机合并。runtime 严格拒绝缺失新默认的直接恢复；若最新玩家胶囊与候选实体重叠，恢复会在改变
任何进度前拒绝，不能把玩家静默推走。已开门的门洞按实际待恢复状态允许通过。源码默认时间改变时，主机
更新 timeOfDay 和 sourceTimeOfDay；默认未变则保留玩家当前时间。宝箱按稳定 ID 只发一次奖励，
删除后重放同一 ID 也不能再次领取。受规则管理的门不能直接互动绕过规则。

无额外权限：引用、示例与指南不授予文件系统、网络、发布、采用或验证权限。
证据范围见目录 provenance 与实际检查记录；不能据此声称经过真实模型效率对照测试。
