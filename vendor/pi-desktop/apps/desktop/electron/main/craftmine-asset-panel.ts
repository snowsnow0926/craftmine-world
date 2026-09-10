/** Exact player metadata and browsing channels; never a filesystem grant. */
export const ASSET_PANEL_CHANNELS = new Set([
  "asset.search", "asset.read", "asset.versions", "asset.usage", "asset.previewRead", "asset.annotate",
]);
const fields: Record<string, string[]> = {
  "asset.search": ["scope", "worldId", "query", "kind", "mediaKind", "tags", "favoritesOnly", "latestOnly", "offset", "limit"],
  "asset.read": ["assetId", "version"], "asset.versions": ["assetId", "offset", "limit"],
  "asset.usage": ["assetId", "version"], "asset.previewRead": ["assetId", "version"],
  "asset.annotate": ["operationId", "assetId", "tags", "favorite"],
};
const bounded = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && Buffer.byteLength(v) <= max && !/\p{Cc}/u.test(v);
const tagsValid = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 32 && v.every(tag => bounded(tag, 40));
export async function requestAssetPanel(channel: string, payload: Record<string, any>, options: {
  domain: (method: string, params: Record<string, any>) => Promise<any>;
  viewingSession: () => string | null;
}): Promise<any> {
  if (!ASSET_PANEL_CHANNELS.has(channel) || !payload || Array.isArray(payload)
    || Object.keys(payload).some(key => key !== "ownerWorldId" && !fields[channel].includes(key))
    || !(payload.ownerWorldId === null || bounded(payload.ownerWorldId, 128))) throw Error("INVALID_ASSET_PANEL_REQUEST");
  // Copy before the first await: retries keep the exact submitted transaction.
  const {ownerWorldId, ...rest} = payload;
  const args = structuredClone(rest);
  if (Buffer.byteLength(JSON.stringify(args)) > 8192) throw Error("INVALID_ASSET_PANEL_REQUEST");
  if (channel === "asset.annotate") {
    if (!bounded(args.operationId, 240) || !bounded(args.assetId, 80)
      || (!Object.hasOwn(args, "favorite") && !Object.hasOwn(args, "tags"))
      || (Object.hasOwn(args, "favorite") && typeof args.favorite !== "boolean")
      || (Object.hasOwn(args, "tags") && !tagsValid(args.tags))) throw Error("INVALID_ASSET_ANNOTATION");
  }
  const session = options.viewingSession();
  const current = async () => {
    const selected = await options.domain("selection.read", {});
    if ((selected.worldId ?? null) !== ownerWorldId || options.viewingSession() !== session) throw Error("ASSET_PANEL_OWNER_CHANGED");
  };
  await current();
  const result = await options.domain("asset.request", {method: channel.slice(6), args});
  // A write may already be durable. A stale response is not a fresh UI receipt;
  // its exact operation ID can still be retried by the original owner.
  await current();
  if (channel !== "asset.annotate") return result;
  if (result?.operationId !== args.operationId || result?.assetId !== args.assetId || !result.metadata
    || (Object.hasOwn(args, "favorite") && result.metadata.favorite !== args.favorite)
    || (Object.hasOwn(args, "tags") && (!tagsValid(result.metadata.tags)
      || JSON.stringify([...new Set(args.tags)].sort()) !== JSON.stringify([...new Set(result.metadata.tags)].sort())))) throw Error("INVALID_ASSET_ANNOTATION_RECEIPT");
  return {operationId: result.operationId, assetId: result.assetId, metadata: {
    ...(typeof result.metadata.favorite === "boolean" ? {favorite: result.metadata.favorite} : {}),
    ...(tagsValid(result.metadata.tags) ? {tags: [...result.metadata.tags]} : {}),
  }};
}
