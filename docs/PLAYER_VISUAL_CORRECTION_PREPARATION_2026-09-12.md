# 视觉纠正前的正式取景准备

已沿 [7272 采用报告](PLAYER_GROUP_ADOPTION_2026-09-12.md) 对应的真实已采用城门准备下一次玩家反馈，**没有开始新模型任务**。此任务是已有作品的后续纠正，不是首次成功率对照。

在冻结 `e8e373fce6d0` 成品、同一 `qQcut9/profile` 中，仅通过正常进入沉浸模式、正式有限步行/转头、绑定只读截图和正常保存，玩家从门内退到 `(0,0.9,15.685)`、yaw 0、pitch 0.15。原城门 build、源码 revision 4 / manifestHash `8199b2c4…` 和全部 10 个组件条目完全不变；没有再次采用、安装、检查或修改源码。

![下一次视觉反馈的实际视角](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/view-preparation-749aa540-3467-4c15-a96d-40a81687e187/gate-view.png)

画面能看到完整门墙轮廓；左塔大部被橡树遮挡，右塔部分被松树遮挡。这正是下次要反馈的实际问题，并非已经完成树木调整。本轮截图从已采用正式运行时取得，不是原模型调用所得，也不能据此声称原模型已经看过图。

取景报告 `view-preparation-749aa540…/report.json` 正常退出 code 0，三类审计为空，完整性通过；保存的是同一正式作品的实际玩家位置。新脚本 `tests/source-proposal-view-prepare.mjs` 追溯采用、原模型、提案和预览证据链，仅开放取景所需有限 API，拒绝 candidate 操作、源码写入、检查和模型调用。五项相关合同测试通过。

后续原句已写入 `D:/cm-group-source-install-0912/test-results/forest-player-prepare/visual-wish.txt`：

> 看看现在的城门效果，把挡住墙和塔的树挪开，门洞和花草保留。

普通玩家入口继续使用原 `player-7068bc1e…json`，绑定真实会话 `3a43c719-8616-4393-a1fb-c8f3b283a785`；**不创建替代会话、不把嵌套取景报告伪装成模型报告**。新取景证据作为后续上下文另行关联。prepare-only 已通过，使用原 `deepseek-v4.1-flash-expires-on-0910 / max` 配置；当前 prepare 中旧包路径仅是占位，正式请求须等待总控提供 preview.13 精确冻结目录，再重新 prepare。本次没有提交上述愿望。

原始路径、哈希、进度回执和调用清单见 [取景证据](evidence/PLAYER_VISUAL_CORRECTION_PREPARATION_2026-09-12.json)。
