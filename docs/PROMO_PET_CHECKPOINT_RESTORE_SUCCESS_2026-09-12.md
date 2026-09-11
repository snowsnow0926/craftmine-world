# 宠物检查点在新成品中的恢复复验

2026-09-12，使用 `964d96d0` 冻结目录成品，通过正常备份检查和恢复接口，
将此前第二次 PET01 已采用世界的备份恢复到全新隔离 profile。
结果为 `status=completed / activated=true`，没有新增模型调用。

原导出报告：`D:/cm-promo-loop-0912/test-results/desktop-native-complete-4zHbur/report.json`。
本次恢复报告：`D:/cm-promo-loop-0912/test-results/desktop-native-complete-gZUpyt/report.json`。

- 世界 ID 保持为 `world-8a3c95aad901`。
- 正式源码清单保持一致，游玩进度字节保持一致。
- 原构建 `gbd-f0d57b9333846b58a9c29ab45dd16fc7a26206eabcca919651ed3bed5ad319ce`
  通过产品正常重建，成为 `gbd-65cd990a053620d7a33c27c1ffb3d854814fd1db301db0aefe4f238b94609dea`。
- 不复制整份 profile、不重置原评测预算，备份不包含模型凭据。
- 原试验报告、导出证据、请求账本保持不变；退出审计无输入/焦点/页面/退出违规。

此前的失败记录继续保留：legacy 快照键序造成误判、旧正式源码重建被新增
固定 helper 清单拒绝，以及恢复已激活后交接失败仍显示泛化失败的问题，
分别有独立实现及验证。这次成功不能改写那些原始失败，也不代表恢复旧源
码后就自动拥有新的场景采样能力；宿主仍按实际正式源码哈希判断能力。

后续 A05 采用原台词「我希望狗换成白色博美犬。」作为独立检查点派生试验，
与原第二次 PET01、独立宠物组 PET02（改名）和完整宣传主线分别记录。
恢复成功本身不证明博美改形或同一对象后续编辑已经成功。
