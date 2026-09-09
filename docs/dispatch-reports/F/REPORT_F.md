# Agent F 原生验收报告

日期：2026-09-09。状态：**ready_for_integration；最终整包代表性真实任务等待打包后补验**。

这批已证明“桌面里的真实 Agent 能创作、压缩后继续、重启后复用作品、意外中断后显式恢复”。测试始终使用独立隐藏窗口和测试目录，没有抢鼠标、发送键盘事件、锁定鼠标或打开用户正在使用的浏览器。**这不是 W2–W5 全部完成的声明**，完整边界在 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md)。

## 1. 实际结果

| 场景 | 结果 | 证据（`docs/evidence/dispatch/F/`） |
| --- | --- | --- |
| 真实 PI Agent 从空世界生成树、检查、真实评审、玩家应用、完整重启 | 通过；8 次真实请求，约 40.6 秒 | `native-baseline.json`；`baseline-durable-audit.json` |
| 同一任务实际压缩 3 次，树从高度5改3、位置−10移到10、重命名后完成 | 通过；4 次草稿修改，3 条 PI 持久摘要，22 次共享预算请求，约 93.2 秒 | `native-three-compactions.json`；`three-compactions-durable-audit.json` |
| 保存应用后的树为固定版本，重复保存幂等；完整重启、新实际会话检索/读取/安装同一 hash 的版本 | 作者和安装通过，第一次评审错误被阻止；修复格式提示后，仅重试一次真实评审，第二棵树实际应用 | `reuse-initial-review-failure.json` → `reuse-explicit-review-retry.json` |
| 实际补丁后终止自有 Electron，重启后通过真实界面显式恢复 | 旧草稿/消息保留，代际1→2，共用原预算；未知请求保留66274估算预留。首次评审格式失败，修复后一次评审通过并应用 | `recovery-initial-review-failure.json` → `recovery-review-memory-backup-grant-failure.json` → `recovery-final-state-backup.json` |
| 玩家规则保存、查询、同 operation 重试 | 真实桌面路径通过，来源是实际用户规则，状态 validated，重复返回同一记录 | `recovery-final-state-backup.json` |
| 真实备份文件导出/检查/防改动/恢复 | 通过；修改文件字节被拒绝，恢复原文件并重新检查后成功恢复；不包含密钥 | `recovery-final-state-backup.json` |
| 原生错误需求、伪造身份、旧证据、迟到写入、重复回执、保存失败保护 | 40 项通过；固定作者和固定评审供应商夹具，不能冒充真实模型作者 | `native-negative-fixtures.json` |
| 花草、真实射线射击、近战、冷却、弹药、死亡奖励、扩展 Worker 和重启 | 27 项真实游戏/Worker 检查通过；另7项运行时测试通过 | `gameplay-headless.json`；`garden.png`；工具执行记录 |
| Rust 作品/作用域记忆/备份/单写者/固定扩展 | F 在最新复制的实际 Rust 进程上重新运行5项测试通过；验证/应用前置证据使用明确夹具 | `tests/dispatch/a/domain-process.test.mjs` 本次工具执行记录 |
| 控制器隔离/拒绝任意参数/不泄露凭据 | 4 项契约测试通过 | `tests/dispatch/f/acceptance-safety.test.mjs` |
| 最终整包真实 Agent 与3次压缩 | runner 已提供真实包模式；等待 E 最终包后实测 | 待追加，不能引用开发运行冒充 |

## 2. 这次真跑发现并保留的问题

1. 真实模型评审返回 `redNote`、或缺少断言 `kind`。验收保持严格，应用被阻止。G 在 `33328ff` 加入保留第一次坏评审和用量后的一次格式纠错；F 用旧失败档案仅追加一次真实评审，未重做作者、未改变原需求。
2. F 最初错误地从“玩家进度快照”读取场景对象，尚未调用模型就失败。改为读 Rust 正式世界源码，并独立核对实际渲染/应用证据；原目录 `desktop-native-f-AFir7M` 保留。
3. F 单独评审脚本最初只等待控制器启动，没有等待插件/世界就绪，模型调用前失败。已修并保留两份 `*-helper-startup-failure.json`。
4. F 备份辅助器曾把新检查 grant 配上旧 operationId，E 正确拒绝 `BACKUP_OPERATION_CONFLICT`。辅助器已按 grant 派生操作ID；修复后只重跑状态/备份，新增模型调用为0。旧失败保留在 `recovery-review-memory-backup-grant-failure.json`。
5. 进程内存采样开始时两个受测进程已经退出，得到0个样本；`process-memory-sample.json` 不能用来宣称低内存或性能达标。

