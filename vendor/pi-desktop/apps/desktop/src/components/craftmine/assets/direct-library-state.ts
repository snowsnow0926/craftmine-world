import {useSyncExternalStore} from "react";
import type {AssetLibraryBridge} from "./use-asset-library";
import type {LibraryReference} from "../../../lib/player-library";
import type {DirectPosition, DirectLibraryOperation as DirectOperation, DirectLibraryInspection as DirectInspection} from "./direct-library-contract";
export type {DirectPosition, DirectLibraryOperation as DirectOperation, DirectLibraryInspection as DirectInspection} from "./direct-library-contract";

export type DirectStatus = DirectOperation["status"];
export type DirectAttempt = {
  request: {action: "start"; worldId: string; ref: LibraryReference; operationId: string; position?: DirectPosition};
  displayName: string; operation: DirectOperation | null; error: string; pending: boolean;
};
const statuses = new Set(["preparing", "checking", "ready", "applying", "applied", "cancelled", "failed", "interrupted"]);
const terminal = new Set(["applied", "cancelled", "failed", "interrupted"]);
const storageKey = "craftmine.direct-library.operations.v1";
const listeners = new Set<() => void>();
let snapshot: DirectAttempt[] | undefined;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sameRef = (a: LibraryReference, b: LibraryReference) => a.assetId === b.assetId && a.version === b.version && a.contentHash === b.contentHash;
export const directIsTerminal = (status?: DirectStatus) => !!status && terminal.has(status);

export function parseDirectInspection(raw: unknown): DirectInspection {
  const value = record(raw);
  if (typeof value.eligible !== "boolean" || value.compatibility !== "unchecked" || typeof value.positionSupported !== "boolean") throw Error("DIRECT_LIBRARY_RECEIPT_INVALID");
  return {eligible: value.eligible, compatibility: "unchecked", positionSupported: value.positionSupported,
    ...(typeof value.reason === "string" ? {reason: value.reason} : {}), ...(typeof value.displayName === "string" ? {displayName: value.displayName} : {})};
}

/** Reject responses from another selection before they can enter retained UI state. */
export function parseDirectOperation(raw: unknown, attempt: DirectAttempt): DirectOperation {
  const value = record(raw), ref = record(value.ref) as LibraryReference;
  if (value.operationId !== attempt.request.operationId || value.worldId !== attempt.request.worldId || !sameRef(ref, attempt.request.ref)
    || !statuses.has(String(value.status)) || typeof value.stage !== "string" || value.modelCalls !== 0
    || typeof value.draftRetained !== "boolean" || !Array.isArray(value.instanceIds) || !value.instanceIds.every(id => typeof id === "string")
    || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) throw Error("DIRECT_LIBRARY_RECEIPT_INVALID");
  const error = record(value.error);
  return {operationId: String(value.operationId), worldId: String(value.worldId), ref: {...attempt.request.ref},
    ...(attempt.request.position ? {position: {...attempt.request.position}} : {}), status: value.status as DirectStatus,
    stage: value.stage, instanceIds: value.instanceIds as string[], draftRetained: value.draftRetained, modelCalls: 0,
    createdAt: Number(value.createdAt), updatedAt: Number(value.updatedAt),
    ...(typeof value.jobId === "string" ? {jobId: value.jobId} : {}), ...(typeof value.candidateId === "string" ? {candidateId: value.candidateId} : {}),
    ...(typeof error.code === "string" && typeof error.message === "string" ? {error: {code: error.code, message: error.message}} : {})};
}

