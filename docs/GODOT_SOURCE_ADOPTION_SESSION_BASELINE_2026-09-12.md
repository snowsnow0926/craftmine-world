# 源码候选采用后的同会话连续创造

真实 preview.13 记录中，原会话完成了城墙/塔楼组合愿望，玩家随后通过正式候选流程采用了结果。下一句普通输入却在第 0 次模型调用前得到 `DRAFT_BASE_CONFLICT`。原任务仍为 finished，草稿 revision=0、无 lease/recovery；其 baseBuild 是旧森林，正式世界已是新构建。

证据报告为 `D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/player-a5c5afd2-98cb-4059-9e36-5dbbf606b66f.json`。本次只读该报告，未访问或启动其 profile。档案持有者另行只读核对：唯一已采用回执 `2cb38725-9cc4-4bdd-b28b-5e9d56ca84c6` 的作者是独立安装任务，原会话任务不是 authorTaskId；采用前正式 scene 与原会话完整 scene 草稿相等，input、previous_world、draft 哈希均匹配。四条 aborted 回执不作为采用依据。

`applications::was_applied` 原本已经兼容 Godot，但标记只属于候选作者。组合安装使用独立宿主任务，因此不能靠这个作者标记刷新原聊天任务，也不能只看到 finished 或 revision=0 就丢弃旧草稿。

修复在正常 `workspace.open` 的现有 Immediate 事务内执行：仍先校验会话/项目、旧 turn、恢复状态和 world lease。仅当旧任务 finished 且 base 确已变化时，从当前正式构建逆向追溯同世界已 applied 的 Godot 部署链。每一步验证 input、previous_world、output 哈希、world/build/launch 关系及递减的正式 revision；到达旧 base 后，要求**整个旧 draft 严格等于采用前正式 scene 的标准草稿**，才以当前正式 scene 创建新任务。没有实际采用、只有预览/中止、不同世界/不相干当前构建、损坏回执或存在未采用 scene 编辑时不放行。可以跨多次真实采用，不依赖任意旧历史回执。

这不是把原任务标记为已采用。旧任务 binding、草稿、历史、预算和既有作者回执保持；新任务按既有正常新愿望流程创建。Godot 源码与版本按世界/分支独立保存，检查候选也独立记录，此处不重写或删除它们。测试特别覆盖原任务曾经写入源码并生成未采用候选，后续独立任务采用两次后，原源码历史与原候选仍可读取、未被假标 adopted；另一个尚未采用的最新源码也保持，旧 revision 的源码写入继续触发 CAS 冲突。继承后 revision=0 的已修改 scene 草稿仍拒绝刷新。

验证命令（独立工作树与独立 Cargo target）：

```powershell
$env:CARGO_TARGET_DIR='D:/cm-source-adoption-baseline-0912/test-results/source-adoption-cargo'
cargo test -p craftmine-core --lib --offline
```

本轮只修改生产基线判断与 SQLite 合同测试；没有模型调用、没有重新采用原作品、没有复制或删除真实档案。新成品上的原会话普通重试由总控执行，其结果须单独记录。

完整 core 库测试结果：325 项通过、0 失败，7 项按原测试配置忽略。日志保留于本工作树 `test-results/source-adoption-core-tests.log`；构建缓存随之移入忽略的测试目录，没有清理实际玩家数据。忽略项不计入通过证据。
