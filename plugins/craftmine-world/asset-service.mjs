// Asset library service for the craftmine.world plugin.
//
// Forwards asset.* channels to the trusted core process and runs preview
// decoding through an injected worker runner. It never opens a window,
// requests pointer lock, sends input or plays audio.
//
// Cache identity and execution identity are separate. The cache key is derived
// from content hash + previewer + engine + settings; the attempt is a claim the
// core issues per run. Every begin, decode, cancel and retry is bound to that
// claim, so a retry can never replay the previous attempt's result and a late
// worker result can never overwrite a cancel or a newer attempt.
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

export const SERVICE_OWNER = 'craftmine.world/asset-service';

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

function requireClaim(begun) {
  const claim = begun?.claim;
  if (!claim || typeof claim.claimId !== 'string' || claim.claimId === '') {
    throw new Error('PREVIEW_CLAIM_REQUIRED');
  }
  if (!Number.isInteger(claim.attempt) || claim.attempt < 1) {
    throw new Error('PREVIEW_CLAIM_REQUIRED');
  }
  return claim;
}

export function createAssetService({ call, runPreview, readFile, owner = SERVICE_OWNER }) {
  if (typeof call !== 'function') throw new Error('DOMAIN_CALL_REQUIRED');
  if (typeof runPreview !== 'function') throw new Error('PREVIEW_RUNNER_REQUIRED');
  if (typeof readFile !== 'function') throw new Error('BODY_READER_REQUIRED');

  // The one live execution per cache key. A second preview of the same content
  // resumes the core claim instead of starting a second decoder.
  const running = new Map();

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
     * records the real evidence against that claim. A cached ok/partial result
     * is returned without re-running the decoder; a failed/timeout/cancelled
     * attempt is retried as a new attempt with a new claim.
     */
    async preview(args = {}) {
      const assetId = requireText(args, 'assetId');
      const version = requireVersion(args);
      const settingsHash = args.settingsHash ?? 'default';
      const begun = await call('asset.previewBegin', {
        assetId,
        version,
        settingsHash,
        owner,
        force: args.force === true,
      });
      if (begun.cached && begun.preview?.status !== 'pending') {
        return {
          ...begun.preview,
          cached: true,
          retried: false,
          applied: true,
          stale: false,
          attempt: begun.preview.attempt ?? begun.attempt ?? 0,
        };
      }
      const claim = requireClaim(begun);
      const operationId = `preview-${begun.cacheKey}-a${claim.attempt}-${claim.claimId}`;
      const controller = new AbortController();
      const entry = { claimId: claim.claimId, attempt: claim.attempt, controller };
      running.set(begun.cacheKey, entry);
      try {
        const record = await call('asset.read', { assetId, version });
        const files = record?.version_?.files ?? [];
        const file = args.path ? files.find(item => item.path === args.path) : files[0];
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
            attempt: claim.attempt,
            claimId: claim.claimId,
          },
          { timeoutMs: begun.timeoutMs, signal: controller.signal },
        );
        const finish = await call('asset.previewFinish', {
          operationId,
          assetId,
          version,
          settingsHash,
          claimId: claim.claimId,
          attempt: claim.attempt,
          status: evidence.status,
          detail: evidence.detail ?? '',
          facts: evidence.facts ?? {},
        });
        // A cancel or a newer attempt owns the slot now: the late result is
        // reported as discarded, never written over the current state.
        if (finish?.applied === false) {
          return {
            ...evidence,
            cached: false,
            retried: begun.retried === true,
            applied: false,
            stale: true,
            reason: finish.reason ?? 'STALE_PREVIEW_ATTEMPT',
            attempt: claim.attempt,
          };
        }
        return {
          ...evidence,
          cached: false,
          retried: begun.retried === true,
          applied: true,
          stale: false,
          attempt: claim.attempt,
        };
      } finally {
        if (running.get(begun.cacheKey) === entry) running.delete(begun.cacheKey);
      }
    },

    /**
     * Player cancellation. It terminates the live worker for this claim and
     * records the attempt's terminal state. Cancelling a finished preview is a
     * no-op: a cached ok result is never rewritten to cancelled.
     */
    async cancel(args = {}) {
      const assetId = requireText(args, 'assetId');
      const version = requireVersion(args);
      const settingsHash = args.settingsHash ?? 'default';
      const begun = await call('asset.previewBegin', { assetId, version, settingsHash, owner });
      const entry = running.get(begun.cacheKey);
      const claim = begun.claim;
      let abortSignalled = false;
      if (entry && (!claim || entry.claimId === claim.claimId)) {
        entry.controller.abort(new Error('PREVIEW_CANCELLED'));
        abortSignalled = true;
      }
      if (!claim?.claimId) {
        return {
          cancelled: false,
          applied: false,
          reason: 'NO_ACTIVE_ATTEMPT',
          status: begun.preview?.status ?? null,
          abortSignalled,
        };
      }
      const finish = await call('asset.previewFinish', {
        operationId: `preview-cancel-${begun.cacheKey}-a${claim.attempt}-${claim.claimId}`,
        assetId,
        version,
        settingsHash,
        claimId: claim.claimId,
        attempt: claim.attempt,
        status: 'cancelled',
        detail: args.detail ?? 'cancelled by player',
        facts: { abortSignalled },
      });
      return {
        ...finish,
        cancelled: finish?.applied === true,
        abortSignalled,
      };
    },
  };
}
