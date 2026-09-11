# 隔离引擎动作验收

控制器方法：现有 `godotExplore`。新增步骤：

```json
{"op":"play-action","args":{"action":"interact","frames":1},"capture":true}
```

- 仅受保护 headless 控制器可用，普通运行与普通 runtime request 拒绝。
- worldId、buildId、instanceId 必须与当前实际实例完全相同；模型不能提供权限标记或令牌。
- 首版只接受 interact 和一个物理帧，不接受额外字段；两个调度帧计入原总帧预算。
- 结果 `dispatched` 仅表示按下／释放完成。读取同实例观察并检查真实玩法结果，不把底座 `interacted` 回执替代为成功。
- 原 `interact` 仍是已有业务操作，不应在同一验收步骤中再调用一次。
- 未载入、暂停、持有冲突、旧导出不支持时明确失败；取消和清理释放本控制器持有。

入口契约测试：`node --test tests/godot-final/headless-play-action.test.mjs tests/godot-final/exploration.test.mjs`。

实际引擎测试：`node tests/headless-play-action-engine.mjs`。独立缓存位置通过已有 `CRAFTMINE_GODOT_CACHE_DIR` 指定；工具校验固定引擎哈希，使用隔离 profile 和 --headless，不启动前台窗口。

真实导出校验：`node tests/creation-pack-export-headless.mjs`。须确认新增 helper 源码、PCK 字节和 Rust 保护清单一致，不能复用旧 helper 缺失的包冒充已验证。
