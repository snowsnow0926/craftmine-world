# NB4 真实模型评测入口

日期：2026-09-11。入口：`tests/creation-model-native.mjs`。

## 范围与输入

此入口运行实际桌面 Electron、产品本来的模型运行时、真实 provider、Godot 编译/检查/采用。
评测器仅创建空白世界、调整视角、启用该隔离世界的自动采用、发送固定原话和读取实际结果，
不替模型编写源码、不生成工具答案、不在失败后修好世界继续冒充首次成功。

新套件标识为 `craftmine.creation-next-model/1`。其 CA03 是“复制这棵树两个，排开一点”，
CA04 是“把时间设为18点”，CA05 是普通非预置砍树/木头/五秒再生需求，与旧 Alpha 的同名
编号原话不同。原 Alpha 记录保留；新结果不能直接覆盖或混入旧成功率。

默认顺序 CA01→CA02→CA03→CA04。`CRAFTMINE_EVAL_SUITE=full` 扩展为
CA01→CA02→CA03→CA04→CA06→CA07→HOLDOUT01→CA05，共八例。
`CRAFTMINE_EVAL_CASES` 可以在固定八例内显式选择，最多十例且不得重复。
`node tests/creation-model-native.mjs --plan` 只列输入，不读取凭据或启动客户端。

## 启动条件

需总控完成当前源码的桌面、插件、runtime 资源及 core 编译后再运行。设置：

```powershell
$env:CRAFTMINE_SOURCE_ROOT = 'D:/cm-nb-root'
$env:CRAFTMINE_CREATION_EVAL = '1'
$env:CRAFTMINE_LIVE_CONFIG = '<明确授权的本地 JSON 配置绝对路径>'
$env:CRAFTMINE_EVAL_MODEL = 'deepseek-flash'
$env:CRAFTMINE_EVAL_SUITE = 'full'
node tests/creation-model-native.mjs
```

配置文件使用 `CRAFTMINE_DEEPSEEK_API_KEY` 或 `DEEPSEEK_API_KEY`，亦接受专用
`CRAFTMINE_EVAL_KEY`。凭据仅从明确配置文件读取，不输出、不复制进评测报告。
不会修改个人 provider、模型设置或安装。可选 `CRAFTMINE_EVAL_CORE`、
`CRAFTMINE_EVAL_HOST`、`CRAFTMINE_EVAL_BASES` 指定总控准备的同源码测试构建。

生产构建必须包含已有输入隔离 guard、评测控制器和 `EVALUATION_REQUEST_LIMIT` fence，
否则启动前拒绝。每次新测试创建独立 `test-results/desktop-native-complete-*/profile`，
禁用真实输入、焦点、Pointer Lock。所有控制通过既有 IPC，不操作个人浏览器或麦克风。

## 预算与分类

总请求上限 40，由宿主在网络前执行持久 reservation fence，重启后仍保留。
报告另记 `session.turnMetrics` 的实际观察请求数与 token，用量缺失保持 null；reservation
不当作实际 API 请求数。每例最长十分钟，最多三次模型修复，超过就停止；不另加纠正提示。
依赖案例失败后后续标记 not_run，避免通过脚本补答案污染首轮基线。

分类分别为首次成功、自主修复成功、人工介入成功、失败、环境阻塞和未运行。修复是实际
工具/检查失败后模型再次修改或重新构建，单纯轮询不算修复。分母只含可比较的真实模型案例；
环境阻塞、人工介入和未运行分别报告。实际价格或账单不可得时费用为 null。

## 成功证据

模型回复“完成”不能判成功。每例要求真实 check job passed、非空真实断言全部通过、正式
buildId 与该 job 一致且发生变化；再检查真实实体、碰撞、选中位置、原对象、实际二倍高度、
复制数量及间距、源默认时间和完整游玩进度。每例保存并重启同一隔离 profile/会话，核对
不同 instanceId 下同一构建、实体/碰撞尺寸和完整存档。CA07 额外回到原世界核对未变化。

CA05 还要求真实 interact 产生一块木头、树的碰撞暂时消失、保存重开保留中间生长状态、
真实 300 个 physics ticks 后恢复树。若未知玩法仅得到基础检查或未采用，保留失败/待验证，
不会绕过产品采用规则。无物理语音准确率或主观体验结论。

报告保留逐阶段实际状态、原始会话、原始运行观察、真实 check、存档和重开证据及 SHA256。
日志在写入前移除授权密钥，源码仓库不包含 profile、凭据、模型日志或测试数据库。

## 当前验证

已执行语法检查、`--plan` 和八项纯分类/证据负例测试。尚未启动此 runner 的真实模型请求；
真实请求结果由总控统一构建后单独登记，不将纯测试结果算成模型成功率。
