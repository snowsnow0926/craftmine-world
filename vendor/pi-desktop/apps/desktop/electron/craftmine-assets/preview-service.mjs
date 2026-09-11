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
import {
  GLB_RENDERER_VERSION,
  glbGeometryDigest,
  parseGlb,
  renderGlbStatic,
} from './decode/glb-render.mjs';

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

/**
 * Structural GLB decode: real accessor bytes, bounds and topology counts.
 * Kept as a separate entry point so accessor parsing is always distinguishable
 * from the rendered picture produced by `renderGlbStatic`.
 */
export function decodeGlb(bytes) {
  const parsed = parseGlb(bytes);
  return {
    decoder: GLB_DECODER,
    digest: glbGeometryDigest(parsed),
    triangles: parsed.triangles,
    vertices: parsed.vertices,
    nodes: parsed.nodes.length,
    meshes: parsed.meshes.length,
    materials: parsed.materials.length,
    images: parsed.images.length,
    accessors: parsed.accessors.length,
  };
}

/** Renderer failures that mean the asset itself is unusable, not just unrenderable. */
const FATAL_GLB_RENDER_CODES = new Set([
  'CORRUPT_ASSET_BODY',
  'UNSUPPORTED_GLB_VERSION',
  'MISSING_POSITION',
  'PREVIEW_TIMEOUT',
  'INVALID_OPTION',
]);

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
    if (mediaType === 'application/zip') {
      return { cacheKey: cache, status: 'failed', detail: 'ARCHIVE_REQUIRES_PACKAGE_CHECK',
        facts: { picture: false, playable: false, executed: false, archiveValidated: false } };
    }
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
          thumbnailBase64: Buffer.from(decoded.thumbnail.png).toString('base64'),
          progressive: probe.progressive === true,
          interlace: probe.interlace === 0 ? 'none' : 'adam7',
          picture: true,
          playable: false,
        },
      };
    }
    if (mediaType === 'model/gltf-binary') {
      // Stage 1: structural accessor parsing. It must stay independently
      // observable, so its facts are recorded even when the picture fails.
      const facts = decodeGlb(bytes);
      const structureFacts = {
        decoder: facts.decoder,
        geometryDigest: facts.digest,
        triangles: facts.triangles,
        vertices: facts.vertices,
        nodes: facts.nodes,
        meshes: facts.meshes,
        materials: facts.materials,
        images: facts.images,
        accessors: facts.accessors,
        accessorParsed: true,
      };
      // Stage 2: a real offscreen software raster. No GPU, no window, no input.
      let render;
      try {
        render = renderGlbStatic(bytes, { maxSide, deadline });
      } catch (error) {
        const code = error?.code || error?.message || 'GLB_RENDER_FAILED';
        if (FATAL_GLB_RENDER_CODES.has(code)) throw error;
        return {
          cacheKey: cache,
          status: 'partial',
          detail: `glb structure only: ${facts.triangles} tris / ${facts.nodes} nodes`,
          facts: {
            ...structureFacts,
            picture: false,
            rendered: false,
            renderer: GLB_RENDERER_VERSION,
            renderReason: String(code).slice(0, 200),
            playable: false,
          },
        };
      }
      return {
        cacheKey: cache,
        status: 'ok',
        detail: `glb ${facts.triangles} tris / ${facts.nodes} nodes rendered ${render.width}x${render.height}`,
        facts: {
          ...structureFacts,
          // The digest is the rendered RGBA framebuffer, so two different
          // models can never share one preview evidence record.
          digest: render.pixelDigest,
          picture: true,
          rendered: true,
          renderer: GLB_RENDERER_VERSION,
          renderWidth: render.width,
          renderHeight: render.height,
          thumbnailBytes: render.png.length,
          thumbnailBase64: Buffer.from(render.png).toString('base64'),
          cameraYawDeg: render.camera.yawDeg,
          cameraPitchDeg: render.camera.pitchDeg,
          cameraScale: render.camera.scale,
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
