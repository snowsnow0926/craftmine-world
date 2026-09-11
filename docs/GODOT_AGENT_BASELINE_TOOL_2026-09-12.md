# GU0 玩家配置与版本基线采集工具

`scripts/godot-agent-baseline.mjs` 仅采集已有事实，不启动客户端、Godot、浏览器或模型。需要支持 `node:sqlite` 的 Node；本次使用 Node 24.14.0 验证。

## 用法

先明确玩家数据库与一个尚不存在的独立输出目录。输出目录的父目录须已存在；脚本不会覆盖旧报告。

```powershell
node scripts/godot-agent-baseline.mjs --player-db 'C:/Users/WINDOWS/AppData/Local/CraftmineWorld/pi.sqlite' --out 'D:/cm-gu0-baseline-0912/test-results/gu0-candidates'
```

没有 `--session-id` 时，只返回按保存更新时间倒序排列的最多五个候选，来源为 `latest-saved-session`、`selectedSessionUnverified=true`。输出只有 `baseline.json`；候选使用 `craftmine.player-config-candidate/1`，不能直接被普通玩家测试入口当成已确认配置。最新候选配置损坏时保留失败原因，不悄悄选用更旧的模型。

调用者明确指定此次验收所对应的已保存会话后：

```powershell
node scripts/godot-agent-baseline.mjs --player-db 'C:/Users/WINDOWS/AppData/Local/CraftmineWorld/pi.sqlite' --session-id '<明确选择的会话 ID>' --out 'D:/cm-gu0-baseline-0912/test-results/gu0-selected'
```

此时来源为 `explicitly-selected-session`，并额外输出兼容普通入口的 `player-config-snapshot.json`。显式指定只证明调用者选择了该保存会话，并不证明它当前显示在前台；`foregroundSelectionObserved` 始终为 false。不得为了获得该快照就随意选择最近会话。

可额外传入 `--core-bin '<明确的 craftmine-core.exe 绝对路径>'`，只记录字节数与 SHA-256，不执行二进制；这不能代表整安装包身份或正在运行的引擎版本。

## 记录内容

- 本脚本所在仓库的完整提交、分支与 Git dirty 路径；不读 diff 正文或未追踪文件内容。重命名同时记录原路径。
- 计划书、插件工具 manifest、工具实现 `world-tools.cjs`、`toolchain.lock.json` 的路径、字节数与 SHA-256；显式二进制可选。
- 保存会话的模型、思考强度、模式、权限、更新时间和对应 provider 的模型绑定；provider 默认模型仅供描述，不替代会话选择。
- `ModelBinding` 当前正式字段完整保留，包括上下文、单次输出容量、思考选项、图片/文档能力与子 agent 可用性。没有添加任何测试 token、请求数或整轮时间上限。
- CLI 只显示输出文件路径与 SHA-256；失败只显示固定错误代码。

SQLite 以 `readOnly:true` 打开；单条 SELECT 对应一致的配置读取视图。查询没有选择会话标题、消息、`secret_ref`、凭据或任意 `kv` 内容。仅解析所需 `providers.config_json.models`，不会把整个 provider JSON 输出。未知模型绑定字段、缺失配置、重复模型 ID、非法格式与携带用户名/密码/查询参数的 endpoint 均阻止显式快照输出，不猜测默认值，也不把原始异常内容打印出来。

`permissionMode=inherit` 原样保留，同时标记 `effectivePermissionUnverified=true`：本工具没有读取全局继承权限或已存在任务的预算。普通测试仍须遵守产品当前权限流程。输出 `ordinaryDriverCompatible` 指当前 `craftmine-headless-player.ts` 的 DeepSeek/agent 参数形状兼容性，不能作为网络可用性或权限通过的证明。其他供应商可采集事实，但不可悄悄转换为 DeepSeek。

## 后续验收衔接

显式快照可作为 `tests/promo-real-player.mjs` 的第二个参数。该驱动还需要既有独立世界/会话报告、原始玩家输入和本轮冻结成品；基线工具不生成世界、不复制私人会话、不读取密钥，也不调用模型。

GU0 应将本工具输出与冻结成品 inventory、工具可调用性、引擎运行证据及真实玩家任务结果分别关联。只有源码与配置快照，不能宣称本版本构建、游玩、视觉或玩家原始目标已通过。旧受限诊断不能并入真实普通流程成功率。

## 验证

```powershell
node --test tests/godot-agent-baseline.test.mjs
```

8 项测试覆盖参数拒绝、完整实际绑定、无默认替代、敏感字段不泄漏、只读临时 SQLite 字节保持、显式会话与候选区分、最新坏配置不回退、Git/文件身份、仅 hash 二进制、输出不覆盖和 CLI 错误脱敏。所有 SQLite、Git 仓库和输出均为临时夹具，不访问用户数据库，不启动真实产品或模型。
