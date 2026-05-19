import { SparkRenderer, SplatMesh, PackedSplats, utils } from "@sparkjsdev/spark";
import { Color, Group, Matrix4, Quaternion, Vector3, type Scene, type WebGLRenderer } from "three";
import type { RenderableGaussianSplat } from "../usd/types";

// DC-only SH → linear RGB:  color = SH_C0 * coeff + 0.5
const SH_C0 = 0.28209479177387814;

export type SplatViewOptions = {
  maxShDegree: number;
  scaleMultiplier: number;
};

export class GaussianSplatRenderer {
  private readonly spark: SparkRenderer;
  private readonly scene: Scene;
  private readonly root = new Group();
  private readonly meshByPath = new Map<string, SplatMesh>();
  private readonly options: SplatViewOptions = {
    maxShDegree: 3,
    scaleMultiplier: 1,
  };
  private lastSplats: RenderableGaussianSplat[] = [];

  constructor(renderer: WebGLRenderer, scene: Scene) {
    this.scene = scene;
    this.spark = new SparkRenderer({ renderer });
    this.root.name = "Gaussian Splat Root";
    this.root.add(this.spark);
    scene.add(this.root);
  }

  renderSplats(splats: RenderableGaussianSplat[]): void {
    this.clearMeshes();
    this.lastSplats = splats;
    for (const splat of splats) {
      const mesh = this._buildMesh(splat);
      this.meshByPath.set(splat.path, mesh);
      this.root.add(mesh);
    }
  }

  clear(): void {
    this.clearMeshes();
    this.lastSplats = [];
  }

  setOptions(options: SplatViewOptions): void {
    const scaleChanged = this.options.scaleMultiplier !== options.scaleMultiplier;
    this.options.maxShDegree = options.maxShDegree;
    this.options.scaleMultiplier = options.scaleMultiplier;

    if (scaleChanged && this.lastSplats.length) {
      this.renderSplats(this.lastSplats);
      return;
    }

    this.updateMaxShDegree();
  }

  setViewUpAxis(axis: "y" | "z"): void {
    this.root.rotation.set(axis === "z" ? -Math.PI / 2 : 0, 0, 0);
  }

  private clearMeshes(): void {
    for (const mesh of this.meshByPath.values()) {
      this.root.remove(mesh);
      mesh.dispose();
    }
    this.meshByPath.clear();
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.root);
  }

  private _buildMesh(splat: RenderableGaussianSplat): SplatMesh {
    const { count, positions, scales, orientations, opacities, shCoeffs } = splat;
    const shStride = getSphericalHarmonicsStride(splat);
    const shDegreeForSpark = getSparkSphericalHarmonicsDegree(splat, shStride);
    const shExtra = createSphericalHarmonicsExtra(splat, shDegreeForSpark);

    const packedSplats = new PackedSplats({
      maxSplats: count,
      extra: shExtra,
      construct: (ps) => {
        const center = new Vector3();
        const scale = new Vector3();
        const quat = new Quaternion();
        const color = new Color();
        const sh1 = new Float32Array(9);
        const sh2 = new Float32Array(15);
        const sh3 = new Float32Array(21);

        for (let i = 0; i < count; i++) {
          center.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
          if (scales.length >= i * 3 + 3) {
            scale.set(scales[i * 3], scales[i * 3 + 1], scales[i * 3 + 2]);
          } else {
            scale.setScalar(1);
          }
          scale.multiplyScalar(this.options.scaleMultiplier);

          if (orientations.length >= i * 4 + 4) {
            // USD GfQuatf memory layout: [ix, iy, iz, real] == THREE [x, y, z, w]
            quat.set(
              orientations[i * 4],
              orientations[i * 4 + 1],
              orientations[i * 4 + 2],
              orientations[i * 4 + 3],
            );
          } else {
            quat.identity();
          }

          const opacity = opacities.length ? opacities[i] : 1;

          if (shCoeffs && shStride > 0 && shCoeffs.length >= (i * shStride + 1) * 3) {
            // DC component only — view-independent base color
            const dc = i * shStride * 3;
            const r = Math.max(0, Math.min(1, SH_C0 * shCoeffs[dc] + 0.5));
            const g = Math.max(0, Math.min(1, SH_C0 * shCoeffs[dc + 1] + 0.5));
            const b = Math.max(0, Math.min(1, SH_C0 * shCoeffs[dc + 2] + 0.5));
            color.setRGB(r, g, b);
          } else {
            color.setRGB(1, 1, 1);
          }

          ps.pushSplat(center, scale, quat, opacity, color);
          encodeSphericalHarmonics(shExtra, splat, i, shDegreeForSpark, sh1, sh2, sh3);
        }
      },
    });
    packedSplats.setMaxSh(this.options.maxShDegree);

    const mesh = new SplatMesh({ packedSplats });

    if (splat.matrix.length === 16) {
      const mat = new Matrix4();
      // USD stores matrices row-major; THREE.Matrix4.set() takes row-major args
      mat.set(...(splat.matrix as Parameters<typeof mat.set>));
      mat.transpose(); // to column-major for WebGL
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(mat);
    }

    return mesh;
  }

  private updateMaxShDegree(): void {
    for (const mesh of this.meshByPath.values()) {
      mesh.packedSplats?.setMaxSh(this.options.maxShDegree);
    }
  }
}

