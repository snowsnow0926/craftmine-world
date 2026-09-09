# D 接口交接 v1

状态：待 G 集成验收。D 独占范围经 G 扩展包含 `app/world-runtime.mjs`、`app/extension-runtime.mjs`、`app/request-plan.mjs`。

## 1. A 的存档与作品

既有 progress 格式不变。gameplay 对象可选 `cooldown:number`，范围 0–10；缺省 0。`craftmine.behavior-state/2|3` 每个 module record 增加可选 `initialized:boolean` 和 `extensions:{[extensionId]:{version:number,state:JSON对象}}`。扩展状态按行为实例隔离；旧版本不兼容时拒绝迁移。

新建模块 initialized=false；恢复旧模块缺该字段视为 true，防止旧存档重复启动奖励。状态/源码升级保留标记，不能因为 build hash 改变而清零。纯迁移只创建尚未激活的新模块；预览/预检的启动结果不写正式进度，最终激活成功后保存真实 snapshot。

作品：`examples/dispatch-d/garden-training@1.json` 是现有 module/4 creation；oak-tree/wild-flower/thin-grass 是 module/1 object。`training-drain@1.extension.json` 为固定扩展源码；其 targets 是作者本地 ID，**不要为安装实例重写扩展 targets 或源码**。D 的 BehaviorBinding 会将调用与 world 转到本地坐标，内核效果再转回世界。显式共享物品 ID 为 `training-token`，各实例共用同一种币；A 可检查名称/描述冲突，不可任意全文替换源码。

包属于可复现固定示例，origin.time=0 表示示例来源，不能伪装成应用成功或 validated 记忆。A 的真实应用证据捕获和新世界草稿事务尚需联合验收。

## 2. C/G 的选择消息

G/C 发给正式游戏 iframe 的 `craftmine-host/1` load 增加从已加载正式世界取得的 `worldId`；build.id/build.hash 延用原字段。没有 worldId 的旧调用保持可运行，但不产生可信 selection。preview=true 副本不发 selection。

游戏发 `craftmine-game/1` 消息：

```json
{"type":"selection","nonce":"existing-frame-nonce","worldId":"host-bound-world","build":{"id":"current-build-id","hash":"current-build-hash"},"objectId":"actual-object-id-or-null","selectionRevision":1}
```

objectId 实际为空时为 JSON null。选中改变时修订递增；来源是实际 raycast 且必须存在于 engine.objects。G/C 必须校验 iframe source、nonce、当前正式 worldId/build ID/hash、单调 selectionRevision、对象仍存在。旧版本事件拒绝；世界切换清空选择。只转发受限上下文，不增加任意 RPC 或模型可控路径。

## 3. F/G 的真实玩法验收

旧 `request-step` 仍只允许 preview=true。attack 现在执行实际物理射线，事件 targetId 不会凭空命中该对象；应设置真实视角并根据观察断言。

```json
{"label":"equip","event":{"type":"equip","weapon":"melee"},"dt":0}
{"label":"attack","event":{"type":"attack"},"dt":0.3,"player":{"x":0.35,"y":6,"z":8,"yaw":0,"pitch":0}}
{"label":"reload","event":{"type":"reload"},"dt":0}
```

player 的 x/y/z 仍为必填，yaw/pitch 可省略。dt 0–1。观察新增 gameplay 快照，可检查 ammo/reloadRemaining/cooldown；冻结断言 DSL 未扩展，因此弹药专门检查直接使用受信测试代码，不能声称模型断言已经支持新 kind。

ext 需求验证使用原 `verifyBehaviorsInBrowser(build,{extensions})`，已实际验证新 creation instance 和重启；无需换成另一套运行器。

## 4. 冻结门槛与接线

`app/harness/extension-loader.mjs` 现在保存实际自测轨迹并执行评审断言，增加 `reviewExecution:{scope:'extension-selftest-traces',ran,passed,results}`。结果仅为已覆盖自测输入上的建议判定，不充当新需求的硬门槛。

G 需审查后更新 `app/harness/kernel.mjs` 对应单个 checksum；补丁与 SHA 见 DELIVERY。D 不更改冻结断言或自动刷新清单。桌面 selection 接线由 G/C 完成，D 不修改 main.cjs/view.mjs 等共用文件。

## 5. 有意保留的边界

- 评审已执行的断言只覆盖实际 selfTests 轨迹；没有自动生成额外对抗场景。
- 多扩展命令仍顺序提交；后面的命令失败不会回滚前面已成功命令。模块会停止并记录错误；跨效果整步事务仍需后续设计。
- 当前扩展改版与旧状态不兼容时安全拒绝，尚无通用扩展状态迁移语言。
- 用户自己的 OS 操作体验、原生 PI Agent 创作/库应用/程序包流程由 G/F 验收。
