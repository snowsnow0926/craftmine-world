/**
 * Asset library controller and React binding (agent R6).
 *
 * The controller owns every host call and keeps one immutable snapshot, so the
 * same logic is driven by the real bridge in the app and by a fake `call` in
 * tests. Failures are recorded in `error`/`status` *and* rethrown: the caller
 * decides what to show, nothing is swallowed.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  ASSET_LICENSE_STATUSES,
  ASSET_VERSIONS_LIMIT,
  buildSearchRequest,
  latestPreview,
  mergePage,
  type AssetCard,
  type AssetImportRequest,
  type AssetLibraryLang,
  type AssetPreview,
  type AssetPreviewBeginResult,
  type AssetPreviewFacts,
  type AssetPreviewFinishRequest,
  type AssetPreviewRecord,
  type AssetPreviewStatus,
  type AssetReadResult,
  type AssetScanResult,
  type AssetSearchInput,
  type AssetSearchRequest,
  type AssetSearchResult,
  type AssetSource,
  type AssetState,
  type AssetUsageItem,
  type AssetUsageResult,
  type AssetVersionEntry,
  type AssetVersionsResult,
} from "./asset-library-model";

export type AssetLibraryCall = (
  channel: string,
  payload: Record<string, unknown>,
) => Promise<unknown>;

export type AssetLibraryStatus = "idle" | "loading" | "ready" | "error" | "unavailable";

export type AssetLibraryImportSummary = {
  assetId: string;
  version: number;
  displayName: string;
  contentHash: string;
  deduplicated: boolean;
  replayed: boolean;
};

export type AssetLibrarySnapshot = {
  status: AssetLibraryStatus;
  error: string | null;
  cards: AssetCard[];
  total: number;
  truncated: boolean;
  nextOffset: number | null;
  request: AssetSearchRequest | null;
  selected: AssetReadResult | null;
  versions: AssetVersionEntry[];
  versionsTotal: number;
  versionsNextOffset: number | null;
  preview: AssetPreview | null;
  previewJob: AssetPreviewBeginResult | null;
  previewRecords: AssetPreviewRecord[];
  usage: AssetUsageItem[];
  usageTotal: number;
  scan: AssetScanResult | null;
  lastImport: AssetLibraryImportSummary | null;
  busy: boolean;
};

export type AssetAnnotateRequest = {
  operationId?: string;
  assetId: string;
  displayName?: string;
  tags?: string[];
  favorite?: boolean;
  notes?: string;
};

export type AssetLibraryActions = {
  search(input: AssetSearchInput): Promise<AssetSearchResult>;
  loadMore(): Promise<AssetSearchResult | null>;
  refresh(): Promise<AssetSearchResult | null>;
  loadVersions(assetId: string, offset?: number): Promise<AssetVersionsResult>;
  select(assetId: string, version: number): Promise<AssetReadResult>;
  previewBegin(
    assetId: string,
    version: number,
    settingsHash?: string,
  ): Promise<AssetPreviewBeginResult>;
  previewFinish(request: AssetPreviewFinishRequest): Promise<void>;
  cancelPreview(): Promise<void>;
  retryPreview(): Promise<AssetPreviewBeginResult | null>;
  annotate(input: AssetAnnotateRequest): Promise<void>;
  scan(sourceRoot: string): Promise<AssetScanResult>;
  importAsset(request: AssetImportRequest): Promise<AssetLibraryImportSummary>;
};

export type AssetLibraryControllerApi = AssetLibraryActions & {
  snapshot(): AssetLibrarySnapshot;
  subscribe(listener: () => void): () => void;
};

export type AssetLibraryController = AssetLibrarySnapshot & AssetLibraryActions;

export type AssetLibraryBridge = {
  call(channel: string, payload?: Record<string, unknown>): Promise<unknown>;
};

/* ------------------------------------------------------------ host parsing */

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const optNum = (value: unknown): number | null => (typeof value === "number" ? value : null);
const bool = (value: unknown): boolean => value === true;

const PREVIEW_STATUSES: AssetPreviewStatus[] = [
  "pending",
  "ok",
  "partial",
  "failed",
  "timeout",
  "cancelled",
];

function parseSource(value: unknown): AssetSource {
  const raw = record(value);
  const status = str(raw.licenseStatus);
  return {
    origin: str(raw.origin),
    author: str(raw.author),
    license: str(raw.license),
    licenseStatus: ASSET_LICENSE_STATUSES.includes(
      status as (typeof ASSET_LICENSE_STATUSES)[number],
    )
      ? (status as AssetSource["licenseStatus"])
      : "unknown",
  };
}

