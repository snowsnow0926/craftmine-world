# 模块参数查询：真实 Core 与打包工具入口集成测试

入口：tests/godot-agent/module-parameters-core.mjs。

本测试创建独立 data、installer staging 和 source 目录，物化真实 creation-sandbox
基础源码，通过真实 Core 两次安装已归档的 Kenney building.zip，再测试只读参数
查询和普通 source patch。没有注册 executor；两次安装的 check 必须明确记录
source-saved-check-blocked / GODOT_EXECUTION_UNAVAILABLE，不能记为检查通过。

host capture/live reference 是**明确构造的测试替身**，包含真实安装后的 entityMap、
主场景 nodePath 和准确 source pin，但 buildId/instanceId/objectId 是 synthetic。
这用于验证 loader/broker 与真实源事务的兼容性，不证明实际物理选中、玩家操作、
Godot 加载、候选检查、采用或应用程序冷开。

## 两种入口

- 设置 CRAFTMINE_MODULE_PLUGIN_ROOT 为打包插件目录，使用其真实
  world-tools.cjs/createWorldTools → godot_project_query 两个 module mode。
  execute context 含 projectId/sessionId/turnId/toolCallId/executionId。普通提交也
  通过打包 godot_project_patch 工具进行。记录实际 packed 文件 SHA-256。
- 不设置插件目录时，从 CRAFTMINE_MODULE_QUERY_LOADER（默认为当前插件目录）
  读取 loader，复制到此次 test-results，再注入本树 pure helper。测试不提交或
  修改被复制的 loader。此模式用于在宿主集成完成前单独核对接口。

两个模式都使用真实 task.context、完整 Core index 分页与分块 read。仅允许查询
期间调用 task.context/godotProject.index/godotProject.read；任何 workspace.open、
write/build/job 操作立即失败。打包入口同时禁止查询读取 getSettings。

## 有意义的覆盖

- 实际两个 ZIP 安装生成不同 instanceId/entityMap，使用原始受审计资源字节。
- 保留完整基础源码，并增加 40 个惰性 JSON 文件使完整 index 跨越 32 项分页；
  父场景追加无执行行为的注释，使必要文本跨越 16,000 分块。
- 捕获返回真实已安装节点的源码值和绑定；query 只读必要文本，不读取 GLB/PNG。
- 参数 preview 返回父场景的一条普通 patch 建议，applied=false。
- 将建议通过正常 Core source patch 提交；核对 A 四值变化、B 节点块原样，
  所有共享 payload、registry、lock 及其他 source 文件 hash 保持。
- 旧 capture/source pin 和旧 preview binding 均拒绝。
- 实际 Core 进程 stop/start 后重新查询，读取仍为修改后的源码值；同值 label
  preview 必须 operations=[]、changed=false、checkRequired=false，且全程只有
  只读 Core 方法。这是 Core 源存储持久化，不能称为应用程序/游戏冷开验收。
- 原世界 formal build 保持 base-a；没有伪造 candidate 或采用成功记录。

## 运行

指定已交付 Core，例如：

```powershell
$env:CRAFTMINE_CORE_BIN='D:/.../win-unpacked/resources/bin/craftmine-core.exe'
$env:CRAFTMINE_MODULE_PLUGIN_ROOT='D:/.../desktop/build/craftmine.world'
node tests/godot-agent/module-parameters-core.mjs
```

报告位于 test-results/module-parameters-core-*/report.json，包含 Core/插件 SHA、
ZIP 身份、两次完整安装回执、synthetic capture、实际只读调用轨迹、查询/预览结果、
patch 回执和前后完整 source 文件描述表。每次运行使用新目录；没有访问用户 profile、
浏览器、引擎、网络或玩家模型。

首轮 packed 集成 Fv6kIg 的 17 项断言通过；增加 Core 重启及同值 label 后，
第二轮 5bLZy8 的 18 项断言通过，no-op 只有只读调用、没有新源码写入或 job。
最终打包插件的 capability/routing 变更须由集成方重新构建并跑同一测试，不能用
先前测过的文件哈希代表后来的产物。
