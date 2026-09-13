# Codex CLI 宣传片内容开发

本轮从 `master@6c0de348` 创建 `codex/promo-agent-20260913` 独立工作树，合入
此前的内置 Blender、白色博美和歼-20 建模成果。用户授权继续使用 Codex CLI
作为项目调用的 Agent，按原宣传片方案推进开发。保留工作树以便继续审阅；
本轮不发布或覆盖用户正在使用的客户端。

## 本轮要补的通路

现有桌面支持 OpenAI 账号模型，但创作循环仍由 PI 执行；前一轮 Codex CLI
通过临时适配器验证了 Blender 建模，尚不等于项目已具备可持续的 Codex 创作
入口。本轮把 CLI 调用、宿主绑定的世界工具、同一世界续做、取消、错误与用量
记录接成可复用入口，再由该入口执行真实愿望。模型固定为 `gpt-6-astra`，
思考强度为 `xhigh`；实际运行元数据必须与选择一致。

开发者 CLI 可以修改本工作树。项目调用的内容 Agent 只使用授权的世界工具，
由宿主绑定身份；模型生成的 Blender Python/GDScript 沿用现有原生执行边界。
普通世界源、任务和进度继续归 Rust 管理，不另造一套宣传片世界数据库。

## 推进顺序与交付结果

| 顺序 | 原分镜 | 要实现的体验 | 验证重点 |
| --- | --- | --- | --- |
| 1 | A01–A03 | 空白 3D 世界中生成树，再增加花草 | 同一世界与会话，原树保留，真实渲染、碰撞与可行走空间 |
| 2 | A04–A05 | 生成狗，再把同一只狗改成可爱的白色博美 | 身份和已有行为保留；模型外观由实际多角度画面复核 |
| 3 | A06–A10 | 怪物、巨怪挑战、获得 AK47 并击败巨怪 | 玩家输入导致攻击、命中、受击和死亡；打偏不扣血；保留战斗状态 |
| 4 | B01 | 雨正常下落、停在半空、倒流并恢复 | 技能实际可触发；玩家仍能移动；保留真实模型、耗时和 token 口径 |
| 5 | B02 | 驾驶歼-20，转向、爬升、下降和变速 | 飞机运动响应输入，具有可用驾驶视角；不以固定航线代替驾驶 |
| 6 | B03 | 可步行探索的整座奥格瑞玛风格城市 | 主路、广场、侧路和分区相连，城市规模与辨识度分别记录 |
| 7 | 拍摄准备 | 各镜头实际画面、原始输入、版本和用量索引 | 分清连续主线和独立世界，不把拼好的画面写成一次生成 |

A 主线保持同一世界逐次创作。雨、驾驶和城市可按原方案使用独立世界，各自
记录来源。宠物步骤失败不应阻塞不依赖它的怪物开发，但不能因此把完整主线
标成通过。旧诊断与本轮证据分开保留。

先验证可玩的内容，再制作镜头和剪辑；用户尚未选定的梦境结尾保持候选。
音乐音源、精确节拍与片长未定，不阻塞当前功能开发，也不虚构已完成成片。

## 可复用资产与当前限制

- 可爱白色博美：GLB 3,753,144 字节，104,101 三角面，SHA-256
  `1ab9f354598df75504b061fb06e1e5e386bd59c878afcec3bad8388832dadd0b`。
- 歼-20：GLB 1,130,080 字节，41,884 三角面，SHA-256
  `458105858e12f513dbef111672e83a9897f274796d4321358425a479f094bafe`。

两者来自此前 Codex CLI 读取 AI 参考图后编写的 Blender 脚本，已通过实际 GLB
导入和渲染。它们都是静态资产：博美偏毛绒玩具风格，毛发几何尚需按场景负载
评估；飞机座舱与进气道、喷口内部简化。复用这些资产必须明确记录来源，不把
加载已有模型计为本轮从零建模，也不把模型存在等同于动画、跟随或驾驶完成。

