# GU2：固定 Godot 引擎 API 元数据切片

日期：2026-09-12。范围：从固定真实引擎反射 API，生成可验证离线语料，并提供独立查询模块。工具路由与安装包复制由集成方接入。

## 来源与执行边界

生成脚本 `scripts/generate-godot-engine-api.mjs` 复用 `desktop/godot/toolchain.mjs` 的 `createGodotProbeEnvironment`。它验证仓库锁定的编辑器 archive 和主 executable SHA-256，将引擎复制至独立目录，创建私有 `_sc_`、APPDATA、LOCALAPPDATA、USERPROFILE、TEMP、TMP，所有启动均由共享 runner 添加 `--headless`、`windowsHide:true`。

固定来源是 `4.7.2-stable`，实际版本 `4.7.2.stable.official.ed1daf0bf`，主引擎 SHA-256 为 `ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424`。用户指定目录里的 console.exe 是 launcher；共享 runner 直接启动它对应的同一已校验主引擎。生成器只接受 `--check`，不接受项目路径或脚本路径参数。

唯一执行项目是临时目录内新建的空工程及仓库维护的 `godot-engine-api-dump.gd`。反射只使用 ClassDB 元数据读取，不实例化被查询类、不执行其方法、不加载玩家项目、插件或 GDExtension。没有浏览器、真实输入、Pointer Lock 或窗口前置。

