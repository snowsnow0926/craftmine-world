const KEY = "craftmine.world-conversations.v1";
const token = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,240}$/.test(value);

/** A preference only. Every restored id is revalidated against host task binding. */
export function rememberedWorldConversation(worldId: string): string | undefined {
  try { const value = JSON.parse(localStorage.getItem(KEY) ?? "{}")[worldId]; return token(value) ? value : undefined; }
  catch { return undefined; }
}

export function rememberWorldConversation(worldId: string, sessionId: string): void {
  if (!token(worldId) || !token(sessionId)) return;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const entries = Object.entries(raw).filter(([world, session]) => token(world) && token(session) && world !== worldId).slice(-199);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...entries, [worldId, sessionId]])));
  } catch { /* Failure to remember never prevents explicit conversation selection. */ }
}
