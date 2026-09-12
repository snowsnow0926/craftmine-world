/** Match host-core permission precedence; an explicit session choice wins. */
export function creationAllowsFullAuto(session: {permissionMode?: unknown} | undefined, defaultMode: unknown): boolean {
  if (!session) return false;
  const mode = session.permissionMode;
  return (mode === undefined || mode === "inherit" ? defaultMode : mode) === "auto";
}
