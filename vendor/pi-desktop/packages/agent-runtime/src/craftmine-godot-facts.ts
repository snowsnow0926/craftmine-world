// Godot-specific durable facts for the per-request host snapshot.
//
// The host appends the snapshot as the final text block of every request, so
// these lines are re-derived automatically after any number of compactions or a
// model switch. They contain only values the host journal already holds; nothing
// is inferred from a task-start snapshot and no project or documentation text is
// promoted to an instruction.

export type GodotSnapshotSource = {
  world?: { id?: string; revision?: number; buildId?: string; hash?: string } | null;
  draft?: { revision?: number; hash?: string } | null;
  receipts?: unknown[];
  jobs?: unknown[];
  /** Forward-compatible richer section once the core exposes it. */
  godot?: {
    projectRevision?: number;
    projectManifestHash?: string;
    buildStatus?: string;
    candidateId?: string;
    candidateStatus?: string;
    baseId?: string;
    engineVersion?: string;
    executorGate?: { build?: boolean; check?: boolean; blockedReason?: string | null };
  } | null;
};

function shortHash(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-f0-9]{8,64}$/.test(value)) return null;
  return value.slice(0, 8);
}

function numberOrNull(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 240 ? value : null;
}

// The most recent receipt that carries a Godot project head for THIS world. A
// receipt only counts when it has a manifest hash and, if it names a world, that
// world is the snapshot's world, so a multi-world journal cannot leak another
// world's source head into this task.
function projectHeadFromReceipts(receipts: unknown[] | undefined, worldId: string | null): { revision: number | null; hash: string | null } {
  if (!Array.isArray(receipts)) return { revision: null, hash: null };
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index];
    if (typeof receipt !== "object" || receipt === null) continue;
    const record = receipt as Record<string, unknown>;
    const hash = shortHash(record.manifestHash);
    if (hash === null) continue;
    const receiptWorld = stringOrNull(record.worldId) ?? stringOrNull(record.world_id);
    if (worldId !== null && receiptWorld !== null && receiptWorld !== worldId) continue;
    return { revision: numberOrNull(record.revision), hash };
  }
  return { revision: null, hash: null };
}

export function godotFactLines(snapshot: GodotSnapshotSource | null | undefined): string[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const world = snapshot.world ?? null;
  const draft = snapshot.draft ?? null;
  const richer = snapshot.godot ?? null;
  const worldId = stringOrNull(world?.id);
  const head = projectHeadFromReceipts(snapshot.receipts, worldId);
  // Only emit a Godot block for a world that actually has Godot identity: an
  // explicit section or a journaled source manifest hash. A legacy world keeps
  // its build id and draft revision, which are not Godot facts.
  if (!richer && head.hash === null) return [];
  const projectRevision = richer?.projectRevision ?? head.revision;
  const projectHash = shortHash(richer?.projectManifestHash) ?? head.hash;
  const buildId = stringOrNull(world?.buildId);
  const baseId = stringOrNull(richer?.baseId);
  const engineVersion = stringOrNull(richer?.engineVersion);
  const buildStatus = stringOrNull(richer?.buildStatus);
  const candidateId = stringOrNull(richer?.candidateId);
  const candidateStatus = stringOrNull(richer?.candidateStatus);
  const worldRevision = numberOrNull(world?.revision);
  const draftRevision = numberOrNull(draft?.revision);
  const draftHash = shortHash(draft?.hash);
  const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs.length : null;
  const executor = richer?.executorGate ?? null;

  const parts: string[] = [];
  if (buildId) parts.push(`appliedBuild=${buildId}`);
  if (buildStatus) parts.push(`buildStatus=${buildStatus}`);
  if (worldRevision !== null) parts.push(`worldRevision=${worldRevision}`);
  if (draftRevision !== null) parts.push(`draftRevision=${draftRevision}`);
  if (draftHash) parts.push(`draftHash=${draftHash}`);
  if (projectRevision !== null) parts.push(`projectRevision=${projectRevision}`);
  if (projectHash) parts.push(`projectHash=${projectHash}`);
  if (baseId) parts.push(`base=${baseId}`);
  if (engineVersion) parts.push(`engine=${engineVersion}`);
  if (candidateId) parts.push(`candidate=${candidateId}:${candidateStatus ?? "unknown"}`);
  if (jobs !== null) parts.push(`verifications=${jobs}`);
  if (executor) parts.push(`executorBuild=${executor.build === true} executorCheck=${executor.check === true}` +
    (executor.blockedReason ? ` blocked=${executor.blockedReason}` : ""));
  return parts;
}

/** One compact line for machineFacts, or null when the world has no Godot data. */
export function godotFactsBlock(snapshot: GodotSnapshotSource | null | undefined): string | null {
  const lines = godotFactLines(snapshot);
  if (lines.length === 0) return null;
  return `godot: ${lines.join(" ")}`;
}
