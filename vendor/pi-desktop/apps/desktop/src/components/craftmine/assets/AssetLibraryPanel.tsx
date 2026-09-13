import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Input, Select, cx } from "../../ui";
import {
  ASSET_KINDS,
  ASSET_LICENSE_STATUSES,
  ASSET_SEARCH_LIMIT_DEFAULT,
  assetIdFromName,
  assetKey,
  canRetry,
  describePreview,
  formatBytes,
  formatDuration,
  importRequestFor,
  kindLabel,
  kindOptions,
  mediaKindForType,
  mediaKindLabel,
  mediaKindOptions,
  scopeLabel,
  scopeOptions,
  scanSummary,
  stateBadges,
  thumbnailSrc,
  usageKindLabel,
  versionOptions,
  type AssetKind,
  type AssetLibraryLang,
  type AssetMediaKind,
  type AssetQueryScope,
  type AssetScanItem,
  type AssetSearchInput,
  type AssetSource,
  type AssetVersion,
} from "./asset-library-model";
import {
  useAssetLibrary,
  type AssetLibraryBridge,
  type AssetLibraryController,
} from "./use-asset-library";
import "./asset-library.css";
import {AssetAnnotationEditor} from "./AssetAnnotationEditor";
import {LibraryPublishPanel} from "./LibraryPublishPanel";
import {PlaytestPanel} from "../PlaytestPanel";
import {DirectLibraryActivity, DirectLibraryUse} from "./DirectLibraryUse";
import {requestWorldTemplateCreation, type LibraryReference} from "../../../lib/player-library";

import {WorldCompositionPanel, type CompositionHandoff} from "./WorldCompositionPanel";

export type AssetImportPick = { sourceRoot: string; sourcePath: string };

export type AssetLibraryPanelProps = {
  bridge: AssetLibraryBridge | null;
  lang?: AssetLibraryLang;
  worldId?: string | null;
  /** Host-owned file picker: returns the authorized root and the picked file. */
  onImportRequest?: () => Promise<AssetImportPick | null> | AssetImportPick | null;
  /** Audio source supplied by the host for a playable WAV preview. */
  audioSrc?: string | null;
  onUseAsset?: (asset: AssetVersion, modify: boolean) => Promise<void>;
  worldName?: string;
  onUseComposition?: (value: CompositionHandoff) => Promise<void>;
  onRepairFeedback?: (text: string) => Promise<void>;
  /** A navigation destination only; publication still requires its normal form. */
  initialSection?: "browse" | "component" | "world";
};

