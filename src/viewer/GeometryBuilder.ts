// Pure geometry/topology helpers shared by the viewport. No renderer or
// scene state lives here — everything is a function of its inputs, which
// keeps the face-expansion, normal-welding, fingerprint, and MaterialX UV
// orientation rules unit-testable.

import { Float32BufferAttribute, Vector3 } from "three";
import type { RenderableMaterial, RenderableMesh } from "../usd/types";

// Face-expand: for each index, copy `stride` floats from `data`. Matches the
// reference ThreeJsRenderDelegate.updateOrder() pattern — no setIndex() needed.
export function faceExpandAttr(
  data: ArrayLike<number>,
  indices: ArrayLike<number>,
  stride: number
): Float32Array {
  const out = new Float32Array(indices.length * stride);
  for (let i = 0; i < indices.length; i++) {
    const s = indices[i] * stride;
    for (let j = 0; j < stride; j++) out[i * stride + j] = data[s + j];
  }
  return out;
}

export function normalWeldKey(x: number, y: number, z: number): string {
  const precision = 1e5;
  return `${Math.round(x * precision)}:${Math.round(y * precision)}:${Math.round(z * precision)}`;
}

export function buildIndexedVertexNormals(
  points: ArrayLike<number>,
  indices: ArrayLike<number>
): Float32Array {
  const normals = new Float32Array(points.length);
  const weldedNormals = new Map<string, Vector3>();
  const weldedVertexIndices = new Map<string, number[]>();

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const ia = Number(indices[i]);
    const ib = Number(indices[i + 1]);
    const ic = Number(indices[i + 2]);

    const ax = points[ia * 3];
    const ay = points[ia * 3 + 1];
    const az = points[ia * 3 + 2];
    const bx = points[ib * 3];
    const by = points[ib * 3 + 1];
    const bz = points[ib * 3 + 2];
    const cx = points[ic * 3];
    const cy = points[ic * 3 + 1];
    const cz = points[ic * 3 + 2];

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    for (const vertexIndex of [ia, ib, ic]) {
      const offset = vertexIndex * 3;
      const key = normalWeldKey(points[offset], points[offset + 1], points[offset + 2]);
      const accumulated = weldedNormals.get(key) ?? new Vector3();
      accumulated.x += nx;
      accumulated.y += ny;
      accumulated.z += nz;
      weldedNormals.set(key, accumulated);
      const indicesForKey = weldedVertexIndices.get(key) ?? [];
      indicesForKey.push(vertexIndex);
      weldedVertexIndices.set(key, indicesForKey);
    }
  }

  for (const [key, accumulated] of weldedNormals) {
    const length = accumulated.length();
    if (length > 0) {
      accumulated.divideScalar(length);
    } else {
      accumulated.set(0, 0, 1);
    }
    for (const vertexIndex of weldedVertexIndices.get(key) ?? []) {
      const offset = vertexIndex * 3;
      normals[offset] = accumulated.x;
      normals[offset + 1] = accumulated.y;
      normals[offset + 2] = accumulated.z;
    }
  }

  return normals;
}

// NOTE: 8-point sampling means interior-only vertex changes can go
// undetected (documented false negative; removed with the unified driver).
export function geometryFingerprint(points: ArrayLike<number>): string {
  if (!points.length) return "0";
  const samples = 8;
  const last = points.length - 1;
  let hash = `${points.length}`;
  for (let i = 0; i < samples; i++) {
    const index = Math.min(last, Math.floor((last * i) / (samples - 1)));
    hash += `:${points[index].toPrecision(7)}`;
  }
  return hash;
}

export function renderableHasMaterialX(renderable: RenderableMesh): boolean {
  if (renderable.material?.materialX) {
    return true;
  }
  return (renderable.materialSubsets ?? []).some((subset) => !!subset.material?.materialX);
}

// The MaterialX V-flip. This is the single place UV orientation for
// MaterialX-bound meshes is decided; regression case materialx-tiled
// guards it with an orientation-asymmetric texture.
export function applyMaterialXUvOptions(
  uvAttr: Float32BufferAttribute,
  renderable: RenderableMesh,
  materialXFlipV: boolean
): void {
  if (!materialXFlipV || !renderableHasMaterialX(renderable)) {
    return;
  }

  for (let index = 0; index < uvAttr.count; index += 1) {
    uvAttr.setY(index, 1 - uvAttr.getY(index));
  }
  uvAttr.needsUpdate = true;
}

export function getSubsetMaterialKey(
  material: RenderableMaterial | undefined,
  fallbackPath: string
): string {
  return material?.path ?? fallbackPath;
}

export function getUniqueSubsetMaterials(
  renderable: RenderableMesh
): (RenderableMaterial | undefined)[] {
  const materials: (RenderableMaterial | undefined)[] = [];
  const seen = new Set<string>();
  for (const subset of renderable.materialSubsets ?? []) {
    const key = getSubsetMaterialKey(subset.material, subset.path);
    if (seen.has(key)) continue;
    seen.add(key);
    materials.push(subset.material);
  }
  return materials;
}

export function getRenderableMaterialKey(
  renderable: RenderableMesh,
  materialXFlipV: boolean
): string {
  const materials = renderable.materialSubsets?.length
    ? getUniqueSubsetMaterials(renderable)
    : [renderable.material];
  return materials.map((material) => {
    const materialX = material?.materialX;
    if (materialX) {
      return `mtlx:${materialXFlipV ? "flipv" : "noflipv"}:${materialX.path}:${materialX.materialName ?? ""}`;
    }
    return material?.path ?? "default";
  }).join("|");
}
