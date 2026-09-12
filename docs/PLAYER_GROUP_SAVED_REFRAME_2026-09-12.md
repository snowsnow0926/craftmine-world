# 城门提案：保存取景后的候选正面图

这是 [前次真实模型成组预览](PLAYER_GROUP_PREVIEW_2026-09-12.md) 的独立补验，没有再次请求模型、安装素材或启动检查。原失败导航报告和两次未保存取景的预览报告完整保留。

总控查明当前成品预览使用上次保存的玩家快照，授权仅保存实际玩家取景进度。本次通过正式世界的有限 `look/walk`，在 z≈10.834、pitch=0.18 处正常 `runtimeSave(freeze:true)`；保存回执仍绑定原森林正式 build `gbd-266a02b8…`，玩家进度 revision 6。**没有采用新城门源码。** 随后打开原检查通过的同一个候选，使用新候选实例身份读取现有视图图像。

![真实城门候选正面](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/source-proposal-adoption-3950ed30-1a29-4998-9eb8-0057b62fe8d5/preview.png)

目视结果：中央门洞与两侧城墙形成连续入口；两侧塔楼可见，但被前景树木遮挡较多，墙线附近也有树冠交叠。中央门洞可见开口，**没有在候选中实际穿行，不能宣称通行已验证**。本次只能证明实际采用现成城堡素材的模型布置已经进入候选画面，不能据此宣称最终构图完全达标。

截图为 `scope:candidate`、1200×800；候选 `gcan-7677a6b8…`，本次真实候选实例不同于前两次。截图前后宿主身份、窗口和视图尺寸一致。关闭预览后正式 build 仍为原森林；正常退出 code 0，三类审计均为空，原模型报告和 marker 字节完整性通过。

新驱动仅新增显式 `--save-reframe`：必须同时提供既有成功预览报告，才允许保存当前正式玩家进度；仍拒绝 `candidateApply`、重复安装和额外模型入口。当前版本需要这次手动保存才能更新候选视角，**不能说旧预览会自动跟随未保存位置**。三个离线合同测试通过。

完整原报告与文件哈希、保存回执、有限移动、截图身份见 [补验证据](evidence/PLAYER_GROUP_SAVED_REFRAME_2026-09-12.json)。原正式世界同取景图可用于比较：

![同位置的原正式森林](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/source-proposal-adoption-3950ed30-1a29-4998-9eb8-0057b62fe8d5/formal-after.png)
