import {createHash} from "node:crypto";
import type {GodotViewCapture, GodotViewCaptureIdentity} from "./godot-view-capture";

type Image = {isEmpty(): boolean; getSize(): {width: number; height: number}; resize(size: {width: number; height: number; quality: "good"}): Image; toPNG(): Buffer};
type PreparationDiagnostic = {attempts: number; elapsedMs: number; retryElapsedMs: number; firstRetryableCode: "GODOT_VIEW_CAPTURE_BUSY" | "GODOT_VIEW_CAPTURE_PENDING" | null; outcome: "ready" | "failed"; finalCode?: string};
const RETRYABLE = new Set(["GODOT_VIEW_CAPTURE_BUSY", "GODOT_VIEW_CAPTURE_PENDING"]);
const DIAGNOSTIC_CODES = new Set([...RETRYABLE, "LIBRARY_PREVIEW_UNAVAILABLE", "LIBRARY_PREVIEW_WORLD_CHANGED", "LIBRARY_PREVIEW_INVALID",
  "GODOT_VIEW_CAPTURE_DETACHED", "GODOT_VIEW_CAPTURE_IDENTITY_CHANGED", "GODOT_VIEW_CAPTURE_UNAVAILABLE", "GODOT_VIEW_CAPTURE_DIMENSIONS_CHANGED",
  "GODOT_VIEW_CAPTURE_DIMENSIONS", "GODOT_VIEW_CAPTURE_TIMEOUT", "GODOT_VIEW_CAPTURE_FAILED", "GODOT_VIEW_CAPTURE_EMPTY_FRAME",
  "GODOT_VIEW_CAPTURE_INVALID_IMAGE", "GODOT_VIEW_CAPTURE_PNG_LIMIT", "GODOT_VIEW_CAPTURE_IDENTITY", "GODOT_VIEW_CAPTURE_CANDIDATE_CHANGED"]);

/** A derivative of the current formal world frame, never renderer-supplied bytes. */
export function createLibraryPreviewCapture(options: {
  selection(): Promise<string | null>;
  instance(): GodotViewCaptureIdentity | null;
  candidateActive(): boolean;
  sourceIdentity(worldId: string): Promise<string | null>;
  capture(identity: GodotViewCaptureIdentity): Promise<GodotViewCapture>;
  decode(bytes: Buffer): Image;
  onPreparation?(diagnostic: PreparationDiagnostic): void;
  /** Deterministic transport-clock injection for isolated tests, never IPC. */
  now?(): number;
  wait?(milliseconds: number): Promise<void>;
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
  const fresh = async (worldId: string, expected?: Binding, beforeCapture?: () => void) => {
    const current = await binding(worldId);
    if (expected && !same(expected, current)) throw Error("LIBRARY_PREVIEW_WORLD_CHANGED");
    const identity = {worldId, buildId: current.buildId, instanceId: current.instanceId};
    const verify = async () => {
      try {if (same(current, await binding(worldId))) return;} catch { /* Classify a lost binding as a changed captured world. */ }
      throw Error("LIBRARY_PREVIEW_WORLD_CHANGED");
    };
    beforeCapture?.();
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
      const now = options.now ?? (() => performance.now());
      const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
      const started = now();
      let retryStarted: number | null = null;
      let attempts = 0, firstRetryableCode: PreparationDiagnostic["firstRetryableCode"] = null;
      const diagnostic = (outcome: PreparationDiagnostic["outcome"], finalCode?: string) => {
        const finished = now();
        try {options.onPreparation?.({attempts, elapsedMs: Math.max(0, Math.round(finished - started)), retryElapsedMs: retryStarted === null ? 0 : Math.max(0, Math.round(finished - retryStarted)), firstRetryableCode, outcome, ...(finalCode ? {finalCode} : {})});} catch { /* Diagnostics never change capture ownership or outcome. */ }
      };
      try {
        const original = await binding(worldId);
        const unchanged = async () => {
          const current = await binding(worldId);
          if (ticket !== preparation || !same(original, current)) throw Error("LIBRARY_PREVIEW_WORLD_CHANGED");
        };
        for (;;) {
          await unchanged();
          try {
            const result = await fresh(worldId, original, () => {
              if (ticket !== preparation) throw Error("LIBRARY_PREVIEW_WORLD_CHANGED");
              // The normal first compositor capture has its own native deadline.
              // Start this contention window only after the first BUSY/PENDING.
              if (retryStarted !== null && now() >= retryStarted + 2000) throw Error(firstRetryableCode!);
              ++attempts;
            });
            await unchanged();
            cached = result; diagnostic("ready");
            // Only host-owned bytes are retained, never returned to the renderer.
            return {ready: true, worldId, buildId: result.binding.buildId};
          } catch (error) {
            const code = error instanceof Error ? error.message : "";
            if (!RETRYABLE.has(code)) throw error;
            firstRetryableCode ??= code as PreparationDiagnostic["firstRetryableCode"];
            retryStarted ??= now();
            // Save/checkpoint/transition reads may briefly own the capture slot.
            // Retain the first binding and never retry any other failure.
            await unchanged();
            const remaining = retryStarted + 2000 - now();
            if (remaining <= 0) throw error;
            await wait(Math.min(100, remaining));
            await unchanged();
            if (now() >= retryStarted + 2000) throw error;
          }
        }
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        diagnostic("failed", DIAGNOSTIC_CODES.has(code) ? code : "LIBRARY_PREVIEW_FAILED");
        throw error;
      }
    },
  });
}