## 运行和证据

不额外设置 token、模型请求次数或整轮时长上限。用户叫停时按正常取消链路
停止，已生成资产和草稿保留。产品原有文件大小与原生单作业约束仍如实返回。
历史文档中的 10/40 次调用诊断上限不适用于本轮正常创作。

全部验证使用独立后台进程与测试档案；不抢鼠标，不发送真实键鼠，不请求
Pointer Lock，不激活测试窗口或操控用户的浏览器。检查依次区分：协议测试、
真实 Agent 调用、源码导入、引擎构建、应用、实际交互、保存重开和视觉复核。
任何一项未做都保留为未验证，不由前一项自动推断。

本文件是开发安排。实际结果追加到 `docs/evidence/codex-promo-20260913/`，
原始日志、输入、资产和隔离档案放在 `test-results/codex-promo/`。

## 已落地的项目入口与后台检查

`scripts/codex-world-author.mjs` 是项目直接调用 Codex CLI 的创作入口，当前表面
是项目命令行，尚未接入桌面对话框。`scripts/promo-world-author.mjs` 在该入口
上装配现有 `GodotBuildVerifier`：在独立后台 Electron 中检查候选的真实启动、
画面、运行错误、进度兼容性和隔离行为，保留实际 PNG 与检查记录。它不伪造
首次进入世界或候选采用的回执。

```powershell
node scripts/promo-world-author.mjs init --data <新档案绝对路径> --runtime <运行组件目录> --plugin <当前编译插件目录> --world promo-mainline
node scripts/promo-world-author.mjs turn --data <同一档案> --codex <codex.exe绝对路径> --prompt "我想生成一些树。"
node scripts/promo-world-author.mjs turn --data <同一档案> --codex <codex.exe绝对路径> --prompt "我希望地上有花草。"
node scripts/promo-world-author.mjs cancel --data <同一档案>
```

后台服务的隔离与非法描述符测试入口为
`node --test tests/promo-godot-check-service.test.mjs`。实际原生检查入口为
`node tests/promo-godot-check-native.mjs <运行组件目录> <当前编译插件目录>`；
它使用未修改的官方空白底座，不调用模型，不代表宣传内容已通过。

首次原生联调发现：新世界通过检查后，尚不存在正式运行实例，构建读取时的
采用状态核对会抛出 `GODOT_WORLD_NOT_INITIALIZED`。现仅对该明确状态保留原
检查结果；仍不标记为已采用，其他运行时错误和世界切换继续拒绝。修复后真实
导入、导出、后台检查和画面保存通过，原失败记录保留。

## 既有模型的显式复用

`scripts/promo-model-library.mjs` 读取本轮已准备的素材清单，核对模型字节、
SHA-256 和 GLB 头，再通过同一世界的正常源文件事务导入 `assets/library/`。
事务使用实际源索引中的 Git head 和 manifest，拒绝覆盖已有文件，导入后从
Rust 分页读回并核对完整哈希，确认正式构建和玩家进度没有变化。该操作由操作者
显式选择素材，未向内容 Agent 开放主机文件读取或通用 RPC。

```powershell
node scripts/promo-model-library.mjs list
node scripts/promo-model-library.mjs import <档案绝对路径> j20
node scripts/promo-model-library.mjs import <档案绝对路径> pomeranian-cute
```

本轮清单及原素材位于 `test-results/codex-promo/reusable-assets/`，来源为前一轮
交付的模型包。导入回执写入对应档案的 `asset-imports/`，明确标记
`generatedThisTurn:false` 和 `applied:false`。飞机素材已在独立飞行档案完成
完整读回校验；随后提交原始驾驶愿望，由 Codex 编写实际玩法。

整城参考图保存在 `examples/promo/references/`，覆盖城门、主城区和相连侧区。
它是 AI 设计参考，不是已实现世界的截图或经过测量的地图。
