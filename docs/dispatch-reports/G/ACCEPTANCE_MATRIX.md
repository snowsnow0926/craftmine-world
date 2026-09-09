# W2–W5 集成验收矩阵

日期：2026-09-09。源码产品冻结 0f6eaa8；实际包构建 aaa5dc7（产品代码相同）。通过只覆盖写明的范围；独立旧场景不冒充最终包场景。

| 阶段/要求 | 当前结论 | 实际证据 | 尚需补验 |
| --- | --- | --- | --- |
| W2 原生真实 Agent 生成、修改、检查、评审、应用、重启 | 开发链和最终包代表性链通过 | F native-baseline / native-three-compactions / 最终包及durable audit | 任意需求成功率另需长期测量 |
| W2 跨会话固定作品复用 | 原生开发链通过，含一次失败评审和显式纠错 | F reuse-initial-review-failure → reuse-explicit-review-retry | 最终包精确重复同一跨会话场景未运行 |
| W2 保留失败草稿、重复回执和固定依赖 | 通过接线/真实 Rust/原生负例 | G final-bridge、F native-negative-fixtures、A process | 所有写入失联时点非穷举 |
| W3 同任务三次真实压缩后完成 | 开发链及最终包通过 | F 包内三条真实 summary、四版改动、22请求同账本、应用重启，持久审计13/13 | 自动阈值触发长跑与所有模型切换另需验证 |
| W3 原目标、纠正、事实、已改资源、完成任务不复活 | 定向及实际压缩场景通过 | Rust42、PI324、G11、F durable audit | 不能证明模型在任意需求下都不误解 |
| W3 创作/摘要/评审/重试累计预算、unknown结算 | 真实账本和定向通过 | F复用/恢复/压缩请求记录；G host-domain与维护 | 估计是保守方法，非精确tokenizer |
| W3 世界/项目/会话隔离及通用工具拒绝 | 逻辑、实际Rust与原生负例通过 | G gateway/host-domain/panel-domain；F负例 | 任意第三方插件攻击面未全面审计 |
| W3 杀进程、消息/任务/草稿恢复、旧调用失效 | 原生恢复链通过，格式失败后重试应用 | F recovery系列；Rust recovery；G启动失败注入 | 最终包故障矩阵未穷举 |
| W3 typed memory来源/替代/失效/作用域 | 实际Rust与原生玩家规则路径通过 | A/C服务、E精确回执、G panel-domain、F recovery-final-state-backup | renderer待确认操作跨重启待办 |
| W4 花草贴地/通行/图像，真实武器/奖励/扩展 | 实际游戏/Worker27项通过 | D/F gameplay-headless、garden.png | 玩家审美/操作手感尚未确认 |
| W4 A Rust库安装组合→正式应用→原生游玩→重启 | 未完成整链验收 | A库含固定扩展验证；D/F游戏执行分别通过 | 必须跑同一包完整组合场景，不能合并两段证据冒认 |
| W4 评审实际断言/反空实现/冻结回归 | 实际执行与全量276通过 | D extension-loader审查，G最终回归 | 评审额外提出但没执行的新对抗场景不能计绿 |
| W5 DPAPI/迁移失败保原件 | 本Windows用户实际验证通过 | E10个Rust tests | 跨Windows用户与全新系统待验 |
| W5 备份导出/检查/防篡改/恢复 | 原生开发整链通过 | F recovery-final-state-backup | 最终包恢复再验与所有断电时点待验 |
| W5 独立身份/NSIS/源码/许可证/哈希 | 构建/40项包内验证/825文件复制哈希通过 | E最终manifest/package evidence，G delivery-copy | 真实安装并不等于构建安装包 |
| W5 升级失败保护 | 合成目录/实际PowerShell验证通过 | E windows-services | 干净OS首装、覆盖升级、卸载待验 |
| W5 中文/PI桌面/主题/布局 | 实际组件和原生离屏范围通过 | C26+6、F/G native40 | 可见合成、全部PI入口、物理双击/输入待验 |
| W5 性能/体积/诊断 | 体积可量化；诊断白名单服务通过；性能未验 | E包清单/服务 tests；F开发0样本不作依据，包内15个自有进程含驱动4次采样仅短负载观测 | 启动/帧率/长期内存基准与采样接线 |

所有自动验证均无真实输入、无 Pointer Lock、无显示/置前测试窗口、无用户浏览器操作。最终安装包尚未签名。本矩阵保留未验证项，整体 W0–W5 目标未记完成。
