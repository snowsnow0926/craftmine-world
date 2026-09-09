# 第 5 批证据说明

- `native-fixture-development.json`：开发版原生固定服务场景，39 项通过。代码和回复都是测试夹具，PI/Rust/渲染器/面板是真实链路。
- `native-live-development.json`：开发版原生真实 DeepSeek 评审，33 项通过；固定草稿，真实模型提出 14 条需求断言并执行通过。
- `native-live-application.png`：成功应用后的独立世界面板离屏截图，不代表可见桌面的最终窗口合成。
- `native-live-failed-contract.json`、`failed-live-review.json`：第一轮真实模型失败及其原文；缺少地面高度与隐藏语义导致错误断言，没有记为通过。
- `native-failed-paint.json`：早期离屏首帧失败，没有记为通过。

只保留测试报告、明确选择的评审证据和截图。测试配置目录、数据库、凭据、真实个人存档均不进入交付证据。JSON 中的原始工作树路径用于定位历史运行，清理工作树后应以本目录的副本为准。程序包验收与哈希会在交付报告中单独列出。
