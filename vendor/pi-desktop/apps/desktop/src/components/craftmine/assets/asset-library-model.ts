/**
 * Pure model for the asset library surface (`asset.*` RPC, agent R6).
 *
 * No React, no host calls: every function here is deterministic and unit
 * testable. The shapes mirror `crates/craftmine-core/src/asset_catalog` exactly
 * (camelCase, `version_` for a version body, `nextOffset` null at the end), and
 * the copy rules are deliberately strict:
 *
 *  - a GLB preview is structure-only until an offscreen renderer exists;
 *  - an OGG file is never presented as playable while PCM decoding is missing;
 *  - the four `state` flags get four independent badges, never one green light.
 */
import type { CraftmineLang } from "../../../lib/craftmine-worlds";

export type AssetLibraryLang = CraftmineLang;

/* --------------------------------------------------------------- contract */

/** CP0's seven creation-package categories. */
export type AssetKind =
  | "base"
  | "world"
  | "module"
  | "object"
  | "scene"
  | "raw"
  | "data";

export type AssetMediaKind = "image" | "model" | "audio" | "package" | "other";

export type AssetQueryScope = "current-world" | "local-library" | "import-source";

export type AssetLicenseStatus = "verified" | "unverified" | "unknown";

export type AssetUsageRefKind =
  | "world-current"
  | "world-history"
  | "world-draft"
  | "creation-dependency"
  | "backup-retention"
  | "export-package";

export type AssetPreviewStatus =
  | "pending"
  | "ok"
  | "partial"
  | "failed"
  | "timeout"
  | "cancelled";

export type AssetSource = {
  origin: string;
  author: string;
  license: string;
  licenseStatus: AssetLicenseStatus;
};

export type AssetBaseCheck = {
  status: string;
  baseId: string;
  baseVersion: number;
  engineVersion: string;
  target: string;
  checkerVersion: string;
  detail: string;
};

export type AssetAppliedToSource = { worldId: string; detail: string };

export type AssetState = {
  indexed: boolean;
  previewable: boolean;
  baseChecked: AssetBaseCheck | null;
  appliedToSource: AssetAppliedToSource | null;
};

/** One search row (`asset.search` item). */
export type AssetCard = {
  assetId: string;
  version: number;
  kind: string;
  mediaKind: string;
  contentHash: string;
  displayName: string;
  tags: string[];
  favorite: boolean;
  bytes: number;
  fileCount: number;
  source: AssetSource;
  createdAt: number;
  state: AssetState;
};

export type AssetSearchRequest = {
  scope: AssetQueryScope;
  worldId?: string;
  query: string;
  kind?: AssetKind;
  mediaKind?: AssetMediaKind;
  tags: string[];
  favoritesOnly: boolean;
  latestOnly: boolean;
  offset: number;
  limit: number;
};

export type AssetSearchResult = {
  items: AssetCard[];
  total: number;
  truncated: boolean;
  nextOffset: number | null;
};

export type AssetSearchInput = {
  scope: AssetQueryScope;
  worldId?: string | null;
  query?: string;
  kind?: AssetKind | "" | null;
  mediaKind?: AssetMediaKind | "" | null;
  tags?: string[];
  favoritesOnly?: boolean;
  latestOnly?: boolean;
  offset?: number;
  limit?: number;
};

export type AssetFileEntry = {
  path: string;
  sha256: string;
  bytes: number;
  mediaType: string;
};

/** One immutable version body (`asset.read` / `asset.versions`). */
export type AssetVersion = {
  assetId: string;
  version: number;
  kind: string;
  mediaKind: string;
  contentHash: string;
  displayName: string;
  bytes: number;
  fileCount: number;
  source: AssetSource;
  createdAt: number;
  files: AssetFileEntry[];
};

export type AssetVersionEntry = { version_: AssetVersion; state: AssetState };

export type AssetReadResult = { version_: AssetVersion; state: AssetState };