const COPY = {
  title: { zh: "素材库", en: "Asset library" },
  refresh: { zh: "刷新", en: "Refresh" },
  import: { zh: "导入素材", en: "Import asset" },
  filters: { zh: "筛选", en: "Filters" },
  scope: { zh: "范围", en: "Scope" },
  world: { zh: "世界标识", en: "World id" },
  worldHint: { zh: "当前世界范围必须带上世界标识。", en: "The current-world scope needs a world id." },
  query: { zh: "搜索", en: "Search" },
  kind: { zh: "分类", en: "Category" },
  mediaKind: { zh: "媒体类型", en: "Media type" },
  tags: { zh: "标签（逗号分隔）", en: "Tags (comma separated)" },
  favoritesOnly: { zh: "仅收藏", en: "Favorites only" },
  latestOnly: { zh: "仅最新版本", en: "Latest version only" },
  all: { zh: "全部", en: "All" },
  search: { zh: "查询", en: "Search" },
  loading: { zh: "正在读取素材…", en: "Loading assets…" },
  unavailable: {
    zh: "素材库接口尚未接入，这里不会用本地数据代替。",
    en: "The asset library channel is not wired; no local data is substituted.",
  },
  empty: { zh: "没有符合条件的素材。", en: "No assets match these filters." },
  emptyHint: { zh: "调整范围或标签后再试。", en: "Change the scope or tags and try again." },
  more: { zh: "加载更多", en: "Load more" },
  truncated: { zh: "结果被截断，请缩小范围。", en: "Results were truncated; narrow the scope." },
  back: { zh: "返回列表", en: "Back to list" },
  detail: { zh: "详情", en: "Detail" },
  source: { zh: "来源与许可", en: "Source and licence" },
  origin: { zh: "来源", en: "Origin" },
  author: { zh: "作者", en: "Author" },
  license: { zh: "许可", en: "Licence" },
  licenseStatus: { zh: "许可状态", en: "Licence status" },
  importSourceHint: {
    zh: "作者或许可可留空，系统会记为“未知”；许可留空时不会标记为已验证。",
    en: "Blank author or licence is recorded as unknown. A blank licence is never marked verified.",
  },
  files: { zh: "文件清单", en: "Files" },
  versions: { zh: "版本", en: "Versions" },
  usage: { zh: "使用关系", en: "Usage" },
  preview: { zh: "预览", en: "Preview" },
  previewStart: { zh: "开始预览", en: "Start preview" },
  retry: { zh: "重试预览", en: "Retry preview" },
  cancel: { zh: "取消预览", en: "Cancel preview" },
  noFiles: { zh: "主机未报告文件。", en: "The host reported no files." },
  noUsage: { zh: "没有使用关系。", en: "No usage relations." },
  noPreview: { zh: "尚无预览记录。", en: "No preview recorded yet." },
  audioHost: {
    zh: "可试听；播放地址由宿主提供。",
    en: "Playable; the host supplies the audio source.",
  },
  scan: { zh: "扫描结果", en: "Scan result" },
  scanSummary: { zh: "新版本 / 未变 / 不支持", en: "New / unchanged / unsupported" },
  scanTruncated: { zh: "扫描被截断，仅显示部分结果。", en: "The scan was truncated; results are partial." },
  scanEmpty: { zh: "没有可导入的文件。", en: "No importable files were found." },
  importPick: { zh: "选择要导入的文件", en: "Pick the file to import" },
  importName: { zh: "显示名称", en: "Display name" },
  importAssetId: { zh: "素材标识", en: "Asset id" },
  importConfirm: { zh: "确认导入", en: "Confirm import" },
  importCancel: { zh: "取消导入", en: "Cancel import" },
  importDone: { zh: "已导入", en: "Imported" },
  importDedup: { zh: "内容已存在，未重复写入。", en: "Content already existed; nothing was written twice." },
  error: { zh: "操作失败", en: "Operation failed" },
} as const;

const t = (key: keyof typeof COPY, lang: AssetLibraryLang): string => COPY[key][lang];

