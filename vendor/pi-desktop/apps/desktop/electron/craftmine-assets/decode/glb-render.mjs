/**
 * Craftmine World asset library (AL2) - real static GLB rendering.
 *
 * Two clearly separated stages:
 *
 *   1. `parseGlb()`       structural parsing only: real GLB chunks, real
 *                         accessor/bufferView facts, real topology counts.
 *   2. `renderGlbStatic()` a deterministic software rasterizer that turns the
 *                         parsed POSITION/index data into a real PNG: node and
 *                         scene transforms (matrix or TRS, hierarchical), an
 *                         orthographic 3/4 camera fitted to the bounding box,
 *                         z-buffered triangle rasterisation with flat Lambert
 *                         shading on a dark background.
 *
 * Pure Node ESM. Dependencies: `node:crypto` plus the existing PNG encoder from
 * `image-decode.mjs`. No GPU, no window, no focus, no input, no audio playback,
 * no network, no Date/random in the render path, so identical bytes always
 * produce identical pixels.
 *
 * Error codes: CORRUPT_ASSET_BODY, UNSUPPORTED_GLB_VERSION, MISSING_POSITION,
 * PREVIEW_TIMEOUT, RENDER_EMPTY_GEOMETRY, INVALID_OPTION.
 */

import crypto from 'node:crypto';

import { encodePng } from './image-decode.mjs';

/** Identity of the rasterizer, recorded as preview evidence. */
export const GLB_RENDERER_VERSION = 'glb-software-raster/1';

const GLB_MAGIC = 0x46546c67; // "glTF" little endian
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

const COMPONENT_BYTES = Object.freeze({
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
});

const TYPE_COMPONENTS = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
});

const DEFAULT_MAX_SIDE = 256;
const MAX_SIDE = 2048;
const RENDER_BUDGET_MS = 20000;

// Fixed 3/4 camera. The renderer never reads the clock or a random source, so
// these constants fully determine the framing for a given geometry.
const CAMERA_YAW_DEG = 35;
const CAMERA_PITCH_DEG = 25;
const CAMERA_FILL = 0.86;

const BACKGROUND = Object.freeze([16, 18, 24, 255]);
const AMBIENT = 0.25;
const DEFAULT_BASE_COLOR = Object.freeze([0.78, 0.8, 0.86]);

// Light direction in camera space: upper-left, slightly in front.
const LIGHT = (() => {
  const x = -0.45;
  const y = 0.62;
  const z = 0.65;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
})();

/** Typed error so callers can distinguish the exact failure reason. */
export class GlbRenderError extends Error {
  /**
   * @param {string} code stable machine readable code
   * @param {string} message human readable detail
   */
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'GlbRenderError';
    this.code = String(code);
  }
}

function fail(code, message) {
  throw new GlbRenderError(code, message);
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  fail('INVALID_OPTION', 'bytes must be a Uint8Array, Buffer or ArrayBuffer');
  return null; // unreachable
}

