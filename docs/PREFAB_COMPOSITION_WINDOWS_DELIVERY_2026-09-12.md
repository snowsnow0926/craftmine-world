# 预制组件组合与视觉纠正 Windows 成品

本批沿玩家“预制一些东西和素材，让游戏内 agent 呈现更好效果”的要求，完成首批 18 个资源的成组使用、真实游戏图片输入及连续创造修复。资源数量仍为 18；本批重点是让模型正确组合和调整已有资源。

## 安装包

[下载 0.14.4-preview.14](D:/cm-promo-loop-0912/desktop/build/releases/f33d37f9cc9b-cdcaf54b-8437-47a6-b661-a929caed6e8f/output/Craftmine-World-Setup-0.14.4-preview.14.exe)

冻结源码 `f33d37f9cc9be5565ec9352b9432f35c22b8cb48`，安装包 366143354 字节，SHA-256 `0d33964eecac1caee02f4580cc409c665f4e79b19a83e9b8f50c56d50d4d3788`。完整构建退出 0，安装载荷解包核验通过。尚未代用户执行安装向导。

## 实际改善

模型使用两段城墙、两组塔楼基座/中段/垛口共 8 个资源，正常成组安装、检查并采用；中心路线穿门、保存及冷重开通过，原有森林与组件保留。随后沿同一会话输入“看看现在的城门效果，把挡住墙和塔的树挪开，门洞和花草保留。”，模型取得真实 PNG 并正常续答，只修改四棵树的位置，候选检查通过。

调整前：

![调整前，前景树遮挡塔楼](D:/cm-player-retry-0912/test-results/retry-preparation/images/capture-18.png)

调整后的正式作品：

![调整后，两塔露出，门洞和花草保留](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/candidate-adoption-ec144605-194a-4cee-a9c1-ddabd796b5ea/adopted.png)

源文件对比确认只有四条树位置变化，其他正文保持一致。模型在未打开候选时尝试抓图被正确拒绝，最终预览由正常产品流程在回合结束后打开；不将此记为完全无人参与的视觉迭代。

该候选已正常采用、保存 progress revision 10 并冷重开；新实例 `eb024ea92d71c7d9234c84af` 恢复同一正式构建 `gbd-909bc88ecaeac64999bdbfc6e6d7cff10baf62da3c4e1ea46b352bd65c280802`，源码及组件清单与采用后完全一致。两次启动均退出 0，隔离、页面和关闭审计为空，完整性通过；采用及重开阶段没有额外模型调用、安装或重检。见 [原始回执](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/candidate-adoption-ec144605-194a-4cee-a9c1-ddabd796b5ea/report.json)。

本批也修复工作台截图误拒绝、预览沿用旧保存视角，以及素材采用后原会话出现 `DRAFT_BASE_CONFLICT` 的问题。失败输入经正常归档重试，新工作区绑定已采用构建，主历史没有重复愿望。详细过程与失败记录见 [开发记录](SOURCE_GROUP_AND_VISUAL_FEEDBACK_2026-09-12.md)。

## 下一阶段

优先推进带跟随、互动、外观变化和独立状态保存的宠物预制组件，随后复用角色基础发展战斗。普通犬的官方资源筛选已完成，但当前下载受上游配额阻断；博美仍缺合格资源。尚未有新的宠物模型、动画或可玩组件交付，不用静态素材代替玩法验收。见 [下一批计划](PLAYABLE_PREFAB_NEXT_BATCH_2026-09-12.md)。
