# preview.24 玩家问题修复验收

## 交付身份

最终程序源码为 `c04cef7e13e30e77460ae12f1bd29546173aeea1`，版本 `0.14.4-preview.24`。
之后的集成提交只补测试、证据和文档，不更改密封成品。

- 目录：`D:/Craftmine Releases/PlayerFix-preview24-c04cef7e`。
- ZIP：`D:/Craftmine Releases/PlayerFix-preview24-c04cef7e.zip`，1,141,834,498 字节。
- SHA256：`179de9ef34b1ad64c813711ab627a1aba012c649744c5f0c217cba1731363c74`。
- ZIP 实际解压后的 8,456 个文件逐一比较通过，共 2,226,099,369 字节。
- 实际解压副本位于 `D:/Craftmine Releases/PlayerFix-preview24-c04cef7e.verify-70651ec5-4d9c-4ade-9dc9-08e93af5714c/PlayerFix-preview24-c04cef7e`。

继续原试玩档案使用成品中的 `docs/CONTINUE-PREVIEW23.cmd`，先保存、关闭旧应用。
默认 `START-PLAYER-PREVIEW.cmd` 使用新的独立 preview.24 档案。详细步骤见
[修复版使用说明](PLAYER_FLOW_FIX_PREVIEW24_GUIDE_ZH.md)。没有启动用户正在使用的档案，
没有将本次测试世界写入用户资料。

## 真实“再给我生成一只小狗”

使用独立后台成品进程、全新 `promo-mainline` 副本和产品原有创作流程，实际选择
Codex CLI `gpt-6-astra / xhigh`、全自动，原样发送“再给我生成一只小狗”。没有添加
模型调用、token 或整轮时长上限，没有手动安装或确认代替自动采用。

- 世界：`world-bd900f064cf2`。
- 会话：`d8e5b82a-8a52-44c8-ab5f-c081f545bc95`。
- 回合：`e3c0d53b-817d-4006-a0e8-2217a614b453`，真实耗时 331.721 秒。
- 构建：`gbd-0bdc0cfdcaa4414f6964971353f7a6b66f03bf805718acdf951e5d2960a7b572`。
- 检查通过并由产品自动采用；原 `pet-dog-01` 小麦与新增 `pet-dog-02` 小白同时显示。
- 保存、正常退出、冷开后实例 ID 改变，同一构建和两只狗的完整状态保留。
- 两次应用都正常退出，输入、前台、页面错误及关闭审计均为空。

本轮模型选择读取现有项目和模型资产后复制狗的独立源码实体，没有走新的
`godot_source_library install`。新的单个／组合安装另外经过真实 Rust Core 的作者任务、
防重复、外世界拒绝及实际取消后写入拒绝测试；执行器未注册时检查真实为 blocked，
不把这些 Core 测试称为完成模型或 Godot 检查。

小狗创作使用的成品源码为 `a5084f7d80ac`。后续 `c04cef7e` 仅在该成品基础上改进指导
分页说明和提前报错；Main、headless preload、Core、Host、Godot broker、作者安装模块、
插件视图七个关键运行文件与最终包 SHA256 完全相同。该创作不能标为最终包逐字节全包验收。

冷开后采样前已恢复运行，六只原有巡逻怪物的坐标和朝向发生 24 个数值变化；完整差异
保留，不能宣称整个运行快照完全一致。两只狗、玩家、武器、背包、首领及其他状态没有差异。

本轮用量由已结束回合的真实消息导出：未缓存输入 198,548、缓存读取 1,544,704、
输出 6,155，总计 **1,749,407 token**。推理明细 2,356 已包含在输出中，不重复相加。
物理模型调用数和费用未报告；不将事件或累计快照当作调用次数。

证据根目录：`D:/cm-player-dog-fix/test-results/desktop-native-product-ZgZfL2/`。

- `double-dog-acceptance.json`：两只狗完整状态、完整冷开差异、成品范围和正常退出。
- `continuation-4282a97a-4a1b-45cf-b7e6-ba2da8931d75.json`：完整操作报告。
- `dog-final-usage.json` / `.md`：去重后的真实回合用量及来源。
- `captures/1789372368292-fb775a26-981a-46d5-bf98-c021812f3d56.png`：冷开后两只狗同屏。
- 初次 driver 错将城市组合用于 mainline 的 `FORM_DISABLED` 报告仍保留；当时未调用模型。
  修正测试入口后继续同一独立世界和会话。真实模型曾用 16,000 / 12,000 字符读取指导产生
  两个分页错误；保留原始回合，最终包已补 1–8,000 限制说明和提前诊断，没有篡改旧记录。

## 针对性验证范围

已通过候选协调器及真实视图函数恢复测试、Codex 创作与评审 33 项运行时测试、17 项独立
headless 界面检查、分页／素材／指导兼容测试、作者安装和真实采用状态测试，以及 4 项
真实 Rust Core 安装测试。JavaScript 成品构建成功。

两套已淘汰 catalog 接口测试在未修改基线上仍有 23 项失败；桌面完整 TypeScript 检查
仍有两个现存 `.mjs` 模块声明缺失。没有降低旧断言、伪造通过或把针对性结果称为所有测试通过。

真实候选刷新恢复和网页树创作结果在执行结束后追加。Windows 外部干净机器与真人长期
操作手感不属于本次后台自动验收。