/** Cooperative deadline guard: checked on the first call, then every 32 calls. */
function createGuard(deadline) {
  let ticks = 0;
  return function tick() {
    ticks += 1;
    if (ticks === 1 || (ticks & 31) === 0) {
      if (deadline !== null && Date.now() > deadline) {
        fail('PREVIEW_TIMEOUT', 'GLB render exceeded the supplied deadline');
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Structural GLB parsing (no rasterisation)
// ---------------------------------------------------------------------------

function readAccessorMeta(json, index) {
  const accessor = (json.accessors || [])[index];
  if (!accessor || typeof accessor !== 'object') {
    fail('CORRUPT_ASSET_BODY', `accessor ${index} is missing`);
  }
  return accessor;
}

function bufferViewRange(json, bin, accessor, index) {
  if (accessor.sparse !== undefined) {
    fail('CORRUPT_ASSET_BODY', `accessor ${index} uses an unsupported sparse layout`);
  }
  if (bin === null) fail('CORRUPT_ASSET_BODY', 'GLB has no BIN chunk for its accessors');
  const view = (json.bufferViews || [])[accessor.bufferView];
  if (!view || typeof view !== 'object') {
    fail('CORRUPT_ASSET_BODY', `accessor ${index} references a missing bufferView`);
  }
  const components = TYPE_COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  if (components === undefined || componentBytes === undefined) {
    fail('CORRUPT_ASSET_BODY', `accessor ${index} has an invalid type/componentType`);
  }
  const elementBytes = components * componentBytes;
  const stride = view.byteStride === undefined ? elementBytes : view.byteStride;
  if (!Number.isInteger(stride) || stride < elementBytes) {
    fail('CORRUPT_ASSET_BODY', `accessor ${index} has an invalid byteStride`);
  }
  if (!Number.isInteger(accessor.count) || accessor.count < 0) {
    fail('CORRUPT_ASSET_BODY', `accessor ${index} has an invalid count`);
  }
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const end = accessor.count === 0 ? base : base + (accessor.count - 1) * stride + elementBytes;
  if (base < 0 || end > bin.byteLength) {
    fail(
      'CORRUPT_ASSET_BODY',
      `accessor ${index} reads ${end} bytes but the BIN chunk has ${bin.byteLength}`,
    );
  }
  return { view, elementBytes, stride, base, count: accessor.count };
}

function viewFor(json, bin, accessorIndex, expectedType, allowedComponents) {
  const accessor = readAccessorMeta(json, accessorIndex);
  if (accessor.type !== expectedType) {
    fail('CORRUPT_ASSET_BODY', `accessor ${accessorIndex} must be ${expectedType}`);
  }
  if (!allowedComponents.includes(accessor.componentType)) {
    fail(
      'CORRUPT_ASSET_BODY',
      `accessor ${accessorIndex} componentType ${accessor.componentType} is not supported`,
    );
  }
  return bufferViewRange(json, bin, accessor, accessorIndex);
}

/** Raw accessor bytes, compacted element by element (used for digests). */
function readRawAccessor(parsed, accessorIndex) {
  const accessor = readAccessorMeta(parsed.json, accessorIndex);
  const { elementBytes, stride, base, count } = bufferViewRange(
    parsed.json,
    parsed.bin,
    accessor,
    accessorIndex,
  );
  const out = new Uint8Array(count * elementBytes);
  const bin = parsed.bin;
  for (let i = 0; i < count; i += 1) {
    const src = base + i * stride;
    const dst = i * elementBytes;
    for (let b = 0; b < elementBytes; b += 1) out[dst + b] = bin[src + b];
  }
  return out;
}

function positionAccessorIndexes(parsed) {
  const indexes = [];
  for (const mesh of parsed.meshes) {
    for (const primitive of mesh.primitives || []) {
      const index = primitive?.attributes?.POSITION;
      if (index !== undefined) indexes.push(index);
    }
  }
  return indexes;
}

/**
 * SHA-256 over every POSITION accessor's raw bytes. Kept separate from the
 * rendered pixel digest so accessor evidence and picture evidence never alias.
 */
export function glbGeometryDigest(parsed) {
  const hash = crypto.createHash('sha256');
  for (const index of positionAccessorIndexes(parsed)) {
    hash.update(readRawAccessor(parsed, index));
  }
  return hash.digest('hex');
}

/**
 * Parse the real GLB container and accessor/topology facts.
 *
 * @param {Uint8Array|Buffer|ArrayBuffer} bytes GLB bytes
 * @returns {{json:object,bin:Uint8Array|null,accessors:Array,bufferViews:Array,meshes:Array,nodes:Array,scenes:Array,materials:Array,images:Array,triangles:number,vertices:number}}
 */
export function parseGlb(bytes) {
  const data = asBytes(bytes);
  if (data.byteLength < 20) {
    fail('CORRUPT_ASSET_BODY', `GLB is ${data.byteLength} bytes, the header needs 20`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    fail('CORRUPT_ASSET_BODY', 'GLB magic is not "glTF"');
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    fail('UNSUPPORTED_GLB_VERSION', `GLB version ${version} is not supported (only 2)`);
  }
  const declared = view.getUint32(8, true);
  if (declared !== data.byteLength) {
    fail(
      'CORRUPT_ASSET_BODY',
      `GLB declares ${declared} bytes but the body has ${data.byteLength}`,
    );
  }

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= data.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + length > data.byteLength) {
      fail('CORRUPT_ASSET_BODY', `GLB chunk at ${offset} is truncated`);
    }
    if (type === CHUNK_JSON) {
      if (json !== null) fail('CORRUPT_ASSET_BODY', 'GLB has more than one JSON chunk');
      try {
        json = JSON.parse(new TextDecoder().decode(data.subarray(body, body + length)));
      } catch (error) {
        fail('CORRUPT_ASSET_BODY', `GLB JSON chunk is invalid: ${error.message}`);
      }
    } else if (type === CHUNK_BIN) {
      if (bin !== null) fail('CORRUPT_ASSET_BODY', 'GLB has more than one BIN chunk');
      bin = data.subarray(body, body + length);
    }
    offset = body + length + ((4 - (length % 4)) % 4);
  }
  if (json === null || typeof json !== 'object') {
    fail('CORRUPT_ASSET_BODY', 'GLB is missing its JSON chunk');
  }

  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  const bufferViews = Array.isArray(json.bufferViews) ? json.bufferViews : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const scenes = Array.isArray(json.scenes) ? json.scenes : [];
  const materials = Array.isArray(json.materials) ? json.materials : [];
  const images = Array.isArray(json.images) ? json.images : [];

  let triangles = 0;
  let vertices = 0;
  let sawPosition = false;
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives || []) {
      const positionIndex = primitive?.attributes?.POSITION;
      if (positionIndex === undefined) {
        fail('MISSING_POSITION', 'a GLB primitive has no POSITION attribute');
      }
      const accessor = accessors[positionIndex];
      if (!accessor || accessor.type !== 'VEC3') {
        fail('MISSING_POSITION', `POSITION accessor ${positionIndex} is missing or not VEC3`);
      }
      if (accessor.componentType !== 5126) {
        fail(
          'CORRUPT_ASSET_BODY',
          `POSITION accessor ${positionIndex} must be FLOAT, got ${accessor.componentType}`,
        );
      }
      if (!Number.isInteger(accessor.count) || accessor.count < 1) {
        fail('MISSING_POSITION', `POSITION accessor ${positionIndex} has no vertices`);
      }
      bufferViewRange(json, bin, accessor, positionIndex);
      sawPosition = true;
      vertices += accessor.count;

      const mode = primitive.mode === undefined ? 4 : primitive.mode;
      if (primitive.indices !== undefined) {
        const indices = accessors[primitive.indices];
        if (!indices) {
          fail('CORRUPT_ASSET_BODY', `primitive indices accessor ${primitive.indices} is missing`);
        }
        if (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType)) {
          fail(
            'CORRUPT_ASSET_BODY',
            `indices accessor ${primitive.indices} must be SCALAR u8/u16/u32`,
          );
        }
        bufferViewRange(json, bin, indices, primitive.indices);
        if (mode === 4) triangles += Math.floor(indices.count / 3);
      } else if (mode === 4) {
        triangles += Math.floor(accessor.count / 3);
      }
    }
  }
  if (!sawPosition) {
    fail('MISSING_POSITION', 'GLB contains no mesh primitive with POSITION data');
  }

  return {
    json,
    bin,
    accessors,
    bufferViews,
    meshes,
    nodes,
    scenes,
    materials,
    images,
    triangles,
    vertices,
  };
}