export type AssetVersionsResult = {
  assetId: string;
  items: AssetVersionEntry[];
  total: number;
  nextOffset: number | null;
};

/** Decoder facts. Kept loose on purpose: every media type has its own keys. */
export type AssetPreviewFacts = Record<string, unknown>;

export type AssetPreview = {
  status: AssetPreviewStatus;
  detail: string;
  facts: AssetPreviewFacts;
  createdAt: number;
};

export type AssetPreviewBeginResult = {
  jobId: string;
  cacheKey: string;
  cached: boolean;
  retried: boolean;
  previousStatus?: AssetPreviewStatus;
  timeoutMs: number;
  preview: AssetPreview;
};

export type AssetPreviewFinishRequest = {
  operationId: string;
  assetId: string;
  version: number;
  settingsHash?: string;
  status: AssetPreviewStatus;
  detail: string;
  facts: AssetPreviewFacts;
};

export type AssetPreviewRecord = {
  previewerVersion: string;
  engineVersion: string;
  settingsHash: string;
  status: AssetPreviewStatus;
  detail: string;
  facts: AssetPreviewFacts;
  createdAt: number;
};

export type AssetUsageItem = {
  version: number;
  refKind: string;
  refId: string;
  detail: string;
  createdAt: number;
};

export type AssetUsageResult = { items: AssetUsageItem[]; total: number };

export type AssetScanItem = {
  path: string;
  bytes: number;
  supported: boolean;
  mediaType: string | null;
  sha256?: string | null;
  /** null when the hash budget was exhausted and the file could not be compared. */
  known: boolean | null;
  assetId?: string;
  version?: number;
};

export type AssetScanIssue = { path: string | null; code: string };

export type AssetScanHints = {
  newVersions: number;
  unchanged: number;
  unsupported: number;
};

export type AssetScanResult = {
  root?: string;
  scanned: number;
  truncated: boolean;
  items: AssetScanItem[];
  issues: AssetScanIssue[];
  hints: AssetScanHints;
  worldUpdated: false;
};

export type AssetImportRequest = {
  operationId: string;
  sourceRoot: string;
  sourcePath: string;
  assetId: string;
  version: number;
  kind: AssetKind;
  mediaKind: AssetMediaKind;
  path: string;
  mediaType: string;
  displayName: string;
  source: AssetSource;
  tags?: string[];
};

export type AssetImportOverrides = {
  assetId: string;
  kind: AssetKind;
  mediaKind: AssetMediaKind;
  displayName: string;
  source: AssetSource;
  tags?: string[];
  version?: number;
  sourceRoot?: string | null;
  sourcePath?: string | null;
  operationId?: string;
};

export type AssetOption<T extends string> = {
  value: T;
  label: Record<AssetLibraryLang, string>;
};

/* --------------------------------------------------------------- constants */

export const ASSET_SEARCH_LIMIT_MAX = 100;
export const ASSET_SEARCH_LIMIT_DEFAULT = 50;
export const ASSET_SEARCH_OFFSET_MAX = 10_000;
export const ASSET_QUERY_MAX = 120;
export const ASSET_VERSIONS_LIMIT = 50;
export const ASSET_SCAN_SAMPLE_PATHS = 5;

export const ASSET_KINDS: AssetKind[] = [
  "base",
  "world",
  "module",
  "object",
  "scene",
  "raw",
  "data",
];

export const ASSET_MEDIA_KINDS: AssetMediaKind[] = [
  "image",
  "model",
  "audio",
  "package",
  "other",
];

export const ASSET_QUERY_SCOPES: AssetQueryScope[] = [
  "current-world",
  "local-library",
  "import-source",
];

export const ASSET_LICENSE_STATUSES: AssetLicenseStatus[] = [
  "verified",
  "unverified",
  "unknown",
];

