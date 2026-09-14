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

/** Existing Rust-owned voxel transactions; never native/Godot operators. */
export const CODEX_LEGACY_WORLD_TOOLS = new Set([
  "project_inspect", "capabilities_read", "resource_read", "workspace_patch",
  "verification_submit", "verification_read", "verification_cancel",
  "library_search", "library_read", "library_install", "memory_search", "memory_propose",
  "requirements_read", "world_brief",
]);

/** Main supplies registered definitions; the sidecar selects one runtime catalog. */
export const CODEX_REGISTERED_WORLD_TOOLS = new Set([...CODEX_WORLD_TOOLS, ...CODEX_LEGACY_WORLD_TOOLS]);