// ---------------------------------------------------------------------------
// Node/scene transforms
// ---------------------------------------------------------------------------

function identityMatrix() {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** Column-major 4x4 product `a * b` (b applied first). */
function multiplyMatrix(a, b) {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail('CORRUPT_ASSET_BODY', `${label} is not a finite number`);
  return number;
}

function nodeLocalMatrix(node, index) {
  if (node.matrix !== undefined) {
    if (!Array.isArray(node.matrix) || node.matrix.length !== 16) {
      fail('CORRUPT_ASSET_BODY', `node ${index} matrix must have 16 elements`);
    }
    const matrix = new Float64Array(16);
    for (let i = 0; i < 16; i += 1) matrix[i] = finiteNumber(node.matrix[i], `node ${index} matrix[${i}]`);
    return matrix;
  }
  const translation = node.translation === undefined ? [0, 0, 0] : node.translation;
  const rotation = node.rotation === undefined ? [0, 0, 0, 1] : node.rotation;
  const scale = node.scale === undefined ? [1, 1, 1] : node.scale;
  if (!Array.isArray(translation) || translation.length !== 3) {
    fail('CORRUPT_ASSET_BODY', `node ${index} translation must have 3 elements`);
  }
  if (!Array.isArray(rotation) || rotation.length !== 4) {
    fail('CORRUPT_ASSET_BODY', `node ${index} rotation must have 4 elements`);
  }
  if (!Array.isArray(scale) || scale.length !== 3) {
    fail('CORRUPT_ASSET_BODY', `node ${index} scale must have 3 elements`);
  }
  const tx = finiteNumber(translation[0], `node ${index} translation[0]`);
  const ty = finiteNumber(translation[1], `node ${index} translation[1]`);
  const tz = finiteNumber(translation[2], `node ${index} translation[2]`);
  let qx = finiteNumber(rotation[0], `node ${index} rotation[0]`);
  let qy = finiteNumber(rotation[1], `node ${index} rotation[1]`);
  let qz = finiteNumber(rotation[2], `node ${index} rotation[2]`);
  let qw = finiteNumber(rotation[3], `node ${index} rotation[3]`);
  const qLength = Math.hypot(qx, qy, qz, qw);
  if (qLength > 1e-12) {
    qx /= qLength;
    qy /= qLength;
    qz /= qLength;
    qw /= qLength;
  } else {
    qx = 0;
    qy = 0;
    qz = 0;
    qw = 1;
  }
  const sx = finiteNumber(scale[0], `node ${index} scale[0]`);
  const sy = finiteNumber(scale[1], `node ${index} scale[1]`);
  const sz = finiteNumber(scale[2], `node ${index} scale[2]`);

  // Rotation (column-major) scaled by the TRS scale.
  const xx = qx * qx;
  const yy = qy * qy;
  const zz = qz * qz;
  const xy = qx * qy;
  const xz = qx * qz;
  const yz = qy * qz;
  const wx = qw * qx;
  const wy = qw * qy;
  const wz = qw * qz;
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (yy + zz)) * sx;
  m[1] = (2 * (xy + wz)) * sx;
  m[2] = (2 * (xz - wy)) * sx;
  m[4] = (2 * (xy - wz)) * sy;
  m[5] = (1 - 2 * (xx + zz)) * sy;
  m[6] = (2 * (yz + wx)) * sy;
  m[8] = (2 * (xz + wy)) * sz;
  m[9] = (2 * (yz - wx)) * sz;
  m[10] = (1 - 2 * (xx + yy)) * sz;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  m[15] = 1;
  return m;
}