function splitTags(value: string): string[] {
  return value
    .split(/[,\uFF0C;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function licenseTone(status: string): "neutral" | "success" | "warning" {
  if (status === "verified") return "success";
  if (status === "unknown") return "warning";
  return "neutral";
}

function previewTone(tone: string): "neutral" | "success" | "error" | "warning" {
  return tone === "success" || tone === "error" || tone === "warning" ? tone : "neutral";
}

/**
 * The asset library surface: filters on the left, cards in the middle and the
 * selected version on the right. Every fact comes from the host; an unwired
 * bridge renders as `unavailable` instead of a local substitute.
 */
export function AssetLibraryPanel({
  bridge,
  lang = "zh",
  worldId = null,
  onImportRequest,
  audioSrc = null,
  onUseAsset,
  onUseComposition,
  worldName,
  onRepairFeedback,
  initialSection = "browse",
}: AssetLibraryPanelProps) {
  const ownedBridge = useMemo<AssetLibraryBridge | null>(() => bridge ? {
    call: (channel, payload) => bridge.call(channel, {...payload, ownerWorldId: worldId}),
  } : null, [bridge, worldId]);
  const controller: AssetLibraryController = useAssetLibrary(ownedBridge);
  const [view, setView] = useState<"list" | "detail">("list");
  const [section, setSection] = useState<"browse" | "component" | "world" | "composition">(initialSection);
  const [usePending, setUsePending] = useState(false);
  const [useError, setUseError] = useState("");
  const requestUse = async (asset: AssetVersion, modify: boolean) => {
    if (!onUseAsset || usePending) return;
    setUsePending(true); setUseError("");
    try { await onUseAsset(asset, modify); }
    catch (failure) { setUseError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setUsePending(false); }
  };

  const [scope, setScope] = useState<AssetQueryScope>("local-library");
  const [world, setWorld] = useState(worldId ?? "");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssetKind | "">("");
  const [mediaKind, setMediaKind] = useState<AssetMediaKind | "">("");
  const [tags, setTags] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [latestOnly, setLatestOnly] = useState(true);

  const [importSource, setImportSource] = useState<AssetImportPick | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importName, setImportName] = useState("");
  const [importId, setImportId] = useState("");
  const [importKind, setImportKind] = useState<AssetKind>("object");
  const [importOrigin, setImportOrigin] = useState("player-import");
  const [importAuthor, setImportAuthor] = useState("");
  const [importLicense, setImportLicense] = useState("");
  const [importLicenseStatus, setImportLicenseStatus] = useState("unknown");
  const [importTags, setImportTags] = useState("");

  const filters = useMemo(
    (): AssetSearchInput => ({
      scope,
      worldId: scope === "current-world" ? world : null,
      query,
      kind: kind || null,
      mediaKind: mediaKind || null,
      tags: splitTags(tags),
      favoritesOnly,
      latestOnly,
      limit: ASSET_SEARCH_LIMIT_DEFAULT,
    }),
    [scope, world, query, kind, mediaKind, tags, favoritesOnly, latestOnly],
  );

  // The controller records and rethrows; the panel shows `controller.error`, so
  // the rejection is only detached here to avoid an unhandled promise.
  const searchWith = (patch: Partial<AssetSearchInput>): void => {
    void controller.search({ ...filters, ...patch }).catch(() => {});
  };

  // Mount-time load only; later changes go through `searchWith`.
  // `useAssetLibrary` returns a fresh object each render, so the effect must
  // depend on the stable search method instead of the controller object; the
  // old dependency re-ran the mount search after every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void controller
      .search({ ...filters, scope: "local-library", limit: ASSET_SEARCH_LIMIT_DEFAULT })
      .catch(() => {});
  }, [controller.search]);

  // `scanResult` is the snapshot field; `controller.scan` is the action. Reading
  // the action here used to bind a function and crash the whole React tree.
  const scan = controller.scanResult;
  const preview = describePreview(controller.preview, lang);
  const selected = controller.selected;
  const summary = scanSummary(scan);
  const thumb = thumbnailSrc(controller.preview);
  const audioMs = controller.preview?.facts.durationMs;
  const picked: AssetScanItem | null =
    scan && importPath && Array.isArray(scan.items)
      ? scan.items.find((item) => item.path === importPath) ?? null
      : null;

  const openCard = (assetId: string, version: number): void => {
    setView("detail");
    void controller.select(assetId, version).catch(() => {});
  };

  const startPreview = (): void => {
    if (!selected) return;
    void controller.previewBegin(selected.version_.assetId, selected.version_.version).catch(() => {});
  };

  const startImport = (): void => {
    if (!onImportRequest) return;
    void (async () => {
      try {
        const pickedSource = await onImportRequest();
        if (!pickedSource) return;
        setImportSource(pickedSource);
        setImportPath(null);
        const result = await controller.scan(pickedSource.sourceRoot);
        const candidate =
          result.items.find((item) => item.supported && item.known === false) ??
          result.items.find((item) => item.supported);
        if (!candidate) return;
        setImportPath(candidate.path);
        setImportName(baseName(candidate.path));
        setImportId(assetIdFromName(baseName(candidate.path)));
        setImportKind("object");
      } catch {
        // `controller.error` already carries the host reason.
      }
    })();
  };

  const confirmImport = (): void => {
    if (!importSource || !picked) return;
    const source: AssetSource = {
      origin: importOrigin,
      author: importAuthor,
      license: importLicense,
      licenseStatus: ASSET_LICENSE_STATUSES.includes(
        importLicenseStatus as AssetSource["licenseStatus"],
      )
        ? (importLicenseStatus as AssetSource["licenseStatus"])
        : "unknown",
    };
    const request = importRequestFor(picked, {
      assetId: importId || assetIdFromName(importName),
      kind: importKind,
      mediaKind: mediaKindForType(picked.mediaType ?? ""),
      displayName: importName || baseName(picked.path),
      source,
      sourceRoot: importSource.sourceRoot,
      sourcePath: importSource.sourcePath,
      tags: splitTags(importTags),
    });
    void controller.importAsset(request).catch(() => {});
  };

  return (
    <section
      className="asset-library"
      aria-label={t("title", lang)}
      data-asset-library-state={controller.status}
      data-view={view}
    >
      <div className="asset-library-head">
        <span className="asset-library-title">{t("title", lang)}</span>
        <Button
          size="sm"
          variant="ghost"
          data-action="asset-refresh"
          disabled={controller.busy || controller.status === "unavailable"}
          onClick={() => searchWith({})}
        >
          {t("refresh", lang)}
        </Button>
        <form data-asset-import-form="pick" onSubmit={event => {event.preventDefault(); startImport();}}><Button
          size="sm"
          variant="secondary"
          data-action="asset-import"
          type="submit"
          disabled={controller.busy || controller.status === "unavailable" || !onImportRequest}
        >
          {t("import", lang)}
        </Button></form>
      </div>
      <DirectLibraryActivity bridge={bridge} worldId={worldId} zh={lang === "zh"}/>
      {worldId&&<PlaytestPanel key={worldId} bridge={bridge} worldId={worldId} zh={lang === "zh"} onRepair={onRepairFeedback}/>}
      <div className="library-publish-tabs" role="tablist" aria-label={lang === "zh" ? "素材操作" : "Library actions"}>
        {(["browse", "component", "world", "composition"] as const).map((tab, index) => <form key={tab} onSubmit={event => {event.preventDefault(); setSection(tab);}} data-library-tab={tab}>
          <button type="submit" role="tab" aria-selected={section === tab} disabled={tab !== "browse" && !worldId}>{(lang === "zh" ? ["浏览素材", "保存对象", "保存世界模板", "玩法组合"] : ["Browse", "Save object", "Save world template", "Compose gameplay"])[index]}</button>
        </form>)}
      </div>
      {section === "composition" && worldId ? <WorldCompositionPanel bridge={bridge} worldId={worldId} zh={lang === "zh"} onUseComposition={onUseComposition}/> : section !== "browse" && section !== "composition" && worldId ? <LibraryPublishPanel key={`${worldId}:${section}`} bridge={bridge} worldId={worldId} worldName={worldName} kind={section} zh={lang === "zh"} onSaved={(ref: LibraryReference) => {
        setSection("browse"); setScope("local-library"); setQuery(ref.assetId); setView("detail"); setKind(""); setMediaKind(""); setTags(""); setFavoritesOnly(false); setLatestOnly(false);
        void controller.search({...filters, scope: "local-library", query: ref.assetId, kind: null, mediaKind: null, tags: [], favoritesOnly: false, latestOnly: false}).then(() => controller.select(ref.assetId, ref.version)).catch(() => {});
      }}/> : <>
      {controller.status === "unavailable" && (
        <p className="asset-library-note" data-asset-state="unavailable">
          {t("unavailable", lang)}
        </p>
      )}
      {controller.error && (
        <p className="asset-library-error" role="alert" data-asset-error="true">
          {t("error", lang)}: {controller.error}
        </p>
      )}

      <div className="asset-library-body">
        <form
          className="asset-library-filters"
          aria-label={t("filters", lang)}
          onSubmit={(event) => {
            event.preventDefault();
            const value = event.currentTarget.querySelector<HTMLInputElement>('[data-filter="favorites"]')?.checked ?? favoritesOnly;
            setFavoritesOnly(value);
            searchWith({favoritesOnly: value});
          }}
        >
          <label className="asset-library-field">
            <span className="asset-library-field-label">{t("scope", lang)}</span>
            <Select
              value={scope}
              data-filter="scope"
              onChange={(event) => {
                const next = event.target.value as AssetQueryScope;
                setScope(next);
                searchWith({ scope: next, worldId: next === "current-world" ? world : null });
              }}
            >
              {scopeOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label[lang]}
                </option>
              ))}
            </Select>
          </label>

          {scope === "current-world" && (
            <label className="asset-library-field">
              <span className="asset-library-field-label">{t("world", lang)}</span>
              <Input
                value={world}
                data-filter="world"
                onChange={(event) => {
                  setWorld(event.target.value);
                  searchWith({ scope: "current-world", worldId: event.target.value });
                }}
              />
              <span className="asset-library-field-hint">{t("worldHint", lang)}</span>
            </label>
          )}

          <label className="asset-library-field">
            <span className="asset-library-field-label">{t("query", lang)}</span>
            <Input
              value={query}
              data-filter="query"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <label className="asset-library-field">
            <span className="asset-library-field-label">{t("kind", lang)}</span>
            <Select
              value={kind}
              data-filter="kind"
              onChange={(event) => {
                const next = event.target.value as AssetKind | "";
                setKind(next);
                searchWith({ kind: next || null });
              }}
            >
              <option value="">{t("all", lang)}</option>
              {kindOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label[lang]}
                </option>
              ))}
            </Select>
          </label>

          <label className="asset-library-field">
            <span className="asset-library-field-label">{t("mediaKind", lang)}</span>
            <Select
              value={mediaKind}
              data-filter="media-kind"
              onChange={(event) => {
                const next = event.target.value as AssetMediaKind | "";
                setMediaKind(next);
                searchWith({ mediaKind: next || null });
              }}
            >
              <option value="">{t("all", lang)}</option>
              {mediaKindOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label[lang]}
                </option>
              ))}
            </Select>
          </label>

          <label className="asset-library-field">
            <span className="asset-library-field-label">{t("tags", lang)}</span>
            <Input
              value={tags}
              data-filter="tags"
              onChange={(event) => {
                setTags(event.target.value);
                searchWith({ tags: splitTags(event.target.value) });
              }}
            />
          </label>

          <label className="asset-library-check">
            <input
              type="checkbox"
              checked={favoritesOnly}
              data-filter="favorites"
              onChange={(event) => {
                setFavoritesOnly(event.target.checked);
                searchWith({ favoritesOnly: event.target.checked });
              }}
            />
            <span>{t("favoritesOnly", lang)}</span>
          </label>
          <label className="asset-library-check">
            <input
              type="checkbox"
              checked={latestOnly}
              data-filter="latest"
              onChange={(event) => {
                setLatestOnly(event.target.checked);
                searchWith({ latestOnly: event.target.checked });
              }}
            />
            <span>{t("latestOnly", lang)}</span>
          </label>

          <Button size="sm" variant="primary" type="submit" data-action="asset-search">
            {t("search", lang)}
          </Button>
        </form>

        <div className="asset-library-list">
          {controller.status === "loading" && controller.cards.length === 0 && (
            <p className="asset-library-note" data-asset-state="loading">
              {t("loading", lang)}
            </p>
          )}
          {controller.status === "ready" && controller.cards.length === 0 && (
            <div className="asset-library-note" data-asset-state="empty">
              <p>{t("empty", lang)}</p>
              <p className="asset-library-field-hint">{t("emptyHint", lang)}</p>
            </div>
          )}
          {controller.truncated && (
            <p className="asset-library-note" data-asset-state="truncated">
              {t("truncated", lang)}
            </p>
          )}
          <ul className="asset-library-cards">
            {controller.cards.map((card) => {
              const active =
                selected !== null &&
                selected.version_.assetId === card.assetId &&
                selected.version_.version === card.version;
              return (
                <li key={assetKey(card.assetId, card.version)}><form style={{display:"contents"}} data-asset-select-form onSubmit={event => {event.preventDefault(); openCard(card.assetId, card.version);}}>
                  <button
                    type="submit"
                    className={cx("asset-library-card", active && "is-active")}
                    data-asset-id={card.assetId}
                    data-asset-version={card.version}
                    data-asset-active={active ? "true" : "false"}
                  >
                    <span
                      className="asset-library-card-state"
                      data-previewable={card.state.previewable ? "true" : "false"}
                      data-indexed={card.state.indexed ? "true" : "false"}
                    />
                    <span className="asset-library-card-body">
                      <span className="asset-library-card-name">{card.displayName}</span>
                      <span className="asset-library-card-meta">
                        {kindLabel(card.kind, lang)} · v{card.version} ·{" "}
                        {mediaKindLabel(card.mediaKind, lang)} · {formatBytes(card.bytes)}
                      </span>
                      <span className="asset-library-card-badges">
                        {stateBadges(card.state, lang).map((badge) => (
                          <span key={badge.key} data-state-key={badge.key}>
                            <Badge tone={previewTone(badge.tone)}>{badge.label}</Badge>
                          </span>
                        ))}
                      </span>
                    </span>
                  </button></form>
                </li>
              );
            })}
          </ul>
          {controller.nextOffset !== null && controller.cards.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              data-action="asset-more"
              disabled={controller.busy}
              onClick={() => void controller.loadMore().catch(() => {})}
            >
              {t("more", lang)}
            </Button>
          )}
        </div>

        <div className="asset-library-detail">
          <div className="asset-library-detail-head">
            <Button
              size="sm"
              variant="ghost"
              className="asset-library-back"
              data-action="asset-back"
              onClick={() => setView("list")}
            >
              {t("back", lang)}
            </Button>
            <span className="asset-library-field-label">{t("detail", lang)}</span>
          </div>

          {!selected && (
            <p className="asset-library-note" data-asset-state="no-selection">
              {t("noPreview", lang)}
            </p>
          )}

          {selected && (
            <>
              <p className="asset-library-detail-name">{selected.version_.displayName}</p>
              <p className="asset-library-card-meta">
                {kindLabel(selected.version_.kind, lang)} · v{selected.version_.version} ·{" "}
                {mediaKindLabel(selected.version_.mediaKind, lang)} ·{" "}
                {formatBytes(selected.version_.bytes)} · {selected.version_.fileCount} files
              </p>
              <p className="asset-library-detail-badges">
                {stateBadges(selected.state, lang).map((badge) => (
                  <span key={badge.key} data-state-key={badge.key}>
                    <Badge tone={previewTone(badge.tone)}>{badge.label}</Badge>
                  </span>
                ))}
              </p>

              <AssetAnnotationEditor key={assetKey(selected.version_.assetId, selected.version_.version)} controller={controller} lang={lang} />
              <DirectLibraryUse key={`${worldId}:${selected.version_.assetId}:${selected.version_.version}:${selected.version_.contentHash}`} bridge={bridge} worldId={worldId} asset={selected.version_} zh={lang === "zh"}/>
              {selected.version_.kind === "world" && selected.version_.assetId.startsWith("player.world.") ? <div className="asset-library-use-actions">
                <form data-asset-world-template onSubmit={event => {event.preventDefault(); requestWorldTemplateCreation({assetId: selected.version_.assetId, version: selected.version_.version, contentHash: selected.version_.contentHash});}}><Button type="submit" size="sm">{lang === "zh" ? "从此模板新建世界" : "Create a world from this template"}</Button></form>
                <p className="asset-library-field-hint">{lang === "zh" ? "使用作者保存的起点，创建独立副本。" : "Create an independent copy from the author's saved starting state."}</p>
              </div> : onUseAsset && <div className="asset-library-use-actions">
                <form onSubmit={event => {event.preventDefault(); void requestUse(selected.version_, false);}}><Button type="submit" size="sm" disabled={!worldId || usePending} data-asset-use="add">{lang === "zh" ? "让 AI 加入当前世界" : "Ask AI to add to this world"}</Button></form>
                <form onSubmit={event => {event.preventDefault(); void requestUse(selected.version_, true);}}><Button type="submit" size="sm" variant="secondary" disabled={!worldId || usePending} data-asset-use="modify">{lang === "zh" ? "让 AI 修改后加入" : "Ask AI to modify and add"}</Button></form>
                <p className="asset-library-field-hint">{lang === "zh" ? "素材引用将填入原对话，发送后开始创作。" : "Adds the asset reference to your conversation. Send it to start creating."}</p>
                {useError && <p role="alert">{useError}</p>}
              </div>}

              <h4 className="asset-library-section">{t("source", lang)}</h4>
              <dl className="asset-library-source">
                <dt>{t("origin", lang)}</dt>
                <dd>{selected.version_.source.origin || "—"}</dd>
                <dt>{t("author", lang)}</dt>
                <dd>{selected.version_.source.author || "—"}</dd>
                <dt>{t("license", lang)}</dt>
                <dd>{selected.version_.source.license || "—"}</dd>
                <dt>{t("licenseStatus", lang)}</dt>
                <dd>
                  <Badge tone={licenseTone(selected.version_.source.licenseStatus)}>
                    {selected.version_.source.licenseStatus}
                  </Badge>
                </dd>
              </dl>

              <h4 className="asset-library-section">{t("preview", lang)}</h4>
              {controller.preview?.facts?.previewScope === "source-world-view" && <p className="asset-library-field-hint">{lang === "zh" ? "源世界视角" : "Source world view"}</p>}
              <div className="asset-library-preview" data-preview-tone={preview.tone}>
                <p className="asset-library-preview-label">{preview.label}</p>
                {preview.detail && (
                  <p className="asset-library-preview-detail">{preview.detail}</p>
                )}
                {thumb && (
                  <img
                    className="asset-library-thumb"
                    src={thumb}
                    alt={selected.version_.displayName}
                    data-preview-thumb="true"
                  />
                )}
                {preview.playable && audioSrc && (
                  <audio
                    className="asset-library-audio"
                    controls
                    preload="metadata"
                    src={audioSrc}
                    data-preview-audio="true"
                  />
                )}
                {preview.playable && !audioSrc && (
                  <p className="asset-library-field-hint">{t("audioHost", lang)}</p>
                )}
                {preview.playable && typeof audioMs === "number" && (
                  <p className="asset-library-preview-detail">{formatDuration(audioMs)}</p>
                )}
                <div className="asset-library-preview-actions">
                  {!controller.preview && (
                    <form data-asset-preview-form="begin" data-preview-version={selected.version_.version} onSubmit={event => {event.preventDefault(); startPreview();}}><Button
                      size="sm"
                      variant="secondary"
                      data-action="asset-preview"
                      type="submit"
                      disabled={controller.busy}
                    >
                      {t("previewStart", lang)}
                    </Button></form>
                  )}
                  {controller.preview && canRetry(controller.preview) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      data-action="asset-preview-retry"
                      disabled={controller.busy}
                      onClick={() => void controller.retryPreview().catch(() => {})}
                    >
                      {t("retry", lang)}
                    </Button>
                  )}
                  {controller.preview?.status === "pending" && controller.previewJob && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="asset-preview-cancel"
                      disabled={controller.busy}
                      onClick={() => void controller.cancelPreview().catch(() => {})}
                    >
                      {t("cancel", lang)}
                    </Button>
                  )}
                </div>
              </div>

              <h4 className="asset-library-section">{t("files", lang)}</h4>
              {selected.version_.files.length === 0 ? (
                <p className="asset-library-note">{t("noFiles", lang)}</p>
              ) : (
                <ul className="asset-library-files">
                  {selected.version_.files.map((file) => (
                    <li key={file.path} data-file-path={file.path}>
                      <span className="asset-library-file-path">{file.path}</span>
                      <span className="asset-library-file-meta">
                        {file.mediaType} · {formatBytes(file.bytes)} · {file.sha256.slice(0, 12)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <h4 className="asset-library-section">{t("versions", lang)}</h4>
              <ul className="asset-library-versions">
                {versionOptions(controller.versions).map((option) => (
                  <li key={option.version}>
                    <button
                      type="button"
                      className={cx(
                        "asset-library-version",
                        option.version === selected.version_.version && "is-active",
                      )}
                      data-version={option.version}
                      onClick={() => openCard(selected.version_.assetId, option.version)}
                    >
                      <span>{option.label}</span>
                      <span className="asset-library-file-meta">
                        {formatBytes(option.entry.version_.bytes)} ·{" "}
                        {option.entry.version_.contentHash.slice(0, 12)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <h4 className="asset-library-section">{t("usage", lang)}</h4>
              {controller.usage.length === 0 ? (
                <p className="asset-library-note">{t("noUsage", lang)}</p>
              ) : (
                <ul className="asset-library-usage">
                  {controller.usage.map((item) => (
                    <li key={`${item.refKind}:${item.refId}:${item.version}`}>
                      <span>{usageKindLabel(item.refKind, lang)}</span>
                      <span className="asset-library-file-meta">
                        {item.refId} · v{item.version} · {item.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {scan && importSource && (
        <div className="asset-library-import" data-asset-import="scan">
          <div className="asset-library-head">
            <span className="asset-library-title">{t("scan", lang)}</span>
            <Button
              size="sm"
              variant="ghost"
              data-action="asset-import-cancel"
              onClick={() => {
                setImportSource(null);
                setImportPath(null);
              }}
            >
              {t("importCancel", lang)}
            </Button>
          </div>
          <p className="asset-library-field-hint">
            {t("scanSummary", lang)}: {summary.newVersions} / {summary.unchanged} /{" "}
            {summary.unsupported}
          </p>
          {scan.truncated && (
            <p className="asset-library-note" data-asset-state="scan-truncated">
              {t("scanTruncated", lang)}
            </p>
          )}
          {summary.samplePaths.length > 0 && (
            <p className="asset-library-field-hint" data-asset-scan-samples="true">
              {summary.samplePaths.join(" · ")}
            </p>
          )}
          {summary.samplePaths.length === 0 ? (
            <p className="asset-library-note">{t("scanEmpty", lang)}</p>
          ) : (
            <ul className="asset-library-scan">
              {scan.items
                .filter((item) => item.supported)
                .map((item) => (
                  <li key={item.path}>
                    <label className="asset-library-check">
                      <input
                        type="radio"
                        name="asset-import-pick"
                        checked={importPath === item.path}
                        data-import-path={item.path}
                        onChange={() => {
                          setImportPath(item.path);
                          setImportName(baseName(item.path));
                          setImportId(assetIdFromName(baseName(item.path)));
                        }}
                      />
                      <span className="asset-library-file-path">{item.path}</span>
                      <span className="asset-library-file-meta">
                        {item.mediaType ?? "—"} · {formatBytes(item.bytes)} ·{" "}
                        {item.known === false ? "new" : item.known === true ? "known" : "?"}
                      </span>
                    </label>
                  </li>
                ))}
            </ul>
          )}

          {picked && (
            <form className="asset-library-import-form" data-asset-import-form="confirm" onSubmit={event => {event.preventDefault(); confirmImport();}}>
              <p className="asset-library-field-label">{t("importPick", lang)}</p>
              <label className="asset-library-field">
                <span className="asset-library-field-label">{t("importName", lang)}</span>
                <Input
                  value={importName}
                  data-import-field="name"
                  onChange={(event) => {
                    setImportName(event.target.value);
                    setImportId(assetIdFromName(event.target.value));
                  }}
                />
              </label>
              <label className="asset-library-field">
                <span className="asset-library-field-label">{t("importAssetId", lang)}</span>
                <Input
                  value={importId}
                  data-import-field="id"
                  onChange={(event) => setImportId(event.target.value)}
                />
              </label>
              <label className="asset-library-field">
                <span className="asset-library-field-label">{t("kind", lang)}</span>
                <Select
                  value={importKind}
                  data-import-field="kind"
                  onChange={(event) => setImportKind(event.target.value as AssetKind)}
                >
                  {ASSET_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {kindLabel(value, lang)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="asset-library-field">
                <span className="asset-library-field-label">{t("origin", lang)}</span>
                <Input
                  value={importOrigin}
                  data-import-field="origin"
                  onChange={(event) => setImportOrigin(event.target.value)}
                />
              </label>
              <p data-import-source-hint="true">{t("importSourceHint", lang)}</p>
              <label className="asset-library-field">
                <span className="asset-library-field-label">{t("author", lang)}</span>
                <Input
                  value={importAuthor}
                  data-import-field="author"
                  onChange={(event) => setImportAuthor(event.target.value)}
                />
              </label>
              <label className="asset-library-field">
                <span className="asset-library-field-label">{t("license", lang)}</span>
                <Input
                  value={importLicense}
                  data-import-field="license"
                  onChange={(event) => setImportLicense(event.target.value)}
                />
              </label>
              <label className="asset-library-field">
                <span className="asset-library-field-label">{t("licenseStatus", lang)}</span>
                <Select
                  value={importLicenseStatus}
                  data-import-field="license-status"
                  onChange={(event) => setImportLicenseStatus(event.target.value)}
                >
                  {ASSET_LICENSE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="asset-library-field">
                <span className="asset-library-field-label">{t("tags", lang)}</span>
                <Input
                  value={importTags}
                  data-import-field="tags"
                  onChange={(event) => setImportTags(event.target.value)}
                />
              </label>
              <Button
                size="sm"
                variant="primary"
                data-action="asset-import-confirm"
                type="submit"
                disabled={controller.busy}
              >
                {t("importConfirm", lang)}
              </Button>
            </form>
          )}

          {controller.lastImport && (
            <p className="asset-library-note" data-asset-import="done">
              {t("importDone", lang)}: {controller.lastImport.displayName} v
              {controller.lastImport.version}
              {controller.lastImport.deduplicated ? ` · ${t("importDedup", lang)}` : ""}
            </p>
          )}
        </div>
      )}

      <p className="asset-library-field-hint" data-asset-scope={scope}>
        {scopeLabel(scope, lang)}
        {mediaKind ? ` · ${mediaKindLabel(mediaKind, lang)}` : ""}
      </p>
      </>}
    </section>
  );
}
