# 沉浸式造物世界：物件操作与普通源码玩法

指导 ID：`creation-sandbox.authoring`，版本 `1.0.0`。仅匹配
`creation-sandbox` 底座 `1.0.0`、`creation-sandbox-1.0.0` build 和
Godot `4.7.2-stable`，并检查所列运行时接口的真实文件哈希。

这是按源码整理的接口指南。加载指南或示例不会证明模型首次成功、玩法验收或正式采用。

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

`creationTarget.sourceRevision` 是主机源码事务 revision，等于工具请求
`expected.revision`；`creationTarget.target.revision` 是 `world/creation.json`
内部场景 revision。两者有不同来源，不能互换。`manifestHash`、buildId、instanceId、
worldId 和 snapshotId 必须使用同一个主机捕获；只查文件得到的几何不是这种授权快照。

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
      revision: creationTarget.sourceRevision,
      manifestHash: creationTarget.manifestHash,
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
- `environment`：timeOfDay 为 0..24，通过源码默认时间变更进入候选采用。
- `sequence-door`：为已有门和 2..16 个不同 marker 生成一份普通 GDScript 顺序规则。规则最多 8 个，工具的规则 ID 不可重复使用。

参数按 kind 限定：chest 的 rewardId／rewardCount（1..99），door 的 initiallyOpen，
marker 的 label（最多 80 字符）；树和岩石的 parameters 为空对象。
修改门的 initiallyOpen 是新实例的默认状态，既有门的玩家进度按稳定 ID 保留。

工具写入源码与操作日志，并不等于运行时已采用。重试同一请求使用同一 operationId；
重放冲突时不能用同 ID 换请求内容。源码或目标过期时重新读取主机实际身份，保留别人的修改。

## 新增非预置逻辑：普通源码路径

结构化 action 是常用编辑入口，不是所有玩法的菜单。读取当前 `.gd`、场景和合同后，
可用 `godot_project_patch` 在绑定草稿中增加或修改普通 GDScript。每个 put 都写完整文件，
携带当前 revision、manifestHash 与旧文件 expectedHash；新文件 expectedHash 为 null。
引擎 API 以 `godot_docs` 和当前脚本为准。

当前 creation.json 的规则声明 kind **仅支持 `sequence-door`**，不能凭空写新的 kind。
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

## 检查、预览、采用与保留进度

对最新源码身份执行 `godot_build_start`，`mode=check`；用返回 jobId 调
`godot_build_read` 直到确有终态。build 只证明导入编译；check 才运行真实固定断言并产生候选。
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
capture，再由主机合并。runtime 严格拒绝缺失新默认的直接恢复。源码默认时间改变时，主机
更新 timeOfDay 和 sourceTimeOfDay；默认未变则保留玩家当前时间。宝箱按稳定 ID 只发一次奖励，
删除后重放同一 ID 也不能再次领取。受规则管理的门不能直接互动绕过规则。

无额外权限：引用、示例与指南不授予文件系统、网络、发布、采用或验证权限。
证据范围见目录 provenance 与实际检查记录；不能据此声称经过真实模型效率对照测试。
