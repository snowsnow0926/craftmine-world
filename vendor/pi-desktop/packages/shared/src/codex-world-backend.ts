/** Experimental transport selection, separate from API provider credentials. */
export const CODEX_WORLD_BACKEND = "codex-cli" as const;
export const CODEX_WORLD_MODEL = "gpt-6-astra" as const;
export const CODEX_WORLD_EFFORT = "xhigh" as const;
export type WorldAgentSettings = { worldAgentBackend?: "pi" | "codex-cli"; codexCliPath?: string };

export function validateWorldAgentSettings(value: WorldAgentSettings): void {
  if (value.worldAgentBackend !== undefined && !["pi", "codex-cli"].includes(value.worldAgentBackend)) {
    throw Error("CODEX_BACKEND_INVALID");
  }
  if (value.codexCliPath !== undefined && (typeof value.codexCliPath !== "string" ||
      value.codexCliPath.length > 4096 || /[\x00-\x1f]/.test(value.codexCliPath))) throw Error("CODEX_PATH_INVALID");
}

/** Catalog entries must also be present in the registered, project-scoped plugin. */
export const CODEX_WORLD_TOOLS = new Set([
  "godot_docs", "godot_guidance", "godot_project_index", "godot_file_read",
  "godot_project_query", "godot_project_patch", "godot_project_facts", "godot_capability_report",
  "godot_runtime_state", "godot_view_capture", "godot_performance_observe", "godot_asset_put",
  "godot_asset_list", "godot_build_start", "godot_build_read", "godot_build_cancel",
  "godot_candidate_read", "godot_candidate_list", "godot_jobs", "creation_operation",
  "requirements_read", "world_brief", "blender_status", "blender_generate", "blender_job_read", "blender_cancel",
  "asset_library", "godot_source_library", "package_library",
]);