function getSnapshot(): DirectAttempt[] {
  if (snapshot) return snapshot;
  snapshot = [];
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(rows)) for (const raw of rows) {
      const row = record(raw), request = record(row.request), ref = record(request.ref), position = record(request.position);
      if (request.action !== "start" || typeof request.worldId !== "string" || !request.worldId || request.worldId.length > 128
        || typeof request.operationId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(request.operationId)
        || typeof ref.assetId !== "string" || !Number.isSafeInteger(ref.version) || Number(ref.version) < 1
        || typeof ref.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(ref.contentHash)) continue;
      if (request.position !== undefined && ![position.x, position.y, position.z].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 80)) continue;
      const attempt: DirectAttempt = {request: {action: "start", worldId: request.worldId, operationId: request.operationId,
        ref: {assetId: ref.assetId, version: Number(ref.version), contentHash: ref.contentHash},
        ...(request.position ? {position: position as DirectPosition} : {})}, displayName: String(row.displayName ?? ref.assetId).slice(0, 160),
        operation: null, error: "", pending: false};
      // Persist locators only. A new renderer must ask main before showing any result.
      snapshot.push(attempt);
    }
  } catch { /* In-memory retention still works when profile storage is unavailable. */ }
  return snapshot;
}
export const currentDirectAttempts = () => getSnapshot();
function update(id: string, mutate: (attempt: DirectAttempt) => DirectAttempt): void {
  snapshot = getSnapshot().map(row => row.request.operationId === id ? mutate(row) : row);
  // Bound completed UI history, while never evicting an unresolved native operation.
  const completed = snapshot.filter(row => directIsTerminal(row.operation?.status)).slice(-20);
  snapshot = snapshot.filter(row => !directIsTerminal(row.operation?.status) || completed.includes(row));
  try {localStorage.setItem(storageKey, JSON.stringify(snapshot.map(({request, displayName}) => ({request, displayName}))));} catch { /* Host operations remain durable. */ }
  for (const listener of listeners) listener();
}
export function useDirectAttempts() {
  return useSyncExternalStore(listener => {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot, getSnapshot);
}
export function retainDirectAttempt(worldId: string, ref: LibraryReference, displayName: string, position?: DirectPosition): DirectAttempt {
  const attempt: DirectAttempt = {request: {action: "start", worldId, ref: {...ref}, operationId: crypto.randomUUID(), ...(position ? {position} : {})}, displayName, operation: null, error: "", pending: false};
  snapshot = [...getSnapshot(), attempt]; update(attempt.request.operationId, row => row);
  return attempt;
}

/** All mutations use the retained immutable request; retries never invent a replacement operation. */
export async function requestDirectOperation(bridge: AssetLibraryBridge, attempt: DirectAttempt, action: "start" | "status" | "cancel" | "apply"): Promise<void> {
  const id = attempt.request.operationId;
  update(id, row => ({...row, pending: action !== "status" || row.pending, error: ""}));
  try {
    const payload = action === "start" ? attempt.request : {action, worldId: attempt.request.worldId, operationId: id};
    const operation = parseDirectOperation(await bridge.call("library.direct", payload), attempt);
    update(id, row => {
      const previous = row.operation;
      if (previous && (previous.updatedAt > operation.updatedAt || (directIsTerminal(previous.status) && previous.status !== operation.status))) return {...row, pending: action === "status" ? row.pending : false};
      return {...row, operation, pending: action === "status" && !directIsTerminal(operation.status) ? row.pending : false, error: ""};
    });
  } catch (failure) {
    update(id, row => directIsTerminal(row.operation?.status) ? {...row, pending: false} : {...row, pending: action === "status" ? row.pending : false, error: failure instanceof Error ? failure.message : String(failure)});
  }
}

export function directErrorMessage(raw: string, zh: boolean): string {
  if (/WORLD_CHANGED|WORLD_NOT_SELECTED|SELECTION|STALE/i.test(raw)) return zh ? "世界或内容已改变。返回原世界查看此操作；重新准备前请先确认当前内容。" : "The world or content changed. Return to the original world and review this operation before preparing again.";
  if (/BUSY|ACTIVE|PENDING/i.test(raw)) return zh ? "世界正在处理其他创作。等待它结束后，刷新本次状态。" : "Another creation is active. Wait for it to finish, then refresh this operation.";
  if (/RUNWAY|SPACE|COLLISION|OVERLAP|FOOTPRINT|GROUND|PLACEMENT/i.test(raw)) return zh ? "这个位置或场地不符合素材要求。查看检查原因，调整位置或选择合适的世界后重新准备。" : "The placement or site does not meet this asset's requirements. Review the check, then adjust the position or use a suitable world.";
  if (/INPUT|WEATHER|KEY.*CONFLICT/i.test(raw)) return zh ? "素材与现有控制或天气冲突。请先处理冲突，或让 AI 根据完整需求修改。" : "The asset conflicts with existing controls or weather. Resolve the conflict, or ask AI to adapt the full request.";
  if (/UNSUPPORTED|NOT_ELIGIBLE|SOURCE_PACKAGE|RAW|KIND/i.test(raw)) return zh ? "此素材暂不支持直接放置。可让 AI 使用它；世界模板请从模板新建世界。" : "This asset does not support direct placement. Ask AI to use it, or create a separate world from a world template.";
  if (/NOT_FOUND|UNKNOWN_OPERATION/i.test(raw)) return zh ? "尚未找到此操作。可重试同一次准备，不会创建新的操作编号。" : "This operation was not found. Retry the same preparation with its original operation ID.";
  return zh ? "操作未完成。请刷新状态；如仍失败，保留检查原因再处理。" : "The operation did not finish. Refresh its status; if it still fails, review the reported reason.";
}