官方 ClassDB 文档用于核对反射接口形状；语料内容来自实际固定引擎，不复制在线手册：[ClassDB 官方接口](https://docs.godotengine.org/en/stable/classes/class_classdb.html)。Godot 许可及版权文件已在 `desktop/godot/licenses/GODOT_LICENSE.txt` 与 `GODOT_COPYRIGHT.txt`。

## 真实覆盖与限制

| 元数据 | 本次导出数量 |
| --- | ---: |
| 类 | 1,054 |
| 直接声明的方法 | 17,008 |
| 属性（不含编辑器分组标记） | 5,168 |
| 信号 | 510 |
| 枚举 | 764 |
| 整数常量 | 5,246 |

类包含直接父类、apiType、enabled、instantiable。方法和信号保留参数、返回类型、flags 与默认参数。类型保留 Godot 原始数值及 `typeName`、class_name、hint 等描述。属性分组标记单独保存在 `propertySections`；枚举关联常量名称和 bitfield；整数常量值以十进制字符串保存，避免 64 位值损失。

继承成员不重复写进每个类，查询时按父链解析，并返回 `declaredIn` 和 `inherited`。本类同 kind/name 声明优先。apiType 分布是 core=969、editor=82、none=3；在当前 headless script 上下文中注册的 editor API 也保留，不能由名字判断为未覆盖。

本切片不是完整 Godot 手册，未包含语义说明、教程、示例、Variant 内置类型（如 Vector3）的成员、GDScript 全局函数、项目自定义类及仅在完整编辑器会话追加注册的类。首次试验使用 `--editor` 导出更多内部编辑器类，但退出时引擎报告资源泄漏，未通过共享 runner 的无错误检查；该诊断保留于独立 test-results，不作为成功语料。最终使用无编辑器会话的 headless script 上下文，干净退出并两次复现一致。

反射存在不代表 Web 导出可用、渲染器支持、沙箱许可或调用后的玩法正确。`enabled/instantiable` 是反射结果，不授予调用许可。默认参数使用 Godot `var_to_str` 文本；Object 默认值标为 `object-default-not-serialized`，不序列化实例或标识。

## 可复现文件

`plugins/craftmine-world/engine-api/4.7.2-stable/`：

- `classdb.json`：6,284,092 bytes，全部直接声明元数据。
- `index.json`：146,249 bytes，版本、引擎/提取脚本/全语料 SHA-256、计数、每类数组偏移、父类和独立类 SHA-256。

当前 corpusHash 为 `8dd5a762b893919963b1256300800e2db2d44c6f624a5488d58568f890a4e2a9`。语料对象键排序、成员列表排序，剔除不可移植的 method registration id；不加入时间戳或机器路径。文件固定 LF；脚本内容在哈希前标准化 CRLF 为 LF。两次独立引擎环境生成结果逐字节一致。

复现：

```powershell
$env:CRAFTMINE_GODOT_CACHE_DIR='D:/Craftmine World/desktop/build/godot/4.7.2-stable'
node scripts/generate-godot-engine-api.mjs --check
node --test tests/godot-agent/engine-api.test.mjs
```

生成证据在每次私有 `test-results/godot-engine-api-*` 的 `report.json` 与引擎日志。未加 `--check` 时重新生成版本目录中的两个文件；`--check` 仅对比，不改语料。共享 runner 的固定 fixture 超时用于取消失常的元数据导出，与玩家模型轮次限制无关。

## 独立查询接口与安装约定

`godot-engine-api.cjs` 导出：

```javascript
const {queryEngineApi, createEngineApi, VERSION, FORMAT} = require('./godot-engine-api.cjs');
queryEngineApi({mode:'info'});
queryEngineApi({mode:'class',className:'CharacterBody3D',kind:'method',limit:20});
queryEngineApi({mode:'member',className:'CharacterBody3D',memberName:'queue_free'});
queryEngineApi({mode:'search',query:'position',kind:'property',limit:20});
```

参数：`mode=info/class/member/search`；`className/memberName` 是区分大小写的精确名称；`query` 是不区分大小写的字面子串；`kind=method/property/signal/enum/constant`，搜索额外允许 `class`；`offset` 默认为 0；`limit` 默认 20、最大 100；`inherited` 默认 true。全局搜索只列直接声明一次，设置 className 时可搜索该类含继承的表面。类查询和成员查询支持分页，防止超大类一次返回全部接口。

非零 offset 必须携带上页的 `pin.engineVersion` 和 `pin.corpusHash`；调用者保持相同模式及筛选。第一页允许只指定 engineVersion；不存在的版本返回 unknown，永不替换成另一个引擎版本。语料 pin 不符返回 `ENGINE_API_METADATA_PIN_MISMATCH`。结果有 `items/offset/nextOffset/total/pageComplete/complete`；complete 只表示当前请求从头到尾覆盖所选元数据，不代表实现玩法通过。

结果始终包含来源与限制。未找到类、成员、版本或缺文件返回 `status=unknown,available=false,reason`；未收录类/成员另标 `engineSupport=unknown`，不推断引擎不支持。非法参数及缺分页 pin 抛出带 `errorCode` 的确定性错误。

加载是惰性的：require 模块不读取语料，第一次 query 才检查文件格式、固定引擎 SHA、完整 corpus SHA、每类 hash、偏移及继承链，然后在当前模块实例内缓存已验证快照。返回结果复制，不允许调用者污染缓存。安装时复制模块及完整 `engine-api/4.7.2-stable/` 目录；如果旧 staging 只调用原精选文档，可对新模块做惰性 require。`createEngineApi({directory})` 仅供宿主安装定位或测试使用，不能把 directory 暴露给模型参数。

集成建议：既有 godot_docs 的 api-info → info；api-class → class（有 memberName 时 → member）；api-search → search。已有精选摘要 info/search/read 保持原用途。

## 验收结果

两次独立真实引擎导出成功且 hash 一致；8 项测试全部通过，覆盖固定锁身份、类/方法/属性/信号/枚举/常量真实查询、继承归属、完整分页无重复遗漏、未知版本和域、非法分页、缺失/篡改语料、缓存返回值隔离。没有模型请求或付费调用。

本提交不包含工具 manifest/broker 接线、安装包复制或玩家创作完成率验收。该接口与数据用于接续集成，不应单独宣称 GU2 全部完成。
