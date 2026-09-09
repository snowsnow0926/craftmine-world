import { createHash } from "node:crypto";

export function craftmineProjectIdentity(
  session: { id?: string; projectPath?: string | null } | undefined,
  sessionId: string | undefined,
): string {
  if (!sessionId || session?.id !== sessionId) {
    throw new Error("CRAFTMINE_HOST_SESSION_REQUIRED");
  }
  const source = session.projectPath
    ? ["project", session.projectPath]
    : ["session", sessionId];
  return `pi-${createHash("sha256").update(JSON.stringify(source)).digest("hex")}`;
}
