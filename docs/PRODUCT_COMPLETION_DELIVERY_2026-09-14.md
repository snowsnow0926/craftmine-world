# 五项产品功能与 Windows preview.23 交付

2026-09-14，[五项开发方案](PRODUCT_COMPLETION_PLAN_2026-09-14.md)的软件范围已完成。继续在原 PI Desktop 上提供世界、对话、素材库、编辑器和设置；Windows 成品源码固定为 `76e8c0a9ba6abf875db3302c313542a7d27b5654`。后续提交只补充测试和文档，不改写已封包程序。

## 功能与入口

| 已完成功能 | 玩家入口与结果 | 验证记录 |
| --- | --- | --- |
| 可配置玩法组合 | 素材库的玩法组合固定引用已有版本，生成可编辑请求；Agent 制作实际收集、伙伴与飞行规则。 | [城市与飞行](ACTUAL_CITY_FLIGHT_PLAY_2026-09-14.md) |
| 多轮创作与需求保留 | 创作侧栏的作品目标、保留要求、建议采用和继续修改；版本认可与原生检查分开。 | [连续修改](PRODUCT_CONTINUATION_ACCEPTANCE_2026-09-14.md)、[会话恢复](CODEX_HISTORY_RECOVERY_ACCEPTANCE_2026-09-14.md) |
| 可视化制作 | 原对象编辑器的摆放、移动、旋转、尺寸、颜色、临时预览、取消和撤销；确认后正常检查并采用。 | [最终解压版实测](EXTRACTED_PREVIEW23_FINAL_ACCEPTANCE_2026-09-14.md) |
| 玩家接入 Codex | 后端设置中的兼容安装发现、路径选择、登录、取消、验证和故障恢复。 | [接入与反馈](PLAYER_ACCESS_FEEDBACK_ACCEPTANCE_2026-09-14.md) |
| 分享与反馈 | 世界模板交换；反馈预览、可选截图、导入去重、回复与创作输入框交接。 | [双档案反馈](PLAYER_ACCESS_FEEDBACK_ACCEPTANCE_2026-09-14.md)、[最终模板复现](EXTRACTED_PREVIEW23_FINAL_ACCEPTANCE_2026-09-14.md) |

具体操作见[玩家指南](PRODUCT_PREVIEW23_PLAYER_GUIDE_ZH.md)。直接复用兼容素材、导入模板、游玩与受支持的编辑不需要模型；自然语言创作使用玩家自己的兼容 CLI 和登录，不分发开发者账号。

## 最终 Windows 成品

- 启动：`D:/Craftmine Releases/Product-preview23-76e8c0a9/START-PLAYER-PREVIEW.cmd`。
- 完整 ZIP：`D:/Craftmine Releases/Product-preview23-76e8c0a9.zip`，1,141,577,714 字节，约 1.14 GB。
- SHA256：`06e60c0fc2c2e5629de2be5193937f16a85590497f187a737f8cde8da961694b`。
- 含说明与模板的完整解压内容 2,225,835,243 字节，约 2.23 GB；8,453 个文件逐一校验一致。
- 启动器使用 `%LOCALAPPDATA%/CraftmineWorld-FirstCreationPreview23` 独立档案。完整保留目录，不要只复制 EXE。

包内有四个可复用模板：庭院、伙伴与雨、博美与编辑过的树，以及轻雨城市／博美／歼二十。在“我的模板”导入 `examples/` 中的 ZIP，再创建自己的世界。城市模板 SHA256 为 `780615c946006035c82d7002c9ff814180027b84cd65cfbb3bfa83d11e3af25e`，保留作者已经完成的 3/3 任务、五项库存、一次起降与博美两次互动及等待状态。[城市说明](PRODUCT_PREVIEW23_CITY_PLAY_GUIDE_ZH.md)说明实际起点与操作。

`DELIVERY.json`、`seal.json`、`package-evidence.json` 与 `EXTRAS.json` 固定应用和随包内容身份；ZIP 同目录的校验文件记录压缩与解压核对。包内 `resources/source/`、`resources/blender/source/` 和 `resources/licenses/` 保留对应源码与第三方材料。发行目录和 ZIP 封包后未修改；[紧凑交付证据](evidence/product-preview23-closeout-20260914/release.json)记录关联。

## 最后修复与真实模型验收

