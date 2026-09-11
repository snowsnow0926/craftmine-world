# 已审核历史 creation 采样合同的 PCK 兼容

日期：2026-09-12。实现基线：43203d8e。

## 实机证据与目标

只读 desktop-native-complete-KsYZ7Y 的 plugin.log，恢复档案激活后，正式源码重建作业明确以 CREATION_PACK_SOURCE_PIN_MISSING 失败。stageArtifacts 对 creation-sandbox 的 index.pck 一律调用五固定源验证，而旧 PET02 正式源码只有此前审核过的三固定源。

恢复要按原已采用源码重建，不能通过偷偷替换狗脚本、共享采样器或存档来满足新合同。本轮仅增加已审核历史源的精确兼容，原当前核心 check requirements 保护未改。

## 历史 profile 的选择

内置白名单固定到提交 `940c5a84702a5ac85cbaa2de583b62ad0a5cbab2`。三个文件分别只有已审核的 LF 和 CRLF 两种 SHA-256/bytes 组合：

| 文件 | LF SHA-256 | LF bytes | CRLF SHA-256 | CRLF bytes |
| --- | --- | ---: | --- | ---: |
| base_adapter.gd | edf0f6efe5ed9381f7fca2b7365cbba6062463a4ebb489191086e734af3765ee | 9456 | b381b17a4c26176fa257a843fcd5d11e48ce0ea16252961c7d8f619ba14962c5 | 9667 |
| runtime_bridge.gd | faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2 | 6958 | 4424aa350e3c2bcd8783c73a1adcb2a455b9c1ca2c4b4200a886d4eaa6966ac1 | 7104 |
| state_guard.gd | a1e524c8b45743244651b17c33c8ab916fad0b9f5809f9cbc3dc519a10562f20 | 1759 | 9b3bb64b8515b0937e9e884999cfe10684d16d4a2b0af53140cc2a81dcc11293 | 1800 |

路径前缀均为 craftmine_shared/。三个源 pin 必须各自唯一且全部匹配；source 和 PCK 中都不能出现新 headless_play_action.gd、scene_mesh_picker.gd 或其大小写、.remap、.uid、.gdc 等别名。完整旧合同混入任意新 helper 明确拒绝。未知、半旧、缺失或篡改后的三源不能按文件数量获得放行。

选定历史 profile 后仍解析实际 PCK，检查三个文件的真实 byte length/SHA-256、路径别名、目录范围、各条目的 MD5，以及 project.binary 中两项固定桥接选择器。没有跳过导出后实际 bytes 检查。当前五文件路径继续原先的可信 source pins → 实际 PCK 逐文件绑定，不额外声称这些 source pins 支持新能力。

## 证据标记与能力边界

proof 的 format 仍为 craftmine.creation-pack-proof/1，新增 observerContract：

```json
{
  "profileId": "creation-observer-940c5a84",
  "sourceCommit": "940c5a84702a5ac85cbaa2de583b62ad0a5cbab2",
  "historical": true,
  "sceneObjectTarget": false,
  "headlessPlayAction": false,
  "requiresNormalMigration": true
}
```

当前路径仅标记 `{profileId:"current-source-pins",historical:false}`，不提供未经证实的能力布尔值。历史 profile 由封闭的源码哈希集合推导，没有请求参数、环境变量或模型可选的降级开关。

旧 adapter 不会重新计算普通源码返回的新 sceneObjectTarget 字段，所以该字段不能因历史 PCK 验证通过就获得信任；新通用捕获与输入必须通过总控正在实现的当前五固定源哈希 gate。恢复旧版会保持旧能力直到正常迁移，不能把历史 proof 当作新捕获/输入授权。

## 验证

- 10 项 PCK 合同测试通过，含精确 LF/CRLF 源、源码/PCK 缺失与单字节篡改、版本混用、新 helper/别名混入、编译选择器替换和旧/当前 proof 权限语义。
- 只读验证实际 PET02 正式 source 与其原始 PCK：pack SHA-256 为 a43a5def87be0b89946e232a73f68a1048aafacb98eb73130531dd400a57e170，5683892 bytes；三个固定文件实际逐项匹配白名单。
- 实际字节证据：D:/cm-promo-historical-pack-0912/test-results/creation-pack-history-sb2Gt8/report.json。入口 tests/creation-pack-history-artifact.mjs 要求显式绝对 source 和 PCK 路径，只读原产物。
- 未运行用户 profile、模型或旧脚本，未修改原 PCK/源码/进度。真正备份恢复与启动验收由总控重试，不能将本轮字节检查称为完整恢复成功。
