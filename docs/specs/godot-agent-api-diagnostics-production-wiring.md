# Godot 引擎 API 与结构化诊断生产接线

本切片将已提交的固定引擎 ClassDB metadata 和 GU5 诊断模块接到实际插件路由与打包链。没有新增工具名称或提高写权限；manifest 仍为 37 项工具（含 runtime_info），godot_ 前缀工具仍为 20 项。

## godot_docs

保留 `info/search/read` 的精选摘要行为、分页和参数。新增：

| 外部 mode | 引擎 metadata 查询 | 参数 |
| --- | --- | --- |
| api-info | info | 可选 engineVersion/corpusHash |
| api-class | class | className 必填，kind/inherited/offset/limit 可选 |
| api-class + memberName | member | className/memberName 必填，其他 API 参数保持原样 |
| api-search | search | query 必填，可按 className/kind 过滤 |

API 参数映射后由 `godot-engine-api.cjs` 严格校验，不允许模型选择 directory、文件路径或引擎程序。API `limit` 为 1–100、query 长度不超过 160；旧摘要的 read limit 仍可达 16000、search query 长度仍可达 200。共享 schema 为保留旧接口允许较宽的顶层值，description 写明各 mode 差异，API 模块运行时拒绝越界。

API offset 大于 0 时必须原样携带返回 pin.engineVersion 和 pin.corpusHash。后续页应沿用相同 class/kind/inherited/filter，不能因为接线而重置或替换 pin。缺少 metadata、完整性错误、未知类/成员仍保持模块原 `status=unknown`、available=false 与原因，绝不默认为支持。

metadata 模块仅在 API mode 被调用时 lazy require；这些调用不启动 core、不打开世界、不访问模型或执行引擎。旧文档摘要不依赖 metadata 是否存在。返回增加 tool/toolMode；api-info 的 modes 显示实际外部 `api-info/api-class/api-search`，原内部 info/class/member/search 保存为 metadataQueryModes，避免模型把内部查询名当作外部工具 mode。

工具描述与原 metadata limitations 均明确：固定 editor 引擎反射不是 Web 导出、渲染器或沙箱支持证明，也不是完整手册。内容仍是参考数据。

## godot_build_read

有等待的 readGodotBuildWithWait 返回路径，以及直接 godotBuild.read 路径，都在 active、当前选中世界、返回 jobId/worldId 与原请求绑定一致后附加 `diagnostics`。

既有 wait 内的持续身份校验与 creationApplication 验证保留。直接路径新增对返回 job/world 和等待期间世界切换的防护；不会把外来结果装饰成原世界诊断。

原 output、outputHash、status、sourceStale、候选和 creationApplication 不被替换。诊断只是附加字段，不改变 core 的结果存储、校验哈希、权限、采用事务、模型调用次数或预算。抛错路径仍抛原错误；日志内容不授予任何工具权限。

## 生产包

`desktop/build-world-plugin.mjs` 将以下文件按原字节复制到插件：

- godot-engine-api.cjs
- godot-diagnostics.cjs
- engine-api/4.7.2-stable/index.json
- engine-api/4.7.2-stable/classdb.json

不将 metadata 提取器或其他开发执行入口打包。实际打包测试在独立临时目录运行 build-world-plugin，校对新文件原字节，随后用包内 world-tools 执行真实 metadata 查询与 fixture 作业诊断，证明相对依赖在已打包目录能解析。

## 验证

```powershell
node --test tests/godot-remaining/L/broker-contract.test.mjs tests/godot-round3/S6/live-and-execution-wiring.test.mjs tests/godot-agent/engine-api.test.mjs tests/godot-diagnostics.test.mjs
node --test tests/creation-guidance/packaging.test.mjs
```

第一组 58 项，第二组 1 项。覆盖外部 mode/member 映射、分页 pin、缺 metadata、旧摘要保留、API 不访问世界、direct/wait 双路径、身份变化拒绝、原 output/hash 不变、独立采用回执保留与实际生产打包。旧测试私有复制目录补齐新依赖；一处仅返回 status 的旧 fixture 补成实际 core 返回应有的 job/world 身份。

均为后台纯逻辑或插件构建验证，模型、真实 Godot/浏览器和玩家数据没有运行或修改。尚未以冻结整客户端和真实模型任务验收这些增强，不能把本次插件构建称为玩家玩法通过。
