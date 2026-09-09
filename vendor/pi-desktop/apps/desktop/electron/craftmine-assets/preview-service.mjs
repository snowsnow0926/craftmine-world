// AL2 trusted preview service for the local asset library (agent N).
//
// This module is the only place that turns asset bytes into preview evidence.
// It never executes GDScript, never launches the Godot engine, never opens a
// window, never plays audio and never sends input. Every successful result
// carries the decoder identity and a real digest, so a placeholder can never be
// recorded as a successful preview.
import crypto from 'node:crypto';

import {
  AssetPreviewError as ImageError,
  decodeImage,
  probeImage,
} from './decode/image-decode.mjs';
import {
  AssetPreviewError as AudioError,
  decodeAudio,
  probeAudio,
} from './decode/audio-decode.mjs';
import {
  AssetPreviewError as PackageError,
  checkGodotPackage,
  packageKind,
} from './decode/godot-package.mjs';

export const PREVIEWER_VERSION = 'asset-preview/1';
export const PREVIEW_SETTINGS = Object.freeze({ maxSide: 256, audioMaxFrames: 48000 * 60 });
export const PREVIEW_TIMEOUT_MS = 20000;
export const GLB_DECODER = 'glb-decode.mjs@1';
export const IMAGE_DECODER = 'image-decode.mjs@1';
export const AUDIO_DECODER = 'audio-decode.mjs@1';
export const PACKAGE_DECODER = 'godot-package.mjs@1';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/** Frozen cache-key input shared with the Rust `asset_catalog::preview`. */
export function cacheKeyInput({
  assetId,
  version,
  contentHash,
  previewerVersion = PREVIEWER_VERSION,
  engineVersion,
  settingsHash = 'default',
}) {
  return [
    'craftmine.asset-preview/1',
    String(assetId),
    String(version),
    String(contentHash),
    String(previewerVersion),
    String(engineVersion),
    String(settingsHash),
  ].join('\n');
}

export function cacheKey(parts) {
  return sha256(Buffer.from(cacheKeyInput(parts), 'utf8'));
}

/** Minimal static GLB decode: real accessor bytes, bounds and topology counts. */
export function decodeGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20) throw new Error('CORRUPT_ASSET_BODY');
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('CORRUPT_ASSET_BODY'); // "glTF"
  if (view.getUint32(4, true) !== 2) throw new Error('UNSUPPORTED_GLB_VERSION');
  const declared = view.getUint32(8, true);
  if (declared !== bytes.byteLength) throw new Error('CORRUPT_ASSET_BODY');
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + length > bytes.byteLength) throw new Error('CORRUPT_ASSET_BODY');
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(body, body + length)));
    } else if (type === 0x004e4942) {
      bin = bytes.subarray(body, body + length);
    }
    offset = body + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error('CORRUPT_ASSET_BODY');
  const accessors = json.accessors || [];
  const views = json.bufferViews || [];
  const meshes = json.meshes || [];
  let triangles = 0;
  let vertices = 0;
  const positionSlices = [];
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives || []) {
      const position = primitive.attributes?.POSITION;
      if (position === undefined) throw new Error('MISSING_POSITION');
      const accessor = accessors[position];
      if (!accessor || accessor.type !== 'VEC3') throw new Error('MISSING_POSITION');
      vertices += accessor.count;
      if (primitive.indices !== undefined) {
        const indices = accessors[primitive.indices];
        if (!indices) throw new Error('CORRUPT_ASSET_BODY');
        triangles += Math.floor(indices.count / 3);
      }
      const bufferView = views[accessor.bufferView];
      if (!bufferView || !bin) throw new Error('CORRUPT_ASSET_BODY');
      const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
      const end = start + accessor.count * 12;
      if (end > bin.byteLength) throw new Error('CORRUPT_ASSET_BODY');
      positionSlices.push(bin.subarray(start, end));
    }
  }
  if (!positionSlices.length) throw new Error('MISSING_POSITION');
  const digest = sha256(Buffer.concat(positionSlices.map(slice => Buffer.from(slice))));
  return {
    decoder: GLB_DECODER,
    digest,
    triangles,
    vertices,
    nodes: (json.nodes || []).length,
    meshes: meshes.length,
    materials: (json.materials || []).length,
    images: (json.images || []).length,
    accessors: accessors.length,
  };
}

function packageFiles(request) {
  if (request.files instanceof Map) return request.files;
  if (request.files && typeof request.files === 'object') return new Map(Object.entries(request.files));
  if (typeof request.path === 'string' && request.bytes instanceof Uint8Array) {
    return new Map([[request.path, request.bytes]]);
  }
  throw new Error('PACKAGE_FILES_REQUIRED');
}

function failure(error) {
  const code = error?.code || error?.message || 'PREVIEW_FAILED';
  if (code === 'PREVIEW_TIMEOUT') {
    return { status: 'timeout', detail: 'PREVIEW_TIMEOUT', facts: {} };
  }
  return { status: 'failed', detail: String(code).slice(0, 200), facts: {} };
}