/** World matrix per node index, or null when the node is outside the scene. */
function nodeWorldMatrices(json) {
  const nodes = json.nodes;
  const world = new Array(nodes.length).fill(null);
  let roots = null;
  if (json.scenes.length > 0) {
    const sceneIndex = Number.isInteger(json.scene) ? json.scene : 0;
    const scene = json.scenes[sceneIndex] || json.scenes[0];
    if (scene && Array.isArray(scene.nodes) && scene.nodes.length > 0) roots = scene.nodes.slice();
  }
  if (roots === null) {
    const children = new Set();
    for (const node of nodes) {
      for (const child of node?.children || []) children.add(child);
    }
    roots = nodes.map((_, index) => index).filter(index => !children.has(index));
  }
  const visit = (index, parent, depth) => {
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length) {
      fail('CORRUPT_ASSET_BODY', `node graph references unknown node ${index}`);
    }
    if (world[index] !== null) {
      fail('CORRUPT_ASSET_BODY', `node graph reuses node ${index} (cycle or shared child)`);
    }
    if (depth > nodes.length) fail('CORRUPT_ASSET_BODY', 'node graph is too deep');
    const local = nodeLocalMatrix(nodes[index], index);
    world[index] = multiplyMatrix(parent, local);
    for (const child of nodes[index].children || []) visit(child, world[index], depth + 1);
  };
  const rootMatrix = identityMatrix();
  for (const root of roots) visit(root, rootMatrix, 0);
  return world;
}