function parseState(value: unknown): AssetState {
  const raw = record(value);
  const check = record(raw.baseChecked);
  const applied = record(raw.appliedToSource);
  return {
    indexed: bool(raw.indexed),
    previewable: bool(raw.previewable),
    baseChecked: raw.baseChecked
      ? {
          status: str(check.status),
          baseId: str(check.baseId),
          baseVersion: num(check.baseVersion),
          engineVersion: str(check.engineVersion),
          target: str(check.target),
          checkerVersion: str(check.checkerVersion),
          detail: str(check.detail),
        }
      : null,
    appliedToSource: raw.appliedToSource
      ? { worldId: str(applied.worldId), detail: str(applied.detail) }
      : null,
  };
}

function parseCard(value: unknown): AssetCard {
  const raw = record(value);
  return {
    assetId: str(raw.assetId),
    version: num(raw.version),
    kind: str(raw.kind),
    mediaKind: str(raw.mediaKind),
    contentHash: str(raw.contentHash),
    displayName: str(raw.displayName),
    tags: list(raw.tags).filter((tag): tag is string => typeof tag === "string"),
    favorite: bool(raw.favorite),
    bytes: num(raw.bytes),
    fileCount: num(raw.fileCount),
    source: parseSource(raw.source),
    createdAt: num(raw.createdAt),
    state: parseState(raw.state),
  };
}

function parseSearchResult(value: unknown): AssetSearchResult {
  const raw = record(value);
  return {
    items: list(raw.items).map(parseCard),
    total: num(raw.total),
    truncated: bool(raw.truncated),
    nextOffset: optNum(raw.nextOffset),
  };
}

function parseVersionBody(value: unknown): AssetReadResult["version_"] {
  const raw = record(value);
  return {
    assetId: str(raw.assetId),
    version: num(raw.version),
    kind: str(raw.kind),
    mediaKind: str(raw.mediaKind),
    contentHash: str(raw.contentHash),
    displayName: str(raw.displayName),
    bytes: num(raw.bytes),
    fileCount: num(raw.fileCount),
    source: parseSource(raw.source),
    createdAt: num(raw.createdAt),
    files: list(raw.files).map((entry) => {
      const file = record(entry);
      return {
        path: str(file.path),
        sha256: str(file.sha256),
        bytes: num(file.bytes),
        mediaType: str(file.mediaType),
      };
    }),
  };
}

function parseReadResult(value: unknown): AssetReadResult {
  const raw = record(value);
  return { version_: parseVersionBody(raw.version_), state: parseState(raw.state) };
}

function parseVersionEntry(value: unknown): AssetVersionEntry {
  const raw = record(value);
  return { version_: parseVersionBody(raw.version_), state: parseState(raw.state) };
}

function parseVersionsResult(value: unknown): AssetVersionsResult {
  const raw = record(value);
  return {
    assetId: str(raw.assetId),
    items: list(raw.items).map(parseVersionEntry),
    total: num(raw.total),
    nextOffset: optNum(raw.nextOffset),
  };
}

function parsePreview(value: unknown): AssetPreview {
  const raw = record(value);
  const status = str(raw.status) as AssetPreviewStatus;
  return {
    // An unknown status is never treated as a success.
    status: PREVIEW_STATUSES.includes(status) ? status : "failed",
    detail: str(raw.detail),
    facts: record(raw.facts) as AssetPreviewFacts,
    createdAt: num(raw.createdAt),
  };
}

function parsePreviewBegin(value: unknown): AssetPreviewBeginResult {
  const raw = record(value);
  const previous = str(raw.previousStatus) as AssetPreviewStatus;
  return {
    jobId: str(raw.jobId),
    cacheKey: str(raw.cacheKey),
    cached: bool(raw.cached),
    retried: bool(raw.retried),
    ...(raw.previousStatus ? { previousStatus: previous } : {}),
    timeoutMs: num(raw.timeoutMs),
    preview: parsePreview(raw.preview),
  };
}

function parsePreviewRecords(value: unknown): AssetPreviewRecord[] {
  return list(record(value).items).map((entry) => {
    const raw = record(entry);
    const status = str(raw.status) as AssetPreviewStatus;
    return {
      previewerVersion: str(raw.previewerVersion),
      engineVersion: str(raw.engineVersion),
      settingsHash: str(raw.settingsHash),
      status: PREVIEW_STATUSES.includes(status) ? status : "failed",
      detail: str(raw.detail),
      facts: record(raw.facts) as AssetPreviewFacts,
      createdAt: num(raw.createdAt),
    };
  });
}

