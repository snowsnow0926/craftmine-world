import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Read history only, not proof that a whole file or the current revision was read. */
export function completedGodotReadFiles(messages: readonly AgentMessage[]): string[] {
  const calls = new Map<string, { path: string; revision: number; manifestHash: string }>();
  const reads = new Set<string>();
  const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const file = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 &&
    !/[\x00-\x1f\x7f\\:]/.test(value) && !value.startsWith("/") && value.split("/").every(part => part !== "" && part !== "." && part !== "..");
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type !== "toolCall" || block.name !== "plugin_craftmine_world_godot_file_read") continue;
        const args = block.arguments;
        if (file(args.path) && Number.isSafeInteger(args.revision) && Number(args.revision) >= 1 && hash(args.manifestHash))
          calls.set(block.id, { path: args.path, revision: Number(args.revision), manifestHash: args.manifestHash });
      }
    } else if (message.role === "toolResult" && message.toolName === "plugin_craftmine_world_godot_file_read" && !message.isError) {
      const call = calls.get(message.toolCallId);
      const result = message.details;
      if (!call || !result || typeof result !== "object" || Array.isArray(result)) continue;
      const data = result as Record<string, unknown>;
      if (data.path === call.path && data.revision === call.revision && data.manifestHash === call.manifestHash &&
          hash(data.sha256) && typeof data.worldId === "string" && data.worldId.length > 0 &&
          typeof data.text === "string" && Number.isSafeInteger(data.offset) && Number(data.offset) >= 0 &&
          Number.isSafeInteger(data.totalCharacters) && Number(data.totalCharacters) >= Number(data.offset) + data.text.length)
        reads.add(call.path);
    }
  }
  return [...reads].sort();
}
