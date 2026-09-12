# GU2 静态工程关系查询增量

基于集成提交 `e4f8504f`，本切片只修改 `godot-query.cjs`、查询测试与本说明。沿用现有 scene/resources/scripts/summary 模式和参数，不新增工具或 schema 字段，也不加载引擎、执行脚本或调用模型。

## 先复现的缺口

使用原解析器构造一个 root、同父两个 Door、Door/Button 与信号连接，实际看到 Button 无警告地挂在最后一个 Door 上。它是按 path 的 Map 覆盖造成的，并没有解析依据来判断应选哪个 Door。

同一轮纯解析还观察到：

- 继承场景根只有 instance 路径，没有说明继承内容是否展开。
- signal 连接只有原始 from/to 字符串，没有定位到声明节点或未展开实例的提示。
- 注释 `# preload("res://not-a-dependency.tres")` 与字符串内的 `load(...)` 都被误收为依赖。
- InputMap 只返回动作名字，没有多行定义和脚本字面动作名的关联。

这些复现只运行原纯解析函数，没有通过引擎运行证明故障玩法。

## scene 模式

新节点视图携带完整序列化 path（根为 `.`），同名但不同父路径保持可区分。先建立声明索引再关联父节点，因此声明在子节点之后的父节点也能关联。重复完整路径产生 AMBIGUOUS_NODE_PATH；子节点的父路径不唯一时进入 detached，并保留警告，不能选择最后一个声明。

多 root 文件同样是歧义。历史测试此前把 child 自动归给首个 root；本次改为保留两个 root 并将 child 留在 detached，防止把人为选择变成事实。

新增：

- instances：区分根 instance 引用的 scene-inheritance 与普通 scene-instance，保留资源 ID、path、声明行，contents 固定 not-expanded。
- connectionRefs：from/to 对应本文件声明路径、行号、声明 type/script；重复路径为 ambiguous，没有本文件声明为 unknown。若可能属于继承根或某个已声明实例，附 possibleInstanceSources，明确 inherited/instanced content 未展开。methodResolution 和 runtimeConnection 始终 unknown。
- subResources/resourceLinks：列出子资源声明，以及单行属性值中的明确 ExtResource/SubResource 引用、owner/property/line、唯一/重复/缺失 ID 状态。
- extResources、instances、外部 property links 与直接声明的连接端点 script 可关联同一 manifest 的目标文件 SHA-256。

analysisScope 明确为 serialized-source-declarations；runtimeTree=unknown、inheritedContentsExpanded=false、dynamicNodesEvaluated=false。这里的 tree 是本文件的声明关系，不是引擎展开后的实际树。没有递归读取/合并 base.tscn、实例内容或动态 add_child 结果。

scene 现在先读取带 pin 的 manifest，以文件 SHA-256 校验目标 scene 的返回内容。引用目标只查这个 manifest，不产生新的文件读取或执行权限。

## resources 模式

保持按文件分页、跳过超出 read cap 的资源文件。新增子资源和属性引用关系，明确资源对象/子资源 owner。外部 shader、script、material 等引用只关联 manifest path/hash，不执行资源加载，不推断继承属性或加载成功。

注释或字符串中的资源引用不再成为 scriptResourceIds。重复 ID 保持 ambiguous。属性引用解析目前覆盖单行完整 literal calls，不能完整解释多行嵌套 Variant、资源循环或 import 派生文件；analysisScope.relationsComplete=false 明示边界。

## scripts 与 InputMap

词法遮罩保留源码 offset/行号，排除注释、普通字符串与三引号文本中的伪类/函数/load/Input 调用。它不是完整 GDScript AST。顶层 extends 的引用可关联同一 manifest；inner class 的 extends 不覆盖顶层继承。不能确定的字符串转义、动态 load 参数保持 unknown 列表，不猜目标路径。

preloads/runtimeLoads 保留已明确的字面 path，新增 sourceReference。脚本中动态 add_child、实例化、动态 signal connect 与运行时加载是否真的发生仍 unknown。

以下 Input/InputMap 字面调用可记录 action name、method、argument、line：is_action_pressed、is_action_just_pressed、is_action_just_released、get_action_strength、get_action_raw_strength、get_axis、get_vector、has_action、action_get_events、action_get_deadzone。动态参数放入 dynamicInputCalls，不将变量名当动作名。

summary 新增 inputActionDefinitions，保留多行 project.godot `[input]` 的 raw、line/endLine、字面 deadzone 和 Object(InputEvent...) 类型。eventValues 为 unparsed-serialized-data，runtimeBinding 为 unknown；本切片不解释每个物理按键或手柄轴，不发送任何输入。

scripts 页面包含字面 Input 引用时，最多额外读取一次同 pin 的 project.godot，并核对 manifest 文件 hash：

- 唯一完整配置声明：projectSettings.status=declared。
- 未在 project.godot 声明：not-in-project-settings，明确引擎默认动作或运行时注册情况未知，不能说动作不存在。
- 配置文件缺失、被 cap 截断或声明不完整：unknown。
- 重复配置键产生 warning，不能当成唯一完整声明。

settingsSource 和每个 Input 引用保留实际配置文件 hash。读到旧 pin 时仍使用旧配置，不能混入当前 head。

## 版本、分页与完整性口径

沿用 revision/manifestHash 的成对 pin、续页强制 pin、每页身份检查、manifest SHA 校验、读取字符 cap 和 scripts/resources 文件分页。所有查询仍只经 godotProject.index/read，来源为 static-source，数据为 untrusted-project-data。

sourceReference 的 `manifest-entry` 仅证明目标 path/hash 在当前源码 manifest 内，contentsRead=false；不证明资源已经导入、实例化或可运行。UID 引用、非规范 res 路径保持 unknown。规范 res 路径不在 manifest 时写 not-in-source-manifest，明确生成导入文件、引擎默认资源和运行时来源尚未确定。

旧顶层 complete/pageComplete 沿用“本次文件/字节页是否读完”的语义；不能拿它证明完整依赖闭包或真实运行树。新的 analysisScope 和 runtimeBinding 明确指出尚未解释的范围。

## 验证

```powershell
node --test tests/godot-agent/query-relations.test.mjs tests/godot-agent/query-continuation.test.mjs tests/godot-remaining/L/query.test.mjs tests/godot-remaining/L/broker-contract.test.mjs
$env:CRAFTMINE_CORE_BIN='D:/cm-agent-godot-0912/vendor/pi-desktop/target/release/craftmine-core.exe'
node --test tests/godot-agent/query-core.test.mjs
```

第一组 50 项覆盖继承/实例、节点重名/重复路径、连接端点、资源引用、注释/字符串伪依赖、InputMap、多页 pin、截断、身份/hash 错配和真实 broker 路由。

第二组 1 项使用明确的真实 Rust 核心，仅在新临时数据目录创建测试世界与源码。核心文件 SHA-256 为 `3341edbeb1d15c36621b6db9c594b626b45e4f608f84d3f40504f96ebf4a24e8`；测试输出记录 binary 路径/hash 与隔离目录。它验证真实 source store 的 scene/resources/InputMap 关联，以及 head 删除动作声明后：旧 pin 仍返回原声明，新 head 显示未在 settings 声明。没有运行 Godot、模型、浏览器或真实键鼠，也没有访问玩家 profile。

真实 store 通过不代表继承场景展开或实际 InputMap 游玩通过；这些仍是下一阶段运行证据的工作。