/**
 * Produces preview evidence for one exact content hash. The caller (Rust
 * `asset.previewFinish`) is the only writer of the durable state.
 */
export function previewAsset(request) {
  const {
    mediaType,
    bytes,
    path = '',
    settingsHash = 'default',
    deadline,
    maxSide = PREVIEW_SETTINGS.maxSide,
    engineVersion = 'unknown',
  } = request;
  const cache = cacheKey({ ...request, settingsHash, engineVersion });
  try {
    const needsBytes = mediaType !== 'application/x-godot-package';
    if (needsBytes && !(bytes instanceof Uint8Array)) throw new Error('ASSET_BODY_REQUIRED');
    if (mediaType === 'image/png' || mediaType === 'image/jpeg') {
      const probe = probeImage(bytes);
      const decoded = decodeImage(bytes, { maxSide, deadline });
      return {
        cacheKey: cache,
        status: 'ok',
        detail: `${probe.format} ${probe.width}x${probe.height}`,
        facts: {
          decoder: IMAGE_DECODER,
          digest: decoded.pixelDigest,
          format: probe.format,
          width: decoded.width,
          height: decoded.height,
          thumbnailWidth: decoded.thumbnail.width,
          thumbnailHeight: decoded.thumbnail.height,
          thumbnailBytes: decoded.thumbnail.png.length,
          progressive: probe.progressive === true,
          interlace: probe.interlace === 0 ? 'none' : 'adam7',
          picture: true,
          playable: false,
        },
      };
    }
    if (mediaType === 'model/gltf-binary') {
      const facts = decodeGlb(bytes);
      return {
        cacheKey: cache,
        status: 'partial',
        detail: `glb structure only: ${facts.triangles} tris / ${facts.nodes} nodes`,
        facts: {
          ...facts,
          // The accessor bytes were really parsed, but no offscreen renderer
          // produced a picture. The UI must not present this as a rendered
          // model preview.
          picture: false,
          rendered: false,
          renderReason: 'model-render-not-implemented',
          playable: false,
        },
      };
    }
    if (mediaType === 'audio/wav' || mediaType === 'audio/ogg') {
      const probe = probeAudio(bytes);
      const decoded = decodeAudio(bytes, { deadline, maxFrames: PREVIEW_SETTINGS.audioMaxFrames });
      const containerOnly = decoded.pcmDecoded === false;
      return {
        cacheKey: cache,
        status: containerOnly ? 'failed' : 'ok',
        detail: containerOnly
          ? 'OGG_PCM_DECODE_NOT_IMPLEMENTED'
          : `${probe.codec} ${probe.durationMs} ms`,
        facts: {
          decoder: AUDIO_DECODER,
          digest: decoded.signalDigest || sha256(Buffer.from(JSON.stringify({
            codec: decoded.codec,
            sampleRate: decoded.sampleRate,
            channels: decoded.channels,
            frames: decoded.frames,
          }))),
          codec: decoded.codec,
          sampleRate: decoded.sampleRate,
          channels: decoded.channels,
          frames: decoded.frames,
          durationMs: decoded.durationMs,
          pcmDecoded: decoded.pcmDecoded,
          playable: decoded.pcmDecoded === true,
          picture: false,
          reason: decoded.reason || (containerOnly ? 'OGG_PCM_DECODE_NOT_IMPLEMENTED' : null),
        },
      };
    }
    if (mediaType === 'application/x-godot-package') {
      const files = packageFiles(request);
      const checked = checkGodotPackage(files);
      // The digest must depend on the actual package bytes, otherwise two
      // different packages with the same counts would share one "evidence".
      const ordered = [...files.entries()].sort((left, right) =>
        left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
      const facts = {
        decoder: PACKAGE_DECODER,
        digest: sha256(Buffer.concat(ordered.map(([name, content]) => Buffer.concat([
          Buffer.from(name, 'utf8'),
          Buffer.from([0]),
          Buffer.from(content),
        ])))),
        kind: checked.kind,
        executed: false,
        picture: false,
        playable: false,
        files: checked.files,
        bytes: checked.bytes,
        extResources: checked.extResources.length,
        missing: checked.missing.length,
        cycles: checked.cycles.length,
        issues: checked.issues.length,
      };
      return checked.ok
        ? { cacheKey: cache, status: 'ok', detail: `${checked.kind} package checked`, facts }
        : {
            cacheKey: cache,
            status: 'failed',
            detail: `package rejected: ${checked.issues[0] || checked.missing[0]?.target || 'unknown'}`.slice(0, 200),
            facts,
          };
    }
    return {
      cacheKey: cache,
      status: 'failed',
      detail: 'UNSUPPORTED_MEDIA_TYPE',
      facts: {},
    };
  } catch (error) {
    if (
      error instanceof ImageError ||
      error instanceof AudioError ||
      error instanceof PackageError
    ) {
      return { cacheKey: cache, ...failure(error) };
    }
    return { cacheKey: cache, ...failure(error) };
  }
}

export { packageKind };
