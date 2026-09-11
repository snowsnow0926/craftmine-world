# GU3 / GA08 / GU6：导入模块的独立参数持久化审计

审计代码基线：a9b4c0e299c7a40f88c4e004f02a9fe658016159。
本交付只增加测试、证据和方案；没有生产修改，没有运行玩家模型。

## 结论

现有普通 Godot 源码链已经能承载持久化的实例属性修改：读取准确父场景，
在选中实例的节点块中写入局部属性，再走 patch → check → candidate →
preview/apply → cold open。无需增加安装 registry 或参数 DSL。

尚未完成的是把导入模块的现场引用可靠地转换成“这个源码实例的这些可编辑
属性”，以及验证改动确实只作用于它并在成品冷开后保留。现有 configure 调用
只改变运行实例，不能作为保存实现。已有两实例运行参数隔离测试不能替代这项验收。

## 当前行为与实际负例

使用之前正式安装并冷开通过的关闭测试 profile 的源提交
a446aa197dc7b0bd20929f8fb82e584d90157f6e，只读复制到独立项目。其 building wrapper
SHA-256 为 e2341b41e564ddd2b573039aa82f9dbdc9d4637ad4c7e004d527216f3bece4b5，
与本基线发布的 building.zip 内 module.gd 完全一致。

最终归档：docs/evidence/gu3-module-runtime-persistence-20260912/。
report.json 来自 module-persistence-audit-OcJZY0；包含原源文件清单、完整 LPAC
请求和回执、引擎身份、Web 输出及 12 项断言。broker.stdout、task.log 和独立
重读得到的 stage-source-files.json 保留原始核验材料。

| 步骤 | 实测 |
|---|---|
| 加入第二个独立建筑实例 B | A/B 使用同一个 imported Mesh 资源 |
| 对 A configure(250, 1, false, runtime-only-audit) | A 的比例、旋转、solid、label 改变，B 保持默认 |
| 观察 A 的真实 CollisionShape3D | 存在碰撞形状，且全部 disabled |
| 调普通 adapter.capture | snapshot 只有基础存档字段，不含模块参数或测试 label |
| 对同一实例 restore(snapshot) | 返回成功，A 仍保持内存中的临时参数 |
| 删除 A，以同 entity_id 从未改的 module.tscn 重建 | 新 runtime objectId；参数回到 100、0、true、building |
| 再 restore 同一 snapshot | 仍是默认参数，无法恢复之前 configure 的参数 |

12/12 实际断言通过，LPAC receipt/source binding 全量核验通过，原关闭 source HEAD
未变；Web pageErrors/Godot errors 为零，Pointer Lock/focus 请求为零。
这是“运行实例重建”负例，不是本次应用程序冷开，也不是正式玩家或模型验收。
复现 runner 仍明确依赖记录中的关闭测试 source/profile，不读取用户 profile。

## 路径审计

1. scripts/fixtures/kenney-city-module.gd

   @export 已声明 model_scale_percent（25..800）、quarter_turns（0..3）、solid、
   label。configure 校验这四个字段，设置实例变量并 rebuild_geometry；它没有
   FileAccess、ResourceSaver、源事务或存档写回。_ready 根据已加载的属性构造
   Visual 变换和碰撞。label 目前只由 module_state 返回，没有显示名称/UI 行为；
   不能把改 label 宣称为可见重命名。entity_id 不能由 configure 修改。

2. creation-sandbox 的 capture/restore

   desktop/godot/bases/creation-sandbox/scripts/creation_world.gd:415 的 capture
   只保存 player/time/inventory/openedChests/doors/rules。validate_progress 严格
   限制字段，_apply_progress 不恢复外部模块。不能往现有存档强塞 modules 字段。
   同实例 restore 不改变临时模块值，正是容易被误判成“已保存”的原因。