const KIND_COPY: Record<AssetKind, Record<AssetLibraryLang, string>> = {
  base: { zh: "底座", en: "Base" },
  world: { zh: "世界", en: "World" },
  module: { zh: "模块", en: "Module" },
  object: { zh: "物件", en: "Object" },
  scene: { zh: "场景", en: "Scene" },
  raw: { zh: "原始素材", en: "Raw" },
  data: { zh: "数据", en: "Data" },
};

const MEDIA_COPY: Record<AssetMediaKind, Record<AssetLibraryLang, string>> = {
  image: { zh: "图片", en: "Image" },
  model: { zh: "模型", en: "Model" },
  audio: { zh: "音频", en: "Audio" },
  package: { zh: "Godot 包", en: "Godot package" },
  other: { zh: "其它", en: "Other" },
};

const SCOPE_COPY: Record<AssetQueryScope, Record<AssetLibraryLang, string>> = {
  "current-world": { zh: "当前世界", en: "Current world" },
  "local-library": { zh: "本地库", en: "Local library" },
  "import-source": { zh: "导入来源", en: "Import source" },
};

const USAGE_COPY: Record<string, Record<AssetLibraryLang, string>> = {
  "world-current": { zh: "当前世界使用", en: "Used by a world" },
  "world-history": { zh: "世界历史版本", en: "World history" },
  "world-draft": { zh: "世界草稿", en: "World draft" },
  "creation-dependency": { zh: "作品依赖", en: "Creation dependency" },
  "backup-retention": { zh: "备份保留", en: "Backup retention" },
  "export-package": { zh: "导出包", en: "Export package" },
};

const text = (copy: Record<AssetLibraryLang, string>, lang: AssetLibraryLang): string =>
  copy[lang] ?? copy.zh;

/* ----------------------------------------------------------------- options */

export function scopeOptions(): AssetOption<AssetQueryScope>[] {
  return ASSET_QUERY_SCOPES.map((value) => ({ value, label: SCOPE_COPY[value] }));
}

export function kindOptions(): AssetOption<AssetKind>[] {
  return ASSET_KINDS.map((value) => ({ value, label: KIND_COPY[value] }));
}

export function mediaKindOptions(): AssetOption<AssetMediaKind>[] {
  return ASSET_MEDIA_KINDS.map((value) => ({ value, label: MEDIA_COPY[value] }));
}

export function kindLabel(kind: string, lang: AssetLibraryLang = "zh"): string {
  const copy = KIND_COPY[kind as AssetKind];
  return copy ? text(copy, lang) : kind;
}

export function mediaKindLabel(mediaKind: string, lang: AssetLibraryLang = "zh"): string {
  const copy = MEDIA_COPY[mediaKind as AssetMediaKind];
  return copy ? text(copy, lang) : mediaKind;
}

export function scopeLabel(scope: string, lang: AssetLibraryLang = "zh"): string {
  const copy = SCOPE_COPY[scope as AssetQueryScope];
  return copy ? text(copy, lang) : scope;
}

export function usageKindLabel(refKind: string, lang: AssetLibraryLang = "zh"): string {
  const copy = USAGE_COPY[refKind];
  return copy ? text(copy, lang) : refKind;
}

/** Maps a supported `mediaType` to its catalog media kind. */
export function mediaKindForType(mediaType: string): AssetMediaKind {
  if (mediaType === "image/png" || mediaType === "image/jpeg") return "image";
  if (mediaType === "model/gltf-binary") return "model";
  if (mediaType === "audio/wav" || mediaType === "audio/ogg") return "audio";
  if (mediaType === "application/x-godot-package") return "package";
  return "other";
}

/* ------------------------------------------------------------------ inputs */

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Tags are trimmed, lower-cased (the host compares lower-case), sorted, unique. */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result.sort((left, right) => left.localeCompare(right));
}