function transformPoint(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function cameraMatrix() {
  const yaw = (CAMERA_YAW_DEG * Math.PI) / 180;
  const pitch = (CAMERA_PITCH_DEG * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const ry = new Float64Array([
    cy, 0, -sy, 0,
    0, 1, 0, 0,
    sy, 0, cy, 0,
    0, 0, 0, 1,
  ]);
  const rx = new Float64Array([
    1, 0, 0, 0,
    0, cp, sp, 0,
    0, -sp, cp, 0,
    0, 0, 0, 1,
  ]);
  return multiplyMatrix(rx, ry);
}

// ---------------------------------------------------------------------------
// Accessor reads
// ---------------------------------------------------------------------------

function readFloatPositions(parsed, accessorIndex) {
  const { json, bin } = parsed;
  const accessor = readAccessorMeta(json, accessorIndex);
  if (accessor.type !== 'VEC3') {
    fail('MISSING_POSITION', `POSITION accessor ${accessorIndex} is not VEC3`);
  }
  if (accessor.componentType !== 5126) {
    fail('CORRUPT_ASSET_BODY', `POSITION accessor ${accessorIndex} must be FLOAT`);
  }
  const { stride, base, count } = viewFor(json, bin, accessorIndex, 'VEC3', [5126]);
  const dataView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const src = base + i * stride;
    out[i * 3] = dataView.getFloat32(src, true);
    out[i * 3 + 1] = dataView.getFloat32(src + 4, true);
    out[i * 3 + 2] = dataView.getFloat32(src + 8, true);
  }
  return out;
}

function readIndices(parsed, accessorIndex) {
  const { json, bin } = parsed;
  const accessor = readAccessorMeta(json, accessorIndex);
  if (accessor.type !== 'SCALAR') {
    fail('CORRUPT_ASSET_BODY', `indices accessor ${accessorIndex} is not SCALAR`);
  }
  const { stride, base, count } = viewFor(json, bin, accessorIndex, 'SCALAR', [5121, 5123, 5125]);
  const dataView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) {
    const src = base + i * stride;
    if (accessor.componentType === 5121) out[i] = bin[src];
    else if (accessor.componentType === 5123) out[i] = dataView.getUint16(src, true);
    else out[i] = dataView.getUint32(src, true);
  }
  return out;
}

function materialBaseColor(json, materialIndex) {
  if (!Number.isInteger(materialIndex)) return DEFAULT_BASE_COLOR;
  const material = json.materials[materialIndex];
  const factor = material?.pbrMetallicRoughness?.baseColorFactor;
  if (!Array.isArray(factor) || factor.length < 3) return DEFAULT_BASE_COLOR;
  const color = factor.slice(0, 3).map(value => Number(value));
  if (!color.every(Number.isFinite)) return DEFAULT_BASE_COLOR;
  return color.map(value => Math.min(1, Math.max(0, value)));
}

/**
 * Collect every rasterisable triangle in camera space, following node and
 * scene transforms. Returns flat arrays plus the per-triangle base colour.
 */
