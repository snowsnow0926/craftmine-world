# 首批素材真实源码安装预检（2026-09-12）

本轮对正式构建的 17 个组件 ZIP 做真实 Rust 安装事务检查。没有调用模型、开启界面、运行 Godot 或修改原六组世界。

## 已复现并修复的阻断

9c8a97a 成品中 oak 的安装计划已经生成，但 `godotProject.applyFiles` 因 `addons/cw.nature.tree-oak/models/nature/tree_oak.glb.import` 不在源码扩展名准入表而返回 `UNSUPPORTED_PROJECT_FILE`。原始失败报告保留在本工作树 `test-results/builtin-install-6fbM3C/report.json`。

3888aaa2 增加严格最小静态 GLB 导入策略校验，既允许本批禁 LOD 配置，也拒绝任意脚本、其他导入参数、缓存路径及缺失/损坏的配对 GLB。create、普通文本/二进制 patch、applyFiles 共用校验。位置解析沿用上游 38594ace（本树对应 c144ba38）；没有删除 sidecar、改原 GLB 或放宽检查采用。

## 可复现入口

`node tests/builtin-source-library-install-native.mjs <core.exe绝对路径> <builtin-source-library绝对目录>`

脚本创建独立小型世界，以原样标准 creation_world.gd 满足自然环境模块 sourceRequirements，然后通过 createManagedPackageInstaller 把所有 ZIP 装入同一源码分支。检查 scene instance 和 script-node 的显式位置、脚本 UID、依赖、逐文件 SHA、锁清单与重复安装身份，确认正式世界及进度未被偷偷采用或改写。

本次输入来自 9c8a97a13fb0-4fb58bd3-59ae-4a3d-9eec-1694a8cfbeda 成品的原始 builtin-source-library。catalog SHA-256：`c61e058938c74a3eedb2adf9bd2accbb0a8c01949d06fb458643ce6f31adc97a`。

新 core 按源码 `3888aaa2bf1400298e29a8a94368df7af39d5804` 编译，SHA-256：`9f7dab0bf2c61718829680afb3444f6f2ad53e69eeb9cb45612762d9eb0361d6`。测试使用自己工作树 `test-results/core-3888aaa2/craftmine-core.exe` 副本；未替换任何冻结包内 binary。首次编译器进程异常退出，单任务重新构建成功。

Rust godot_projects 范围 16 项通过、0 失败，另有 1 项原本忽略的 Windows junction 夹具未运行；其中新增 2 项覆盖合法配置和恶意事务、legacy/Git 两种后端。无需扩大到模型或 UI 测试。

## 最终结果及边界

原始成功报告：`D:/cm-prefab-install-preflight-0912/test-results/builtin-install-CSHSLn/report.json`。17 个真实 ZIP 均安装成功，再重复安装 oak 成功，共 18 个独立实例；scene instance 与环境 script-node 的显式位置都保留。逐文件字节、脚本 UID 唯一性、17 项锁清单及正式世界/进度不变检查全部通过。

所有结果均为 `source-saved-check-blocked`，因为本预检刻意未注册引擎执行器。这里只证明真实安装计划、依赖与 Rust 源码事务通过；Godot 导入可能重写 `.import`，完整 broker expectedFiles、托管检查、采用、视觉与游戏表现仍应由新的正式成品验证。不得把此预检计为引擎通过。