/**
 * Fills the request defaults the host requires and drops filters the host
 * would reject: `limit` is capped at 100 (the host's own search budget),
 * unknown kinds/media kinds are omitted instead of sent as garbage, and
 * `worldId` is only sent for the `current-world` scope.
 */
export function buildSearchRequest(input: AssetSearchInput): AssetSearchRequest {
  const scope: AssetQueryScope = ASSET_QUERY_SCOPES.includes(input.scope)
    ? input.scope
    : "local-library";
  const request: AssetSearchRequest = {
    scope,
    query: (input.query ?? "").trim().slice(0, ASSET_QUERY_MAX),
    tags: normalizeTags(input.tags),
    favoritesOnly: input.favoritesOnly === true,
    latestOnly: input.latestOnly !== false,
    offset: clampInt(input.offset, 0, ASSET_SEARCH_OFFSET_MAX, 0),
    limit: clampInt(input.limit, 1, ASSET_SEARCH_LIMIT_MAX, ASSET_SEARCH_LIMIT_DEFAULT),
  };
  if (scope === "current-world") request.worldId = (input.worldId ?? "").trim();
  if (input.kind && ASSET_KINDS.includes(input.kind)) request.kind = input.kind;
  if (input.mediaKind && ASSET_MEDIA_KINDS.includes(input.mediaKind)) {
    request.mediaKind = input.mediaKind;
  }
  return request;
}

export function assetKey(assetId: string, version: number): string {
  return `${assetId}#${version}`;
}

/** Appends one page, de-duplicating by `assetId+version` and keeping order. */
export function mergePage(
  previous: AssetSearchResult | null,
  page: AssetSearchResult,
): AssetSearchResult {
  const seen = new Set<string>();
  const items: AssetCard[] = [];
  for (const card of [...(previous?.items ?? []), ...(page.items ?? [])]) {
    const key = assetKey(card.assetId, card.version);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(card);
  }
  return {
    items,
    total: page.total,
    truncated: page.truncated,
    nextOffset: page.nextOffset,
  };
}

/* -------------------------------------------------------------- state text */

export type AssetTone = "success" | "warning" | "error" | "neutral";

export type AssetStateBadge = {
  key: "indexed" | "previewable" | "baseChecked" | "appliedToSource";
  tone: AssetTone;
  label: string;
  detail: string;
};

export type AssetStateSummary = {
  indexed: AssetStateBadge;
  previewable: AssetStateBadge;
  baseChecked: AssetStateBadge;
  appliedToSource: AssetStateBadge;
};

/**
 * Four independent badges. A single green light would hide the difference
 * between "indexed", "has preview evidence", "base check passed" and "applied
 * to a world"; each is reported on its own.
 */
export function describeState(
  state: AssetState | null | undefined,
  lang: AssetLibraryLang = "zh",
): AssetStateSummary {
  const indexed: AssetStateBadge = state?.indexed
    ? {
        key: "indexed",
        tone: "success",
        label: text({ zh: "已索引", en: "Indexed" }, lang),
        detail: "",
      }
    : {
        key: "indexed",
        tone: "warning",
        label: text({ zh: "未索引", en: "Not indexed" }, lang),
        detail: "",
      };

  const previewable: AssetStateBadge = state?.previewable
    ? {
        key: "previewable",
        tone: "success",
        label: text({ zh: "有预览结果", en: "Preview on record" }, lang),
        detail: "",
      }
    : {
        key: "previewable",
        tone: "neutral",
        label: text({ zh: "无预览结果", en: "No preview yet" }, lang),
        detail: "",
      };

  const check = state?.baseChecked ?? null;
  const baseChecked: AssetStateBadge = !check
    ? {
        key: "baseChecked",
        tone: "neutral",
        label: text({ zh: "未做底座检查", en: "Base check not run" }, lang),
        detail: "",
      }
    : {
        key: "baseChecked",
        tone:
          check.status === "passed"
            ? "success"
            : check.status === "failed" || check.status === "error"
              ? "error"
              : "warning",
        label:
          check.status === "passed"
            ? text({ zh: "底座检查通过", en: "Base check passed" }, lang)
            : check.status === "failed" || check.status === "error"
              ? text({ zh: "底座检查未通过", en: "Base check failed" }, lang)
              : text({ zh: "底座检查未完成", en: "Base check unfinished" }, lang),
        detail: `${check.baseId} v${check.baseVersion} · ${check.target} · ${check.detail}`.trim(),
      };

  const applied = state?.appliedToSource ?? null;
  const appliedToSource: AssetStateBadge = applied
    ? {
        key: "appliedToSource",
        tone: "success",
        label: text({ zh: "已应用到世界", en: "Applied to a world" }, lang),
        detail: [applied.worldId, applied.detail].filter(Boolean).join(" · "),
      }
    : {
        key: "appliedToSource",
        tone: "neutral",
        label: text({ zh: "未应用到世界", en: "Not applied to a world" }, lang),
        detail: "",
      };

  return { indexed, previewable, baseChecked, appliedToSource };
}

