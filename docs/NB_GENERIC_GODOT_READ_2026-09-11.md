# 真实模型起手只读工具错误的修复

基线 badd725f；独立分支 codex/creation-next-routing-20260911；工作树 D:/cm-nb-routing。

## 实测触发与根因

本轮原始模型对照 [nla0QX 报告](D:/cm-nb-root/test-results/desktop-native-complete-nla0QX/report.json) 的 CA01 最终为 model_repaired_pass，共8次模型请求。模型先调用通用 project_inspect/capabilities_read，分别遇到 undefined.map 与 scene.objects is not iterable，之后自行转向 Godot 工具完成。

独立使用实际打包 domain.cjs 复现两种错误：Godot 的 craftmine.godot-scene/1 只有底座/场景元信息，不能送入旧体素 upgradeScene、draftPackages/素材验证。问题位于工具的运行时分流，不是模型欠缺对象数组；不能补空objects掩盖。

## 变更

通用入口先读取绑定世界的真实记录。Godot世界的project_inspect改为读取godotProject.index，返回当前源码revision/manifestHash、分页文件、正式build与任务身份，以及适用的Godot工具；造物世界可同时带宿主已有目标上下文。capabilities_read的四个章节返回实际Godot能力清单和GDScript/源码工具指引，不再返回旧体素schema或JavaScript模块合同。所有文本页保持有界Unicode分页，源码身份另放外层供跨页核对。

缺少Godot工程时明确available=false/GODOT_PROJECT_NOT_FOUND，指向工程创建/索引工具，不把缺数据伪装成有效空世界。权限、取消、跨世界和源码身份不匹配仍拒绝。旧体素世界保留原有资源目录与合同。工具描述、路由能力元数据及插件打包copylist同步更新；没有新增模型请求、没有修改root运行资源。

## 验证

- 7项实际打包工具/旧domain合同测试通过：独立重现旧错误、五Godot底座默认inspect、四能力章节、Unicode分页、缺源码、权限/跨世界、只读讨论及legacy回归。
- 新建独立Rust数据库并调用实际core+打包工具，4项通过：真实Godot世界→两通用入口正确分流，未制造legacy资源，返回实际能力标记，读取前后源码revision/hash不变。证据见 [Rust只读工具结果](evidence/creation-next-batch-20260911/generic-read/core-report.json)。
- 源码语法与diff检查通过；新增helper已进入实际插件构建。

不以这些单测声称模型请求次数已下降。本次只修复实测根因，修复后的真实模型成功率/用量应由后续独立对照记录，不改原CA01已发生的8次请求或历史分类。
