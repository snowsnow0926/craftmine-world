type Data = Record<string, any>;
const actions: Record<string, string[]> = {
  read: [], add: ["operationId", "expectedRevision", "kind", "text"],
  update: ["operationId", "expectedRevision", "id", "kind", "text"],
  remove: ["operationId", "expectedRevision", "id"],
  review: ["operationId", "expectedRevision", "id", "buildId", "accepted"],
  "accept-proposal": ["operationId", "expectedRevision", "proposalId"],
  "dismiss-proposal": ["operationId", "expectedRevision", "proposalId"],
};
/** Main-window product commands only; the model has a separate proposal API. */
export function createWorldBriefService(deps: {
  selected: () => Promise<string | null>;
  call: (method: string, args: Data) => Promise<unknown>;
  busy: () => boolean;
}) {
  return {async request(input: unknown) {
    try {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("WORLD_BRIEF_INVALID_REQUEST");
      const args = input as Data, keys = actions[args.action];
      if (!Object.hasOwn(actions,args.action) || !keys || Object.keys(args).some(key => !["action","worldId",...keys].includes(key))
        || typeof args.worldId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(args.worldId)) throw Error("WORLD_BRIEF_INVALID_REQUEST");
      const selected = async () => {if (await deps.selected() !== args.worldId) throw Error("WORLD_CHANGED");};
      await selected();
      if (args.action !== "read" && deps.busy()) throw Error("WORLD_BUSY");
      const {action,...body} = args;
      const result = await deps.call(action === "read" ? "worldBrief.read" : "worldBrief.edit",
        action === "read" ? {worldId: args.worldId} : {...body,action}) as Data;
      await selected();
      if (!result || result.worldId !== args.worldId) throw Error("WORLD_BRIEF_RESPONSE_INVALID");
      return result;
    } catch (error) {
      const code = String((error as Data)?.errorCode ?? (error as Data)?.code ?? (error as Error)?.message ?? "");
      const match = code.match(/\b(WORLD_BRIEF_[A-Z_]+|WORLD_BUSY|WORLD_CHANGED|WORLD_ARCHIVED|WORLD_NOT_FOUND)\b/);
      throw Error(match?.[1] ?? "WORLD_BRIEF_UNAVAILABLE");
    }
  }};
}