export function stateBadges(
  state: AssetState | null | undefined,
  lang: AssetLibraryLang = "zh",
): AssetStateBadge[] {
  const summary = describeState(state, lang);
  return [summary.indexed, summary.previewable, summary.baseChecked, summary.appliedToSource];
}

/* ------------------------------------------------------------ preview text */

export type AssetPreviewDescription = {
  tone: AssetTone;
  label: string;
  detail: string;
  canRetry: boolean;
  picture: boolean;
  playable: boolean;
};

const factNumber = (facts: AssetPreviewFacts, key: string): number | null =>
  typeof facts[key] === "number" && Number.isFinite(facts[key]) ? (facts[key] as number) : null;

const factText = (facts: AssetPreviewFacts, key: string): string =>
  typeof facts[key] === "string" ? (facts[key] as string) : "";

/** OGG (and any future container-only audio) is never called playable. */
function isUndecodableAudio(preview: AssetPreview, facts: AssetPreviewFacts): boolean {
  if (preview.detail === "OGG_PCM_DECODE_NOT_IMPLEMENTED") return true;
  if (factText(facts, "reason") === "ogg-pcm-decode-not-implemented") return true;
  return facts.pcmDecoded === false && preview.status === "failed";
}

function imageDetail(facts: AssetPreviewFacts, fallback: string): string {
  const width = factNumber(facts, "width");
  const height = factNumber(facts, "height");
  const format = factText(facts, "format");
  const size = width !== null && height !== null ? `${width}x${height}` : "";
  return [format, size].filter(Boolean).join(" ") || fallback;
}

function audioDetail(facts: AssetPreviewFacts, fallback: string): string {
  const codec = factText(facts, "codec");
  const duration = factNumber(facts, "durationMs");
  const rate = factNumber(facts, "sampleRate");
  const parts = [codec, duration !== null ? formatDuration(duration) : "", rate ? `${rate} Hz` : ""];
  return parts.filter(Boolean).join(" · ") || fallback;
}

function modelDetail(facts: AssetPreviewFacts, fallback: string): string {
  const triangles = factNumber(facts, "triangles");
  const nodes = factNumber(facts, "nodes");
  const parts = [
    triangles !== null ? `${triangles} tris` : "",
    nodes !== null ? `${nodes} nodes` : "",
  ];
  return parts.filter(Boolean).join(" · ") || fallback;
}

/**
 * Turns one preview record into copy. Rules that must not be softened:
 *  - `picture` requires `status === "ok"` and `facts.picture === true`;
 *  - `playable` requires `status === "ok"` and `facts.playable === true`;
 *  - a GLB `partial` preview is structure-only, never "rendered";
 *  - OGG `failed` says decoding is not implemented, never "playable".
 */