function gatherSceneTriangles(parsed, guard) {
  const { json } = parsed;
  const world = nodeWorldMatrices(json);
  const camera = cameraMatrix();
  const cam = [];
  const colors = [];
  let rasterized = 0;

  for (let nodeIndex = 0; nodeIndex < json.nodes.length; nodeIndex += 1) {
    const node = json.nodes[nodeIndex];
    if (node.mesh === undefined) continue;
    const matrix = world[nodeIndex];
    if (matrix === null) continue;
    const mesh = json.meshes[node.mesh];
    if (!mesh) fail('CORRUPT_ASSET_BODY', `node ${nodeIndex} references missing mesh ${node.mesh}`);
    for (const primitive of mesh.primitives || []) {
      const mode = primitive.mode === undefined ? 4 : primitive.mode;
      if (mode !== 4) continue; // only TRIANGLES can be rasterised
      const positions = readFloatPositions(parsed, primitive.attributes.POSITION);
      const vertexCount = positions.length / 3;
      const indices = primitive.indices === undefined ? null : readIndices(parsed, primitive.indices);
      const color = materialBaseColor(json, primitive.material);
      const emit = (ia, ib, ic) => {
        if (ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) {
          fail('CORRUPT_ASSET_BODY', 'primitive index is outside the POSITION accessor');
        }
        const points = [ia, ib, ic];
        for (const vertex of points) {
          const x = positions[vertex * 3];
          const y = positions[vertex * 3 + 1];
          const z = positions[vertex * 3 + 2];
          const [wx, wy, wz] = transformPoint(matrix, x, y, z);
          const [cx, cy2, cz] = transformPoint(camera, wx, wy, wz);
          cam.push(cx, cy2, cz);
        }
        colors.push(color[0], color[1], color[2]);
        rasterized += 1;
      };
      if (indices === null) {
        for (let i = 0; i + 2 < vertexCount; i += 3) emit(i, i + 1, i + 2);
      } else {
        for (let i = 0; i + 2 < indices.length; i += 3) {
          emit(indices[i], indices[i + 1], indices[i + 2]);
        }
      }
      guard();
    }
  }
  return { cam, colors, rasterized };
}

// ---------------------------------------------------------------------------
// Software rasteriser
// ---------------------------------------------------------------------------

function clampByte(value) {
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 255) return 255;
  return rounded;
}

function rasterize(cam, colors, size, guard) {
  const pixels = new Uint8Array(size * size * 4);
  const [bgR, bgG, bgB, bgA] = BACKGROUND;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = bgR;
    pixels[i + 1] = bgG;
    pixels[i + 2] = bgB;
    pixels[i + 3] = bgA;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < cam.length; i += 3) {
    if (cam[i] < minX) minX = cam[i];
    if (cam[i] > maxX) maxX = cam[i];
    if (cam[i + 1] < minY) minY = cam[i + 1];
    if (cam[i + 1] > maxY) maxY = cam[i + 1];
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const extent = Math.max(maxX - minX, maxY - minY);
  const scale = extent > 1e-9 ? (size * CAMERA_FILL) / extent : 1;
  const half = size / 2;

  const depthBuffer = new Float64Array(size * size).fill(Infinity);
  const triangleCount = colors.length / 3;

  for (let t = 0; t < triangleCount; t += 1) {
    const o = t * 9;
    const sx0 = half + (cam[o] - centerX) * scale;
    const sy0 = half - (cam[o + 1] - centerY) * scale;
    const sd0 = -cam[o + 2];
    const sx1 = half + (cam[o + 3] - centerX) * scale;
    const sy1 = half - (cam[o + 4] - centerY) * scale;
    const sd1 = -cam[o + 5];
    const sx2 = half + (cam[o + 6] - centerX) * scale;
    const sy2 = half - (cam[o + 7] - centerY) * scale;
    const sd2 = -cam[o + 8];

    const area = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
    if (!(Math.abs(area) > 1e-9)) {
      guard();
      continue;
    }
    let ax = sx0;
    let ay = sy0;
    let ad = sd0;
    let bx = sx1;
    let by = sy1;
    let bd = sd1;
    let cx = sx2;
    let cy = sy2;
    let cd = sd2;
    if (area < 0) {
      // Keep a consistent counter-clockwise winding for the edge tests.
      [bx, cx] = [cx, bx];
      [by, cy] = [cy, by];
      [bd, cd] = [cd, bd];
    }
    const areaAbs = Math.abs(area);

    // Flat Lambert shading from the camera-space geometric normal.
    const e1x = cam[o + 3] - cam[o];
    const e1y = cam[o + 4] - cam[o + 1];
    const e1z = cam[o + 5] - cam[o + 2];
    const e2x = cam[o + 6] - cam[o];
    const e2y = cam[o + 7] - cam[o + 1];
    const e2z = cam[o + 8] - cam[o + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nLength = Math.hypot(nx, ny, nz);
    let intensity = 1;
    if (nLength > 1e-12) {
      nx /= nLength;
      ny /= nLength;
      nz /= nLength;
      // Two-sided shading: flip normals that face away from the viewer (+z).
      if (nz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      intensity = AMBIENT + (1 - AMBIENT) * lambert;
    }
    const baseR = colors[t * 3];
    const baseG = colors[t * 3 + 1];
    const baseB = colors[t * 3 + 2];
    const r = clampByte(baseR * 255 * intensity);
    const g = clampByte(baseG * 255 * intensity);
    const b = clampByte(baseB * 255 * intensity);

    const pxMin = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const pxMax = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const pyMin = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const pyMax = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));

    for (let py = pyMin; py <= pyMax; py += 1) {
      const sampleY = py + 0.5;
      for (let px = pxMin; px <= pxMax; px += 1) {
        const sampleX = px + 0.5;
        const w0 = (cx - bx) * (sampleY - by) - (cy - by) * (sampleX - bx);
        if (w0 < 0) continue;
        const w1 = (ax - cx) * (sampleY - cy) - (ay - cy) * (sampleX - cx);
        if (w1 < 0) continue;
        const w2 = (bx - ax) * (sampleY - ay) - (by - ay) * (sampleX - ax);
        if (w2 < 0) continue;
        const inv = 1 / areaAbs;
        const depth = (w0 * ad + w1 * bd + w2 * cd) * inv;
        const index = py * size + px;
        if (depth >= depthBuffer[index]) continue;
        depthBuffer[index] = depth;
        const dst = index * 4;
        pixels[dst] = r;
        pixels[dst + 1] = g;
        pixels[dst + 2] = b;
        pixels[dst + 3] = 255;
      }
      guard();
    }
  }

  return { pixels, centerX, centerY, scale };
}