function getSphericalHarmonicsStride(splat: RenderableGaussianSplat): number {
  const { count, shCoeffs, shDegree } = splat;
  if (!shCoeffs?.length || count <= 0) {
    return 0;
  }

  if (typeof shDegree === "number" && shDegree >= 0) {
    return (shDegree + 1) * (shDegree + 1);
  }

  return Math.max(1, Math.floor(shCoeffs.length / (count * 3)));
}

function getSparkSphericalHarmonicsDegree(splat: RenderableGaussianSplat, shStride: number): number {
  if (!splat.shCoeffs?.length || shStride < 4) {
    return 0;
  }

  const authoredDegree = typeof splat.shDegree === "number" ? splat.shDegree : 0;
  const inferredDegree = shStride >= 16 ? 3 : shStride >= 9 ? 2 : shStride >= 4 ? 1 : 0;
  return Math.min(3, Math.max(authoredDegree, inferredDegree));
}

function createSphericalHarmonicsExtra(
  splat: RenderableGaussianSplat,
  shDegree: number
): Record<string, Uint32Array> {
  const extra: Record<string, Uint32Array> = {};
  if (!splat.shCoeffs?.length || shDegree < 1) {
    return extra;
  }

  extra.sh1 = new Uint32Array(splat.count * 2);
  if (shDegree >= 2) {
    extra.sh2 = new Uint32Array(splat.count * 4);
  }
  if (shDegree >= 3) {
    extra.sh3 = new Uint32Array(splat.count * 4);
  }
  return extra;
}

function encodeSphericalHarmonics(
  extra: Record<string, Uint32Array>,
  splat: RenderableGaussianSplat,
  index: number,
  shDegree: number,
  sh1: Float32Array,
  sh2: Float32Array,
  sh3: Float32Array
): void {
  const { shCoeffs } = splat;
  if (!shCoeffs || shDegree < 1) {
    return;
  }

  const shStride = getSphericalHarmonicsStride(splat);
  const baseCoeff = index * shStride + 1;

  if (extra.sh1 && shDegree >= 1) {
    copySphericalHarmonicsBand(shCoeffs, baseCoeff, 3, sh1);
    utils.encodeSh1Rgb(extra.sh1, index, sh1);
  }
  if (extra.sh2 && shDegree >= 2) {
    copySphericalHarmonicsBand(shCoeffs, baseCoeff + 3, 5, sh2);
    utils.encodeSh2Rgb(extra.sh2, index, sh2);
  }
  if (extra.sh3 && shDegree >= 3) {
    copySphericalHarmonicsBand(shCoeffs, baseCoeff + 8, 7, sh3);
    utils.encodeSh3Rgb(extra.sh3, index, sh3);
  }
}

function copySphericalHarmonicsBand(
  source: Float32Array,
  startCoeff: number,
  coeffCount: number,
  target: Float32Array
): void {
  for (let coeff = 0; coeff < coeffCount; coeff++) {
    const sourceOffset = (startCoeff + coeff) * 3;
    const targetOffset = coeff * 3;
    target[targetOffset] = source[sourceOffset] ?? 0;
    target[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
    target[targetOffset + 2] = source[sourceOffset + 2] ?? 0;
  }
}
