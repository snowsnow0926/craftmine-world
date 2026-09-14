# 成品包视觉编辑与城市模板导入验收

本记录补齐验收入口。此前 `desktop-native-rt-wzajjh` 验证的是已构建的源码客户端；本次新增代码尚未运行最终成品包，不以纯逻辑测试替代原生验收。

## 成品包启动参数

`--packaged-root` 指向直接包含 `Craftmine World.exe` 的目录。例如交付包中的 `output/win-unpacked`，或解压得到的对应目录。第二个位置参数必须指向这个目录的 `resources`。驱动现在拒绝使用源码构建目录覆盖成品包资源。

在本工作树执行以下 PowerShell 命令，把 `$packageDir` 换成总控给出的最终包路径：

```powershell
$checkout = 'D:/Craftmine Worktrees/product-completion-20260914'
$packageDir = '<包含 Craftmine World.exe 的最终包绝对路径>'
$env:CRAFTMINE_CREATION_OUTPUT_ROOT = 'D:/cm-final-visual/test-results'
node tests/first-creation-roundtrip-native.mjs $checkout "$packageDir/resources" --packaged-root $packageDir --visual-edit
```

如果环境里已经设置 `CRAFTMINE_PACKAGED_ROOT`，它必须与参数一致。成品模式直接运行包内 EXE，并强制使用包内 `resources/bin` 的 Core/Host；不需要指定源码 Electron、Core、Host。工作目录使用实际成品目录。首个 checkout 参数仍用于定位本机验收辅助依赖，实际应用代码从包内 `app.asar` 读取并记录哈希。

验收启动独立后台 offscreen 进程、独立 profile 和随机 loopback 调试端口。仅调用真实页面表单、React 处理器和受世界/build/instance 限定的原生接口。禁止真实鼠标、键盘、激活窗口、Pointer Lock。开始和结束记录完整包文件清单；任何退出、包完整性或主流程错误都会使 `passed=false`。

## 指定 AI 城市模板

新增参数 `--import-template ABS_ZIP --expected-state ABS_JSON` 与 `--visual-edit`、恢复/截图诊断模式互斥。流程为：

1. 对原始 ZIP 校验预期 SHA256，复制字节到独立 profile 的普通文件选择器输入目录。
2. 确认世界列表为空，通过 PI「我的模板」导入和创建表单创建世界。
3. 读取真实 snapshot 与 observation，检查声明的库存、任务、组件和城市数据。
4. 使用当前实例的普通行走接口完成一段游玩，确认玩家位置实际变化。
5. 使用普通 `godot.runtimeSave(freeze:true)` 保存，正常退出进程。
6. 冷启动并通过世界列表打开同一世界，要求新原生实例、同一 build，比较保存前后完整 `craftmine.godot-progress/1`。不忽略玩家、库存、组件或新增存档字段。
7. 再检查声明数据、保存原生截图、确认没有模型调用，并核对原 ZIP 和成品包未变化。

```powershell
$env:CRAFTMINE_CREATION_OUTPUT_ROOT = 'D:/cm-final-city-import/test-results'
node tests/first-creation-roundtrip-native.mjs $checkout "$packageDir/resources" --packaged-root $packageDir --import-template '<城市 ZIP 绝对路径>' --expected-state '<预期 JSON 绝对路径>'
```

`--expected-state` 仅用于读取与比较，绝不传入 `restore-state`，也不直接改写存档。测试不会生成模型、补任务物品或添加缺失实体。一次步行验收不能证明已经重做飞行任务，也不能证明持续无暂停操作的性能。

## 从实际回执冻结预期

```powershell
node tests/build-city-template-expectations.mjs '<ZIP>' '<实际 snapshot 回执 JSON>' '<实际 observation 回执 JSON>' '<新建预期 JSON>'
```

全部参数必须是绝对路径；输出文件必须不存在。生成器只读取 ZIP 与回执，输出包含三者身份依据的新 JSON；原文件保持原样。城市固定检查 `payload.city.districts=6`、`authoredBuildings=22`。实际城市的 stock `creation.entities` 为空，因此飞机/博美身份按真实 `flightPreparation.aircraftId`、`companionId` 对照存档组件的 `entityId/format`，不伪造 stock 编辑对象。

任务物品为 `org-flight-chart`、`org-flight-clearance`、`org-flight-compass`。只有真实回执中的 0/3 或 3/3 可作为对应预期：默认模板应使用默认态回执；包含已完成进度的模板应使用完成态回执。不得把完成态库存清零后声称获得默认态证据。两种情况都同时核对 inventory 和 observation 中的 collected/required/objectiveComplete。

已冻结的完成态参考：

- `D:/cm-product-agent/test-results/desktop-native-product-5N6HZ2/responses/play-102.json`：`result.state.body`。
- 同目录 `play-104.json`：`result.observation`。
- 这对回执包含完成 3/3、飞机 `hasFlown=true`、`landings=1`、`piloted=false`、`crashed=false`，及博美交互/跟随设置。后续天气轮的实时 `status.json` 不属于此冻结证据。

预期 JSON 格式为 `craftmine.template-import-expectations/1`，含精确 `archiveSha256`、世界 `title` 和 `checks`。每条检查含唯一 `id`、`source`（snapshot/observation）、RFC6901 `pointer`、明确 `value`；可为数字显式指定 `tolerance`。不存在的路径失败，字符串不会转换成数字。声明 `city` 时必须同时声明上述任务和飞机/博美身份及关键状态。生成器自动填充真实库存/门/箱/规则、飞机飞行结果与配置、博美交互与配置；天气或其他新增字段需要以对应真实冻结回执为依据添加指针检查。

`checks` 是导入、保存和冷开均需成立的稳定事实。玩家位置和组件动态位置由保存后完整状态比较验证；不要把旧 snapshot 的玩家位置当成行走后仍需成立的固定值。

## 本次准备验证

`node --test tests/template-import-expectations.test.mjs`：7 项纯逻辑检查，覆盖 missing/null、JSON pointer 转义、来源与 SHA 限定、数值容差、0/3 与 3/3 区分、库存/城市/飞行/实体错误、禁止成品引用外部资源。

`node --check` 检查主驱动和预期生成器语法。最终 ZIP 对应的原生导入与最终成品包视觉编辑，等待总控冻结实际交付包并释放 GPU 后另行运行和保存报告。