/**
 * Render a static, deterministic picture of a GLB.
 *
 * @param {Uint8Array|Buffer|ArrayBuffer} bytes GLB bytes
 * @param {{maxSide?:number,deadline?:number}} [options]
 *   maxSide  square viewport side, integer 1..2048 (default 256)
 *   deadline Date.now() based timestamp; once passed the render aborts with
 *            PREVIEW_TIMEOUT
 * @returns {{png:Uint8Array,width:number,height:number,pixelDigest:string,triangles:number,vertices:number,nodes:number,meshes:number,materials:number,camera:{yawDeg:number,pitchDeg:number,scale:number}}}
 */
export function renderGlbStatic(bytes, options = {}) {
  const opts = options === null || options === undefined ? {} : options;
  if (typeof opts !== 'object') fail('INVALID_OPTION', 'options must be an object');
  const maxSide = opts.maxSide === undefined ? DEFAULT_MAX_SIDE : opts.maxSide;
  if (!Number.isInteger(maxSide) || maxSide < 1 || maxSide > MAX_SIDE) {
    fail('INVALID_OPTION', `options.maxSide must be an integer in 1..${MAX_SIDE}, got ${String(opts.maxSide)}`);
  }
  let deadline = null;
  if (opts.deadline !== undefined && opts.deadline !== null) {
    if (typeof opts.deadline !== 'number' || !Number.isFinite(opts.deadline)) {
      fail('INVALID_OPTION', 'options.deadline must be a finite Date.now() timestamp');
    }
    deadline = opts.deadline;
  } else {
    deadline = Date.now() + RENDER_BUDGET_MS;
  }
  const guard = createGuard(deadline);
  guard();

  const parsed = parseGlb(bytes);
  guard();
  const { cam, colors, rasterized } = gatherSceneTriangles(parsed, guard);
  if (rasterized === 0) {
    fail('RENDER_EMPTY_GEOMETRY', 'GLB contains no TRIANGLES primitive to rasterise');
  }
  guard();

  const size = maxSide;
  const { pixels, scale } = rasterize(cam, colors, size, guard);
  const png = encodePng(pixels, size, size);
  const pixelDigest = crypto.createHash('sha256').update(pixels).digest('hex');

  return {
    png,
    width: size,
    height: size,
    pixelDigest,
    triangles: parsed.triangles,
    vertices: parsed.vertices,
    nodes: parsed.nodes.length,
    meshes: parsed.meshes.length,
    materials: parsed.materials.length,
    camera: { yawDeg: CAMERA_YAW_DEG, pitchDeg: CAMERA_PITCH_DEG, scale },
  };
}
