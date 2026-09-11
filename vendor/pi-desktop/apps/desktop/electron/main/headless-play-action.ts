export const PRIVATE_PLAY_OPS = new Set(["headless-play-authorize", "headless-play-cancel", "play-action"]);
export type PlayIdentity = { worldId: string; buildId: string; instanceId: string };
export function validateHeadlessPlayAction(enabled: boolean, expected: PlayIdentity | null, identity: PlayIdentity, args: Record<string, unknown>): void {
  if (!enabled) throw Error("PLAY_ACTION_HEADLESS_ONLY");
  if (!expected || !identity || Object.keys(identity).sort().join(",") !== "buildId,instanceId,worldId" ||
      ["worldId", "buildId", "instanceId"].some(key => expected[key as keyof PlayIdentity] !== identity[key as keyof PlayIdentity])) throw Error("PLAY_ACTION_IDENTITY");
  if (!args || Object.keys(args).sort().join(",") !== "action,frames" || args.action !== "interact" || args.frames !== 1) throw Error("PLAY_ACTION_ARGUMENTS");
}
