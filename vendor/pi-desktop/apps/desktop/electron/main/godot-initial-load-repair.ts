import {createHash} from "node:crypto";

export const INITIAL_LOAD_BRIDGE_PATH = "craftmine_shared/runtime_bridge.gd";
export const INITIAL_LOAD_BASE_BRIDGE_PATH = "craftmine_shared/runtime_bridge_base.gd";
const PRE_FRAME_DRAIN_SHA256 = "318fdb30c40a6165a2080ff12190571fada156ba321f83c3264bae91e4052c76";
const FRAME_INDEPENDENT_SHA256 = "faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2";
const BOUNDED_ACTION_SHA256 = "418bbb6f2a87b3092fb542b35a8c2007fef4725f554216f01fa48414c40ef6d3";
const CURRENT_SHA256 = "58b4f108bc8fe6fa9232c9f98e577bc6a2914d1f623f373f79cec5450cba51f3";
const CURRENT_ENGINE_WRAPPER_SHA256 = "938c42a578bb37c0590198232448b1391f688b95f15ce7d5fce65d802cca7e08";

/** Host-selected bundled resource; never a caller-supplied path. The historical
 * bridge closes the old load bug without adding dependencies to old worlds. */
export function initialLoadBridgeResource(existingHash: string | undefined): string {
  if (existingHash === CURRENT_ENGINE_WRAPPER_SHA256) return "shared/runtime_bridge_engine_v1.gd";
  return existingHash === PRE_FRAME_DRAIN_SHA256 || existingHash === FRAME_INDEPENDENT_SHA256
    ? "shared/repairs/runtime_bridge-frame-independent.gd" : "shared/runtime_bridge.gd";
}

/** Only the known host-owned bridge is eligible; authored game files are untouched. */
export function initialLoadBridgeRepair(existingHash: string | undefined, replacement: Buffer, existingBaseHash?: string) {
  // The normal creation materializer installs this wrapper at runtime_bridge.gd
  // and retains the stock bridge as a separate inherited file. Recognize only
  // that exact pair; a retry must neither downgrade it nor bless a custom base.
  if (existingHash === CURRENT_ENGINE_WRAPPER_SHA256) {
    if (existingBaseHash !== CURRENT_SHA256) throw Error("GODOT_INITIAL_BRIDGE_CUSTOMIZED");
    if (createHash("sha256").update(replacement).digest("hex") !== CURRENT_ENGINE_WRAPPER_SHA256) throw Error("GODOT_INITIAL_BRIDGE_REPAIR_PIN_MISMATCH");
    return null;
  }
  if (existingHash === BOUNDED_ACTION_SHA256 || existingHash === CURRENT_SHA256) {
    if (createHash("sha256").update(replacement).digest("hex") !== CURRENT_SHA256) throw Error("GODOT_INITIAL_BRIDGE_REPAIR_PIN_MISMATCH");
    return null;
  }
  if (!existingHash) return null;
  if (existingHash === FRAME_INDEPENDENT_SHA256) {
    if (createHash("sha256").update(replacement).digest("hex") !== FRAME_INDEPENDENT_SHA256) throw Error("GODOT_INITIAL_BRIDGE_REPAIR_PIN_MISMATCH");
    return null;
  }
  if (existingHash !== PRE_FRAME_DRAIN_SHA256) throw Error("GODOT_INITIAL_BRIDGE_CUSTOMIZED");
  if (createHash("sha256").update(replacement).digest("hex") !== FRAME_INDEPENDENT_SHA256) {
    throw Error("GODOT_INITIAL_BRIDGE_REPAIR_PIN_MISMATCH");
  }
  return {path: INITIAL_LOAD_BRIDGE_PATH, bytesBase64: replacement.toString("base64"), expectedHash: PRE_FRAME_DRAIN_SHA256};
}
