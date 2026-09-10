/**
 * Asset library controller and React binding (agent R6).
 *
 * The controller owns every host call and keeps one immutable snapshot, so the
 * same logic is driven by the real bridge in the app and by a fake `call` in
 * tests. Failures are recorded and rethrown. Annotation failures are scoped to
 * their logical asset so a late response cannot replace another asset's UI.
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
  selectedMetadata: {assetId: string; tags: string[]; favorite: boolean} | null;
  annotationEdits: Record<string, {request: AssetAnnotateRequest; saving: boolean; error: string | null}>;
  versions: AssetVersionEntry[];
  versionsTotal: number;
  versionsNextOffset: number | null;
  preview: AssetPreview | null;
  previewJob: AssetPreviewBeginResult | null;
  previewRecords: AssetPreviewRecord[];
  usage: AssetUsageItem[];
  usageTotal: number;
  // The scan result is data. The `scan` action keeps its name in
  // `AssetLibraryActions`; the two must never share a key, or the merged
  // controller object lets the method overwrite the result.
  scanResult: AssetScanResult | null;
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
  retryAnnotation(assetId: string): Promise<void>;
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
  // `asset.preview` returns the decoder evidence directly; a raw
  // `asset.previewBegin` nests it under `preview`.
  const evidence = raw.preview ? record(raw.preview) : raw;
  const previous = str(raw.previousStatus) as AssetPreviewStatus;
  return {
    jobId: str(raw.jobId),
    cacheKey: str(raw.cacheKey),
    cached: bool(raw.cached),
    retried: bool(raw.retried),
    attempt: num(raw.attempt ?? evidence.attempt),
    // A result the core rejected as stale must never be presented as applied.
    applied: raw.applied === undefined ? true : bool(raw.applied),
    stale: bool(raw.stale),
    reason: str(raw.reason),
    ...(raw.previousStatus ? { previousStatus: previous } : {}),
    timeoutMs: num(raw.timeoutMs),
    preview: parsePreview(evidence),
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
    selectedMetadata: null,
    annotationEdits: {},
    versions: [],
    versionsTotal: 0,
    versionsNextOffset: null,
    preview: null,
    previewJob: null,
    previewRecords: [],
    usage: [],
    usageTotal: 0,
    scanResult: null,
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

  // Monotonic query generation: a response for a previous scope/world must
  // never overwrite the current list after the player switches.
  let generation = 0;
  // Preview attempts have their own generation. A late decode result, cancel or
  // retry for a previous attempt is dropped by identity, not hidden by the UI.
  let previewGeneration = 0;
  let selectionGeneration = 0;
  const acknowledgedMetadata = new Map<string, {tags?: string[]; favorite?: boolean}>();

  const run = async <T>(work: () => Promise<T>, current: () => boolean = () => true): Promise<T> => {
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
      if (current()) emit({ status: "error", error: assetErrorMessage(failure), busy: false });
      throw failure;
    } finally {
      if (current() && state.busy) emit({ busy: false });
    }
  };

  const search = async (input: AssetSearchInput): Promise<AssetSearchResult> => {
    const request = buildSearchRequest(input);
    const mine = ++generation;
    return run(async () => {
      const page = parseSearchResult(
        await call!("asset.search", request as unknown as Record<string, unknown>),
      );
      // A late response for a previous scope/world is dropped, not shown.
      if (mine !== generation) return page;
      for (const card of page.items) acknowledgedMetadata.delete(card.assetId);
      const selectedCard = page.items.find(card => card.assetId === state.selectedMetadata?.assetId);
      emit({
        cards: page.items,
        total: page.total,
        truncated: page.truncated,
        nextOffset: page.nextOffset,
        request,
        selectedMetadata: selectedCard ? {assetId: selectedCard.assetId, tags: [...selectedCard.tags], favorite: selectedCard.favorite} : state.selectedMetadata,
        status: "ready",
      });
      return page;
    });
  };

  const loadMore = async (): Promise<AssetSearchResult | null> => {
    const request = state.request;
    if (!request || state.nextOffset === null) return null;
    const next: AssetSearchRequest = { ...request, offset: state.nextOffset };
    const mine = generation;
    return run(async () => {
      const page = parseSearchResult(
        await call!("asset.search", next as unknown as Record<string, unknown>),
      );
      if (mine !== generation) return page;
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

  const loadVersions = async (assetId: string, offset = 0): Promise<AssetVersionsResult> => {
    const mine = selectionGeneration;
    return run(async () => {
      const result = parseVersionsResult(
        await call!("asset.versions", { assetId, offset, limit: ASSET_VERSIONS_LIMIT }),
      );
      if (mine !== selectionGeneration) return result;
      emit({
        versions:
          offset > 0 ? mergeVersionEntries(state.versions, result.items) : result.items,
        versionsTotal: result.total,
        versionsNextOffset: result.nextOffset,
        status: "ready",
      });
      return result;
    }, () => mine === selectionGeneration);
  };

  const select = async (assetId: string, version: number): Promise<AssetReadResult> => {
    const mine = ++selectionGeneration;
    const metadata = state.cards.find(card => card.assetId === assetId)
      ?? (state.selectedMetadata?.assetId === assetId ? state.selectedMetadata : null);
    emit({selected: null, selectedMetadata: null});
    return run(async () => {
      // A preview in flight for the previous selection is now superseded.
      previewGeneration += 1;
      const read = parseReadResult(await call!("asset.read", { assetId, version }));
      if (mine !== selectionGeneration) return read;
      emit({
        selected: read,
        selectedMetadata: metadata ? {assetId, tags: [...metadata.tags], favorite: metadata.favorite, ...acknowledgedMetadata.get(assetId)} : null,
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
      if (mine !== selectionGeneration) return read;
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
    }, () => mine === selectionGeneration);
  };

  const previewBegin = async (
    assetId: string,
    version: number,
    settingsHash?: string,
  ): Promise<AssetPreviewBeginResult> => {
    // Evict by attempt identity: a result that arrives after the player
    // switched asset/version, cancelled or retried is discarded, not shown.
    const mine = ++previewGeneration;
    return run(async () => {
      const payload: Record<string, unknown> = { assetId, version };
      if (settingsHash) payload.settingsHash = settingsHash;
      // `asset.preview` runs begin -> decode -> finish against one core-issued
      // claim; the panel never writes preview state itself.
      const result = parsePreviewBegin(await call!("asset.preview", payload));
      if (mine !== previewGeneration) return result;
      const selected = state.selected;
      if (
        selected &&
        (selected.version_.assetId !== assetId || selected.version_.version !== version)
      ) {
        return result;
      }
      emit({ preview: result.preview, previewJob: result, status: "ready" });
      const records = parsePreviewRecords(
        await call!("asset.previewRead", { assetId, version }),
      );
      if (mine !== previewGeneration) return result;
      emit({
        previewRecords: records,
        preview: latestPreview(records) ?? result.preview,
        status: "ready",
      });
      return result;
    });
  };

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

  /**
   * Player cancel. The host terminates the live worker and closes the attempt;
   * a cached ok preview is never rewritten to cancelled. Any in-flight result
   * for this asset is superseded.
   */
  const cancelPreview = async (): Promise<void> => {
    const selected = state.selected;
    if (!selected) return;
    previewGeneration += 1;
    await run(async () => {
      await call!("asset.cancel", {
        assetId: selected.version_.assetId,
        version: selected.version_.version,
        detail: "cancelled by player",
      });
      const records = parsePreviewRecords(
        await call!("asset.previewRead", {
          assetId: selected.version_.assetId,
          version: selected.version_.version,
        }),
      );
      emit({
        previewJob: null,
        previewRecords: records,
        preview: latestPreview(records),
        status: "ready",
      });
    });
  };

  const retryPreview = async (): Promise<AssetPreviewBeginResult | null> => {
    const selected = state.selected;
    if (!selected) return null;
    return previewBegin(selected.version_.assetId, selected.version_.version);
  };

  const annotationRuns = new Map<string, Promise<void>>();
  const submitAnnotation = (request: AssetAnnotateRequest): Promise<void> => {
    const {assetId} = request;
    const active = annotationRuns.get(assetId);
    if (active) return active;
    const mine = generation;
    emit({annotationEdits: {...state.annotationEdits, [assetId]: {request, saving: true, error: null}}});
    const work = Promise.resolve().then(async () => {
      try {
        if (!call) throw new Error("ASSET_LIBRARY_UNAVAILABLE");
        const result = record(await call("asset.annotate", request as Record<string, unknown>));
        const metadata = record(result.metadata);
        if (result.assetId !== assetId || result.operationId !== request.operationId
          || (request.favorite !== undefined && metadata.favorite !== request.favorite)
          || (request.tags !== undefined && (!Array.isArray(metadata.tags)
            || JSON.stringify([...new Set(request.tags)].sort()) !== JSON.stringify([...metadata.tags].sort())))) {
          throw new Error("ASSET_ANNOTATION_RECEIPT_MISMATCH");
        }
        const patch = {
          ...(request.tags !== undefined ? {tags: [...metadata.tags as string[]]} : {}),
          ...(request.favorite !== undefined ? {favorite: metadata.favorite as boolean} : {}),
        };
        const edits = {...state.annotationEdits};
        delete edits[assetId];
        // Release the write slot before publishing enabled controls. A slow
        // read-only refresh must not swallow the player's next distinct edit.
        annotationRuns.delete(assetId);
        acknowledgedMetadata.set(assetId, {...acknowledgedMetadata.get(assetId), ...patch});
        emit({annotationEdits: edits,
          cards: state.cards.map(card => card.assetId === assetId ? {...card, ...patch} : card),
          selectedMetadata: state.selectedMetadata?.assetId === assetId ? {...state.selectedMetadata, ...patch} : state.selectedMetadata});
        // A committed edit is not retried because its list refresh failed.
        // Never reuse a query from an earlier scope/world.
        if (mine === generation && state.request) await refresh().catch(() => {});
      } catch (failure) {
        emit({annotationEdits: {...state.annotationEdits, [assetId]: {request, saving: false, error: assetErrorMessage(failure)}}});
        throw failure;
      } finally {
        if (annotationRuns.get(assetId) === work) annotationRuns.delete(assetId);
      }
    });
    annotationRuns.set(assetId, work);
    return work;
  };
  const annotate = (input: AssetAnnotateRequest): Promise<void> => {
    // A new edit must not overtake an unacknowledged edit for this logical asset.
    if (Object.hasOwn(state.annotationEdits, input.assetId)) return Promise.reject(new Error("ASSET_ANNOTATION_PENDING"));
    const request: AssetAnnotateRequest = {assetId: input.assetId,
      operationId: input.operationId ?? `asset-annotate:${globalThis.crypto.randomUUID()}`};
    if (input.tags !== undefined) request.tags = [...input.tags];
    if (input.favorite !== undefined) request.favorite = input.favorite;
    if (input.displayName !== undefined) request.displayName = input.displayName;
    if (input.notes !== undefined) request.notes = input.notes;
    if (request.tags) Object.freeze(request.tags);
    Object.freeze(request);
    return submitAnnotation(request);
  };
  const retryAnnotation = (assetId: string): Promise<void> => {
    const edit = Object.hasOwn(state.annotationEdits, assetId) ? state.annotationEdits[assetId] : null;
    return edit ? submitAnnotation(edit.request) : Promise.resolve();
  };

  const scan = async (sourceRoot: string): Promise<AssetScanResult> =>
    run(async () => {
      const result = parseScan(await call!("asset.scan", { sourceRoot }));
      emit({ scanResult: result, status: "ready" });
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
    retryAnnotation,
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
  return { ...snapshot, ...controllerActions(controller) };
}

/**
 * Action half of the controller. The snapshot's data keys and these action
 * names must stay disjoint: `scan` once named both the scan result and the scan
 * action, so the merge replaced the result with the function and the panel
 * crashed the whole React tree when it read `scan.items`.
 */
export function controllerActions(
  controller: AssetLibraryControllerApi,
): AssetLibraryActions {
  return {
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
    retryAnnotation: controller.retryAnnotation,
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
