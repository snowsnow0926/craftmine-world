import { craftmineProjectIdentity } from "./craftmine-tool-context";

type Session = {id: string; projectPath?: string | null; updatedAt?: string | number; archived?: boolean};
type Access = {
  selectedWorld(): Promise<string | null>;
  sessions(): Promise<Session[]>;
  pluginEnabled(projectPath: string | null): boolean;
  domain(method: string, input: Record<string, unknown>): Promise<unknown>;
};
const token = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,240}$/.test(value);
const updated = (session: Session) => typeof session.updatedAt === "number" ? session.updatedAt : Date.parse(session.updatedAt ?? "") || 0;

/** Find an existing conversation through its durable workspace/task binding. */
export async function readWorldConversation(input: unknown, access: Access): Promise<{worldId: string; sessionId: string | null; taskId?: string}> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("WORLD_CONVERSATION_REQUEST_INVALID");
  const request = input as Record<string, unknown>;
  if (Object.keys(request).some(key => !["worldId", "sessionId"].includes(key)) || !token(request.worldId)
    || (request.sessionId !== undefined && !token(request.sessionId))) throw Error("WORLD_CONVERSATION_REQUEST_INVALID");
  const worldId = request.worldId;
  const selected = async () => { if (await access.selectedWorld() !== worldId) throw Error("WORLD_CONVERSATION_CHANGED"); };
  await selected();
  // Real desktop sessions exclude synthetic initializer/maintenance identities.
  // The existing session-world index remains authoritative across restarts.
  const sessions = (await access.sessions()).filter(session => token(session.id) && !session.archived)
    .sort((a, b) => Number(b.id === request.sessionId) - Number(a.id === request.sessionId) || updated(b) - updated(a));
  await selected();
  for (const session of sessions) {
    if (!access.pluginEnabled(session.projectPath ?? null)) continue;
    const projectId = craftmineProjectIdentity(session, session.id);
    let result: any;
    try {
      result = await access.domain("workbench.request", {channel: "task.current", payload: {worldId},
        host: {projectId, sessionId: session.id, selectedWorld: worldId, active: false}});
    } catch (error) {
      if (String(error).includes("PROJECT_BINDING_MISMATCH")) {await selected();continue;}
      throw error;
    }
    await selected();
    const context = result?.context, binding = context?.binding;
    if (context?.world?.id !== worldId || binding?.sessionId !== session.id || binding?.projectId !== projectId || !token(binding?.taskId)) continue;
    return {worldId, sessionId: session.id, taskId: binding.taskId};
  }
  await selected();
  return {worldId, sessionId: null};
}
