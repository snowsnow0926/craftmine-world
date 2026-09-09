/** A successful world save must precede backend or page shutdown. */
export async function prepareWorldViewsForQuit(
  views: Iterable<{ pluginId: string; prepare: () => Promise<unknown>; cancel: () => Promise<unknown> }>,
  timeoutMs = 30_000,
): Promise<void> {
  const pending = [...views].filter((view) => view.pluginId === "craftmine.world");
  if (!pending.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(pending.map(async (view) => {
        const result = await view.prepare() as { loaded?: boolean; worldId?: string; revision?: number; buildId?: string } | undefined;
        if (!result || typeof result.loaded !== "boolean") throw new Error("World did not acknowledge its close checkpoint");
        if (result.loaded && (!result.worldId || !result.buildId || !Number.isSafeInteger(result.revision) || result.revision! < 0)) {
          throw new Error("World did not return a saved revision");
        }
      })),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("World save timed out; application remains open")), timeoutMs); }),
    ]);
  } catch (error) {
    // Do not wait on an unresponsive renderer to release the quit attempt.
    // Every resumed page still serializes an unfinished save before new work.
    for (const view of pending) void Promise.resolve().then(view.cancel).catch(() => {});
    throw error;
  } finally { if (timer) clearTimeout(timer); }
}
