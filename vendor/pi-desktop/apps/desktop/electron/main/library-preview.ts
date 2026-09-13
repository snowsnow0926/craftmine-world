import {createHash} from "node:crypto";
import type {GodotViewCapture, GodotViewCaptureIdentity} from "./godot-view-capture";

type Image = {isEmpty(): boolean; getSize(): {width: number; height: number}; resize(size: {width: number; height: number; quality: "good"}): Image; toPNG(): Buffer};

/** A derivative of the current formal world frame, never renderer-supplied bytes. */
export function createLibraryPreviewCapture(options: {
  selection(): Promise<string | null>;
  instance(): GodotViewCaptureIdentity | null;
  candidateActive(): boolean;
  sourceIdentity(worldId: string): Promise<string | null>;
  capture(identity: GodotViewCaptureIdentity): Promise<GodotViewCapture>;
  decode(bytes: Buffer): Image;
}) {
  type Preview = {worldId: string; buildId: string; pngBase64: string; sha256: string};
  type Binding = {worldId: string; buildId: string; instanceId: string; source: string};
  let cached: {binding: Binding; preview: Preview} | null = null;
  let preparation = 0;
  const binding = async (worldId: string): Promise<Binding> => {
    const current = options.instance();
    if (!current || current.worldId !== worldId || options.candidateActive() || await options.selection() !== worldId) throw Error("LIBRARY_PREVIEW_UNAVAILABLE");
    const source = await options.sourceIdentity(worldId);
    if (typeof source !== "string" || !source || source.length > 512) throw Error("LIBRARY_PREVIEW_UNAVAILABLE");
    const latest = options.instance();
    if (!latest || latest.worldId !== worldId || latest.buildId !== current.buildId || latest.instanceId !== current.instanceId || options.candidateActive() || await options.selection() !== worldId) throw Error("LIBRARY_PREVIEW_WORLD_CHANGED");
    return {worldId, buildId: current.buildId, instanceId: current.instanceId, source};
  };
  const same = (a: Binding, b: Binding) => a.worldId === b.worldId && a.buildId === b.buildId && a.instanceId === b.instanceId && a.source === b.source;
  const fresh = async (worldId: string) => {
    const current = await binding(worldId);
    const identity = {worldId, buildId: current.buildId, instanceId: current.instanceId};
    const verify = async () => {
      try {if (same(current, await binding(worldId))) return;} catch { /* Classify a lost binding as a changed captured world. */ }
      throw Error("LIBRARY_PREVIEW_WORLD_CHANGED");
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
    return {binding: current, preview: {worldId, buildId: identity.buildId, pngBase64: png.toString("base64"), sha256: createHash("sha256").update(png).digest("hex")}};
  };
  const capture = async (worldId: string) => {
    const previous = cached;
    if (previous) {
      const current = await binding(worldId);
      if (cached === previous && same(previous.binding, current)) return {...previous.preview};
      if (cached === previous) cached = null;
    }
    return (await fresh(worldId)).preview;
  };
  return Object.assign(capture, {
    /** Feedback reads the explicitly reviewed pre-sheet frame. It must never
     * attempt a fresh compositor capture while the native view is hidden. */
    async prepared(worldId: string): Promise<Preview> {
      const previous = cached;
      if (!previous) throw Error("LIBRARY_PREVIEW_PREPARE_REQUIRED");
      const current = await binding(worldId);
      if (cached !== previous || !same(previous.binding, current)) throw Error("LIBRARY_PREVIEW_WORLD_CHANGED");
      return {...previous.preview};
    },
    async prepare(input: unknown) {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).join(",") !== "worldId"
        || typeof (input as {worldId?: unknown}).worldId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test((input as {worldId: string}).worldId)) throw Error("LIBRARY_PREVIEW_INVALID_REQUEST");
      const worldId = (input as {worldId: string}).worldId, ticket = ++preparation;
      cached = null;
      const result = await fresh(worldId);
      if (ticket !== preparation) throw Error("LIBRARY_PREVIEW_WORLD_CHANGED");
      cached = result;
      // Only host-owned bytes are retained, never returned to the renderer.
      return {ready: true, worldId, buildId: result.binding.buildId};
    },
  });
}
