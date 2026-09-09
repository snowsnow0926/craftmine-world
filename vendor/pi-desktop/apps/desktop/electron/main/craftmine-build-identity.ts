import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Packaged provenance only. The path is supplied by Main's resources root,
 * never by a renderer or a model. Missing development manifests stay absent. */
export function readCraftmineBuildIdentity(resourcesRoot: string): Record<string, unknown> {
  try {
    const file = join(resourcesRoot, "source", "build-manifest.json");
    if (statSync(file).size > 128 * 1024) return {};
    const bytes = readFileSync(file), manifest = JSON.parse(bytes.toString("utf8"));
    if (manifest.format !== "craftmine.build/1" || manifest.appId !== "world.craftmine.desktop") return {};
    const valid = (value: unknown) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) ? value : undefined;
    return { commit: valid(manifest.commit), sourceHash: valid(manifest.sourceArchiveHash), manifestHash: createHash("sha256").update(bytes).digest("hex") };
  } catch { return {}; }
}
