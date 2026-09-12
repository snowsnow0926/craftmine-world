# 预制组件成品实测：已采用部分与一次超时

使用固定 `bafb5b180bcecbc5f2258a8d1bc032077ddc7eff` Windows 成品，沿原 `desktop-native-complete-VO4Pki` / `world-cafb76a24e7c` 继续。没有重建世界或重复安装自然环境，没有模型调用。

两棵橡树分别在 `(-4,0,0)`、`(4.5,0,-1)`，城墙门洞在 `(0,0,-4)`，三次新增组件都通过实际受控导入/导出及固定检查，随后正常预览、采用。这证明受控 `.glb.import` 和实例位置已越过本轮真实构建链路；不等同所有素材或自动选材都已验证。

最后城墙导入返回 `TIMEOUT`，首次续跑退出出现 `PLUGIN_HOOKS_CLOSE_TIMEOUT`。原报告完整保留，不能报告五组件演示全部通过。只读安装 journal 和 SQLite 确认城墙已写入源码 revision 6，实例为 `ins-cfdeb2e8a8f191e1cc91fd71`，检查作业 `gjob-e5ca9b690e45296e970c35809c0bc28afe602cebe4612f06b015feab3433479e` 后为 `interrupted / import / GODOT_HOST_RESTART`。没有重发安装或创建重复实例；后续应恢复检查已有源码。

为先保留可见成果，新增 `tests/builtin-prefab-capture.mjs`：只读取该报告中已确认采用的正式 build，进行普通相机观察、截图、保存和冷重开，不调用安装、修改源码、任务恢复或模型入口。两次启动的 `violations/pageErrors/shutdownFailures` 均为空，原报告和 marker 保持字节不变。正式 build `gbd-37b4837b233ced47f7b297cffa4606be78b8a1fb9d2413032e8bbd3772b56f88` 保存重开后相同。

实际画面显示两棵有树干/树冠的低多边形树、草地材质与环境光；门洞目前从侧面观察，像一段竖立墙体，不能靠此图证明正面门洞效果。未采用的最后城墙不在正式截图中。所有图片均明确属于开发者布置预制组件演示，非模型生成作品。

证据根：`D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/`。

| 路径 | 证据 |
| --- | --- |
| `report.json` | 首次类型解析失败原现场，自然环境已采用 |
| `resume-202ec43f-2e20-4467-a9cb-be42fa2a3a42-report.json` | 本次两树与门洞成功、最后城墙超时及不完整退出 |
| `adopted-prefix-c171acdf-ad5a-4f19-aa76-cdf96382c5e9/report.json` | 已采用部分的独立零模型截图/保存/冷重开，ok=true |
| `adopted-prefix-c171acdf-ad5a-4f19-aa76-cdf96382c5e9/adopted-prefix.png` | 实际两树、地面和侧向门洞 |
| `adopted-prefix-c171acdf-ad5a-4f19-aa76-cdf96382c5e9/reopened-prefix.png` | 冷重开后的同一正式世界 |

报告、profile 和截图未纳入本提交；未修改受测包或原作品源码。
