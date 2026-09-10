import {createHash} from "node:crypto";

export const INITIAL_LOAD_BRIDGE_PATH = "craftmine_shared/runtime_bridge.gd";
const PRE_FRAME_DRAIN_SHA256 = "318fdb30c40a6165a2080ff12190571fada156ba321f83c3264bae91e4052c76";
const FRAME_INDEPENDENT_SHA256 = "faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2";

/** Only the known host-owned bridge is eligible; authored game files are untouched. */
export function initialLoadBridgeRepair(existingHash: string | undefined, replacement: Buffer) {
  if (!existingHash || existingHash === FRAME_INDEPENDENT_SHA256) return null;
  if (existingHash !== PRE_FRAME_DRAIN_SHA256) throw Error("GODOT_INITIAL_BRIDGE_CUSTOMIZED");
  if (createHash("sha256").update(replacement).digest("hex") !== FRAME_INDEPENDENT_SHA256) {
    throw Error("GODOT_INITIAL_BRIDGE_REPAIR_PIN_MISMATCH");
  }
  return {path: INITIAL_LOAD_BRIDGE_PATH, bytesBase64: replacement.toString("base64"), expectedHash: PRE_FRAME_DRAIN_SHA256};
}
