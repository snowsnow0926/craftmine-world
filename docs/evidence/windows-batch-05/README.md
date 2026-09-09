# 第 5 批证据说明

- `native-fixture-development.json`：开发版原生固定服务场景，39 项通过。代码和回复都是测试夹具，PI/Rust/渲染器/面板是真实链路。
- `native-live-development.json`：开发版原生真实 DeepSeek 评审，33 项通过；固定草稿，真实模型提出 14 条需求断言并执行通过。
- `native-live-application.png`：成功应用后的独立世界面板离屏截图，不代表可见桌面的最终窗口合成。
- `native-live-failed-contract.json`、`failed-live-review.json`：第一轮真实模型失败及其原文；缺少地面高度与隐藏语义导致错误断言，没有记为通过。
- `native-failed-paint.json`：早期离屏首帧失败，没有记为通过。
- `native-fixture-packaged.json`：最终包内 EXE 固定场景 40 项通过，增加了 Agent 读取需求失败信息的验收。
- `native-live-packaged.json`：最终包内 EXE 真实 DeepSeek 评审场景 33 项通过，模型本次生成的 8 条断言全部执行通过。
- `native-packaged-application.png`：最终包内世界面板的离屏截图。
- `package-manifest.json`：构建提交、60 个交付文件的大小/哈希及完整复制验证结果。
- `domain-tests.log`：本批已有领域回归 276 项的原始终端结果。

只保留测试报告、明确选择的评审证据和截图。测试配置目录、数据库、凭据、真实个人存档均不进入交付证据。JSON 中的原始工作树路径用于定位历史运行，清理工作树后应以本目录的副本为准。详见 [第 5 批报告](../../WINDOWS_BATCH_05.md)。
