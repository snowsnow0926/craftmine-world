# 首批预制素材 Windows 成品（2026-09-12）

## 成品与范围

冻结源码为 `fcf0ece21abf53a52e42530dccb3a00716694713`。本次成品包含 16 个自然/建筑静态物件、自然环境模块和林间入口组合场景，共 18 个内置源码包；同时包含模型素材搜索/读取/安装提案、静态模型精确选中、受控 GLB 导入设置、实例位置解析和源码安装等待时间修复。

安装包：`D:/cm-promo-loop-0912/desktop/build/releases/fcf0ece21abf-a621cd20-365e-4f45-8470-587075b12da5/output/Craftmine-World-Setup-0.14.4-preview.12.exe`。

- 大小：365935569 字节。
- SHA-256：`45cb5b4377ca6434f824ff5f82c7a1eb00b5dfb83605fa295ad61201d21f508d`。
- 产品清单：1629 个文件，1009486404 字节。
- 构建退出码为 0；安装包解包后的内容校验 `installerPayloadVerified=true`。

构建原始证据位于该 release 目录的 `run.json`、`package-evidence.json`，日志为 `test-results/prefab-final-installer-build.log`。这证明构建与安装包内容一致，尚不等同于在用户机器上实际运行安装向导。

## 验收口径

开发者按固定清单组成的场景只验收素材、场景质量和安装链路。普通玩家模型复用另用真实配置和自然愿望测试，独立记录实际引用、修改、检查与采用。两个结果不得混为模型自主创作成功。

最终包的林间入口成品演示已通过：两包正式检查、采用、实际步行穿门、保存和冷重开完成。报告为 `D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/report.json`，SHA-256 为 `5ab06cd678b69ac2a0e214c4bb35efcc6cee4e283e4694b42e73c298cb250661`。这是零模型调用的开发者布置示例，不能计入模型自主成功率。对比图册为 `D:/Craftmine-Prefab-Preview-20260912/index.html`。

橡树真实模型跟进经过 14 次普通调用，检查和采用完成，但没有复用橡树：实际调用底座 `creation_operation` 生成默认 `tree`，没有新增橡树场景引用，也没有调用素材库。该模型结果应判定为素材复用未达成；工具语义和指南的后续修正不包含在本文件列出的冻结包内。原始测试与失败记录保留，不能用后续修改冒充这版首次成功。

素材许可与原始字节随成品提供。首批静态门洞、树木和城墙不代表交互开门、角色动画、战斗或驾驶已经完成；下一批应增加可组合并可保存的行为组件，而不是仅扩大模型数量。

## 工具语义修复后的新包

后续冻结源码 `fc58b4237f5a01494c0a867e41ad7ca99ee97926` 保留相同素材与运行逻辑，补充 `creation_operation` 即时说明和 `creation-sandbox.authoring` 1.6.4，明确底座生成器不代表已安装的 GLB/场景，保留源码身份、目标与采用约束。31 项接口、指导及生产插件打包测试通过。

新的安装包为 `D:/cm-promo-loop-0912/desktop/build/releases/fc58b4237f5a-9efd801e-dfc5-45cc-8b15-04583b907eb0/output/Craftmine-World-Setup-0.14.4-preview.12.exe`，365966071 字节，SHA-256 为 `2317089254e1b0864e108fde67dc5f52fb0814587df6c48fd92a9df165c5bd81`。构建退出码 0，安装包解包校验通过；产品清单 1629 文件、1009512294 字节。原始证据在该 release 目录，日志 `test-results/prefab-semantics-installer-build.log`。

这版正用原会话自然纠正测试；即使成功，也只能证明连续纠正能力，不能改写上一版首次复用失败或推算首次成功率。前一版冻结成品与证据均保留。
