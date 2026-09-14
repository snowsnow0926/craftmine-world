import type {CodexUsageCoverage,MessageUsage} from '@pi-desktop/shared';

/** Read-only projection for the already persisted legacy context-full marker. */
export function codexContextCapacityMarker(usage:MessageUsage|undefined,window:number|undefined) {
  return typeof window==='number'&&window>0&&usage?.totalTokens===window&&
    [usage.inputTokens,usage.outputTokens,usage.cacheReadTokens,usage.cacheWriteTokens,usage.reasoningTokens].every(value=>value===0||value===undefined);
}

export function codexUsageCoverageText(coverage:CodexUsageCoverage,language:string) {
  const value=coverage.reportedCreationUsage?.totalTokens;
  const count=typeof value==='number'&&Number.isSafeInteger(value)&&value>0?new Intl.NumberFormat(language).format(value):null;
  return language.startsWith('zh')
    ? `CLI 已报告创作计数：${count??'未报告'}${count?' tokens':''}；维护用量未报告，总量不完整。`
    : `CLI-reported creation counters: ${count??'not reported'}${count?' tokens':''}; maintenance usage is unreported, so total usage is incomplete.`;
}
