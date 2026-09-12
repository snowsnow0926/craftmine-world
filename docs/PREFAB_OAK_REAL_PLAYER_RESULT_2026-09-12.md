# 真实普通玩家新增橡树：复用未达成（2026-09-12）

## 结论

真实玩家输入“再放一棵橡树在左边，和已有的树错开。”后，模型生成并检查通过了一棵**底座默认树**。本轮正常采用、保存、冷重开通过，新增树在所选左侧且与原树错开，原两棵 Kenney 橡树保留；但新增树没有引用已有橡树 PackedScene/GLB，外观和现成素材复用均未达成。没有手改作品救分，也没有追加第二轮模型。

最清楚的对比图：`D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/exploration-00b0a388-9c16-4228-9f35-160c1742c313/view-2.png`。左侧细杆椭球树为新增物件，中间和右侧是原有橡树。同行 view-1.png 的准星实际选中新树，并显示物件身份。

## 本轮配置和真实选择

受测冻结包：`fcf0ece21abf-a621cd20-365e-4f45-8470-587075b12da5`，未修改。复用原 VO4Pki 独立 profile，通过正常 sessionCreate 新建真实会话 `219eabdb-7df5-4d44-925e-660cb0311a71`；实际配置为 DeepSeek `deepseek-v4.1-flash-expires-on-0910` / max / maxTokens 384000，无额外评测配额。

模型真实问了“以哪棵树为参照”和“尺寸颜色”。按原自然目标选择“以最左那棵为准，更左边并错开”及“默认原尺寸颜色”，没有机械选择推荐首项；模型自己从源码提出的所选位置为 (-7.5,0,-2)。没有向模型补资产 ID、工具实现或坐标答案。两次权限均逐项核对本世界后 allow-once：creation_operation 和 godot_build_start。

## 可见行为与断点

模型确实读到了 scenes/creation.tscn 中两棵现有橡树及 transforms，公开回复也明确叫它们 oak。实际读取 creation-sandbox.authoring 1.6.3 的 offset 0、8000 字符，全文 9762 字符、nextOffset 8000；没有续读尾段。已返回的前部包含“常见静态外观：先查真实组件”和真实 search/read/propose 说明，不能说模型完全没收到指导。

随后公开回复为“Compiling the structured place operation against the frozen target now”，执行 creation_operation 的 place(kind=tree)，没有说明为何没有使用现成橡树。只据公开回复和工具记录，无法断言其内部选择原因。

真实工具统计：project_facts 1、capability_report 1、ToolSearch 3、project_index 4、project_query 5、file_read 7、guidance 2、asktool 1、creation_operation 1、build_start 1、build_read 1。素材库 search/read/propose 均为 0，普通 source patch 为 0。没有强迫固定工具序列；如果直接实例化已有橡树也会计为复用，但本次没有发生。

源码 revision 6→7，manifest `f72def8428739ec2f3150be01be1e57005aaa2e3b740bcefe721a68b6270ec98`。scenes/creation.tscn 的 SHA-256 仍为 `7525003abb17b64024a9f0a1564cc7d755c5fde0da7af4545e5f5268a73048b4`，原两棵橡树的 PackedScene 引用未增。world/creation.json 新增 `created-487d1e872c2bdba2145352a1`，kind tree、位置 [-7.5,0,-2]、默认色 #84A866。实际构建源码的 creation_world.gd 对 tree 生成盒状树干与 SphereMesh 树冠，未读取 cw.nature.tree-oak。

## 检查、采用与观察

真实 check：`gjob-dd004e9df6e86a88175d5d00d256c596bc70d6b34058560a4bbc2081bb63e2df` passed。候选 `gcan-f3c51688892a0e2f05d58c5553886a8fb9ee93e209183c3f511a20808830be48`，最终 build `gbd-d77451e02183ab6ba5f6e27b9f3a8ad4e36ddc1cc6f3ea5b895128da8b662e8c`。

- 原始玩家报告：`D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/player-bc9702bb-1daf-4962-8cf7-98ee0efb5c13.json`。
- 正常 preview/apply/save/cold-reopen：同根目录 `adoption-4fe041ba-b8a4-41b4-8772-7b3a1d9a318a/report.json`，全部通过。
- 首次观察：同根目录 `exploration-f2fbcf71-bd46-4c79-81c9-1026a8949eff/report.json`。新树在原树后部分遮挡，因此继续正常有限走动找清晰角度。
- 清晰对比：同根目录 `exploration-00b0a388-9c16-4228-9f35-160c1742c313/report.json`，仅 look/walk 和真实 capture，未直接改 actor 坐标。新树实际观察位置 [-7.5,0,-2]；view-1 还验证其真实选择身份。

所有运行退出审计 violations/pageErrors/shutdownFailures 为空；后续采用和观察新增模型调用 0，没有真实鼠标键盘、Pointer Lock 或前台窗口。最终 profile 已退出。原报告/marker/source proof 保留，不覆盖旧失败。

本轮模型请求 14 次，全部有正式用量回执；正常 metrics：inputTokens 110495、cacheReadTokens 644992、outputTokens 19620（其中 reasoningTokens 15512）、totalTokens 775107。提交时间为北京时间 05:55:50，原报告结束 06:00:07。完整原始会话和逐权限/澄清记录在玩家报告同目录。

## 后续继续位置

在新成品修复后，用上述原始 player 报告继续相同 profile/session 的普通对话，不再传 --create-session；把自然纠正作为新的玩家跟进单独记录，不改本轮原话和结果。现存默认树已被正式采用，后续应明确修正它，不能再偷偷添加另一棵掩盖失败。

本次工具名前缀漏报修复另提交 46cbeb52，并有 2 项离线回归；本轮统计仍以原始完整工具行复核。单独机器可读复核在本工作树 `test-results/prefab-oak-reuse-review.json`，保留原报告及最佳截图哈希。
