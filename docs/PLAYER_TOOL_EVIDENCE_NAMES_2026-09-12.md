# 普通玩家报告的真实工具名兼容（2026-09-12）

真实普通会话中的 UiMessage.toolName 使用 plugin_craftmine_world_ 前缀，例如 plugin_craftmine_world_godot_source_library。原 sourceLibraryCalls 仅匹配短名，可能把真实素材库调用漏报为 0。

新增统计辅助函数：仅分类时剥离确切 Craftmine 前缀，原 toolName、toolCallId、toolArgs、toolResult 和状态全部保留；旧短名仍兼容，其他插件和非工具文本不计入。排除原有消息，避免把上轮工具调用归到新愿望。

2 项离线测试通过，使用真实 UiMessage 字段形状，覆盖 search/read/propose、旧消息排除与其他插件前缀。修正未改变当时正在运行的进程；该轮实际结论以保留的完整原始会话逐项复核，不能凭统计字段取代源码复用证据。
