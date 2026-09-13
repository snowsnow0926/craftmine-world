# 造物世界直接编辑与操作级撤销

玩家在已有会话中固定指向后，可打开对象属性，调整 X/Y/Z 尺寸与颜色，明确提交“检查并应用”或“删除对象”。取消只关闭草稿属性，不发送写请求。输入范围保持既有契约：尺寸各轴 0.25–4、颜色六位 RGB。

## 宿主边界

渲染器只提交 sessionId、captureId、operationId、操作和有界参数。worldId、目标 ID、构建、运行实例、源码 revision/hash 均由宿主捕获与当前源码索引提供。直接操作开启持久宿主任务，执行现有 creation_operation、godot_build_start check、要求验收与 candidate 采用流程；不调用模型，不直接改正式存档。完成、失败通过同一任务状态面板显示。

## 删除与撤销

creation_operation 新增 delete(targetId)、undo(undoOperationId)。新操作日志附带最小 before/after 实体集合，而非世界存档。支持放置、修改、复制、删除的撤销；环境/规则和撤销本身不生成逆操作。旧日志可继续重放，无 inverse 的旧记录明确不支持操作级撤销。

撤销要求目标操作未被撤销，当前受影响实体必须与记录的 after 完全一致；再逐个验证 before 的字段、占位与玩家碰撞。逆操作保留原实体 ID，createdIds 为空，并生成新的回执和源码 CAS。原有背包、玩家位置、已领奖宝箱、门与规则历史不属于补丁，按现有候选进度保护链保留。

任何删除类操作遇到世界内 authored rules 均拒绝：声明外的普通脚本也可能引用该对象，当前没有可信依赖声明可证明无引用。显示明确冲突提示，而非偷偷删规则。撤销修改仍可在不删除实体时执行。

选中对象由真实引擎射线决定，显示金色边框和中文名称。观察的 position/scale 来自真实节点，不能用旧源码声明冒充运行结果。


## 通用对象行为

场景规则可声明 entity-behavior，包含 id、kind、entityIds、script、sha256。一个规则引用 1..16 个已存在对象，一个对象只能属于一个 entity-behavior。固定脚本路径和实际源码哈希仍强制校验。普通脚本自行实现行为，没有内置掉落或重生逻辑。

树/石头只有注册行为后才接受 E 互动；事件只交给声明该对象的规则。set_entity_presence 同时更新可见性与碰撞，observe 读取实际 visible/solid，不把关闭碰撞的对象加入 obstacles。

entity-behavior 必需提供纯读 project_entities(state)，返回每个 entityId 的 visible/solid。恢复前按投影检查玩家碰撞；恢复后真实节点必须匹配投影，不匹配则回滚到原 snapshot 和原实体 presence。保持既有通用 rules 进度字典和严格状态校验，不增加无法兼容的顶层进度字段。任何规则存在时删除类操作仍保守拒绝。


## 直接编辑状态恢复

宿主对每个 operationId 先持久保存指纹和阶段，再开始任务；后续阶段以临时文件原子替换。此文件只是操作进展，正式源码、任务和采用仍以 core 为准。重启读取未终态记录时标记 interrupted，保留 jobId/候选/原回执用于核对，不自动重放任何写入。新 renderer owner 必须经宿主当前 session/world 验证后才可重绑定读取；阶段落盘失败不可显示已采用，应返回待核对。

编辑属性从同次宿主射线命中的真实实体采样透传；缺少真实尺寸/颜色时不开放参数编辑。UI状态以session和world共同分区，提交前立即保留唯一操作编号并进入忙碌状态，回复丢失查询同一个编号；结果不明时只提供重新读取原操作状态，不能再次产生新操作。晚到的起始回复不得把已采用结果改回检查中。


## 实际导出包中的采样边界

源码PIN以外，creation-sandbox的生产Web执行器在暂存候选前独立读取index.pck实际字节。只接受当前固定Godot4.7.2生成的未加密独立PCK v4；目录、路径别名、文件范围、MD5、受保护base_adapter/runtime_bridge/state_guard的SHA-256均验证。预期SHA来自core已验证的claim.files，不能用导出后被修改的工作副本重新计算“预期”。

实际project.binary采用ECFG长度有界读取，只解析autoload/CraftmineRuntime和craftmine/runtime/adapter两个字符串入口并要求固定值。拒绝重复key、平台后缀覆盖、受保护脚本remap/gdc别名及override.cfg。正常无关配置Variant只按明确长度跳过，不执行、不反序列化对象。核验结果写执行器耐久ledger，不改core结果协议。失败候选不会进入运行验收或采用。

这封闭了已复现的@tool导出期间篡改保护脚本和入口的缺口；不宣称对任意恶意GDScript进行了形式化证明。


## 通用只读工具的Godot分流

project_inspect与capabilities_read按真实绑定世界的runtimeKind/场景合同分流。Godot必须返回godotProject.index文件、源码身份及适用Godot能力，不将craftmine.godot-scene/1送入体素对象升级/素材遍历。缺少工程明确不可用；权限和身份错误继续失败。legacy保留旧资源与schema。响应提供runtimeKind、baseId、sourceRevision/manifestHash和nextTools，正文支持有界Unicode分页；当前world/panel变化不能重定向已绑定任务。

## Stock object placement preview and transforms (2026-09-14)

The existing PI Desktop object editor exposes position, yaw, 0.5-unit axis nudges
and 15-degree rotation alongside scale and color. Values start from the same
observed entity's origin and yaw; the ray's surface hit point is never substituted
for an entity origin. A ground capture may submit an explicit bounded placement
transform. Position bounds are X/Z -28..28, Y 0..16; yaw is -180..180 degrees.
The existing compiler additionally validates occupied space, world bounds and
player collision. Modify, placement and undo retain the existing source CAS,
normal check, actual observation requirements and candidate adoption. Yaw is
verified modulo 360 in both Electron and Rust; untouched observed yaw is preserved.

**Preview placement** explicitly opens an engine-rendered translucent ghost.
Subsequent field changes debounce by 180 ms; they run no model, task, source patch,
export or build. Valid preview is cyan and obstructed preview is red. The preview
is an advisory shape/placement view; the final source check remains authoritative.
It supports the five fixed stock generators (tree, rock, chest, door, marker).
Arbitrary imported scenes, authored generator replacements and scripted components
are not represented by a substitute mesh.

Main validates the owner/session capture, selected formal source and runtime
instance before and after dispatch. The private `godot.creationPreview` route
cannot be reached through the general runtime-command route. The runtime verifies
its scope, paused state and actual loaded stock generator source bytes. Placement
uses the same generator on a detached holder that never enters the scene tree;
modification clones the selected object's actual meshes. Only script-free mesh
instances enter the ghost, bounded to 128 visited nodes and depth 16. Ghosts have
no collision bodies, shadows or entity-map membership. Live physics tests the
proposed volume, excluding only the modified object's own body.

Cancel, panel/capture/session change, explicit edit submission and a 60-second
inactivity expiry clear the ghost. Save, snapshot, restore, resume, exit and
observation clear it inside the engine before reading or changing authoritative
state. A retired host preview ID cannot be resurrected by a late update. Preview
pauses gameplay and releases engine input actions; returning to play uses the
existing Resume action. Preview cancellation never replays an edit.

The preceding engine bridge is retained as exact LF/CRLF source pins. Existing
worlds remain readable; the existing explicit observer-update action upgrades
only the bridge through a source CAS/check/adoption, retaining unrelated authored
files and progress. If an old picker also needs its independent update, it is
adopted first and the next capture offers the preview update. Unknown/mixed source
cohorts never gain this maintenance authority.
