# 内置可玩宠物源码包

## 范围与合同

新增 `cw.module.pet-companion@1`，类型为既有 `module`，沿 `craftmine.resource/1`、`craftmine.package/1` 和普通源码安装事务交付。资源库原有 18 个 v1 包不改字节；测试保存了本轮改动前的全部 ZIP SHA-256，防止同版本静默换包。

这是行为与视觉自包含的一个资源，不把两份 GLB 单独登记为可玩成功。包内包括宠物脚本及独立 UID、一个薄 `CharacterBody3D` 场景、两份最终原创犬 GLB、各自禁用导入 LOD 的配置和 MIT 许可。场景只明确绑定既定 `res://addons/cw.module.pet-companion/` 路径；没有通用字符串重写，也不引入外部下载或额外输入动作。

两份视觉源来自 `2c17f2e1`：小狗 SHA-256 为 `2bbaba864551620b8b5029476a26e92b138c52e7cfec2c4f20d350c18f720723`，白色博美为 `bde68ac018214c1af54c77f24b292ba77e80d4c74d5bc86debf39130cfd66fd6`。包装前与视觉清单逐字节核对；既不重新生成模型，也不将过程版哈希当作最终资源。

`sceneInstall` 声明单个 `pet` 身份，正常安装器为每次安装映射独立 `entity_id`。两次安装共享只读源码资源，根实例身份独立。调整已有根节点的 `appearance_key` 使用同一身份；状态合同声明 `craftmine.pet-companion-state/1`、`settings`、`sourceSettings`、位置、朝向和互动次数。实际迁移与回滚由受保护组件注册表负责，包本身不直接写进度。

安装前要求世界源码精确匹配冻结构建中的三份文件：

| 世界项目路径 | 构建源码 |
| --- | --- |
| `craftmine_shared/component_state.gd` | `desktop/godot/shared/component_state.gd` |
| `craftmine_shared/base_adapter.gd` | `desktop/godot/shared/adapters/creation-sandbox.gd` |
| `craftmine_shared/runtime_bridge.gd` | `desktop/godot/shared/runtime_bridge.gd` |

这些要求进入包的不可变内容哈希，由正常安装器逐项对比世界源码。旧世界不能绕过升级直接装入缺少状态支持的宠物。模块的首版说明明确为平地跟随、近距离抚摸；不承诺寻路、战斗、驾驶或蒙皮拾取。

## 验证边界

包装测试覆盖 ZIP 往返、两犬原始字节、资源自包含、真实托管路径与哈希、破损资源和非标准导入配置拒绝、两个场景根身份、构建确定性及旧 18 包字节不变。

`tests/builtin-source-library-install-native.mjs` 沿实际 Rust `package.planInstall` 和源码事务安装全部资源，并再次安装宠物检查独立实例 ID。测试准备三份真实托管源码，结束核对其未被安装改写。该测试故意不注册引擎执行器，检查任务应停在 `source-saved-check-blocked`；不把这个结果称为引擎检查、采用、游玩或保存验收。

本轮不启动玩家档案、产品窗口或模型。最终真实宠物行为、换外观后的进度继承、实际截图与冷重开由总控集成验收另行记录。

## 已执行的包装预检

- `node --test tests/builtin-pet-package.test.mjs tests/builtin-source-library.test.mjs`：12 项通过。
- 完整 19 包构建共 357152 字节；原 18 个 ZIP 与改动前逐项 SHA-256 一致。
- 使用总控从 `b9b79529` 编译的真实 debug core，执行完整源码安装驱动：19 包及第二只宠物，共 20 次正常事务通过；错误 runtime 要求拒绝且源码未变。
- 报告：`D:/cm-pet-source-package-0912/test-results/builtin-install-pjEYQ6/report.json`。该轮宠物 ZIP SHA-256 为 `56fab71d15274813d576cb879442ca4f8fc7c5dff22c00c27f7f4ab406ae3a06`，使用状态 `ea214236`、行为 `f1f3da44`、视觉 `2c17f2e1`。

这一完整安装预检发生在“互动 HUD 反馈、无效配置早注册”后续修正之前，不是最终 Windows 成品证明。后续源码冻结后重新构建，并可用同一驱动的 `--asset cw.module.pet-companion` 仅重验该包两次安装与拒绝用例；无需重复其余 18 包的真实安装。

## 最后小修后的聚焦复验

已纳入行为 `4a22cd5b` 与 HUD 适配器 `db0a42ea`，并确认隔离树的宠物脚本及三份运行要求文件 SHA-256 与总控树一致。重新执行上述 12 项测试全过，旧 18 个 ZIP 仍不变。

最终本轮库共 19 包、357213 字节。宠物包 51913 字节，ZIP SHA-256：`f0fc1963e80e00d94548b6270dc42fdf153045957f0cf62d424d1ba7a711dd7b`；资源内容哈希：`c79d24583de1084c25a9fd4966025441b207d192d766d888a009f8314578bd73`。

使用总控重新编译的 debug core，运行：

```powershell
node tests/builtin-source-library-install-native.mjs D:/cm-source-adoption-baseline-0912/test-results/source-adoption-cargo/debug/craftmine-core.exe D:/cm-pet-source-package-0912/test-results/builtin-playable-pet-final --asset cw.module.pet-companion
```

两次宠物安装生成不同实例，8 个实际包文件通过读取与哈希检查；不兼容运行代码要求仍被拒绝、源码不变；世界正式内容与进度不变。报告 `D:/cm-pet-source-package-0912/test-results/builtin-install-SrOZ5B/report.json`，SHA-256 为 `dfdeb13300547e4ae46e1a981385d544980d93715ca0407f8786b1781dd8e79a`。core SHA-256 为 `fe197502292904b7c308d9e9447493a1f745fccfd23cb7dbc52e26e9144ee590`。

本结果仍是零模型、零引擎、零窗口的源码事务预检，不代替总控的实际组件行为与成品测试。
