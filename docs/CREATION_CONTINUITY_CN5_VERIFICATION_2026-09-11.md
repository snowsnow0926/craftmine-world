# CN5 增量验证入口

`node scripts/verify-creation-continuity.mjs` 只执行本批相关的六阶段：源码操作和采用完成逻辑、宿主目标与直接编辑要求、实际 executor 协议、编辑 React 界面、最近结果 React 界面、原生放置故事。既有 `verify-creation-next.mjs` 的完整 18 阶段保留，不被隐式重复调用。

```powershell
# 三个单元/协议阶段，不启动产品客户端或模型。
node scripts/verify-creation-continuity.mjs --quick

# 源码位置与原始结果父目录可显式指定；每次新建独立目录。
node scripts/verify-creation-continuity.mjs --source-root D:/cm-c2-root --output-root D:/cm-c2-root/test-results

# 成品仅重跑真实 EXE 的无模型故事；不会执行安装器。
node scripts/verify-creation-continuity.mjs --source-root D:/cm-c2-root --output-root D:/cm-c2-root/test-results --packaged-root D:/Craftmine-World-preview.11/win-unpacked --native-only
```

`--quick` 与 `--native-only` 互斥。包内参数只作用于原生故事，单元及界面夹具始终验证源码，不把夹具结果说成包内 UI 结果。每个阶段保存命令、退出码、耗时、原日志 SHA-256；汇总记录源码前后提交及已跟踪差异身份，源码在运行中改变会使汇总失败。首次失败保留所有已执行阶段并停止，不自动重试。

UI 与原生档案进入本轮 `raw/test-results/`，沿用 `createCompleteOutput` 对绝对父目录和路径链接的检查，以及产品对直属 `test-results/desktop-native-*` 目录的校验。首次完整运行前五阶段通过，原生阶段因初版父目录命名不符在世界创建前被拒绝；原始失败保留，修正测试目录后单独补验，不改产品守卫。脚本只使用固定无模型用例，清除继承的模型验收入口与包选择，浏览器和产品继续采用独立不可聚焦 headless/offscreen 档案，无实际鼠标键盘、Pointer Lock、麦克风或安装器执行。模型小样本由另一条显式启用且有独立预算的入口记录，不计入本命令。
