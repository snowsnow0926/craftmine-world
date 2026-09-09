# E/F/G/H 接手审计与底座修复

基线：`75f69fa2903e0c259bfaf5ce0cfecd190bb21545`。工作树：
`D:/Craftmine World-worktrees/godot-audit-bases-20260909`，分支
`codex/godot-audit-bases-20260909`。未合并、未推送、未清理他人目录。

E/F/G/H 原工作树均干净，分别审计到 da9bf89、de62480、5093e34、f13eeea。
这些提交提供的是独立底座/工具，不能据其通过直接宣布工作台产品验收完成。

已修复：

- E：`restore-state` 绕过磁盘读取检查接受其他世界状态；现在直接应用也校验 worldId。
  恢复仅剩的 bak 后再次保存失败，不再先删除唯一好档；写入增加 flush 错误检查。
- F：直接 WRITE 截断唯一主档改为临时写入、备份、替换；坏/未来存档不再被退出自动
  保存覆盖；保存失败保留 dirty 以便后续重试；任务奖励负数/畸形配置在扣物前拒绝。
  同步生成示例，并增加局部 LF 规则，修复 Windows 检出后生成哈希漂移。
- G：完整校验身份、版本、玩家、房间、能力/奖励/检查点账本和数值，失败不部分赋值；
  启动拒绝坏档后立即退出，不再进房自动覆盖；保存检查写入错误和自身状态合法性。
  新建工程使用独立实例 ID（可传入、默认 UUID），与 blank/ruins 模板 ID 分离；
  `--force` 不再递归删除任意非空目标目录，身份参数不能包含路径穿越。

真实验证：E headless 52 项通过；F headless 34 项通过；G headless 80 项通过；
新审计脚本使用真实固定 Godot、独立 profile 验证坏档/跨世界/替换失败与实例 ID；
top-down 生成一致性 2/2。证据路径与哈希见同目录 evidence.json。
E 首次重跑中原测试未携带 worldId，使“新版状态原因”断言失败；补齐测试身份后通过，
保留原断言。G 严格整工程导入发现退出时 ObjectDB/resources 泄漏；其历史 verify
只过滤 SCRIPT ERROR，80/80 不代表这项已修复。新测试保留完整导入日志与诊断。

仍需接手方处理：

1. P1/H：素材清单 sourceDirectory 仍指向旧 probes/**，E/F/G 新 bases/** 不受清单覆盖；
   发布门禁不能把这次 assets PASS 算作新底座权利核对完成。Godot 包内探测只搜最多
   四层 godot*.exe，WASM-only、改名或更深路径有漏检。保持用户已确认许可策略，未批量改许可。
2. P2/F：Game.bind_scene 覆盖已存 scene_id，完整重启仍回入口场景；saved facing 也被
   当前角色默认值覆盖。现有34项只验金币、物品、任务等，没有证明店内原位置恢复。
3. P2/E：实体状态按场景路径排序、数组长度严格匹配；新增/删除/重排实体需显式迁移。
   当前改伤害保进度通过，不能扩大为任意内容编辑都保进度。
4. E/F/G 的存档格式、运行协议不同。E 为 craftmine.godot-base-state/1，F/G各有格式；
   G progress_dict 仅玩家坐标，不包含能力/奖励账本，不能用它替代完整保存载荷。
   B/C 的 apply/rollback 必须接完整状态，不得把底座自报 hash 当授权凭证。
5. 旧直接 side-view 示例仍共享 blank/ruins 身份以保留兼容；产品必须从物化项目或
   明确实例 ID 启动。并发同一世界写入仍由宿主单实例/租约负责。
6. 无真实产品模型调用、无新的像素验收、无 A17 独立 Windows 安装证据。
   原 E/F 截图仅属于各自原分支的 authored Web 验证；G 无 GPU 画面证据；A16 未实现。
