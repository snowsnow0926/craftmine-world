import {createHash, randomUUID} from "node:crypto";
import {mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {craftmineProjectIdentity} from "./craftmine-tool-context";

type Session = {id: string; projectPath?: string | null; messageCount?: number; archived?: boolean};
type Locator = {worldId: string; sessionId: string; projectId: string};
const token = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,240}$/.test(value);
export function sameConversationProjectDirectory(sessionPath: string | null, currentPath: string | null): boolean {
  if (sessionPath === null || currentPath === null) return sessionPath === currentPath;
  try {
    const actual = realpathSync.native(sessionPath), current = realpathSync.native(currentPath);
    return actual === current && statSync(actual).isDirectory();
  } catch {return false;}
}

/** Presentation ownership only; this never opens a workspace or authorizes an Agent. */
export function createWorldConversationNavigation(directory: string) {
  const created = new Map<string, Locator>();
  const file = (sessionId: string) => join(directory, createHash("sha256").update(sessionId).digest("hex") + ".json");
  const read = (sessionId: string): Locator | null => {
    try {
      const value = JSON.parse(readFileSync(file(sessionId), "utf8"));
      return value?.sessionId === sessionId && token(value.worldId) && token(value.projectId) ? value : null;
    } catch {return null;}
  };
  return {
    noteCreated(session: Session, worldId: string | null) {
      if (!worldId || !token(worldId) || !token(session.id)) return;
      created.set(session.id, {worldId, sessionId: session.id, projectId: craftmineProjectIdentity(session, session.id)});
      while (created.size > 256) created.delete(created.keys().next().value!);
    },
    register(input: unknown, session: Session, selectedWorld: string | null, currentProjectPath: string | null): Locator {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("WORLD_CONVERSATION_REQUEST_INVALID");
      const args = input as Record<string, unknown>;
      if (Object.keys(args).sort().join(",") !== "action,sessionId,worldId" || args.action !== "remember-created"
        || !token(args.worldId) || !token(args.sessionId)) throw Error("WORLD_CONVERSATION_REQUEST_INVALID");
      if (args.worldId !== selectedWorld) throw Error("WORLD_CONVERSATION_CHANGED");
      if (session.id !== args.sessionId || session.archived) throw Error("WORLD_CONVERSATION_SESSION_CHANGED");
      if (session.messageCount !== 0) throw Error("WORLD_CONVERSATION_EMPTY_SESSION_REQUIRED");
      if (!sameConversationProjectDirectory(session.projectPath ?? null, currentProjectPath)) throw Error("WORLD_CONVERSATION_PROJECT_CHANGED");
      const expected = {worldId: args.worldId, sessionId: session.id, projectId: craftmineProjectIdentity(session, session.id)};
      const previous = read(session.id), fresh = created.get(session.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(expected)) throw Error("WORLD_CONVERSATION_BINDING_IMMUTABLE");
      if (!previous && (!fresh || JSON.stringify(fresh) !== JSON.stringify(expected))) throw Error("WORLD_CONVERSATION_FRESH_SESSION_REQUIRED");
      if (!previous) {
        mkdirSync(directory, {recursive: true});
        const destination = file(session.id), temporary = destination + "." + randomUUID() + ".tmp";
        writeFileSync(temporary, JSON.stringify(expected), {flag: "wx"}); renameSync(temporary, destination);
      }
      created.delete(session.id);
      return expected;
    },
    matches(session: Session, worldId: string): boolean {
      if (!token(session.id) || session.archived) return false;
      const known = read(session.id);
      return known?.worldId === worldId && known.projectId === craftmineProjectIdentity(session, session.id);
    },
  };
}
