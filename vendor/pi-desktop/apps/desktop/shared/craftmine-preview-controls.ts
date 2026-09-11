export type CraftminePreviewIdentity = { worldId: string; candidateId: string; buildId: string; previewId: string };
export type CraftminePreviewState = CraftminePreviewIdentity & {
  applyDisabled: boolean;
  closeDisabled: boolean;
  applyLabel: string;
  reason: string;
  next: string;
  error: string;
};

export function validatePreviewControl(input: Record<string, unknown>): Record<string, unknown> {
  if (input.action === "state" && Object.keys(input).length === 1) return { action: "state" };
  const keys = ["worldId", "candidateId", "buildId", "previewId"];
  if (!["apply", "close"].includes(String(input.action))
    || Object.keys(input).sort().join(",") !== "action,buildId,candidateId,previewId,worldId"
    || !keys.every(key => typeof input[key] === "string" && (input[key] as string).length > 0 && (input[key] as string).length <= 240)) {
    throw Error("INVALID_PREVIEW_CONTROL");
  }
  return { ...input };
}
