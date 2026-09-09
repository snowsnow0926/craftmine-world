import { validateObservationEnvelope } from "../../../../../../desktop/godot/shared/observation.mjs";

/**
 * The shared observation schema is plain JavaScript (owner: S3), so its
 * parameters are widened here instead of restating the schema. The runtime
 * behaviour is the shared validator; only the compile-time signature is local.
 */
const validateEnvelope = validateObservationEnvelope as unknown as (
  envelope: unknown,
  options?: { expect?: Record<string, string> },
) => { ok: boolean; issues: Array<{ code: string; at: string; message: string }> };

/**
 * Live observation bridge for the Craftmine plugin (task S6).
 *
 * The model may only describe the player's current camera, equipment, entities
 * and quests from a sample of the running instance. This module is the trusted
 * main-process half: it asks the formal `GodotWorldViewHost` for the additive
 * `observe-envelope` op and returns an envelope whose identity is the host's
 * own instance identity. It never reads the durable progress body, never
 * invents a sample and never widens the requested world, build or instance.
 *
 * The plugin side (`tool-services.cjs`) validates the identity again and flattens
 * the payload, so a mismatching or malformed envelope fails closed.
 */

export type CraftmineLiveSampleRequest = {
  worldId?: string | null;
  buildId?: string | null;
  instanceId?: string | null;
};

export type CraftmineLiveSampleHost = {
  instance: { worldId: string; buildId: string; instanceId: string; url: string } | null;
  /** Forward one bounded runtime operation; rejects with WORLD_BUSY while the host transitions. */
  request: (op: string, args?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
};

export type CraftmineLiveSampleEnvelope = Record<string, unknown> & {
  format: string;
  worldId: string;
  buildId: string;
  instanceId: string;
  baseId: string;
  baseVersion: string;
  sampledAt: string;
  payload: Record<string, unknown>;
  hostSampledAt: string;
};

const ID = /^[a-zA-Z0-9._-]{1,128}$/;

function requireId(name: string, value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`LIVE_SAMPLE_INVALID_${name.toUpperCase()}`);
  return value;
}

export function createCraftmineLiveSampler(
  host: () => CraftmineLiveSampleHost,
  now: () => number = Date.now,
) {
  return async function sampleLiveState(input: CraftmineLiveSampleRequest = {}): Promise<CraftmineLiveSampleEnvelope | null> {
    const live = host();
    const instance = live.instance;
    // No formal instance is running: unknown, not an empty reading.
    if (!instance) return null;
    const worldId = requireId("world", instance.worldId);
    const buildId = requireId("build", instance.buildId);
    const instanceId = requireId("instance", instance.instanceId);
    // The caller may narrow the request, never redirect it to another instance.
    if (input.worldId && input.worldId !== worldId) throw new Error("LIVE_WORLD_MISMATCH");
    if (input.buildId && input.buildId !== buildId) throw new Error("LIVE_BUILD_MISMATCH");
    if (input.instanceId && input.instanceId !== instanceId) throw new Error("LIVE_INSTANCE_MISMATCH");
    const envelope = await live.request("observe-envelope", {});
    if (envelope === null || envelope === undefined) return null;
    const checked = validateEnvelope(envelope, { expect: { worldId, buildId, instanceId } });
    if (!checked.ok) {
      const detail = checked.issues.map((issue) => `${issue.code}@${issue.at}`).join(",");
      throw new Error(`LIVE_OBSERVATION_INVALID: ${detail}`);
    }
    return {
      ...envelope,
      format: String(envelope.format),
      worldId,
      buildId,
      instanceId,
      baseId: String(envelope.baseId),
      baseVersion: String(envelope.baseVersion),
      sampledAt: String(envelope.sampledAt),
      payload: envelope.payload as Record<string, unknown>,
      // Host receipt time, kept beside the game's own sampling instant so a
      // delayed or cached envelope is distinguishable without overriding it.
      hostSampledAt: new Date(now()).toISOString(),
    };
  };
}
