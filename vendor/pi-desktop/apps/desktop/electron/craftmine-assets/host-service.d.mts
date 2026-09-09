type BodyRequest = {assetId: string; version: number; path: string};
type PreviewRequest = BodyRequest & {jobId: string; settingsHash?: string; engineVersion?: string; attempt?: number; claimId?: string};
export function createAssetPreviewHost(options: {
  resolveBody: (input: BodyRequest) => Promise<unknown>;
  runPreview?: (input: unknown, options: {timeoutMs: number; signal: AbortSignal}) => Promise<unknown>;
}): {
  preview(input: unknown): Promise<unknown>;
  cancel(input: unknown): Promise<{jobId: string; cancelled: boolean}>;
  dispose(): Promise<void>;
};