function parseUsage(value: unknown): AssetUsageResult {
  const raw = record(value);
  return {
    items: list(raw.items).map((entry) => {
      const item = record(entry);
      return {
        version: num(item.version),
        refKind: str(item.refKind),
        refId: str(item.refId),
        detail: str(item.detail),
        createdAt: num(item.createdAt),
      };
    }),
    total: num(raw.total),
  };
}

function parseScan(value: unknown): AssetScanResult {
  const raw = record(value);
  const hints = record(raw.hints);
  return {
    root: str(raw.root),
    scanned: num(raw.scanned),
    truncated: bool(raw.truncated),
    items: list(raw.items).map((entry) => {
      const item = record(entry);
      return {
        path: str(item.path),
        bytes: num(item.bytes),
        supported: bool(item.supported),
        mediaType: typeof item.mediaType === "string" ? item.mediaType : null,
        ...(item.sha256 === undefined ? {} : { sha256: item.sha256 === null ? null : str(item.sha256) }),
        known: item.known === true ? true : item.known === false ? false : null,
        ...(item.assetId === undefined ? {} : { assetId: str(item.assetId) }),
        ...(item.version === undefined ? {} : { version: num(item.version) }),
      };
    }),
    issues: list(raw.issues).map((entry) => {
      const issue = record(entry);
      return { path: issue.path === null ? null : str(issue.path), code: str(issue.code) };
    }),
    hints: {
      newVersions: num(hints.newVersions),
      unchanged: num(hints.unchanged),
      unsupported: num(hints.unsupported),
    },
    worldUpdated: false,
  };
}

function parseImport(value: unknown): AssetLibraryImportSummary {
  const raw = record(value);
  const version_ = record(raw.version_);
  return {
    assetId: str(raw.assetId) || str(version_.assetId),
    version: num(raw.version) || num(version_.version),
    displayName: str(raw.displayName) || str(version_.displayName),
    contentHash: str(raw.contentHash) || str(version_.contentHash),
    deduplicated: bool(raw.deduplicated),
    replayed: bool(raw.replayed),
  };
}

export function assetErrorMessage(raw: unknown): string {
  const text = (raw instanceof Error ? raw.message : String(raw ?? "")).trim();
  if (!text) return "ASSET_OPERATION_FAILED";
  const known: Record<string, string> = {
    ASSET_LIBRARY_UNAVAILABLE: "ASSET_LIBRARY_UNAVAILABLE",
    ASSET_NOT_FOUND: "ASSET_NOT_FOUND",
    ASSET_VERSION_CONFLICT: "ASSET_VERSION_CONFLICT",
    ASSET_SOURCE_CONFLICT: "ASSET_SOURCE_CONFLICT",
    ASSET_SOURCE_OUTSIDE_ROOT: "ASSET_SOURCE_OUTSIDE_ROOT",
    ASSET_SCAN_UNAVAILABLE: "ASSET_SCAN_UNAVAILABLE",
    UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
    MEDIA_KIND_MISMATCH: "MEDIA_KIND_MISMATCH",
    INVALID_ASSET_ID: "INVALID_ASSET_ID",
    WORLD_ID_REQUIRED: "WORLD_ID_REQUIRED",
    SELECTED_WORLD_CHANGED: "SELECTED_WORLD_CHANGED",
  };
  return known[text] ?? text;
}

/* ------------------------------------------------------------- controller */

function initialState(call: AssetLibraryCall | null): AssetLibrarySnapshot {
  return {
    status: call ? "idle" : "unavailable",
    error: null,
    cards: [],
    total: 0,
    truncated: false,
    nextOffset: null,
    request: null,
    selected: null,
    versions: [],
    versionsTotal: 0,
    versionsNextOffset: null,
    preview: null,
    previewJob: null,
    previewRecords: [],
    usage: [],
    usageTotal: 0,
    scan: null,
    lastImport: null,
    busy: false,
  };
}

function mergeVersionEntries(
  previous: AssetVersionEntry[],
  page: AssetVersionEntry[],
): AssetVersionEntry[] {
  const seen = new Set<number>();
  const merged: AssetVersionEntry[] = [];
  for (const entry of [...previous, ...page]) {
    const version = entry.version_.version;
    if (seen.has(version)) continue;
    seen.add(version);
    merged.push(entry);
  }
  return merged.sort((left, right) => right.version_.version - left.version_.version);
}

