import {createHash} from "node:crypto";

export const INITIAL_LOAD_BRIDGE_PATH = "craftmine_shared/runtime_bridge.gd";
const PRE_FRAME_DRAIN_SHA256 = "318fdb30c40a6165a2080ff12190571fada156ba321f83c3264bae91e4052c76";
const FRAME_INDEPENDENT_SHA256 = "faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2";
const BOUNDED_ACTION_SHA256 = "418bbb6f2a87b3092fb542b35a8c2007fef4725f554216f01fa48414c40ef6d3";

/** Host-selected bundled resource; never a caller-supplied path. The historical
 * bridge closes the old load bug without adding dependencies to old worlds. */
export function initialLoadBridgeResource(existingHash: string | undefined): string {
  return existingHash === PRE_FRAME_DRAIN_SHA256 || existingHash === FRAME_INDEPENDENT_SHA256
    ? "shared/repairs/runtime_bridge-frame-independent.gd" : "shared/runtime_bridge.gd";
}

/** Only the known host-owned bridge is eligible; authored game files are untouched. */
export function initialLoadBridgeRepair(existingHash: string | undefined, replacement: Buffer) {
  if (existingHash === BOUNDED_ACTION_SHA256) {
    if (createHash("sha256").update(replacement).digest("hex") !== BOUNDED_ACTION_SHA256) throw Error("GODOT_INITIAL_BRIDGE_REPAIR_PIN_MISMATCH");
    return null;
  }
  if (!existingHash || existingHash === FRAME_INDEPENDENT_SHA256) return null;
  if (existingHash !== PRE_FRAME_DRAIN_SHA256) throw Error("GODOT_INITIAL_BRIDGE_CUSTOMIZED");
  if (createHash("sha256").update(replacement).digest("hex") !== FRAME_INDEPENDENT_SHA256) {
    throw Error("GODOT_INITIAL_BRIDGE_REPAIR_PIN_MISMATCH");
  }
  return {path: INITIAL_LOAD_BRIDGE_PATH, bytesBase64: replacement.toString("base64"), expectedHash: PRE_FRAME_DRAIN_SHA256};
}
