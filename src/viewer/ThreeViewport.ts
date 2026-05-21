import {
  AmbientLight,
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  LinearSRGBColorSpace,
  TextureLoader,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import type { PrimTransform, RenderableMaterial, RenderableMesh, RenderableGaussianSplat, RenderableTexture, StageSummary } from "../usd/types";
import { GaussianSplatRenderer, type SplatViewOptions } from "./GaussianSplatRenderer";

interface FrameAnim {
  startPos: Vector3;
  startTarget: Vector3;
  endPos: Vector3;
  endTarget: Vector3;
  t: number; // 0 → 1
}

export type NavigationMode = "orbital" | "game";
export type ViewUpAxis = "y" | "z";

export type ReferenceHydraRPrim = {
  updatePoints: (points: Float32Array) => void;
  updateIndices: (indices: Int32Array) => void;
  setTransform: (matrix: Float32Array) => void;
};

export type ReferenceHydraRenderInterface = {
  createRPrim: (type: string, id: string) => ReferenceHydraRPrim;
};

export class ThreeViewport {
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly stageRoot = new Group();
  private readonly textureLoader = new TextureLoader();
  private readonly exrLoader = new EXRLoader();
  private readonly textureUrls: string[] = [];
  private readonly textureCache = new Map<string, Promise<Texture | null>>();
  private readonly managedTextures = new Set<Texture>();
  private readonly meshByPath = new Map<string, Mesh>();
  private readonly pathByMesh = new Map<Mesh, string>();
  private readonly highlightedMeshes = new Set<Mesh>();
  private readonly raycaster = new Raycaster();
  private readonly splatRenderer: GaussianSplatRenderer;
  private animationFrame = 0;
  private frameAnim: FrameAnim | null = null;
  private readonly resizeObserver: ResizeObserver;
  private navigationMode: NavigationMode = "orbital";
  private viewUpAxis: ViewUpAxis = "y";
  private gameCameraSpeed = 2;
  private gamePointerActive = false;
  private lastFrameTime = performance.now();
  private readonly gameKeys = new Set<string>();
  private readonly gameForward = new Vector3();
  private readonly gameRight = new Vector3();
  private readonly gameMove = new Vector3();
  private readonly gameUp = new Vector3(0, 1, 0);

  constructor(private readonly host: HTMLElement) {
    this.scene = new Scene();
    this.scene.background = new Color(0x181d21);

    this.camera = new PerspectiveCamera(50, 1, 0.01, 10000);
    this.camera.position.set(4, 3, 6);

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.stageRoot.name = "USD Stage Root";
    this.scene.add(this.stageRoot);
    this.scene.add(new AmbientLight(0xd8e8ff, 0.55));

    const keyLight = new DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(3, 5, 4);
    this.scene.add(keyLight);
    this.scene.add(new AxesHelper(1.25));

    this.splatRenderer = new GaussianSplatRenderer(this.renderer, this.scene);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.installGameNavigationHandlers();
    this.resize();
  }

  start(onTick?: () => void): void {
    const render = () => {
      onTick?.();
      this.tickGameNavigation();
      this.tickFrameAnim();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.animationFrame = window.requestAnimationFrame(render);
    };

    render();
  }

  dispose(): void {
    window.cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.removeGameNavigationHandlers();
    this.controls.dispose();
    this.splatRenderer.dispose();
    this.revokeTextureUrls();
    this.renderer.dispose();
  }

  renderStage(
    renderables: RenderableMesh[],
    _summary: StageSummary | null,
    _hasSplats = false
  ): void {
    if (!renderables.length) {
      this.clearStage();
      this.applyViewUpAxis();
      return;
    }

    this.clearStage();

    for (const renderable of renderables) {
      const geometry = this.buildGeometry(renderable);

      const material = this.createRenderableMaterials(renderable);
      const mesh = new Mesh(geometry, material);
      mesh.name = renderable.name || renderable.path;
      mesh.userData.ptsLen  = renderable.points.length;
      mesh.userData.ptsFingerprint = this.geometryFingerprint(renderable.points);
      this.meshByPath.set(renderable.path, mesh);
      this.pathByMesh.set(mesh, renderable.path);

      if (renderable.matrix.length === 16) {
        mesh.matrix.set(
          ...(renderable.matrix as Parameters<typeof mesh.matrix.set>)
        );
        mesh.matrix.transpose();
        mesh.matrixAutoUpdate = false;
      }

      this.stageRoot.add(mesh);
    }

    this.applyViewUpAxis();

    this.frameStage();
  }

  renderGaussianSplats(splats: RenderableGaussianSplat[]): void {
    this.splatRenderer.renderSplats(splats);
    if (splats.length > 0 && this.meshByPath.size === 0) {
      this.frameSplats(splats);
    }
  }

  createReferenceHydraRenderInterface(): ReferenceHydraRenderInterface {
    this.clearStage();
    this.applyViewUpAxis();

    return {
      createRPrim: (_type: string, id: string): ReferenceHydraRPrim => {
        const geometry = new BufferGeometry();
        const material = new MeshPhysicalMaterial({
          color: new Color(0xb8c4cf),
          metalness: 0.05,
          roughness: 0.55,
          side: DoubleSide,
        });
        const mesh = new Mesh(geometry, material);
        mesh.name = id.split("/").filter(Boolean).pop() || id;
        mesh.matrixAutoUpdate = false;
        this.stageRoot.add(mesh);
        this.meshByPath.set(id, mesh);
        this.pathByMesh.set(mesh, id);

        let points = new Float32Array();
        let indices = new Int32Array();

        const updateGeometry = (): void => {
          if (!points.length || !indices.length) return;
          const positions = this.faceExpandAttr(points, indices, 3);
          const positionAttr = geometry.attributes.position;
          if (positionAttr && positionAttr.count * 3 === positions.length) {
            (positionAttr.array as Float32Array).set(positions);
            positionAttr.needsUpdate = true;
          } else {
            geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
          }
          this.setExpandedVertexNormals(geometry, points, indices);
          geometry.computeBoundingSphere();
        };

        return {
          updatePoints: (nextPoints: Float32Array): void => {
            points = new Float32Array(nextPoints);
            updateGeometry();
          },
          updateIndices: (nextIndices: Int32Array): void => {
            indices = new Int32Array(nextIndices);
            updateGeometry();
          },
          setTransform: (matrix: Float32Array): void => {
            if (matrix.length !== 16) return;
            mesh.matrix.set(...(Array.from(matrix) as Parameters<typeof mesh.matrix.set>));
            mesh.matrix.transpose();
            mesh.matrixAutoUpdate = false;
          },
        };
      },
    };
  }

  frameCurrentStage(): void {
    this.frameStage();
  }

  setSplatViewOptions(options: SplatViewOptions): void {
    this.splatRenderer.setOptions(options);
  }

  setNavigationMode(mode: NavigationMode): void {
    this.navigationMode = mode;
    this.controls.enabled = mode === "orbital";
    if (mode === "game") {
      this.frameAnim = null;
      this.syncOrbitTargetToGameHeading();
    } else {
      this.gamePointerActive = false;
      this.gameKeys.clear();
      this.syncOrbitTargetToGameHeading();
    }
  }

  getNavigationMode(): NavigationMode {
    return this.navigationMode;
  }

  setViewUpAxis(axis: ViewUpAxis): void {
    this.viewUpAxis = axis;
    this.applyViewUpAxis();
    this.frameStage();
  }

  getViewUpAxis(): ViewUpAxis {
    return this.viewUpAxis;
  }

  setGameCameraSpeed(speed: number): void {
    const nextSpeed = Math.min(50, Math.max(0.1, speed));
    if (nextSpeed === this.gameCameraSpeed) return;
    this.gameCameraSpeed = nextSpeed;
    this.host.dispatchEvent(new CustomEvent("camera-speed-change", {
      detail: { speed: this.gameCameraSpeed },
    }));
  }

  getGameCameraSpeed(): number {
    return this.gameCameraSpeed;
  }

  updateRenderables(renderables: RenderableMesh[], forceGeometryUpdate = false): void {
    this.updateRenderablesInScope(renderables, undefined, forceGeometryUpdate);
  }

  updateRenderablesUnderRoot(
    rootPath: string,
    renderables: RenderableMesh[],
    forceGeometryUpdate = false
  ): void {
    const rootPrefix = `${rootPath}/`;
    this.updateRenderablesInScope(
      renderables,
      (path) => path === rootPath || path.startsWith(rootPrefix),
      forceGeometryUpdate
    );
  }

  private updateRenderablesInScope(
    renderables: RenderableMesh[],
    pathInScope: (path: string) => boolean = () => true,
    forceGeometryUpdate = false
  ): void {
    const newPaths = new Set(renderables.map(r => r.path));
    for (const [path, mesh] of [...this.meshByPath.entries()]) {
      if (pathInScope(path) && !newPaths.has(path)) {
        this.stageRoot.remove(mesh);
        mesh.geometry.dispose();
        this.disposeMeshMaterials(mesh);
        this.meshByPath.delete(path);
        this.pathByMesh.delete(mesh);
        this.highlightedMeshes.delete(mesh);
      }
    }
    for (const renderable of renderables) {
      const existing = this.meshByPath.get(renderable.path);
      if (existing) {
        if (renderable.matrix.length === 16) {
          existing.matrix.set(...(renderable.matrix as Parameters<typeof existing.matrix.set>));
          existing.matrix.transpose();
          existing.matrixAutoUpdate = false;
        }
        const len = renderable.points.length;
        const fingerprint = this.geometryFingerprint(renderable.points);
        if (
          forceGeometryUpdate ||
          existing.userData.ptsLen !== len ||
          existing.userData.ptsFingerprint !== fingerprint
        ) {
          this.updateGeometryPositions(existing.geometry, renderable);
          existing.userData.ptsLen = len;
          existing.userData.ptsFingerprint = fingerprint;
        }
        if (renderable.materialSubsets?.length || renderable.material || renderable.color) {
          this.updateMeshMaterials(existing, renderable);
        }
        if (this.highlightedMeshes.has(existing)) {
          this.applyHighlight(existing);
        }
      } else {
        const geometry = this.buildGeometry(renderable);
        const material = this.createRenderableMaterials(renderable);
        const mesh = new Mesh(geometry, material);
        mesh.name = renderable.name || renderable.path;
        mesh.userData.ptsLen = renderable.points.length;
        mesh.userData.ptsFingerprint = this.geometryFingerprint(renderable.points);
        this.meshByPath.set(renderable.path, mesh);
        this.pathByMesh.set(mesh, renderable.path);
        if (renderable.matrix.length === 16) {
          mesh.matrix.set(...(renderable.matrix as Parameters<typeof mesh.matrix.set>));
          mesh.matrix.transpose();
          mesh.matrixAutoUpdate = false;
        }
        this.stageRoot.add(mesh);
      }
    }
  }

  // Materials-only pass: called once after initial load to apply PBR materials
  // and textures onto geometry that was already built by renderStage/Hydra.
  // Never removes or rebuilds geometry — Hydra owns the geometry.
  async updateRenderablesAsync(renderables: RenderableMesh[]): Promise<void> {
    const textureLoads: Promise<void>[] = [];
    for (const renderable of renderables) {
      const existing = this.meshByPath.get(renderable.path);
      if (!existing) continue;

      // Hydra skips UV extraction for skinned meshes — inject from legacy data.
      if (!existing.geometry.attributes.uv && renderable.uvs?.length) {
        const faceUvs = this.faceExpandAttr(renderable.uvs as number[], renderable.indices as number[], 2);
        if (existing.geometry.attributes.position?.count === faceUvs.length / 2) {
          const uvAttr = new Float32BufferAttribute(faceUvs, 2);
          existing.geometry.setAttribute("uv", uvAttr);
          existing.geometry.setAttribute("uv1", uvAttr.clone());
        }
      }
      this.applyGeometryGroups(existing.geometry, renderable);
      this.updateMeshMaterials(existing, renderable, textureLoads);
    }
    await Promise.all(textureLoads);
  }

  private createRenderableMaterials(renderable: RenderableMesh): MeshPhysicalMaterial | MeshPhysicalMaterial[] {
    if (renderable.materialSubsets?.length) {
      return this.getUniqueSubsetMaterials(renderable).map((material) =>
        this.createMaterial(renderable, material)
      );
    }
    return this.createMaterial(renderable, renderable.material);
  }

  private updateMeshMaterials(
    mesh: Mesh,
    renderable: RenderableMesh,
    textureLoads?: Promise<void>[]
  ): void {
    const nextMaterials = this.createRenderableMaterials(renderable);
    const currentIsArray = Array.isArray(mesh.material);
    const nextIsArray = Array.isArray(nextMaterials);
    if (currentIsArray !== nextIsArray ||
        (nextIsArray && (mesh.material as MeshPhysicalMaterial[]).length !== nextMaterials.length)) {
      this.disposeMeshMaterials(mesh);
      mesh.material = nextMaterials;
    }

    const materials = Array.isArray(mesh.material)
      ? mesh.material as MeshPhysicalMaterial[]
      : [mesh.material as MeshPhysicalMaterial];
    const materialSources = renderable.materialSubsets?.length
      ? this.getUniqueSubsetMaterials(renderable)
      : [renderable.material];

    for (let index = 0; index < materials.length; ++index) {
      this.updateMaterialProperties(materials[index], renderable, materialSources[index]);
      this.applyMaterialTextures(materials[index], materialSources[index], textureLoads);
    }
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
  }

  private createMaterial(
    renderable: RenderableMesh,
    rmat = renderable.material
  ): MeshPhysicalMaterial {
    const [r = 0.72, g = 0.72, b = 0.72] = rmat?.diffuseColor ?? renderable.color ?? [];
    const material = new MeshPhysicalMaterial({
      color: new Color(r, g, b),
      metalness: rmat?.metallicTexture ? 1.0 : (rmat?.metallic ?? 0.05),
      roughness: rmat?.roughnessTexture ? 1.0 : (rmat?.roughness ?? 0.55),
      opacity: rmat?.opacity ?? 1,
      transparent: this.isTransparentMaterial(rmat),
      depthWrite: !this.isTransparentMaterial(rmat),
      clearcoat: rmat?.clearcoat ?? 0,
      clearcoatRoughness: rmat?.clearcoatRoughness ?? 0,
      ior: rmat?.ior ?? 1.5,
      side: DoubleSide,
    });
    this.updateMaterialProperties(material, renderable, rmat);
    this.applyMaterialTextures(material, rmat);
    return material;
  }

  private updateMaterialProperties(
    material: MeshPhysicalMaterial,
    renderable: RenderableMesh,
    rmat = renderable.material
  ): void {
    const [r = 0.72, g = 0.72, b = 0.72] = rmat?.diffuseColor ?? renderable.color ?? [];
    material.color.setRGB(r, g, b);
    material.metalness = rmat?.metallicTexture ? 1.0 : (rmat?.metallic ?? 0.05);
    material.roughness = rmat?.roughnessTexture ? 1.0 : (rmat?.roughness ?? 0.55);
    material.opacity = rmat?.opacity ?? 1;
    material.transparent = this.isTransparentMaterial(rmat);
    material.depthWrite = !this.isTransparentMaterial(rmat);
    material.clearcoat = rmat?.clearcoat ?? 0;
    material.clearcoatRoughness = rmat?.clearcoatRoughness ?? 0;
    material.ior = rmat?.ior ?? 1.5;
    if (rmat?.emissiveColor) {
      const [er = 0, eg = 0, eb = 0] = rmat.emissiveColor;
      material.emissive.setRGB(er, eg, eb);
    } else {
      material.emissive.setRGB(0, 0, 0);
    }
    material.needsUpdate = true;
  }

  private applyMaterialTextures(
    material: MeshPhysicalMaterial,
    rmat?: RenderableMaterial,
    textureLoads?: Promise<void>[]
  ): void {
    const loads = [
      this.applyTexture(material, "map",                    rmat?.diffuseTexture,            true),
      this.applyTexture(material, "roughnessMap",           rmat?.roughnessTexture,          false),
      this.applyTexture(material, "metalnessMap",           rmat?.metallicTexture,           false),
      this.applyTexture(material, "normalMap",              rmat?.normalTexture,             false),
      this.applyTexture(material, "aoMap",                  rmat?.occlusionTexture,          false),
      this.applyTexture(material, "emissiveMap",            rmat?.emissiveTexture,           true),
      this.applyTexture(material, "clearcoatMap",           rmat?.clearcoatTexture,          false),
      this.applyTexture(material, "clearcoatRoughnessMap",  rmat?.clearcoatRoughnessTexture, false),
      this.applyTexture(material, "alphaMap",               rmat?.opacityTexture,            false),
    ];
    if (textureLoads) {
      textureLoads.push(...loads);
    }
  }

  private isTransparentMaterial(rmat?: RenderableMaterial): boolean {
    return (rmat?.opacity ?? 1) < 1 || !!rmat?.opacityTexture;
  }

  updateTransforms(transforms: PrimTransform[]): void {
    for (const { path, matrix } of transforms) {
      const mesh = this.meshByPath.get(path);
      if (!mesh || matrix.length !== 16) continue;
      mesh.matrix.set(...(matrix as Parameters<typeof mesh.matrix.set>));
      mesh.matrix.transpose();
    }
  }

  // Update only vertex positions on an existing geometry for animation frames.
  // Preserves UVs, normals re-computed from the original indexed topology.
  // Falls back to full rebuild only when vertex count changes (topology shift).
  private updateGeometryPositions(geo: BufferGeometry, renderable: RenderableMesh): void {
    const pos = this.faceExpandAttr(renderable.points as number[], renderable.indices as number[], 3);
    const posAttr = geo.attributes.position;
    if (posAttr && posAttr.count * 3 === pos.length) {
      // Same vertex count — update in place, keep UVs untouched
      (posAttr.array as Float32Array).set(pos);
      posAttr.needsUpdate = true;
      this.setExpandedVertexNormals(geo, renderable.points, renderable.indices);
    } else {
      // Topology changed — full rebuild, but salvage UVs from the old geometry
      const savedUv = geo.attributes.uv;
      const savedUv1 = geo.attributes.uv1;
      geo.dispose();
      const newGeo = this.buildGeometry(renderable);
      // Copy attributes into the existing geometry object so the Mesh reference stays valid
      for (const key of Object.keys(newGeo.attributes)) {
        geo.setAttribute(key, newGeo.attributes[key]);
      }
      geo.index = newGeo.index;
      geo.clearGroups();
      for (const group of newGeo.groups) {
        geo.addGroup(group.start, group.count, group.materialIndex ?? 0);
      }
      if (!geo.attributes.uv && savedUv) geo.setAttribute("uv", savedUv);
      if (!geo.attributes.uv1 && savedUv1) geo.setAttribute("uv1", savedUv1);
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }

  // Face-expand: for each index, copy `stride` floats from `data`. Matches the
  // reference ThreeJsRenderDelegate.updateOrder() pattern — no setIndex() needed.
  private faceExpandAttr(
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

  private buildGeometry(renderable: RenderableMesh): BufferGeometry {
    const { points, indices, uvs } = renderable;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(this.faceExpandAttr(points, indices, 3), 3));
    if (uvs?.length) {
      const uvAttr = new Float32BufferAttribute(this.faceExpandAttr(uvs, indices, 2), 2);
      geo.setAttribute("uv", uvAttr);
      geo.setAttribute("uv1", uvAttr.clone());
    }
    if (renderable.materialSubsets?.length) {
      this.applyGeometryGroups(geo, renderable);
    }
    this.setExpandedVertexNormals(geo, points, indices);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  private applyGeometryGroups(geo: BufferGeometry, renderable: RenderableMesh): void {
    geo.clearGroups();
    if (!renderable.materialSubsets?.length) return;
    const slots = new Map<string, number>();
    for (let index = 0; index < renderable.materialSubsets.length; ++index) {
      const subset = renderable.materialSubsets[index];
      const key = this.getSubsetMaterialKey(subset.material, subset.path);
      if (!slots.has(key)) {
        slots.set(key, slots.size);
      }
      geo.addGroup(subset.start, subset.count, slots.get(key) ?? 0);
    }
  }

  private getUniqueSubsetMaterials(renderable: RenderableMesh): (RenderableMaterial | undefined)[] {
    const materials: (RenderableMaterial | undefined)[] = [];
    const seen = new Set<string>();
    for (const subset of renderable.materialSubsets ?? []) {
      const key = this.getSubsetMaterialKey(subset.material, subset.path);
      if (seen.has(key)) continue;
      seen.add(key);
      materials.push(subset.material);
    }
    return materials;
  }

  private getSubsetMaterialKey(material: RenderableMaterial | undefined, fallbackPath: string): string {
    return material?.path ?? fallbackPath;
  }

  private setExpandedVertexNormals(
    geo: BufferGeometry,
    points: ArrayLike<number>,
    indices: ArrayLike<number>
  ): void {
    const vertexNormals = new Float32Array(points.length);

    for (let i = 0; i + 2 < indices.length; i += 3) {
      const ia = indices[i] * 3;
      const ib = indices[i + 1] * 3;
      const ic = indices[i + 2] * 3;
      if (ic + 2 >= points.length) continue;

      const ax = points[ia];
      const ay = points[ia + 1];
      const az = points[ia + 2];
      const abx = points[ib] - ax;
      const aby = points[ib + 1] - ay;
      const abz = points[ib + 2] - az;
      const acx = points[ic] - ax;
      const acy = points[ic + 1] - ay;
      const acz = points[ic + 2] - az;

      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;

      vertexNormals[ia] += nx;
      vertexNormals[ia + 1] += ny;
      vertexNormals[ia + 2] += nz;
      vertexNormals[ib] += nx;
      vertexNormals[ib + 1] += ny;
      vertexNormals[ib + 2] += nz;
      vertexNormals[ic] += nx;
      vertexNormals[ic + 1] += ny;
      vertexNormals[ic + 2] += nz;
    }

    for (let i = 0; i + 2 < vertexNormals.length; i += 3) {
      const nx = vertexNormals[i];
      const ny = vertexNormals[i + 1];
      const nz = vertexNormals[i + 2];
      const length = Math.hypot(nx, ny, nz);
      if (length > 0) {
        vertexNormals[i] = nx / length;
        vertexNormals[i + 1] = ny / length;
        vertexNormals[i + 2] = nz / length;
      } else {
        vertexNormals[i + 2] = 1;
      }
    }

    geo.setAttribute("normal", new Float32BufferAttribute(this.faceExpandAttr(vertexNormals, indices, 3), 3));
    geo.attributes.normal.needsUpdate = true;
  }

  private geometryFingerprint(points: ArrayLike<number>): string {
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

  private clearStage(): void {
    this.splatRenderer.clear();
    this.meshByPath.clear();
    this.pathByMesh.clear();
    this.highlightedMeshes.clear();
    this.revokeTextureUrls();
    this.stageRoot.rotation.set(0, 0, 0);
    this.stageRoot.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          this.disposeMaterialTextures(material);
          material.dispose();
        }
      }
    });
    this.stageRoot.clear();
  }

  private applyViewUpAxis(): void {
    this.stageRoot.rotation.set(this.viewUpAxis === "z" ? -Math.PI / 2 : 0, 0, 0);
    this.splatRenderer.setViewUpAxis(this.viewUpAxis);
  }

  private applyTexture(
    material: MeshPhysicalMaterial,
    slot: keyof MeshPhysicalMaterial,
    asset: RenderableTexture | undefined,
    sRGB: boolean
  ): Promise<void> {
    const materialRecord = material as unknown as Record<string, unknown>;
    const userData = material.userData as Record<string, unknown>;
    const textureKey = `texture:${String(slot)}`;

    if (!asset?.data?.length) {
      if (userData[textureKey] !== undefined) {
        userData[textureKey] = undefined;
      }
      const previous = materialRecord[slot as string];
      if (previous instanceof Texture && previous.userData.webviewManaged) {
        previous.dispose();
        this.managedTextures.delete(previous);
      }
      if (previous) {
        materialRecord[slot as string] = null;
        material.needsUpdate = true;
      }
      return Promise.resolve();
    }

    if (userData[textureKey] === asset.path) {
      return Promise.resolve();
    }
    userData[textureKey] = asset.path;

    return this.loadTextureAsset(asset).then((baseTexture) => {
      if (!baseTexture) {
        userData[textureKey] = undefined;
        return;
      }

      const texture = baseTexture.clone();
      texture.name = asset.path;
      texture.colorSpace = sRGB ? SRGBColorSpace : LinearSRGBColorSpace;
      texture.needsUpdate = true;
      texture.userData.webviewManaged = true;
      this.managedTextures.add(texture);

      // When emissiveMap is applied, emissive must be non-black.
      if (slot === "emissiveMap" && material.emissive.getHex() === 0x000000) {
        material.emissive.set(0xffffff);
      }
      const previous = materialRecord[slot as string];
      if (previous instanceof Texture && previous.userData.webviewManaged) {
        previous.dispose();
        this.managedTextures.delete(previous);
      }
      materialRecord[slot as string] = texture;
      material.needsUpdate = true;
    });
  }

  private loadTextureAsset(asset: RenderableTexture): Promise<Texture | null> {
    const cached = this.textureCache.get(asset.path);
    if (cached) {
      return cached;
    }

    const bytes = new ArrayBuffer(asset.data.byteLength);
    new Uint8Array(bytes).set(asset.data);
    const blob = new Blob([bytes], { type: asset.mimeType });
    const url = URL.createObjectURL(blob);
    this.textureUrls.push(url);

    const pending = new Promise<Texture | null>((resolve) => {
      const loader = this.isExrTexture(asset) ? this.exrLoader : this.textureLoader;
      loader.load(
        url,
        (texture: Texture) => {
          texture.name = asset.path;
          texture.userData.webviewManaged = true;
          this.managedTextures.add(texture);
          resolve(texture);
        },
        undefined,
        (error) => {
          console.warn(`Failed to load texture for ${asset.path}`, error);
          this.textureCache.delete(asset.path);
          resolve(null);
        }
      );
    });
    this.textureCache.set(asset.path, pending);
    return pending;
  }

  private isExrTexture(asset: RenderableTexture): boolean {
    return asset.path.toLowerCase().endsWith(".exr") || asset.mimeType === "image/x-exr";
  }

  private disposeMaterialTextures(material: MeshPhysicalMaterial): void {
    const materialRecord = material as unknown as Record<string, unknown>;
    for (const slot of [
      "map",
      "roughnessMap",
      "metalnessMap",
      "normalMap",
      "aoMap",
      "emissiveMap",
      "clearcoatMap",
      "clearcoatRoughnessMap",
      "alphaMap",
    ]) {
      const texture = materialRecord[slot];
      if (texture instanceof Texture && texture.userData.webviewManaged) {
        texture.dispose();
        this.managedTextures.delete(texture);
        materialRecord[slot] = null;
      }
    }
  }

  private disposeMeshMaterials(mesh: Mesh): void {
    const materials = Array.isArray(mesh.material)
      ? mesh.material as MeshPhysicalMaterial[]
      : [mesh.material as MeshPhysicalMaterial];
    for (const material of materials) {
      this.disposeMaterialTextures(material);
      material.dispose();
    }
  }

  private revokeTextureUrls(): void {
    for (const texture of this.managedTextures) {
      texture.dispose();
    }
    this.managedTextures.clear();
    this.textureCache.clear();
    for (const url of this.textureUrls) {
      URL.revokeObjectURL(url);
    }
    this.textureUrls.length = 0;
  }

  pickPrim(clientX: number, clientY: number): string | null {
    const rect = this.host.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.stageRoot.children, true);
    for (const hit of hits) {
      if (hit.object instanceof Mesh) {
        const path = this.pathByMesh.get(hit.object);
        if (path) return path;
      }
    }
    return null;
  }

  setSelectedPrim(primPath: string | null): void {
    for (const mesh of this.highlightedMeshes) {
      this.clearHighlight(mesh);
    }
    this.highlightedMeshes.clear();
    if (!primPath) return;
    const prefix = primPath + "/";
    for (const [path, mesh] of this.meshByPath) {
      if (path === primPath || path.startsWith(prefix)) {
        this.applyHighlight(mesh);
        this.highlightedMeshes.add(mesh);
      }
    }
  }

  private applyHighlight(mesh: Mesh): void {
    const materials = Array.isArray(mesh.material)
      ? mesh.material as MeshPhysicalMaterial[]
      : [mesh.material as MeshPhysicalMaterial];
    if (!mesh.userData.selEmissive) {
      mesh.userData.selEmissive = materials.map((mat) => mat.emissive.clone());
    }
    for (const mat of materials) {
      mat.emissive.set(0x3d1a00); // warm amber, visible on most materials
      mat.needsUpdate = true;
    }
  }

  private clearHighlight(mesh: Mesh): void {
    const materials = Array.isArray(mesh.material)
      ? mesh.material as MeshPhysicalMaterial[]
      : [mesh.material as MeshPhysicalMaterial];
    const saved = mesh.userData.selEmissive as Color[] | undefined;
    if (saved) {
      for (let index = 0; index < materials.length; ++index) {
        if (saved[index]) {
          materials[index].emissive.copy(saved[index]);
          materials[index].needsUpdate = true;
        }
      }
      mesh.userData.selEmissive = null;
    }
  }

  framePrim(primPath: string): void {
    const box = new Box3();
    const prefix = primPath + "/";
    for (const [path, mesh] of this.meshByPath) {
      if (path === primPath || path.startsWith(prefix)) {
        box.expandByObject(mesh);
      }
    }
    if (box.isEmpty()) return;
    this.animateToBox(box, true);
  }

  private tickFrameAnim(): void {
    const a = this.frameAnim;
    if (!a) return;
    // ~18 frames at 60fps ≈ 300ms ease-out
    a.t = Math.min(1, a.t + 0.055);
    const ease = 1 - Math.pow(1 - a.t, 3);
    this.camera.position.lerpVectors(a.startPos, a.endPos, ease);
    this.controls.target.lerpVectors(a.startTarget, a.endTarget, ease);
    if (a.t >= 1) this.frameAnim = null;
  }

  private tickGameNavigation(): void {
    const now = performance.now();
    const deltaSeconds = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    if (this.navigationMode !== "game" || !this.gamePointerActive) {
      return;
    }

    this.camera.getWorldDirection(this.gameForward);
    this.gameRight.crossVectors(this.gameForward, this.gameUp).normalize();
    this.gameMove.set(0, 0, 0);

    if (this.gameKeys.has("w")) this.gameMove.add(this.gameForward);
    if (this.gameKeys.has("s")) this.gameMove.sub(this.gameForward);
    if (this.gameKeys.has("d")) this.gameMove.add(this.gameRight);
    if (this.gameKeys.has("a")) this.gameMove.sub(this.gameRight);
    if (this.gameKeys.has("e")) this.gameMove.add(this.gameUp);
    if (this.gameKeys.has("q")) this.gameMove.sub(this.gameUp);

    if (this.gameMove.lengthSq() > 0) {
      this.gameMove.normalize().multiplyScalar(this.gameCameraSpeed * deltaSeconds);
      this.camera.position.add(this.gameMove);
      this.syncOrbitTargetToGameHeading();
    }
  }

  private installGameNavigationHandlers(): void {
    this.renderer.domElement.addEventListener("contextmenu", this.onGameContextMenu);
    this.renderer.domElement.addEventListener("mousedown", this.onGameMouseDown);
    window.addEventListener("mouseup", this.onGameMouseUp);
    window.addEventListener("mousemove", this.onGameMouseMove);
    window.addEventListener("keydown", this.onGameKeyDown);
    window.addEventListener("keyup", this.onGameKeyUp);
    this.renderer.domElement.addEventListener("wheel", this.onGameWheel, { passive: false });
  }

  private removeGameNavigationHandlers(): void {
    this.renderer.domElement.removeEventListener("contextmenu", this.onGameContextMenu);
    this.renderer.domElement.removeEventListener("mousedown", this.onGameMouseDown);
    window.removeEventListener("mouseup", this.onGameMouseUp);
    window.removeEventListener("mousemove", this.onGameMouseMove);
    window.removeEventListener("keydown", this.onGameKeyDown);
    window.removeEventListener("keyup", this.onGameKeyUp);
    this.renderer.domElement.removeEventListener("wheel", this.onGameWheel);
  }

  private readonly onGameContextMenu = (event: MouseEvent): void => {
    if (this.navigationMode === "game") {
      event.preventDefault();
    }
  };

  private readonly onGameMouseDown = (event: MouseEvent): void => {
    if (this.navigationMode !== "game" || event.button !== 2) return;
    event.preventDefault();
    this.gamePointerActive = true;
    this.controls.enabled = false;
  };

  private readonly onGameMouseUp = (event: MouseEvent): void => {
    if (event.button !== 2) return;
    this.gamePointerActive = false;
    this.gameKeys.clear();
    if (this.navigationMode === "orbital") {
      this.controls.enabled = true;
    }
  };

  private readonly onGameMouseMove = (event: MouseEvent): void => {
    if (this.navigationMode !== "game" || !this.gamePointerActive) return;
    event.preventDefault();

    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y -= event.movementX * 0.002;
    this.camera.rotation.x = Math.max(
      -Math.PI / 2 + 0.01,
      Math.min(Math.PI / 2 - 0.01, this.camera.rotation.x - event.movementY * 0.002)
    );
    this.syncOrbitTargetToGameHeading();
  };

  private readonly onGameKeyDown = (event: KeyboardEvent): void => {
    if (this.navigationMode !== "game" || !this.gamePointerActive) return;
    const key = event.key.toLowerCase();
    if (!"wasdqe".includes(key)) return;
    event.preventDefault();
    this.gameKeys.add(key);
  };

  private readonly onGameKeyUp = (event: KeyboardEvent): void => {
    this.gameKeys.delete(event.key.toLowerCase());
  };

  private readonly onGameWheel = (event: WheelEvent): void => {
    if (this.navigationMode !== "game" || !this.gamePointerActive) return;
    event.preventDefault();
    const multiplier = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.setGameCameraSpeed(this.gameCameraSpeed * multiplier);
  };

  private syncOrbitTargetToGameHeading(): void {
    this.camera.getWorldDirection(this.gameForward);
    this.controls.target.copy(this.camera.position).add(this.gameForward);
  }

  private animateToBox(box: Box3, keepDirection: boolean): void {
    const center = new Vector3();
    const size = new Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxSize = Math.max(size.x, size.y, size.z, 0.001);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const distance = (maxSize * 0.5) / Math.tan(fovRad * 0.5) * 1.6;

    const dir = keepDirection
      ? this.camera.position.clone().sub(this.controls.target).normalize()
      : new Vector3(1, 0.65, 1).normalize();

    const endPos = center.clone().addScaledVector(dir, distance);
    this.camera.near = Math.max(distance / 100, 0.001);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();

    this.frameAnim = {
      startPos: this.camera.position.clone(),
      startTarget: this.controls.target.clone(),
      endPos,
      endTarget: center,
      t: 0,
    };
  }

  private frameSplats(splats: RenderableGaussianSplat[]): void {
    // SplatMesh doesn't participate in Box3.setFromObject, so derive a
    // rough world-space bounding box from the prim transform matrix.
    // USD matrix is row-major; translation is row 3 = m[12..14].
    // Scale estimate = max length of the three rotation/scale rows.
    const box = new Box3();
    for (const splat of splats) {
      const m = splat.matrix;
      if (m.length < 16) continue;
      const tx = m[12], ty = m[13], tz = m[14];
      const s0 = Math.sqrt(m[0] ** 2 + m[1] ** 2 + m[2] ** 2);
      const s1 = Math.sqrt(m[4] ** 2 + m[5] ** 2 + m[6] ** 2);
      const s2 = Math.sqrt(m[8] ** 2 + m[9] ** 2 + m[10] ** 2);
      const r = Math.max(s0, s1, s2, 1) * 1.5;
      box.expandByPoint(new Vector3(tx - r, ty - r, tz - r));
      box.expandByPoint(new Vector3(tx + r, ty + r, tz + r));
    }
    if (!box.isEmpty()) {
      this.animateToBox(box, false);
    }
  }

  private frameStage(): void {
    const box = new Box3().setFromObject(this.stageRoot);
    if (box.isEmpty()) return;
    this.animateToBox(box, false);
  }

  private resize(): void {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