/**
 * Builds the controller over one injected `call`. `null` means the host channel
 * is not wired: every action reports `ASSET_LIBRARY_UNAVAILABLE` instead of
 * inventing data.
 */
export function createAssetLibraryController(
  call: AssetLibraryCall | null,
): AssetLibraryControllerApi {
  let state = initialState(call);
  const listeners = new Set<() => void>();

  const emit = (patch: Partial<AssetLibrarySnapshot>): void => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    if (!call) {
      const failure = new Error("ASSET_LIBRARY_UNAVAILABLE");
      emit({ status: "unavailable", error: assetErrorMessage(failure) });
      throw failure;
    }
    emit({ busy: true, error: null, status: state.status === "ready" ? "ready" : "loading" });
    try {
      const result = await work();
      return result;
    } catch (failure) {
      emit({ status: "error", error: assetErrorMessage(failure), busy: false });
      throw failure;
    } finally {
      if (state.busy) emit({ busy: false });
    }
  };

  const search = async (input: AssetSearchInput): Promise<AssetSearchResult> => {
    const request = buildSearchRequest(input);
    return run(async () => {
      const page = parseSearchResult(
        await call!("asset.search", request as unknown as Record<string, unknown>),
      );
      emit({
        cards: page.items,
        total: page.total,
        truncated: page.truncated,
        nextOffset: page.nextOffset,
        request,
        status: "ready",
      });
      return page;
    });
  };

  const loadMore = async (): Promise<AssetSearchResult | null> => {
    const request = state.request;
    if (!request || state.nextOffset === null) return null;
    const next: AssetSearchRequest = { ...request, offset: state.nextOffset };
    return run(async () => {
      const page = parseSearchResult(
        await call!("asset.search", next as unknown as Record<string, unknown>),
      );
      const merged = mergePage(
        {
          items: state.cards,
          total: state.total,
          truncated: state.truncated,
          nextOffset: state.nextOffset,
        },
        page,
      );
      emit({
        cards: merged.items,
        total: merged.total,
        truncated: merged.truncated,
        nextOffset: merged.nextOffset,
        request: next,
        status: "ready",
      });
      return merged;
    });
  };

  const refresh = async (): Promise<AssetSearchResult | null> => {
    const request = state.request;
    if (!request) return null;
    return search({ ...request });
  };

  const loadVersions = async (assetId: string, offset = 0): Promise<AssetVersionsResult> =>
    run(async () => {
      const result = parseVersionsResult(
        await call!("asset.versions", { assetId, offset, limit: ASSET_VERSIONS_LIMIT }),
      );
      emit({
        versions:
          offset > 0 ? mergeVersionEntries(state.versions, result.items) : result.items,
        versionsTotal: result.total,
        versionsNextOffset: result.nextOffset,
        status: "ready",
      });
      return result;
    });

  const select = async (assetId: string, version: number): Promise<AssetReadResult> =>
    run(async () => {
      const read = parseReadResult(await call!("asset.read", { assetId, version }));
      emit({
        selected: read,
        preview: null,
        previewJob: null,
        previewRecords: [],
        usage: [],
        usageTotal: 0,
        status: "ready",
      });
      const [records, usage] = await Promise.all([
        call!("asset.previewRead", { assetId, version }).then(parsePreviewRecords),
        call!("asset.usage", { assetId, version }).then(parseUsage),
      ]);
      emit({
        previewRecords: records,
        preview: latestPreview(records),
        usage: usage.items,
        usageTotal: usage.total,
        status: "ready",
      });
      if (!state.versions.length || state.versions[0].version_.assetId !== assetId) {
        await loadVersions(assetId);
      }
      return read;
    });

  const previewBegin = async (
    assetId: string,
    version: number,
    settingsHash?: string,
  ): Promise<AssetPreviewBeginResult> =>
    run(async () => {
      const payload: Record<string, unknown> = { assetId, version };
      if (settingsHash) payload.settingsHash = settingsHash;
      const result = parsePreviewBegin(await call!("asset.previewBegin", payload));
      emit({ preview: result.preview, previewJob: result, status: "ready" });
      return result;
    });

  const previewFinish = async (request: AssetPreviewFinishRequest): Promise<void> => {
    await run(async () => {
      await call!("asset.previewFinish", request as unknown as Record<string, unknown>);
      // The host is the only writer of preview state: re-read it instead of
      // trusting the request we just sent.
      const selected = state.selected;
      if (
        selected &&
        selected.version_.assetId === request.assetId &&
        selected.version_.version === request.version
      ) {
        const records = parsePreviewRecords(
          await call!("asset.previewRead", {
            assetId: request.assetId,
            version: request.version,
          }),
        );
        emit({
          previewRecords: records,
          preview: latestPreview(records),
          status: "ready",
        });
        return;
      }
      emit({ status: "ready" });
    });
  };

  /** UI-side cancel: the host finishes the job with `status: "cancelled"`. */
  const cancelPreview = async (): Promise<void> => {
    const job = state.previewJob;
    const selected = state.selected;
    if (!job || !selected) return;
    await previewFinish({
      operationId: job.jobId,
      assetId: selected.version_.assetId,
      version: selected.version_.version,
      status: "cancelled",
      detail: "",
      facts: {},
    });
    emit({ previewJob: null });
  };

  const retryPreview = async (): Promise<AssetPreviewBeginResult | null> => {
    const selected = state.selected;
    if (!selected) return null;
    return previewBegin(selected.version_.assetId, selected.version_.version);
  };

  const annotate = async (input: AssetAnnotateRequest): Promise<void> => {
    await run(async () => {
      const payload: Record<string, unknown> = {
        operationId: input.operationId ?? `asset-annotate:${input.assetId}`,
        assetId: input.assetId,
      };
      if (input.displayName !== undefined) payload.displayName = input.displayName;
      if (input.tags !== undefined) payload.tags = input.tags;
      if (input.favorite !== undefined) payload.favorite = input.favorite;
      if (input.notes !== undefined) payload.notes = input.notes;
      await call!("asset.annotate", payload);
      emit({ status: "ready" });
    });
    if (state.request) await refresh();
  };

  const scan = async (sourceRoot: string): Promise<AssetScanResult> =>
    run(async () => {
      const result = parseScan(await call!("asset.scan", { sourceRoot }));
      emit({ scan: result, status: "ready" });
      return result;
    });

  const importAsset = async (
    request: AssetImportRequest,
  ): Promise<AssetLibraryImportSummary> => {
    const summary = await run(async () => {
      const result = parseImport(
        await call!("asset.import", request as unknown as Record<string, unknown>),
      );
      emit({ lastImport: result, status: "ready" });
      return result;
    });
    // The import already succeeded; a failed list refresh must not turn it into
    // an import failure (the refresh records its own error).
    if (state.request) await refresh().catch(() => {});
    return summary;
  };

  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    search,
    loadMore,
    refresh,
    loadVersions,
    select,
    previewBegin,
    previewFinish,
    cancelPreview,
    retryPreview,
    annotate,
    scan,
    importAsset,
  };
}

