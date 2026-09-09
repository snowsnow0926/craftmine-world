# Agent B 完工报告

日期：2026-09-09。派工版本：W2–W5 v1 / B_HARNESS_CONTEXT.md。

结论：**ready_for_integration**。请求层已经实现并通过本组检查；实际桌面接线、Rust 联合验收和真实模型长任务由 G/F 继续，不能据此记 W2/W3 全部完成。

## 1. 玩家能得到什么

每次调用模型前，重新确认“正在改哪个世界、草稿是哪版、现在要做什么、已经改过什么”，防止压缩后忘记任务。树已经完成、下一步加花时，历史摘要只能解释过去，不能重新开启旧任务。

创作、评审、摘要和重试都向同一个 Rust 任务账本预约用量；上下文压缩不会清零。停止后，迟到的模型成功结果不能再触发工具。世界任务只能使用领域工具，通用文件、命令和派生 Agent 不进入世界任务工具目录；宿主还需要独立检查直接调用。

大世界评审可以只携带修改内容、完整玩法规则和关联对象，同时标明省略对象的来源哈希与位置。必要内容仍超限时明确失败，不截断代码来凑成功。

## 2. 验收项

| 项目 | 结果 | 边界 |
| --- | --- | --- |
| 分层提示、中文纠正、身份事实与引用隔离 | 通过契约检查 | 不能证明模型永远不会误解提示 |
| 系统/消息/工具/图片/输出/结果预留预算 | 通过 | 保守 UTF-8 估算；不是实际 tokenizer |
| 每次物理重试、摘要、评审共享账本接口 | 通过契约检查 | 本组账本是夹具，真实 Rust 接线归 G |
| 最终 provider payload 变化再次检查 | 通过 | 超出预约即失败，不静默扩预算 |
| 单次 PI Agent 任务三次压缩后绿色结束 | 通过 PI 集成夹具 | 一个 prompt、四次创作回复、三次摘要；模型与领域接口为夹具 |
| 真实模型三次压缩后原生客户端完成任务 | 未验证 | 不能替代上一行的真实模型门槛 |
| 停止、晚到回复、结算失败不释放工具调用 | 通过契约检查 | 宿主后台评审/沙箱取消仍需联合验证 |
| 大世界聚焦评审 | 3/3 通过 | 省略对象的完整几何明确未覆盖 |
| 原有 PI 运行器回归 | 321/321 通过 | 代码 de3b9c8；后续仅强化单任务压缩测试 |
| 最终类型检查与 B 定向检查 | 类型通过，13/13 | 代码 d0d9cfa |
| 原生程序、安装包、人工体验 | 未运行 | 不宣称通过 |

## 3. Git 交付

- 工作树：`D:/Craftmine World-worktrees/parallel-b-20260909`。
- 分支：`codex/parallel-b-20260909`。
- 基线：`dispatch/w2-w5-v1` / `2f71e128fd9ff9c49ee4e466138f4949b6bce862`。
- `eeb8d445e234ec7ad747b22933b7f8e566c47d14`：PI 请求/预算/工具边界与规范。
- `de3b9c864bd90c598e67688d3b7c71034f7231e1`：有来源的大世界聚焦评审。
- `7a5bc7d2948493fea2d5ba78b09be8eabafc17f9`：将压缩测试强化为单次连续任务。
- 最终实现提交：`d0d9cfa48986b84307322fdd71471b56cf9f995e`：根据 G 评审改为世界专用工具指引，并保留真实 PI asktool。
- 本报告和证据随后单独提交。最终 HEAD 在回传消息中给出，避免自引用哈希。
- 未修改共同入口；`integration.patch` 仅建议打包时增加 context-review.cjs。已通过基线 `git apply --check`，未使用 overlay。
- 未合并主分支、未推送、未删除工作树。交协调者验收。

## 4. 实际命令与证据

所有命令工作目录均为本组工作树根目录。

| 命令 | 源码 | 结果/耗时 | 证据 |
| --- | --- | --- | --- |
| `pnpm --dir vendor/pi-desktop --filter @pi-desktop/agent-runtime typecheck` | de3b9c8 | 通过 | typecheck.log |
| `pnpm --dir vendor/pi-desktop --filter @pi-desktop/agent-runtime test` | de3b9c8 | 321/321，4.45 秒 | runtime-tests.log |
| `node --test tests/dispatch/b/review-context.test.mjs` | de3b9c8 | 3/3，约 0.11 秒 | review-tests.log |
| `pnpm --dir vendor/pi-desktop --filter @pi-desktop/agent-runtime typecheck` | d0d9cfa | 通过 | final-typecheck.log |
| `pnpm --dir vendor/pi-desktop --filter @pi-desktop/agent-runtime exec vitest run src/craftmine-context.test.ts` | d0d9cfa | 13/13，0.779 秒 | continuous-compaction-tests.log |

证据目录：`docs/evidence/dispatch/B/`。开发中出现的类型错误和初版补丁校验失败已如实记在 `development-failures.md`，修正后复验通过。

## 5. 真实模型与资源

真实模型调用 **0**，实际供应商 tokens **0**。测试 fixture 的 usage 是固定数据，不可当作账单。连续任务测试确实运行 PI 主循环和 compact 实现，产生三个宿主检查点回调；没有手工增加压缩计数或伪造文件。没有启动浏览器或原生窗口，没有鼠标/键盘/Pointer Lock/焦点操作，没有读取个人密钥或个人世界。

## 6. 接口与调用顺序

详见 `INTERFACE_B.md`。核心为 `createCraftmineRequestHooks`、`createCraftmineProxyHooks` 和 `craftmineGuardedStream`，经包 index 导出。先取实际任务事实，再做完整预算，向 A 预约，调用当前配置模型，结算后才交付终态。PI 自动压缩使用相同摘要请求边界，下一请求再取新事实。

主进程需为世界任务传 `craftmineWorld: true`，实现四个 `craftmine.*` 反向 RPC、独立 tools.execute 身份检查，并为异步评审注入捕获身份的 one-shot hooks。完成后的评审只能读同一个仍有效验收任务，不能重新获得写租约。A 的 deadlineAt 是 Unix 毫秒。

## 7. 恢复与数据

B 不另建预算、记忆或存档数据库。真实持久写入归 Rust。未知网络结果保留已预约用量，不能按零消耗处理。摘要失败保留原始对话和草稿，世界任务不采用失去可信背景的自动换窗。玩家显式恢复/丢弃、租约代际与回执查询由 A/G 完成。

## 8. 下一步与限制

1. G 合并三个代码提交，接入实际 A 领域接口；在 getContext 适配器中按当前任务检索有作用域的已验证记忆。A 的 context 不直接返回全作品库，B 不默认注入全库。
2. 打包复制 context-review.cjs，接入 one-shot 评审账本，验证正常主任务结束后的评审继续和停止后的撤销。
3. F 在独立原生离屏档案中完成真实 Agent 创作、跨会话复用和三次真实模型压缩后收尾，记录来源/二进制/用量。
4. 图片预算刻意保守，可能较早拒绝大图片；不能称为精确模型视觉计量。聚焦评审保留所有规则，规则或相关资源本身太大仍明确失败。

不得运行 `tests/browser.mjs` 或 `tests/modules-browser.mjs`；继续使用无真实输入验证。