3. 稳定现场引用已存在，但只是源码上下文

   Main scene-object-target.ts 的 readSceneObjectTarget/currentSceneObjectPath
   把引用标记为 identityScope=runtime-instance、sourceUse=context-only。
   creation-target-service.ts 验证 world/build/instance/source pin、当前 weakref、
   类和源码路径；普通 sceneObjectTarget 会清空结构化 entity target，并关闭
   autoApply、把需求检查标为 SCENE_OBJECT_SOURCE_REVIEW_REQUIRED。
   引用中的 objectId 不是跨冷开的持久实体 ID。

4. 两条专用编辑接口不能直接用于 Kenney

   creation-operations.cjs 的 modify 只查 world/creation.json 的 entities，
   只支持 tree/rock/chest/door/marker。导入 Kenney 实例实际存在于主 .tscn，
   不在该 JSON。真实编译器负例分别返回 CREATION_TARGET_ID_MISMATCH 和
   CREATION_TARGET_REMOVED。

   target-feedback-service.mjs:formal 只接受 first-person 0.1.0；它使用的
   target-feedback-configuration.mjs 还绑定训练靶/世界/profile 的已知脚本，
   只改 hitFlashMilliseconds。真实 describe 路由对 creation-sandbox 在读取
   formal identity 时已拒绝，尚未开始任何写入。

5. 普通源接口可以使用

   godot-query.cjs 的 script 查询提供导出字段类型和 annotation；scene 查询/
   source read 可读取主场景的准确节点块。world-tools.cjs 的 godot_project_patch
   已绑定任务 context、world、revision/manifestHash、Git branch/head 和
   expectedHash；它只改源码。继续使用 godot_build_start(check)、原 candidate
   预览/应用与存档兼容过程即可。

## 最小源码局部 override 方案

第一切片先只处理已审计 Kenney wrapper 的四个现有 export 标量，不增加运行状态
写接口，也不把导入对象硬塞进原生 creation.entities。

1. 从现有冻结 capture 取得现场节点/祖先和 source pin，复核 live reference。
   用 parseScene 读取 run/main_scene 所指的父场景，找到唯一 instance 节点，
   解析其 PackedScene 引用。把其显式 entity_id 与已有
   craftmine.instances.json 的 entityMap、installPath、asset/contentHash 对齐。
   再验证对应 wrapper/scene/source 文件身份。不能靠显示名或临时 objectId
   猜持久对象；遇到重复 ID、动态节点、复杂 inherited/嵌套覆盖则明确 unsupported。

2. 只替换该父场景节点块的 literal 值。例如已安装 A 当前有：

   ```ini
   [node name="ins-...-e0" parent="." instance=ExtResource("4_module")]
   entity_id = "ins-...-e0"
   label = "building"
   model_scale_percent = 100
   quarter_turns = 0
   solid = true
   ```

   本次修改仅将这里的四项值变成 250、1、false、所需 label。保留 entity_id、
   节点路径、PackedScene、共享 module.gd/module.tscn、GLB、纹理和另一实例块。
   使用既有 parseScene 的 literal 子集和 target-feedback-configuration 的
   “读值→绑定→单节点 patch→重新解析核对”方式；不执行 configure，不在宿主
   执行项目脚本，不用正则全文件替换同名属性。

3. 对父场景提交正常 godotProject.patch/applyFiles 源事务；复用既有操作身份、
   expectedHash、head/ref 检查和丢回执恢复。得到新 source pin 后启动正常 check。
   通过后人工/普通产品授权预览并应用。世界存档的 player/inventory 等走原
   progress contract；模块创作配置来自新场景源码，不需要扩充 progress schema。

4. 输出明确影响摘要：A 四项 before/after，改动的父场景路径、source pin，
   未修改的同级实例和共享资源哈希。不能仅输出“configure 返回 ok”。

根节点 position/rotation/scale 也应作为父场景局部 Godot 属性写入；它们与
model_scale_percent/quarter_turns 的 Visual 局部变换是两层不同含义，不能同时
重复施加。首个切片可先排除根 transform，或明确用既有 Node3D 属性表达并补
实际几何/碰撞验收；无需发明 transform DSL。

## 还需要属性 capture 或类型保全吗

