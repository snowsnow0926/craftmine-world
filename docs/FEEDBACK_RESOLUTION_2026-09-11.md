# FB01 实现结案与版本复测映射

日期：2026-09-11。原始反馈、截图、发生版本与原话保留在 [FB01 原始记录](USER_FEEDBACK_BATCH_001_2026-09-10.md)。本表是追加的工程处理状态，不把旧原件的“未开发”改成历史上已经开发，也不把自动检查算作用户复验。

## 当前结论

FB01-001～005 对应的工程实现已进入已交付 Windows **0.14.4-preview.10**，源码为 `c1660f12dfd07a70c835a484e5a3bf2c7d728b22`。仍需按该版本逐项真人复测；原始 111/1111 存档及小狗/雷神之锤请求未提供，不能声称逐个还原了当时失败现场。

| 条目 | 当前实现与源码 | 自动证据及其边界 | 真人复测 |
| --- | --- | --- | --- |
| FB01-001 其他世界创建失败 | 隐藏运行时收到请求即排空有界串行队列，不再依赖下一帧才能 load；清理前保留真实故障。五底座创建/采用已交付。源码：[runtime adapter](../desktop/godot/shared/runtime_bridge.gd)、[世界初始化宿主](../vendor/pi-desktop/apps/desktop/electron/main/godot-world-initialization.ts) | [P1 复现与修复](dispatch-reports/player-feedback-20260910/P1/REPORT.md)分别保留失败和修正；[preview.9 最终完整客户端](dispatch-reports/player-feedback-20260910/P0_FINAL_2026-09-11.md)验证四底座，preview.10 交付记录另外确认造物底座 10 项。截图相似故障不等于原用户存档根因已确证。 | 待复测：在 preview.10 新建各底座并进入；旧失败世界若仍失败，保存该世界与原始 load 日志。 |
| FB01-002 版本入口导向 PI | 左下版本取宿主实际版本并显示为普通文字，去掉该入口 updater/外链和更新提示点；许可证保留。[Sidebar.tsx](../vendor/pi-desktop/apps/desktop/src/components/Sidebar.tsx) | [P5 报告](dispatch-reports/player-feedback-20260910/P5/REPORT.md)记录 Sidebar 5 项及实际 React 检查。仅取消此版本入口，不声称所有上游说明链接均删除。 | 待复测：确认左下为 preview.10，点击不打开 PI 链接。 |
| FB01-003 应用不可用且原因不明 | 应用旁显示忙碌、无预览、评审中/失败、旧草稿、结果确认、读取失败等原因及下一步；保留正式版本/进度验证。[apply-presentation.mjs](../plugins/craftmine-world/apply-presentation.mjs)、[view.mjs](../plugins/craftmine-world/view.mjs) | [P2 报告](dispatch-reports/player-feedback-20260910/P2/REPORT.md)：21 项语义、22 项真实页面夹具；[最终纠正案例](dispatch-reports/player-feedback-20260910/P0_FINAL_2026-09-11.md)的小狗/锤子曾借助旧源码与反馈，不算模型首次成功率。 | 待复测：正常预览、旧检查记录和失败检查时，原因可见且下一步可操作；不能只把按钮变亮当成功。 |
| FB01-004 全屏与退出快捷键 | F11 切换全屏；Escape 尊重输入法、菜单、Pointer Lock 与控件层级后退出全屏；提供可见按钮和状态。[world-fullscreen-shortcuts.ts](../vendor/pi-desktop/apps/desktop/shared/world-fullscreen-shortcuts.ts) | [P3 报告](dispatch-reports/player-feedback-20260910/P3/REPORT.md)：13 项策略、14 项 React/DOM；原生宿主发送者与当前实例另有 P1 检查。开发没有真实按键操作。 | 待复测：真实键盘 F11/Escape、输入法、菜单、多屏/DPI；本实现“退出”指退出全屏，未把它解释为关闭客户端。 |
| FB01-005 本次任务 Token/TPS/时间/模型 | 宿主按持久 session/turn 累积供应商实际调用，UI读取匹配任务；多模型分开列，缺失/部分用量不填假零。[TaskMetrics.tsx](../vendor/pi-desktop/apps/desktop/src/components/TaskMetrics.tsx)、[task-metrics-recorder.ts](../vendor/pi-desktop/apps/desktop/electron/main/task-metrics-recorder.ts) | [P4 数据证据](dispatch-reports/player-feedback-20260910/P4/REPORT.md)、[P5 显示证据](dispatch-reports/player-feedback-20260910/P5/REPORT.md)记录实际 SQLite 与无输入 UI 验证；TPS 是匹配生成时段的输出速率，不是总任务时间除以任意字符数。 | 待复测：一次真实需求含重试/模型切换，核对当前任务统计、停止后结算与重开；无供应商 usage 时应显示未知。 |

## preview.10 交付事实

[原始交付说明](D:/Craftmine-World-preview.10/README.zh-CN.md)与[交付记录快照](evidence/feedback-resolution-20260911/preview10-delivery.json)确认：`master` 的 c1660f12 已推送到 origin/master；已生成 360,928,355 字节安装包与 461,389,637 字节便携 ZIP。安装包载荷和便携载荷已核对，实际成品离屏客户端 17 项与造物 10 项通过。安装包未签名，构建过程未替换用户当前安装，也未把本地成品生成称作公开发行。

上一轮三个残留目录及本轮打包工作树的清理已完成，29 个旧草稿/自动 UID 已归档，其他历史任务保留。详见[残留清理](evidence/feedback-resolution-20260911/preview10-residual-cleanup.json)、[打包工作树清理](evidence/feedback-resolution-20260911/preview10-packaging-cleanup.json)。这是该次交付时间的状态，不表示本轮 NB0–NB7 开发期间仓库仍无工作树。

## 真人复验登记入口

当前没有收到 preview.10 的逐项真人复验结果，五项均保持“工程实现已交付，待真人复测”。后续在这里追加测试时间、实际安装版本与构建、条目编号、原话、截图/日志、通过或仍失败；需要进一步修改时关联新任务，保留原 FB01 编号。物理麦克风、普通玩家模型首轮完成率和干净 Windows 首装/升级/卸载不由上述自动成绩替代。

本轮下一步按[NB0–NB7 计划](CREATION_NEXT_BATCH_PLAN_2026-09-11.md)推进愿望验收、编辑、中文语音、真实模型与计时；不要重复实现本表已有的版本文字、全屏和基础任务统计。
