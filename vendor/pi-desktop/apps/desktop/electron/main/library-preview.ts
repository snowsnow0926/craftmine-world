import {createHash} from "node:crypto";
import type {GodotViewCapture, GodotViewCaptureIdentity} from "./godot-view-capture";

type Image = {isEmpty(): boolean; getSize(): {width: number; height: number}; resize(size: {width: number; height: number; quality: "good"}): Image; toPNG(): Buffer};

/** A derivative of the current formal world frame, never renderer-supplied bytes. */
export function createLibraryPreviewCapture(options: {
  selection(): Promise<string | null>;
  instance(): GodotViewCaptureIdentity | null;
  candidateActive(): boolean;
  capture(identity: GodotViewCaptureIdentity): Promise<GodotViewCapture>;
  decode(bytes: Buffer): Image;
}) {
  return async (worldId: string) => {
    const current = options.instance();
    if (!current || current.worldId !== worldId || options.candidateActive() || await options.selection() !== worldId) throw Error("LIBRARY_PREVIEW_UNAVAILABLE");
    const identity = {worldId, buildId: current.buildId, instanceId: current.instanceId};
    const verify = async () => {
      const latest = options.instance();
      if (await options.selection() !== worldId || options.candidateActive() || !latest || latest.worldId !== worldId || latest.buildId !== identity.buildId || latest.instanceId !== identity.instanceId) throw Error("LIBRARY_PREVIEW_WORLD_CHANGED");
    };
    const frame = await options.capture(identity);
    await verify();
    if (frame.worldId !== worldId || frame.buildId !== identity.buildId || frame.instanceId !== identity.instanceId || frame.scope !== "formal") throw Error("LIBRARY_PREVIEW_WORLD_CHANGED");
    const original = Buffer.from(frame.pngBase64, "base64");
    if (original.length > 4 * 1024 * 1024 || original.toString("base64") !== frame.pngBase64 || createHash("sha256").update(original).digest("hex") !== frame.sha256) throw Error("LIBRARY_PREVIEW_INVALID");
    const image = options.decode(original), size = image.getSize();
    if (image.isEmpty() || !Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width <= 0 || size.height <= 0) throw Error("LIBRARY_PREVIEW_INVALID");
    const thumbnail = (maxWidth: number, maxHeight: number) => {
      const ratio = Math.min(1, maxWidth / size.width, maxHeight / size.height);
      return image.resize({width: Math.max(1, Math.floor(size.width * ratio)), height: Math.max(1, Math.floor(size.height * ratio)), quality: "good"}).toPNG();
    };
    let png = thumbnail(640, 360);
    if (png.length > 512 * 1024) png = thumbnail(320, 180);
    if (png.length < 33 || png.length > 512 * 1024 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw Error("LIBRARY_PREVIEW_INVALID");
    await verify();
    return {worldId, buildId: identity.buildId, pngBase64: png.toString("base64"), sha256: createHash("sha256").update(png).digest("hex")};
  };
}
