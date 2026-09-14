# 博美穿行、抚摸、跟随与存档实测

2026-09-14，在真正 `76e8c0a9` Windows 包、原 `5N6HZ2` 档案中，正常 `gpt-6-astra / xhigh` 会话完成 rev14 的构建检查与采用后，执行 `play-144..169`。博美直线穿行、E 抚摸、H 跟随/等待及普通存档冷开均通过。测试没有调用新模型、瞬移、改写数据库或直接设置玩家/组件状态。

正式构建为 `gbd-5eca401ecb43674379b3ba8eba42d16a1dbb8300fd93b5b9ab2631bfe2fd2a76`。包 main SHA256 `6c0a337893f08099c6bbb1168ddd16a44ac743ca5e0ffa140e0b734dfd4cb0d9`，包清单 SHA256 `51de0dbb2605896fe6c03e897446999dd89385f53e692c82ab07d4dbad68002d`；包内 Core SHA256 `6f7218996c688259f41f8da7ac418a2d98c0f562bc320e61f92632e1e602f509`。这是这份真实包的玩法证据，不把早先混合源码或 201 候选预验收混为本次版本。

| 实测 | 原始回执 | 结果 |
| --- | --- | --- |
| 穿过静止小麦 | 145、147–149 | 从 `(226.2559,60.9014)` 沿 W 方向走到 `(221.3239,60.0762)`；小麦在 `(222.0717,60.2325)` 不动。路径距中心约 0.0307m，两端在两侧，距离分别 4.237m/0.764m，排除绕侧通过。 |
| E 抚摸 | 151–152 | 瞄准真实博美中心，实际 KeyE 将 interactionCount 从 1 增到 2；截图显示“小麦开心地回应了你的抚摸”。 |
| H 跟随 | 153、156–157 | following false→true；玩家走动时小麦实际移动，松键等待后水平距离由约 5.714m 收敛到 1.50024m。 |
| H 等待 | 158–160 | following true→false；玩家再走开超过 5m，小麦完整状态及位置不变。 |
| 地面与控制器 | 每段 before/during/after | onFloor=true，实际 layer8/mask3，progressCollisionGuard=passed；冻结玩家高度保持 0.900763m。 |
| 保存与冷开 | 163–169 | 普通保存/冻结并正常退出冷开，新 instance `0357743d3f4628aca7300037`、同 build，完整 progress 与保存时精确相同。 |

所有输入片段都记录了真实释放结果：held keys/buttons 为空，focus/Pointer Lock guard 均为 0。冷开前的应用正常退出 code0，violations/pageErrors/shutdownFailures 全空；冷开后世界保持普通保存冻结，交还总控做后续发布。该时点没有宣称客户端最终已经关闭。

五项库存始终各为 1；通航任务保持 3/3，城市保持 6 城区/22 建筑。完整飞机状态逐段保持，包括 `flightSeconds≈4.6`、`landings=1`、`hasFlown=true`、`piloted=false`、`crashed=false`。最终小麦等待在 `(215.07152,0.0001017,60.09487)`，互动次数 2；玩家停在 `(208.21637,0.900763,60.07623)`。

rev10 修复前正式源码到 rev14 的语义变化仅为 `scripts/city_pet.gd`（SHA256 `69900c20ff38e31055c5f96c96c76956062e313621c71068a6276b62acf00aab`），外加两份诊断文档。脚本只把这只小麦切换到 layer16/mask19；玩家/城市几何/飞机/原博美包源文件逐字节未变。冷开观察的实际通路 audit 也已从旧阻挡结果变为通过。本轮未长距离重做主动撞墙/撞机或重飞飞机，不能把源码保留表述成已重新实测这些行为。

本轮是带普通存档冻结的分段功能验证。原生观测、截图和最后 checkpoint 属于异步采样；requested frames 不等于本轮完整实际运行帧数，不作持续真人手感或性能结论。

证据：

- `docs/evidence/pet-contact-76-20260914/summary.json`：原始 26 个回执哈希、三阶段原生帧链接、完整最终进度、穿行几何比较、跟随距离、源码哈希与冷开证据。
- `docs/evidence/pet-contact-76-20260914/actual-petting.png`：实际 E 抚摸画面，原图未修改。
- `node tests/product-pet-contact-evidence.mjs D:/cm-product-agent/test-results/desktop-native-product-5N6HZ2`：只读校验上述真实回执和原产物，不发送任何命令。