export function describePreview(
  preview: AssetPreview | null | undefined,
  lang: AssetLibraryLang = "zh",
): AssetPreviewDescription {
  if (!preview) {
    return {
      tone: "neutral",
      label: text({ zh: "尚无预览", en: "No preview yet" }, lang),
      detail: "",
      canRetry: true,
      picture: false,
      playable: false,
    };
  }
  const facts = (preview.facts ?? {}) as AssetPreviewFacts;
  const picture = preview.status === "ok" && facts.picture === true;
  const playable = preview.status === "ok" && facts.playable === true;
  const base = { canRetry: canRetry(preview), picture, playable };
  const detail = preview.detail ?? "";

  switch (preview.status) {
    case "pending":
      return {
        ...base,
        tone: "neutral",
        label: text({ zh: "预览中", en: "Previewing" }, lang),
        detail,
      };
    case "ok":
      if (picture) {
        return {
          ...base,
          tone: "success",
          label: text({ zh: "可预览图片", en: "Image preview available" }, lang),
          detail: imageDetail(facts, detail),
        };
      }
      if (playable) {
        return {
          ...base,
          tone: "success",
          label: text({ zh: "可试听", en: "Audio playback available" }, lang),
          detail: audioDetail(facts, detail),
        };
      }
      return {
        ...base,
        tone: "success",
        label: text({ zh: "预览完成", en: "Preview complete" }, lang),
        detail,
      };
    case "partial":
      if (facts.rendered === false) {
        return {
          ...base,
          tone: "warning",
          label: text({ zh: "仅结构解析，无画面", en: "Structure parsed only — no picture" }, lang),
          detail: modelDetail(facts, detail),
        };
      }
      return {
        ...base,
        tone: "warning",
        label: text({ zh: "部分预览", en: "Partial preview" }, lang),
        detail,
      };
    case "failed":
      if (isUndecodableAudio(preview, facts)) {
        return {
          ...base,
          tone: "warning",
          label: text(
            { zh: "不可试听（未实现解码）", en: "Not playable — decoding not implemented" },
            lang,
          ),
          detail: detail || text({ zh: "OGG 解码尚未实现", en: "OGG decoding is not implemented" }, lang),
        };
      }
      return {
        ...base,
        tone: "error",
        label: text({ zh: "预览失败", en: "Preview failed" }, lang),
        detail,
      };
    case "timeout":
      return {
        ...base,
        tone: "warning",
        label: text({ zh: "预览超时", en: "Preview timed out" }, lang),
        detail,
      };
    case "cancelled":
      return {
        ...base,
        tone: "neutral",
        label: text({ zh: "预览已取消", en: "Preview cancelled" }, lang),
        detail,
      };
    default:
      return { ...base, tone: "neutral", label: String(preview.status), detail };
  }
}

/** Mirrors the host rule: a finished success is cached; everything else reruns. */
export function canRetry(preview: AssetPreview | null | undefined): boolean {
  if (!preview) return true;
  return (
    preview.status === "failed" ||
    preview.status === "timeout" ||
    preview.status === "cancelled"
  );
}

export function previewLabel(
  preview: AssetPreview | null | undefined,
  lang: AssetLibraryLang = "zh",
): string {
  return describePreview(preview, lang).label;
}

/** `data:` URL for a decoded thumbnail; null when there is no real picture. */
export function thumbnailSrc(preview: AssetPreview | null | undefined): string | null {
  const described = describePreview(preview);
  if (!described.picture) return null;
  const facts = (preview?.facts ?? {}) as AssetPreviewFacts;
  const base64 = factText(facts, "thumbnailBase64");
  if (!base64) return null;
  return `data:image/png;base64,${base64}`;
}

/* ------------------------------------------------------------------ format */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? `${Math.round(value)}` : value.toFixed(1);
  return `${shown} ${units[unit]}`;
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0 ms";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------- scan */

export type AssetScanSummary = {
  newVersions: number;
  unchanged: number;
  unsupported: number;
  samplePaths: string[];
};

