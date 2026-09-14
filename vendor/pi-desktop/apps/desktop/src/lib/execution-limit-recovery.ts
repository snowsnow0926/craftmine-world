export const EXECUTION_LIMIT_ERRORS = new Set([
  "REQUEST_BUDGET_EXHAUSTED", "COMPACTION_BUDGET_EXHAUSTED", "TASK_DEADLINE_EXCEEDED",
]);

export function isExecutionLimitFailure(code: unknown): boolean {
  return typeof code === "string" && EXECUTION_LIMIT_ERRORS.has(code);
}

/** A player button owns the release and continuation. Neither model text nor
 * transcript IDs authorize changes to the current task. */
export async function releaseAndContinueTask(options: {
  call: (channel: string, payload: Record<string, unknown>) => Promise<any>;
  assertSession: () => void;
  sessionId: string;
  onReleased: () => void;
}) {
  const {call, assertSession} = options;
  assertSession();
  const selection = await call("world.list", {}); assertSession();
  const worldId = selection.activeWorldId;
  if (typeof worldId !== "string" || !worldId) throw Error("SELECTED_WORLD_CHANGED");
  const current = await call("task.current", {worldId}); assertSession();
  const task = current.context;
  if (!task || task.binding?.sessionId !== options.sessionId || !task.binding.taskId || !Number.isSafeInteger(task.generation)) throw Error("STALE_TASK");
  const target = {taskId: task.binding.taskId, generation: task.generation};
  const prepared = await call("workbench.prepare", {worldId, channel: "task.releaseExecutionLimits", payload: target}); assertSession();
  const result = await call("workbench.execute", {worldId, operationId: prepared.operationId});
  if (result.kind !== "player-execution-limit-release" || result.modelReplay !== false || result.resumed !== false
    || result.taskId !== target.taskId || result.generation !== target.generation || result.worldId !== worldId) throw Error("INVALID_OPERATION_RECEIPT");
  options.onReleased(); assertSession();
  const latest = await call("world.list", {}); assertSession();
  if (latest.activeWorldId !== worldId) throw Error("SELECTED_WORLD_CHANGED");
  return call("task.resume", {worldId, ...target});
}