## 3. 模型与费用账目

供应商 DeepSeek；模型 `deepseek-v4.1-flash-expires-on-0910`；思考强度 high；未换模型。开发客户端阶段共 **64 条持久模型请求、598930 个已知供应商 totalTokens，另1条结果未知请求保持66274估算预留**。64条包括摘要、首次失败评审和两次明确纠错评审；没有把缓存/推理重复加进总量。备份和记忆复验没有新增模型请求。这里报告用量，不推算价格。

每条新创作链最多20分钟/80请求，真实账本另有30分钟 deadline、8次压缩及100万token限制。失败档案重试沿用旧任务剩余额度，没有重置预算。最终包代表性任务用量将单独追加。

## 4. 源码、构建与可复现命令

工作树 `D:/Craftmine World-worktrees/parallel-f-20260909`，分支 `codex/parallel-f-20260909`。从指定派工基线进入，依父任务许可按实际依赖快进/合并 G，而未操作主目录。首批源码 `cc46edc`；原生复用/恢复基础 `985ea8a`；包前冻结源码 `a346377987ec8e35eac42bb512618e2759ac6c15`。完整提交和文件哈希见交付清单。

最早 baseline/3压缩使用 G `2f5f7b0` 的插件与已构建 main（其共享index与7ba一致）加 F 临时入口，A冻结 core `1f8884a`。临时index和patch hash在 [INTERFACE_F.md](INTERFACE_F.md)。入口随后正式合入 G `a82c0ea`；后续 F 不再修改共享index。复用初跑是 `a82c0ea`，恢复初跑是 `1e3fcfe`，纠错是包含 `33328ff` 的 F 合并状态。每个成绩单保留当次实际二进制hash；不能把后来的代码版本套到早期成绩上。

在本工作树执行：

```powershell
node desktop/prepare-client.mjs
pnpm --dir vendor/pi-desktop build:js
$env:CRAFTMINE_LIVE_CONFIG='D:/Craftmine World/.craftmine/secrets.json'
$env:CRAFTMINE_CORE_BIN='<isolated tested craftmine-core.exe>'
$env:PI_DESKTOP_HOST_BIN='<isolated tested pi-desktop-host-core.exe>'
node tests/dispatch/f/native-agent.mjs
$env:CRAFTMINE_F_COMPACTIONS='3'
node tests/dispatch/f/native-agent.mjs
node tests/dispatch/f/audit-native.mjs <new-isolated-profile>
```

各场景使用独立 shell 环境：`CRAFTMINE_F_WORKBENCH=1` 为新会话固定作品复用；`CRAFTMINE_F_RECOVERY=1` 为真实进程中断恢复；可选 memory/backup 标志见接口文档。不要把互斥场景标志遗留在同一环境。实际包模式必须设置 `CRAFTMINE_PACKAGED_ROOT`，它将从 ASAR 检查护栏、检查资源与源码manifest、启动实际EXE并强制使用包内 Rust 二进制。

只重试保留的失败评审：`node tests/dispatch/f/retry-review.mjs <failed-profile>`；已应用后仅检查记忆/备份时加 `CRAFTMINE_F_STATE_ONLY=1`，不会重新调用模型。

其他实际命令：`node tests/dispatch/d/headless.mjs`；`node --test tests/dispatch/a/domain-process.test.mjs tests/dispatch/d/runtime.test.mjs`；`node --test tests/dispatch/f/acceptance-safety.test.mjs`；原生负例用 `CRAFTMINE_TEST_APPLICATION=1 node tests/desktop-native.mjs`。后者是固定供应商夹具，报告已明确区分。

## 5. 保留数据与尚未覆盖的边界

所有进程在结束时关闭，仅进程中断场景有计划地终止自有 Electron。测试profile、实际生成源码、SQLite、会话和原始日志保留在本工作树 `test-results/`；可携带非凭据成绩单在 `docs/evidence/dispatch/F/`。真实配置文件只读用于已有授权模型入口，不打印/提交密钥；不修改主项目 `.craftmine`、端口8787或用户浏览器。

开发侧几条核心链已经闭合，但最终包、干净Windows安装、可见窗口合成、真实走动、完整PI桌面回归、所有故障时点和模型切换仍须按矩阵分别验收。F未合并master、未推送、未清理别人的目录。源代码入口已交G；最终包代表性任务将在同一冻结包上补验并追加独立证据。
