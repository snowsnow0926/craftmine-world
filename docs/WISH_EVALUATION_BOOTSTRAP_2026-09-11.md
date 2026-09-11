# 开放愿望测试：第一批实现与交接

日期：2026-09-11。产品源码审阅基线 `7f815914`；开发分支基于仅追加文档的 `38f22b3f`。

## 已同步的文档

- [随机真实玩家连续创作测试 v1](RANDOM_PLAYER_CREATION_TEST_PLAN_V1.md)
- [宣传片愿望驱动创作测试 v2](PROMO_WISH_CREATION_TEST_PLAN_V2.md)
- [文档交叉审阅与推进建议](DOCUMENT_REVIEW_AND_NEXT_STEPS_2026-09-11.md)

它们保留编写时的范围和状态；历史“不执行、不 push”描述不否定用户随后要求同步和开始开发的授权。本批没有把其中的建议费用当作自动开销许可。

## 本批实际实现

**1. 离线愿望测试准备入口。** `scripts/prepare-promo-wishes.mjs` 使用独立的裁判侧案例，支持环境、宠物、战斗、雨、飞机、城市六组独立短故事（25 个步骤槽位），也支持同一世界原宣传主线（11 个步骤槽位，含开场和重开尾声）。原片输入与新增测试要求分别标注。按 seed 为独立组选择一条可选后续愿望，记录完整选择；没有实现 v1 全量权重抽卡、动态玩家或故障注入。

每步预留真实提交、检查、采用、运行观察、采用前后进度、保存、冷重开和用量证据。未知字段为 null，所有结果为 NOT_RUN。输出完整清单的 SHA-256。只允许写到新目录，不覆盖原测试；不读取凭据、不启动 Electron、不发送网络请求。清单是裁判资料，不能传给产品作为答案，也不能放进运行资源包。

**2. 修复既有自主成功率分母。** `tests/helpers/creation-model-evaluation.mjs` 原来从真实模型样本中排除 `humanIntervention` 后计算 `denominator` 和自主成功率。一例自主成功加一例人工介入，旧代码会得到 100% 而不是 50%。新代码保留全部有实际模型调用的样本，人工介入不计自主成功；全人工介入时返回 0 而不是 null。尝试级指标仍单独包含零请求环境阻塞，没有把请求预留伪装成真实请求。

新增 `metricsFormat: craftmine.model-case-metrics/2`、分母说明和 `unassistedModelRuns` 描述字段。保留原分类计数、费用未知和所有历史报告；不重新改写旧结果。矛盾的 first_attempt_pass 标签不会压过已记录的人工介入或零请求。

**3. 测试接入。** 新增 6 项指标回归和 10 项规划/CLI 回归，连同既有 8 项评测 helper 测试组成 `npm run test:wish-evaluation`；也加入根目录默认测试列表。本批没有重跑完整根目录测试。

## 已实际运行

环境：Linux，Node.js v22.16.0；通过 GitHub 读取相关原始文件，再在隔离目录执行定向测试。不是完整仓库 checkout；原 helper 和原测试的 Git blob SHA 与远端逐字一致。

- 修复前：6 项新指标测试中，2 通过、4 失败；保留原始 TAP。
- 修复后：上述 24 项定向测试全部通过，0 跳过。
- CLI：实际生成六组独立清单、完整主线清单；独立目录写入和重复覆盖拒绝已检查。
- 产品模型调用：0。Windows / Godot / Rust / 包内 EXE / 真实语音与手感：未运行。

原始记录和文件哈希位于 [evidence/wish-bootstrap-20260911](evidence/wish-bootstrap-20260911)。这是纯逻辑与 CLI 证据，不是模型创作结果或产品发布验收。

## 命令

```sh
npm run test:wish-evaluation
npm run plan:wishes -- --plan
npm run plan:wishes -- --cases pet --seed 20260911
npm run plan:wishes -- --suite mainline
```

保存准备结果时，父目录须已经存在，目标目录须不存在：

```sh
node scripts/prepare-promo-wishes.mjs --cases pet --seed 20260911 --out test-results/pet-preparation-01
```

这些命令都不会启动真实模型。命令不提供 `--live`，不会把准备结束误报成执行完成。

## 查明的下一步接线位置

[NB4 原入口](NB4_REAL_MODEL_RUNNER_2026-09-11.md) 和 `tests/creation-model-native.mjs` 已有受保护的原生 IPC、固定案例、实际 request fence、检查/采用/重开和账目读取；它当前只认识 CA01 等八个案例。**不能把这份新清单直接塞入 CRAFTMINE_EVAL_CASES，也不能仅扩充白名单就宣称开放愿望已验收。**

下一批优先接宠物一组：核对成品与宿主评测控制器，复用现有隔离和网络前预算保护，增加正常消息提交与只读观察适配；建立宠物身份、跟随轨迹、外观复核、正式采用及冷重开检查。平台底线不变，裁判不得直接补写狗、坐标或状态。下一批允许模型正常修改世界工程，但不能在一次冻结测试中临时修改宿主。

当前 `nextWishStep` 仅帮助整理依赖：失败阻塞其短故事，不阻塞另一独立世界；即使外部给的清单全写 PASS，也只返回 REVIEW_REQUIRED，不签发成功。它不是可信证据验证器、产品授权器或实际驱动。

未完成项：实时愿望适配器、成品冻结核验、统一实际请求账本接入、真实宠物/天气/驾驶/城市裁判、动态随机玩家和 Windows 端到端验收。它们没有被计为本批完成。
