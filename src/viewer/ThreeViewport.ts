import {
  AmbientLight,
  AxesHelper,
  Box3,
  BoxGeometry,
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
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PrimTransform, RenderableMesh, RenderableGaussianSplat, RenderableTexture, StageSummary } from "../usd/types";
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

export class ThreeViewport {
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly stageRoot = new Group();
  private readonly textureLoader = new TextureLoader();
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

  setPlaceholderStage(label: string): void {
    this.clearStage();

    const geometry = new BoxGeometry(1.4, 1.4, 1.4);
    const material = new MeshPhysicalMaterial({
      color: 0xd2b46d,
      metalness: 0.15,
      roughness: 0.42,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = label;
    this.stageRoot.add(mesh);
    this.applyViewUpAxis();
    this.frameStage();
  }

  renderStage(
    renderables: RenderableMesh[],
    summary: StageSummary | null,
    hasSplats = false
  ): void {
    if (!renderables.length) {
      if (!hasSplats) {
        this.setPlaceholderStage(summary?.rootFile ?? "USD stage");
      } else {
        this.clearStage();
        this.applyViewUpAxis();
      }
      return;
    }

    this.clearStage();

    for (const renderable of renderables) {
      const rawGeometry = new BufferGeometry();
      rawGeometry.setAttribute(
        "position",
        new Float32BufferAttribute(renderable.points, 3)
      );
      if (renderable.uvs?.length) {
        const uvAttr = new Float32BufferAttribute(renderable.uvs, 2);
        rawGeometry.setAttribute("uv", uvAttr);
        rawGeometry.setAttribute("uv1", uvAttr); // required for aoMap
      }
      rawGeometry.setIndex(renderable.indices);

      const geometry = this.buildRenderableGeometry(rawGeometry, renderable);
      geometry.computeVertexNormals();

      const mat = renderable.material;
      const [red = 0.72, green = 0.72, blue = 0.72] =
        mat?.diffuseColor ?? renderable.color ?? [];

      const material = new MeshPhysicalMaterial({
        color: new Color(red, green, blue),
        metalness: mat?.metallicTexture ? 1.0 : (mat?.metallic ?? 0.05),
        roughness: mat?.roughnessTexture ? 1.0 : (mat?.roughness ?? 0.55),
        opacity: mat?.opacity ?? 1,
        transparent: (mat?.opacity ?? 1) < 1,
        clearcoat: mat?.clearcoat ?? 0,
        clearcoatRoughness: mat?.clearcoatRoughness ?? 0,
        ior: mat?.ior ?? 1.5,
        side: DoubleSide,
      });

      if (mat?.emissiveColor) {
        const [er = 0, eg = 0, eb = 0] = mat.emissiveColor;
        material.emissive = new Color(er, eg, eb);
      }

      this.applyTexture(material, "map",                    mat?.diffuseTexture,            true);
      this.applyTexture(material, "roughnessMap",           mat?.roughnessTexture,          false);
      this.applyTexture(material, "metalnessMap",           mat?.metallicTexture,           false);
      this.applyTexture(material, "normalMap",              mat?.normalTexture,             false);
      this.applyTexture(material, "aoMap",                  mat?.occlusionTexture,          false);
      this.applyTexture(material, "emissiveMap",            mat?.emissiveTexture,           true);
      this.applyTexture(material, "clearcoatMap",           mat?.clearcoatTexture,          false);
      this.applyTexture(material, "clearcoatRoughnessMap",  mat?.clearcoatRoughnessTexture, false);
      this.applyTexture(material, "alphaMap",               mat?.opacityTexture,            false);

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
    console.log(`[GaussianSplat] ${splats.length} splat prim(s) received`);
    if (splats.length > 0 && this.meshByPath.size === 0) {
      this.frameSplats(splats);
    }
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

  updateRenderables(renderables: RenderableMesh[], forceGeometry = false): void {
    void this.updateRenderablesAsync(renderables, forceGeometry);
  }

  async updateRenderablesAsync(renderables: RenderableMesh[], forceGeometry = false): Promise<void> {
    const textureLoads: Promise<void>[] = [];
    const newPaths = new Set(renderables.map(r => r.path));

    // Remove prims that are no longer in the stage
    for (const [path, mesh] of [...this.meshByPath.entries()]) {
      if (!newPaths.has(path)) {
        this.stageRoot.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as MeshPhysicalMaterial).dispose();
        this.meshByPath.delete(path);
        this.pathByMesh.delete(mesh);
        this.highlightedMeshes.delete(mesh);
      }
    }

    for (const renderable of renderables) {
      const rmat = renderable.material;
      const [r = 0.72, g = 0.72, b = 0.72] = rmat?.diffuseColor ?? renderable.color ?? [];
      const existing = this.meshByPath.get(renderable.path);

      if (existing) {
        if (renderable.matrix.length === 16) {
          existing.matrix.set(...(renderable.matrix as Parameters<typeof existing.matrix.set>));
          existing.matrix.transpose();
          existing.matrixAutoUpdate = false;
        }

        // Swap geometry only when the points actually changed.
        // Compare pre-merge length + sampled values as a cheap fingerprint.
        const len = renderable.points.length;
        const fingerprint = this.geometryFingerprint(renderable.points);
        if (
          forceGeometry ||
          existing.userData.ptsLen  !== len ||
          existing.userData.ptsFingerprint !== fingerprint
        ) {
          const raw = new BufferGeometry();
          raw.setAttribute("position", new Float32BufferAttribute(renderable.points, 3));
          if (renderable.uvs?.length) {
            const uvAttr = new Float32BufferAttribute(renderable.uvs, 2);
            raw.setAttribute("uv", uvAttr);
            raw.setAttribute("uv1", uvAttr);
          }
          raw.setIndex(renderable.indices);
          const geometry = this.buildRenderableGeometry(raw, renderable);
          geometry.computeVertexNormals();
          existing.geometry.dispose();
          existing.geometry = geometry;
          existing.userData.ptsLen  = len;
          existing.userData.ptsFingerprint = fingerprint;
        }

        if (rmat || renderable.color) {
          // Material scalars are cheap to update unconditionally when present.
          const material = existing.material as MeshPhysicalMaterial;
          material.color.setRGB(r, g, b);
          material.metalness = rmat?.metallicTexture ? 1.0 : (rmat?.metallic ?? 0.05);
          material.roughness = rmat?.roughnessTexture ? 1.0 : (rmat?.roughness ?? 0.55);
          material.opacity   = rmat?.opacity ?? 1;
          material.transparent = (rmat?.opacity ?? 1) < 1;
          material.clearcoat          = rmat?.clearcoat ?? 0;
          material.clearcoatRoughness = rmat?.clearcoatRoughness ?? 0;
          material.ior = rmat?.ior ?? 1.5;
          if (rmat?.emissiveColor) {
            const [er = 0, eg = 0, eb = 0] = rmat.emissiveColor;
            material.emissive.setRGB(er, eg, eb);
          }
          textureLoads.push(this.applyTexture(material, "map",                    rmat?.diffuseTexture,            true));
          textureLoads.push(this.applyTexture(material, "roughnessMap",           rmat?.roughnessTexture,          false));
          textureLoads.push(this.applyTexture(material, "metalnessMap",           rmat?.metallicTexture,           false));
          textureLoads.push(this.applyTexture(material, "normalMap",              rmat?.normalTexture,             false));
          textureLoads.push(this.applyTexture(material, "aoMap",                  rmat?.occlusionTexture,          false));
          textureLoads.push(this.applyTexture(material, "emissiveMap",            rmat?.emissiveTexture,           true));
          textureLoads.push(this.applyTexture(material, "clearcoatMap",           rmat?.clearcoatTexture,          false));
          textureLoads.push(this.applyTexture(material, "clearcoatRoughnessMap",  rmat?.clearcoatRoughnessTexture, false));
          textureLoads.push(this.applyTexture(material, "alphaMap",               rmat?.opacityTexture,            false));
          material.needsUpdate = true;
        }

        // Re-apply highlight if this prim was selected
        if (this.highlightedMeshes.has(existing)) {
          this.applyHighlight(existing);
        }
      } else {
        // New prim — full construction, same as renderStage
        const raw = new BufferGeometry();
        raw.setAttribute("position", new Float32BufferAttribute(renderable.points, 3));
        if (renderable.uvs?.length) {
          const uvAttr = new Float32BufferAttribute(renderable.uvs, 2);
          raw.setAttribute("uv", uvAttr);
          raw.setAttribute("uv1", uvAttr);
        }
        raw.setIndex(renderable.indices);
        const geometry = this.buildRenderableGeometry(raw, renderable);
        geometry.computeVertexNormals();

        const material = new MeshPhysicalMaterial({
          color: new Color(r, g, b),
          metalness: rmat?.metallicTexture ? 1.0 : (rmat?.metallic ?? 0.05),
          roughness: rmat?.roughnessTexture ? 1.0 : (rmat?.roughness ?? 0.55),
          opacity: rmat?.opacity ?? 1,
          transparent: (rmat?.opacity ?? 1) < 1,
          clearcoat: rmat?.clearcoat ?? 0,
          clearcoatRoughness: rmat?.clearcoatRoughness ?? 0,
          ior: rmat?.ior ?? 1.5,
          side: DoubleSide,
        });
        if (rmat?.emissiveColor) {
          const [er = 0, eg = 0, eb = 0] = rmat.emissiveColor;
          material.emissive = new Color(er, eg, eb);
        }
        textureLoads.push(this.applyTexture(material, "map",                    rmat?.diffuseTexture,            true));
        textureLoads.push(this.applyTexture(material, "roughnessMap",           rmat?.roughnessTexture,          false));
        textureLoads.push(this.applyTexture(material, "metalnessMap",           rmat?.metallicTexture,           false));
        textureLoads.push(this.applyTexture(material, "normalMap",              rmat?.normalTexture,             false));
        textureLoads.push(this.applyTexture(material, "aoMap",                  rmat?.occlusionTexture,          false));
        textureLoads.push(this.applyTexture(material, "emissiveMap",            rmat?.emissiveTexture,           true));
        textureLoads.push(this.applyTexture(material, "clearcoatMap",           rmat?.clearcoatTexture,          false));
        textureLoads.push(this.applyTexture(material, "clearcoatRoughnessMap",  rmat?.clearcoatRoughnessTexture, false));
        textureLoads.push(this.applyTexture(material, "alphaMap",               rmat?.opacityTexture,            false));

        const mesh = new Mesh(geometry, material);
        mesh.name = renderable.name || renderable.path;
        mesh.userData.ptsLen  = renderable.points.length;
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
    // No frameStage() — camera position is intentionally preserved
    await Promise.all(textureLoads);
  }

  updateTransforms(transforms: PrimTransform[]): void {
    for (const { path, matrix } of transforms) {
      const mesh = this.meshByPath.get(path);
      if (!mesh || matrix.length !== 16) continue;
      mesh.matrix.set(...(matrix as Parameters<typeof mesh.matrix.set>));
      mesh.matrix.transpose();
    }
  }

  private buildRenderableGeometry(raw: BufferGeometry, renderable: RenderableMesh): BufferGeometry {
    if (renderable.usedComputedPoints) {
      return raw;
    }

    // Static extracted meshes arrive face-expanded, so welding gives smoother
    // normals. Skinned Hydra fallback points should stay in the exact order
    // native code produced for this frame.
    const geometry = mergeVertices(raw);
    raw.dispose();
    return geometry;
  }

  private geometryFingerprint(points: number[]): string {
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
    if (!asset?.data?.length) {
      return Promise.resolve();
    }

    const userData = material.userData as Record<string, unknown>;
    const textureKey = `texture:${String(slot)}`;
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

      const materialRecord = material as unknown as Record<string, unknown>;
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
      this.textureLoader.load(
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
    const mat = mesh.material as MeshPhysicalMaterial;
    if (!mesh.userData.selEmissive) {
      mesh.userData.selEmissive = mat.emissive.clone();
    }
    mat.emissive.set(0x3d1a00); // warm amber, visible on most materials
    mat.needsUpdate = true;
  }

  private clearHighlight(mesh: Mesh): void {
    const mat = mesh.material as MeshPhysicalMaterial;
    if (mesh.userData.selEmissive) {
      mat.emissive.copy(mesh.userData.selEmissive);
      mesh.userData.selEmissive = null;
      mat.needsUpdate = true;
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
