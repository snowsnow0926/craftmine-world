# 宠物真实运行时集成检查

基线 `91a61dbe`，独立工作区 `D:/cm-pet-integration-0912`。使用该源码的正式 `buildBuiltinPetPackage` 构建并保留原始 `cw.module.pet-companion.zip`，核对来源要求后解包到 `materializeBase` 新造物世界。薄场景仅在同根添加 FirstPet/SecondPet、各自 entity_id 与 `../Player` 绑定；不修改包内行为/视觉文件，不打开用户、qQ 或 VO 档案。

## Native 主要整链通过

真实 Godot 4.7.2 headless 引擎与生产 runtime bridge 执行 load/resume/look/walk/interact/pause/save，未直接改演员位置或传送追赶。玩家通过 walk 移动，两犬从 `(±2,0,4)` 跟随到约 `(±0.7505,0.0001,0.6074)`。对准 FirstPet 后正常 bridge interact 返回 pet-first，计数变为1、第二只保持0；直接调用生产 `runtime._input(InputEventAction)` 的正常 E 分支后第一只计数变为2、第二只仍为0。这是纯引擎函数路由检查，**没有发送真实 E 键，没有调用 Input.parse_input_event，也不称硬件试玩**。

实际世界 status_label 在树内可见，内容为“初一开心地回应了你的抚摸”，等待后恢复原 WASD/E/F2 操作提示。通过组件公开运行时 setter 把第一只 following 改为 false、源码默认仍为 true，再经真实 bridge save 得到完整 JSON 与 SHA receipt；这一步明确用于验证运行设置与源码默认的区别，不声称已有玩家跟随开关 UI。

只修改测试薄场景中 FirstPet 的源码导出 companion_name=雪球、appearance_key=pomeranian-white，entity_id 不变。另开真实引擎取得新 defaults，经生产 `deriveAdditiveProgress` 合并旧 save，验证只更新对应默认设置；第一只位置/yaw/count2/运行 following=false、第二只完整状态、玩家及原生世界进度全保留。再起引擎通过 runtime.load 恢复合并状态，真实子场景引用白博美 GLB，第二只仍为 dog GLB，完整 JSON 相等。save 后再次冷启动 load，仍精确一致。

成功报告：`D:/cm-pet-integration-0912/test-results/pet-integration-GzyhBv/report.json`。新 defaults 7 项、迁移加载13项、冷启动13项检查通过；沿用真实 gameplay 的25项已完成检查及其原始保存字节。ZIP SHA与全部非 `.import` 包正文保持；Godot 按正常流程更新安装副本的 `.import` 导入缓存声明，原ZIP未改变。

## 保留的驱动断言问题

- `pet-integration-7iuxCX/report.json` 保留失败：真实 gameplay 和 save 已成功，但驱动将原始 JSON 字符串与 parse 后重新串化结果逐字比较，遇 stateVersion 的 `1` / `1.0` 表示差异。修为原 receipt 字节 SHA 加完整解码值相等；复用原 `gameplay-save.json`，没有编造进度、重写旧报告或重复 gameplay。该早期阶段文件含 error 字段，不能只看它曾写出的 ok；总报告明确失败，驱动随后修正错误标记不会被末尾覆盖。
- `pet-integration-zeZc5U/report.json` 保留失败：真实改外观恢复已通过，额外测试将原生 Cylinder float32 半径与 GDScript double `.36` 精确比较。只对几何半径改用引擎浮点精度比较；实体身份、保存 JSON、玩家/组件状态仍逐字段精确比较。

## Web 附加检查发现的真实阻断

随后将成功 Native cold-save 放入同包同薄场景的真实 Compatibility Web 导出，通过生产 `createWorldRuntime` 和 bridge load 恢复，返回：**Component restore did not preserve state: pet-first**。报告：`D:/cm-pet-integration-0912/test-results/pet-integration-GzyhBv/web-pNNkIM/report.json`。

因此 **Native 集成通过不等于 Native→Web 恢复通过**；本轮尚无成功的 Web 集成反馈截图，不能以先前独立外观 viewer 图片替代。具体差异字段待后续独立诊断，当前未确认原因，未放宽组件校验或改状态救结果。

全部检查0模型、无OS键鼠/Pointer Lock/窗口抢焦点。普通犬保守碰撞直径1.5米，可能通过不了森林1.4米门洞；本结果只覆盖本次平地跟随、互动与Native保存恢复，不代表寻路、所有地形或窄门通行完成。
