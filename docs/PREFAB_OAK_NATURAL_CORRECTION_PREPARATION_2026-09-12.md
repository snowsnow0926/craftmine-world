# 原会话自然纠正准备（2026-09-12）

只读准备，未启动成品、未发送模型请求。下一句原文已写入本工作树 `test-results/prefab-oak-correction-wish.txt`：

> 新放的这棵树样子不对，我要和原来那两棵一样的橡树，位置保留。

普通入口继续使用 `D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/player-bc9702bb-1daf-4962-8cf7-98ee0efb5c13.json`，原 profile 为 VO4Pki/profile，原 session 为 `219eabdb-7df5-4d44-925e-660cb0311a71`，不传 --create-session。沿实际 adoption-4fe041ba-b8a4-41b4-8772-7b3a1d9a318a/report.json 和 exploration-00b0a388-9c16-4228-9f35-160c1742c313/report.json，确认普通采用/冷重开/探索均成功，已采用 build 为 `gbd-d77451e02183ab6ba5f6e27b9f3a8ad4e36ddc1cc6f3ea5b895128da8b662e8c`，源码 revision 7、manifestHash `f72def8428739ec2f3150be01be1e57005aaa2e3b740bcefe721a68b6270ec98`。

现有 inspectPlayerSource 直接读取普通 player 报告，不会把报告内更早 sourceRecovery 的 revision 6 当作当前版本强制恢复。输入仍走普通 playerSetup/playerStatus/creationTarget/agentPrompt；由产品对当前世界和新目标做真实绑定，不把既有截图当新capture。

最后目标必须如实区分：view-1 的真实采样选中新物件 created-487d1e872c2bdba2145352a1；之后 view-2 的 target 是 boundary，entityId=null，sceneObjectTarget=null。两张图可以证明物件存在及外观差异，不能证明下一次启动时准星仍瞄着新树。这句纠正依靠原会话最近创建结果指代；若产品或模型需要澄清，按自然玩家目标回答，不注入技术 ID/资源路径，不伪造捕获。

准备清单 `test-results/prefab-oak-correction-ready.json` 记录原 player、marker、adoption、exploration、原句文件的当前 SHA proof 及最后真实目标。新冻结包路径尚未提供，故没有以旧包进行新一轮 live。

总控正在构建含 guide 1.6.4 和结构化物件工具语义澄清的新成品，核心与素材不变。下一轮是**已有上下文里的自然纠正**，不能作为修复后的首次愿望成功率对照。原失败与所有报告保持独立，不改旧 ok 字段或用新结果覆盖旧结论。
