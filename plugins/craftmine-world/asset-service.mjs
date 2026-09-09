// Asset library service for the craftmine.world plugin (agent R6).
//
// Forwards asset.* channels to the trusted core process and runs preview
// decoding through an injected worker runner. It never opens a window,
// requests pointer lock, sends input or plays audio. OGG is not playable: PCM
// decoding is not implemented, so its preview is recorded as a failure.
const FORWARDED = [
  'asset.search',
  'asset.read',
  'asset.versions',
  'asset.usage',
  'asset.annotate',
  'asset.scan',
  'asset.import',
  'asset.previewRead',
  'asset.probe',
  'asset.mapLegacy',
  'asset.resolveLegacy',
  'asset.recordUsage',
  'asset.recordCheck',
];

function requireText(value, key) {
  const text = value?.[key];
  if (typeof text !== 'string' || text.trim() === '') throw new Error(`${key.toUpperCase()}_REQUIRED`);
  return text;
}

function requireVersion(value) {
  const version = value?.version;
  if (!Number.isInteger(version) || version < 1) throw new Error('VERSION_REQUIRED');
  return version;
}

function channelFor(method) {
  if (!FORWARDED.includes(method)) throw new Error(`UNSUPPORTED_ASSET_CHANNEL: ${method}`);
  return method;
}

export function createAssetService({ call, runPreview, readFile }) {
  if (typeof call !== 'function') throw new Error('DOMAIN_CALL_REQUIRED');
  if (typeof runPreview !== 'function') throw new Error('PREVIEW_RUNNER_REQUIRED');
  if (typeof readFile !== 'function') throw new Error('BODY_READER_REQUIRED');

  const forward = method => args => call(channelFor(method), args ?? {});

  return {
    search: forward('asset.search'),
    read: forward('asset.read'),
    versions: forward('asset.versions'),
    usage: forward('asset.usage'),
    annotate: forward('asset.annotate'),
    scan: forward('asset.scan'),
    importAsset: forward('asset.import'),
    previewRead: forward('asset.previewRead'),
    probe: forward('asset.probe'),
    resolveLegacy: forward('asset.resolveLegacy'),
    recordUsage: forward('asset.recordUsage'),
    recordCheck: forward('asset.recordCheck'),

    /**
     * Claims a preview slot, decodes the exact body in an isolated worker and
     * records the real evidence. A cached ok/partial result is returned without
     * re-running the decoder; a failed/timeout/cancelled slot is retried.
     */
    async preview(args = {}) {
      const assetId = requireText(args, 'assetId');
      const version = requireVersion(args);
      const settingsHash = args.settingsHash ?? 'default';
      const begun = await call('asset.previewBegin', { assetId, version, settingsHash });
      if (begun.cached && begun.preview?.status !== 'pending') {
        return { ...begun.preview, cached: true, retried: false };
      }
      const record = await call('asset.read', { assetId, version });
      const files = record?.version_?.files ?? [];
      const file = args.path
        ? files.find(entry => entry.path === args.path)
        : files[0];
      if (!file) throw new Error('ASSET_FILE_NOT_FOUND');
      const body = await call('asset.bodyPath', { assetId, version, path: file.path });
      const bytes = await readFile(body.blobPath);
      const evidence = await runPreview(
        {
          assetId,
          version,
          contentHash: record.version_.contentHash,
          mediaType: file.mediaType,
          path: file.path,
          bytes,
          engineVersion: args.engineVersion ?? 'unknown',
          settingsHash,
        },
        { timeoutMs: begun.timeoutMs },
      );
      await call('asset.previewFinish', {
        operationId: `preview-${begun.cacheKey}`,
        assetId,
        version,
        settingsHash,
        status: evidence.status,
        detail: evidence.detail ?? '',
        facts: evidence.facts ?? {},
      });
      return { ...evidence, cached: false, retried: begun.retried === true };
    },

    /** Player cancellation. The recorded state is cancelled, never ok. */
    async cancel(args = {}) {
      const assetId = requireText(args, 'assetId');
      const version = requireVersion(args);
      const settingsHash = args.settingsHash ?? 'default';
      const begun = await call('asset.previewBegin', { assetId, version, settingsHash });
      return call('asset.previewFinish', {
        operationId: `preview-cancel-${begun.cacheKey}`,
        assetId,
        version,
        settingsHash,
        status: 'cancelled',
        detail: args.detail ?? 'cancelled by player',
        facts: {},
      });
    },
  };
}