/* ------------------------------------------------------------------- hook */

/**
 * React binding. `bridge` may be null (host channel not wired); the controller
 * then reports `unavailable` instead of throwing during render. Action
 * rejections are never swallowed — they update `error` and propagate.
 */
export function useAssetLibrary(bridge: AssetLibraryBridge | null): AssetLibraryController {
  const controller = useMemo<AssetLibraryControllerApi>(
    () =>
      createAssetLibraryController(
        bridge ? (channel, payload) => bridge.call(channel, payload) : null,
      ),
    [bridge],
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    // Only the mount-time load is guarded: React cannot surface a rejection
    // here, and the failure is already in `error`/`status` for the panel.
    void controller.refresh().catch(() => {});
  }, [controller]);
  return {
    ...snapshot,
    search: controller.search,
    loadMore: controller.loadMore,
    refresh: controller.refresh,
    loadVersions: controller.loadVersions,
    select: controller.select,
    previewBegin: controller.previewBegin,
    previewFinish: controller.previewFinish,
    cancelPreview: controller.cancelPreview,
    retryPreview: controller.retryPreview,
    annotate: controller.annotate,
    scan: controller.scan,
    importAsset: controller.importAsset,
  };
}

/** Convenience for hosts that already expose a Craftmine world bridge. */
export function assetLibraryCallFrom(bridge: AssetLibraryBridge | null): AssetLibraryCall | null {
  if (!bridge) return null;
  return (channel, payload) => bridge.call(channel, payload);
}

export type { AssetLibraryLang };
