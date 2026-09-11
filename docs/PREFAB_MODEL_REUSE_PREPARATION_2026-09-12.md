# 预制演示世界的普通模型复用验收准备（2026-09-12）

本轮仅准备，没有启动成品、调用模型或改写测试档案。只读查询原演示档案 `D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/profile/pi.sqlite` 的 sessions 表，当前为空；原演示本来就是开发者布置，不应伪造一个模型会话或普通玩家报告。

## 最小入口

现有 `tests/promo-real-player.mjs` 新增显式 `--create-session`：只接受已成功且完整性验证通过、没有 sessionId 的 `craftmine.builtin-prefab-demo/1` 原报告。prepare-only 只展示待执行内容。live 在已有隔离状态检查之后，连接同一独立 Electron 自己的 loopback CDP 主 renderer，用现有 `piDesktop` 白名单 IPC 读取 sessionList，确认无会话后执行一次 sessionCreate。发现任何既有会话就停止并要求明确复用，不猜测或替换。创建前通过普通 workbench.capabilities 的世界身份校验。

返回的真实 sessionId 进入正常 playerSetup、godot.creationTarget、agentPrompt。实际 world/session 绑定仍由产品 bindCraftmineTurn/turn.begin 完成，驱动不写 DB、不伪造绑定、不改产品权限。新报告保存 sessionCreation 回执，原 demo 报告保持不变。使用 actual-player-config-20260912.json 和已有 secrets 配置，不启用 CREATION_EVAL，不加模型次数/token/总时长上限。

待 demo 完成，使用其最新成功报告：

```powershell
$env:CRAFTMINE_LIVE_CONFIG='D:/Craftmine World/.craftmine/secrets.json'
node tests/promo-real-player.mjs <成功demo报告绝对路径> D:/cm-promo-loop-0912/test-results/actual-player-config-20260912.json <愿望文本绝对路径> --create-session --packaged-root <同一冻结成品>
# 核对 prepare-only 后，再加 --live；本轮尚未执行。
```

愿望原文：**再放一棵橡树在左边，和已有的树错开。** 不补坐标或素材 ID 答案。若模型需要玩家选择落点，按实际观察澄清；不机械选择首项。

## 真实复用证据与后续采用

报告从本轮新增的真实会话 tool 行提取 `sourceLibraryCalls`，包含 godot_source_library 的实际 toolArgs、toolResult、toolStatus 和 toolCallId。分别核对 search/read/propose；没有调用就记为没有调用。新会话还通过正常 package.request/sourceProposals 读取提交前后提案快照。完整 latest.record 保留原始会话，不把工具配置存在当成调用证据。

模型结束后检查实际提案：同 world、确切 archiveRef 和来源源码版本；明确位置需有真实依据。确认对应本次愿望后，走现有普通 UI 的 package.request/installSourceProposal，参数只含 worldId/proposalId；不要直接传 ZIP 或自己替模型生成 proposal。提案已由产品持久化，可以同 profile 正常重开读取。随后读取 sourceJob；检查通过后才 candidateRead/Preview/Apply，再保存冷重开与真实截图。新报告中的 library 调用、提案、安装回执、候选必须逐项相互对应。本补丁只准备输入与证据记录，不提前安装任何模型提案。

3 项离线接口测试通过：精确普通 API 创建、已有会话拒绝替换、世界变化在创建前拒绝；脚本语法检查通过。测试模拟 IPC/CDP，不宣称实机入口或模型复用已通过。