**证明单实例源码持久化不必先建新接口。** 当前 source query/read/patch 足够
完成上述受审计的一次修改。已有 CP0 的 resource manifest 已包含
content.interfaces.parameters（四项类型/范围）和 sceneInstall.exports 默认值。
不是缺少参数声明格式，也不是缺少 Godot 保存能力。

**产品级类型化编辑仍有两个独立缺口。**

- 目前没有通用的“sceneObjectRef → owning scene node → 有效局部值/继承默认值”
  source property capture/patch 契约。只读 parseScript.exports 列出名称、类型、
  annotation，不能单独证明有效默认值、setter 行为或编辑范围。可在既有源码
  操作层增加已知模块的受限 handler，复用 CP0 parameters 和已有源事务；不要
  直接放宽旧 creation_operation 的五类实体规则或训练靶的校验。
- 参数类型描述尚未完整保全：draft_install.mjs 的 craftmine.instances.json
  只存 instance/ref/path/entityMap/localOverrides；asset lock 也不存 interfaces。
  godot-package-source.mjs 当前重新导出时构造 interfaces:{}。因此冷开/第二次
  导出后不能假装已恢复原包类型契约。已知 wrapper 第一切片可用已审计脚本
  hash/固定四参数规则作为明确支持范围；通用后续应保留原有 CP interfaces 的
  来源绑定，并让 exporter 往返保全同一声明（必要时作为明确引用的受管理源
  metadata 文件），不能推断或新建平行安装 registry。

GA08 的共享材质编辑仍未覆盖：这四个参数不改共享材质。未来“只改 A 的颜色”
必须选择实例 material override 或实例本地资源；编辑共用 material/GLB 属于
影响所有引用者的另一种作用域，需要明确意图和单独验收。

## 必须完成的正式验收

- 使用正式 package/request 安装两个独立建筑；将它们放开，验证各自命中和
  entityMap，不以默认重叠场景判断选择能力。
- 冻结 A 的真实 capture，正常源事务只改 A 的四项属性。检查源 diff 只有对应
  父节点；B 的声明、显式 ID、共享 wrapper/scene/GLB/纹理哈希全部保持。
- 普通真实 check 在新 source pin 上验证：A 的实际字段、Visual scale/rotation、
  碰撞 disable/enable 和真实射线结果；B 仍为旧值。不能只相信项目自报
  module_state，也不能拿 source grep 替代引擎行为。
- 应用候选，保存正常进度并干净退出。独立 profile 冷开后从新场景重建 A/B，
  重新取得 runtime objectId，通过显式 source entity identity 验证 A 保留参数、
  B 未变，原 player/inventory/progress 按契约保留。
- 回执丢失原操作重试不重复写；source head、父节点、entityId、脚本 hash 或
  runtime instance 变化后拒绝旧 capture。未知 setter、越界值、恶意字符串及
  写 identity/共享文件请求拒绝或走明确普通审查。
- 对比例、solid 或位置改变补“保存玩家位置与新真实碰撞冲突”负例。当前基础
  validate_progress 的 overlap 主要枚举原生 entities，不能据此推断导入模块的
  几何兼容性已经被覆盖。相同 snapshot 成功恢复不足以证明玩家不会陷入新建筑。
- 如包含共享材质，另验证 A 的局部 override 与 B 保持不变；若明确选择共享编辑，
  则所有受影响实例按约定改变。四标量持久化通过不等于 GA08 材质部分完成。

## 复现

`node tests/godot-agent/module-runtime-persistence-audit.mjs` 使用固定已验证 LPAC
broker、4.7.2 headless Web export 和独立 Chromium profile。需要 runner 中记录
的关闭正式测试 source repository。没有用户输入、焦点操作、Pointer Lock 或
模型调用。普通局部 export 超时通过 broker cancel，不增加玩家整轮时限。

`node --test tests/godot-agent/module-runtime-persistence-evidence.test.mjs` 无需
引擎：复核 12 项原始断言、完整请求与独立 stage 清单、日志 hash、fixture、
当前发行 ZIP 的 wrapper hash，以及两条现有专用接口的真实拒绝分支。