原城市长会话暴露了中止确认丢失、历史恢复超长、文件校验过慢，以及应用更新后完整重建产物冲突。最终实现保留原生中止确认并排空输出、验证后恢复旧会话、分段恢复必要的长历史；文件完整 SHA 校验在固定 Worker 中执行；不同完整构建作业使用独立不可变产物目录，同一调用仍保持幂等。旧产物、失败记录和工具链校验保留。

最终 Windows 包中，原 `gpt-6-astra / xhigh` 会话直接续接，以未再修改的 rev14 草稿完成完整构建与检查。本轮主机耗时 **118.797 秒**。作业 `gjob-e7eca52be1f4a5db4949f9508dd07d430103ef166b3a434e8972908ac09cd904` 通过，全部 10 个文件共 52,674,672 字节完成校验：Worker 41ms、Main 等待 108ms，完整原生检查 8.087 秒。同一旧档案此前 Main 校验耗时 21.277 秒，是单次实测对比，不是所有机器的固定性能指标。

模型结束时如实报告“等待回合结束后采用”。随后普通自动采用队列实际变为 `applied`，正式构建为 `gbd-5eca401ecb43674379b3ba8eba42d16a1dbb8300fd93b5b9ab2631bfe2fd2a76`；不是根据模型声明推断已采用。进度迁移前后哈希一致。[检查与采用摘要](evidence/product-preview23-closeout-20260914/authoring.json)保留真实作业、终态回执、包身份和正常退出证据。

采用后实际验证博美直线穿行、E 抚摸、H 跟随／等待、保存和冷启动；库存和完整飞机记录保留，见[博美实测](ACTUAL_PET_CONTACT_ACCEPTANCE_2026-09-14.md)。随后经普通界面发布并导出最终城市模板。一次导出因目标文件已存在返回 EEXIST，旧文件归档后新目标正常导出；失败回执 `052-export-final-city.json` 保留，没有覆盖旧模板或伪造首次成功。

## 最终验收范围

真正从发行 ZIP 解压出的 EXE 和包内资源完成两轮独立后台验证：视觉编辑／撤销／分享／独立导入约 **5 分 47 秒**；最终城市导入／游玩／保存冷开约 **1 分 3 秒**。均为 **0 次模型调用**，七次应用启动均正常退出，全包文件清单前后相同；八个普通 Godot 检查作业全部通过。城市导入、保存、冷开各 30 项状态检查通过，完整进度冷开精确一致。详见[最终解压验收](EXTRACTED_PREVIEW23_FINAL_ACCEPTANCE_2026-09-14.md)。

双档案反馈完整往返已在本轮源码客户端验证；真实反馈转创作、修复、最终采用与再发布在对应候选和最终包中分别记录，不宣称所有反馈场景又在最终解压包重跑了一遍。最后的 Rust 联合回归为 Godot 149 通过／1 个既有忽略，备份 26 通过／3 个既有忽略；反馈与目标四张表已补入完整、便携和领域备份注册。构建、资源暂存、源码包、封包与完整性校验通过。

测试没有抢占真实鼠标键盘、置前窗口或请求 Pointer Lock，未给玩家模型添加 token、调用次数或整轮预算上限。原生输入只作用于独立后台进程。自动化验证不能代替长期手感、美术认可或外部新玩家反馈。

这是未签名的本地 Windows x64 预览版。干净外部 Windows、新账号兼容 CLI 安装及真人试玩尚无完成记录；已有软件流程和试玩材料可直接用于后续测试。任意脚本对象或任意 GLB 不承诺支持全部可视编辑能力。

## 时间、用量与收尾

[真实创作用量](PRODUCT_AUTHORING_USAGE_2026-09-14_ZH.md)区分普通生成、应用故障调试、历史维护和零模型模板复用；没有把缓存输入当输出或把未知失败计数记作零。

本轮交付合入本地 `main`，不自动推送 GitHub。四个本轮工作树完成合并后按归属清理；原始 `test-results` 与 `desktop/build/releases` 迁入 `D:/Craftmine Archives/product-completion-20260914/` 对应子目录，`LOCATION.json` 记录原路径与新位置。`D:/cm-*` 实测档案、共享构建缓存、本版完整成品及实际解压验收副本、preview.21／22 和已认可演示归档保留。原报告中的绝对路径是测试发生时的位置，归档后按映射查阅。
