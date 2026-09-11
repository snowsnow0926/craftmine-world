# 城门成组提案：正式采用、中心穿门与冷重开

总控实际查看并确认 [门前候选图](PLAYER_GROUP_SAVED_REFRAME_2026-09-12.md) 后，批准采用这一份 8 件候选。本次继续同一 `qQcut9/profile`、同一冻结 `e8e373fce6d0` 成品，没有重新调用模型、安装素材、启动检查或手改源码。

正常流程为：读取已核验候选 → 在本次启动中重新预览 → `candidateApply` → 正式运行时有限步行 → 保存 → 退出 → 冷重开。提案、候选、构建和报告链均绑定原模型输出；旧 preview-only 报告未覆盖。

![已正式采用的城门](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/source-proposal-adoption-7272f689-9956-43d3-a49c-30b7efa2b624/adopted.png)

## 真实结果

- 正式 build 已变为已检查候选 `gbd-a96e9793c0958690aeb912d4fac14dbe8bd6b5359c9f020e43d29c09cc0bbf1a`。
- 玩家沿 x=0 中心路线正常前进，z 从约 10.834 → 4.834 → 0.334，始终落地，跨过门洞所在 z≈2.833 平面。**中央路线实际通过**；这不代表所有侧向路线或全场碰撞验收通过。
- 保存进度 revision 8，冷重开得到新实例 `1eee9488fee70f17b3a91353`，同正式 build、同源码 revision 4 / manifestHash `8199b2c46a261ade3685a186e9166c4d74af42f0cd5378fdc00d7e9b3bbf26bd`。全部 10 个组件条目与重开前完全相同，位置恢复误差小于 0.05 米，原森林和树木没有被替换或修改。
- 两次产品启动均正常退出 code 0，隔离、页面、关闭三类审计为空；原模型、前序预览报告及 marker 完整性通过。

前景树对塔楼的遮挡和墙边树冠交叠仍存在。本轮只完成已批准作品的采用及中心穿行，不冒充已经做过视觉纠正。

## 采用生命周期回归

第一次采用驱动误把历史预览当作当前活动预览，产品以 `GODOT_PREVIEW_REQUIRED` 拒绝，没有发生采用。该失败报告 `source-proposal-adoption-4ad6d438…/report.json` 保留并归为 harness 顺序错误。修正后必须先收到本次启动、相同世界/候选/构建的正常 preview 回执才能调用 apply；关闭或重启清空活动预览授权。新增回归覆盖：历史批准仍不能直接采用、错误候选回执拒绝、当前回执才允许、关闭后再次拒绝；四项合同测试通过。

`tests/source-proposal-preview.mjs` 增加显式 `--adopt-preview-report <已审图成功报告>`；只允许这一个候选的正常采用、正式步行、保存重开，仍拒绝重复安装和检查。原 preview-only 默认权限不变。

原始采用报告及图像绝对路径、哈希、前序守卫拒绝、步行数据和保存重开证据见 [采用证据](evidence/PLAYER_GROUP_ADOPTION_2026-09-12.json)。没有提交 profile、密钥或完整模型会话数据。