/** New-version hint plus a bounded sample of the scanned paths (max 5). */
export function scanSummary(scan: AssetScanResult | null | undefined): AssetScanSummary {
  const hints = scan?.hints ?? { newVersions: 0, unchanged: 0, unsupported: 0 };
  const items = Array.isArray(scan?.items) ? scan.items : [];
  const fresh = items.filter((item) => item.known === false);
  const rest = items.filter((item) => item.known !== false);
  const samplePaths = [...fresh, ...rest]
    .map((item) => item.path)
    .filter((path): path is string => typeof path === "string" && path.length > 0)
    .slice(0, ASSET_SCAN_SAMPLE_PATHS);
  return {
    newVersions: hints.newVersions ?? 0,
    unchanged: hints.unchanged ?? 0,
    unsupported: hints.unsupported ?? 0,
    samplePaths,
  };
}

/** Joins a scanned relative path onto its root using that root's separator. */
export function joinScanPath(root: string, relativePath: string): string {
  const base = root.trim().replace(/[\\/]+$/, "");
  const tail = relativePath.replace(/^[\\/]+/, "");
  if (!base) return tail;
  if (!tail) return base;
  // Scans report `/` separators; a Windows root still needs `\` for the host.
  const separator = base.includes("\\") ? "\\" : "/";
  const normalized = separator === "\\" ? tail.replace(/\//g, "\\") : tail.replace(/\\/g, "/");
  return `${base}${separator}${normalized}`;
}

/** `asset.import` payload for one scanned file; ready to send unchanged. */
export function importRequestFor(
  item: AssetScanItem,
  input: AssetImportOverrides,
): AssetImportRequest {
  const root = (input.sourceRoot ?? "").trim();
  const version = input.version ?? item.version ?? 1;
  const request: AssetImportRequest = {
    operationId:
      input.operationId?.trim() || `asset-import:${input.assetId}:${version}:${item.path}`,
    sourceRoot: root,
    sourcePath: (input.sourcePath ?? joinScanPath(root, item.path)).trim(),
    assetId: input.assetId,
    version,
    kind: input.kind,
    mediaKind: input.mediaKind,
    path: item.path,
    mediaType: item.mediaType ?? "",
    displayName: input.displayName,
    source: {
      origin: input.source.origin,
      author: input.source.author,
      license: input.source.license,
      licenseStatus: input.source.licenseStatus,
    },
  };
  const tags = normalizeTags(input.tags);
  if (tags.length) request.tags = tags;
  return request;
}

/** Deterministic identifier the host accepts (`[A-Za-z0-9-_.:]`, ≤120 bytes). */
export function assetIdFromName(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_.:]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return slug || "asset";
}

export type AssetVersionOption = {
  version: number;
  label: string;
  entry: AssetVersionEntry;
};

/** Version picker entries, newest first. */
export function versionOptions(
  items: AssetVersionEntry[] | null | undefined,
): AssetVersionOption[] {
  return [...(items ?? [])]
    .filter((entry) => entry && entry.version_ && typeof entry.version_.version === "number")
    .sort((left, right) => right.version_.version - left.version_.version)
    .map((entry) => ({
      version: entry.version_.version,
      label: `v${entry.version_.version}`,
      entry,
    }));
}

/** Latest preview record for one version, newest first, or null. */
export function latestPreview(
  items: AssetPreviewRecord[] | null | undefined,
): AssetPreview | null {
  const list = [...(items ?? [])].filter((record) => record && record.status);
  if (!list.length) return null;
  list.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  const newest = list[0];
  return {
    status: newest.status,
    detail: newest.detail ?? "",
    facts: (newest.facts ?? {}) as AssetPreviewFacts,
    createdAt: newest.createdAt ?? 0,
  };
}

export function emptyScanHints(): AssetScanHints {
  return { newVersions: 0, unchanged: 0, unsupported: 0 };
}
