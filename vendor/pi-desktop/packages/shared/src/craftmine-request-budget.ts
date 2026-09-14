/** Shared arithmetic for the PI world request guard and its UI explanation.
 * Output is the actual next-request allowance, not already consumed tokens.
 * This helper never changes the configured window or output allowance. */
export function craftmineRequestBudget(
  contextWindow: number,
  maxOutputTokens: number,
  toolResultReserve = 2048,
) {
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 1 ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 ||
      !Number.isSafeInteger(toolResultReserve) || toolResultReserve < 0) {
    throw new Error("CRAFTMINE_CONTEXT_BUDGET_INVALID");
  }
  const inputCapacity = Math.max(0, contextWindow - maxOutputTokens - toolResultReserve);
  return {
    contextWindow,
    maxOutputTokens,
    toolResultReserve,
    inputCapacity,
    // Apply early-compaction headroom to input space, not to the output cap.
    compactionThreshold: Math.floor(inputCapacity * 0.85),
  };
}
