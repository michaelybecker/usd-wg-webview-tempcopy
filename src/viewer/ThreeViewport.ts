import {
  AmbientLight,
  AxesHelper,
  Box3,
  Color,
  type ColorSpace,
  DoubleSide,
  EquirectangularReflectionMapping,
  Float32BufferAttribute,
  BufferGeometry,
  Group,
  HemisphereLight,
  ImageLoader,
  InstancedMesh,
  MeshBasicMaterial,
  type Material,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  LinearSRGBColorSpace,
  type ToneMapping,
  TextureLoader,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { MaterialXLoader } from "three/examples/jsm/loaders/MaterialXLoader.js";
import type { PrimTransform, RenderableMaterial, RenderableMesh, RenderableGaussianSplat, RenderableTexture, StageSummary } from "../usd/types";
import { GaussianSplatRenderer, type SplatViewOptions } from "./GaussianSplatRenderer";
import {
  applyMaterialXUvOptions,
  buildIndexedVertexNormals,
  faceExpandAttr,
  geometryFingerprint,
  getRenderableMaterialKey,
  getSubsetMaterialKey,
  getUniqueSubsetMaterials,
  renderableHasMaterialX,
} from "./GeometryBuilder";
import {
  createReferenceHydraRenderInterface,
  type ReferenceHydraRenderInterface,
} from "./referenceHydraInterface";

interface FrameAnim {
  startPos: Vector3;
  startTarget: Vector3;
  endPos: Vector3;
  endTarget: Vector3;
  t: number; // 0 → 1
}

interface PickSelection {
  path: string;
  instanceId: number | null;
}

export type NavigationMode = "orbital" | "game";
export type ViewUpAxis = "y" | "z";

export type {
  ReferenceHydraRPrim,
  ReferenceHydraRenderInterface,
} from "./referenceHydraInterface";

const TEXT_DECODER = new TextDecoder();
const IDENTITY_MATRIX = new Matrix4();

export class ThreeViewport {
  private readonly defaultBackground = new Color(0x181d21);
  private readonly camera: PerspectiveCamera;
  private controls: OrbitControls;
  private renderer: WebGLRenderer | WebGPURenderer;
  private readonly scene: Scene;
  private readonly stageRoot = new Group();
  private readonly textureLoader = new TextureLoader();
  private readonly exrLoader = new EXRLoader();
  private readonly hdrLoader = new HDRLoader();
  private readonly textureUrls: string[] = [];
  private readonly textureCache = new Map<string, Promise<Texture | null>>();
  private readonly materialXLoader = new MaterialXLoader();
  private readonly materialXResourceUrls = new Map<string, string>();
  private readonly materialXTangentWarnings = new Set<string>();
  private readonly managedTextures = new Set<Texture>();
  private readonly ambientLight: AmbientLight;
  private readonly hemisphereLight: HemisphereLight;
  private readonly defaultEnvironmentTarget: WebGLRenderTarget;
  private readonly defaultAmbientIntensity = 0.22;
  private readonly defaultHemisphereIntensity = 1.25;
  private readonly defaultEnvironmentIntensity = 0.7;
  private hdriTexture: Texture | null = null;
  private hdriMapVisible = true;
  private hdriIntensity = 1;
  private readonly meshByPath = new Map<string, Mesh>();
  private readonly pathByMesh = new Map<Mesh, string>();
  private readonly highlightedMeshes = new Set<Mesh>();
  private textureGeneration = 0;
  private selectedInstance: PickSelection | null = null;
  private selectedInstanceOverlays: Mesh[] = [];
  private readonly raycaster = new Raycaster();
  private splatRenderer: GaussianSplatRenderer | null;
  private experimentalMaterialXMode = false;
  private webGpuInit: Promise<boolean> | null = null;
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
  private materialXFlipV = true;

  constructor(private readonly host: HTMLElement) {
    this.scene = new Scene();
    this.scene.background = this.defaultBackground;

    this.camera = new PerspectiveCamera(50, 1, 0.01, 10000);
    this.camera.position.set(4, 3, 6);

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.host.appendChild(renderer.domElement);

    this.materialXLoader.manager.addHandler(/^data:image\//, new ImageLoader(this.materialXLoader.manager));

    const pmremGenerator = new PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    this.defaultEnvironmentTarget = pmremGenerator.fromScene(roomEnvironment);
    pmremGenerator.dispose();

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.stageRoot.name = "USD Stage Root";
    this.scene.add(this.stageRoot);
    this.ambientLight = new AmbientLight(0xffffff, this.defaultAmbientIntensity);
    this.scene.add(this.ambientLight);

    this.hemisphereLight = new HemisphereLight(0xfff7ec, 0x6b737c, this.defaultHemisphereIntensity);
    this.scene.add(this.hemisphereLight);
    this.applyDefaultEnvironment();
    this.scene.add(new AxesHelper(1.25));

    this.splatRenderer = new GaussianSplatRenderer(renderer, this.scene);

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
      if (this.isWebGpuRenderer()) {
        void (this.renderer as WebGPURenderer).renderAsync(this.scene, this.camera);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      this.animationFrame = window.requestAnimationFrame(render);
    };

    render();
  }

  dispose(): void {
    window.cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.removeGameNavigationHandlers();
    this.controls.dispose();
    this.splatRenderer?.dispose();
    this.materialXLoader.dispose();
    this.clearSelectedInstanceOverlays();
    this.revokeMaterialXResourceUrls();
    this.disposeHdriTexture();
    this.revokeTextureUrls();
    this.defaultEnvironmentTarget.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
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
      const mesh = this.createSceneMesh(renderable);
      mesh.name = renderable.name || renderable.path;
      mesh.userData.materialKey = getRenderableMaterialKey(renderable, this.materialXFlipV);
      mesh.userData.ptsLen  = renderable.points.length;
      mesh.userData.ptsFingerprint = geometryFingerprint(renderable.points);
      mesh.userData.instanceCount = renderable.instanceMatrices?.length ?? 0;
      this.meshByPath.set(renderable.path, mesh);
      this.pathByMesh.set(mesh, renderable.path);
      this.applyRenderableTransform(mesh, renderable);
      this.stageRoot.add(mesh);
    }

    this.applyViewUpAxis();

    this.frameStage();
  }

  renderGaussianSplats(splats: RenderableGaussianSplat[]): void {
    if (!this.splatRenderer) {
      return;
    }
    this.splatRenderer.renderSplats(splats);
    if (splats.length > 0 && this.meshByPath.size === 0) {
      this.frameSplats(splats);
    }
  }

  isExperimentalMaterialXMode(): boolean {
    return this.experimentalMaterialXMode;
  }

  setMaterialXFlipV(enabled: boolean): void {
    this.materialXFlipV = enabled;
  }

  async prepareForRenderables(renderables: RenderableMesh[]): Promise<void> {
    if (renderables.some((renderable) => renderableHasMaterialX(renderable))) {
      await this.ensureWebGpuRenderer();
    }
  }

  private async ensureWebGpuRenderer(): Promise<boolean> {
    if (this.isWebGpuRenderer()) {
      return true;
    }
    if (this.webGpuInit) {
      return this.webGpuInit;
    }

    this.webGpuInit = this.switchToWebGpuRenderer();
    return this.webGpuInit;
  }

  private async switchToWebGpuRenderer(): Promise<boolean> {
    const previousRenderer = this.renderer;
    const previousCanvas = previousRenderer.domElement;
    try {
      this.removeGameNavigationHandlers();
      this.controls.dispose();

      // Automation/CI escape hatch: headless Chromium cannot present WebGPU
      // canvases, so ?forceWebGL=1 runs the same renderer (and the MaterialX
      // TSL node path) on its WebGL2 backend instead.
      const forceWebGL =
        new URLSearchParams(window.location.search).get("forceWebGL") === "1";
      const renderer = new WebGPURenderer({ antialias: true, alpha: false, forceWebGL });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = previousRenderer.outputColorSpace;
      renderer.toneMapping = previousRenderer.toneMapping;
      renderer.toneMappingExposure = previousRenderer.toneMappingExposure;
      await renderer.init();

      this.renderer = renderer;
      previousCanvas.replaceWith(renderer.domElement);
      previousRenderer.dispose();
      this.controls = new OrbitControls(this.camera, renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.splatRenderer?.dispose();
      this.splatRenderer = null;
      this.installGameNavigationHandlers();
      this.resize();
      return true;
    } catch (error) {
      console.warn("Failed to initialize WebGPU renderer for MaterialX", error);
      this.renderer = previousRenderer;
      this.controls = new OrbitControls(this.camera, previousCanvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.installGameNavigationHandlers();
      return false;
    }
  }

  private isWebGpuRenderer(): boolean {
    return "isWebGPURenderer" in this.renderer;
  }

  createReferenceHydraRenderInterface(): ReferenceHydraRenderInterface {
    return createReferenceHydraRenderInterface({
      stageRoot: this.stageRoot,
      meshByPath: this.meshByPath,
      pathByMesh: this.pathByMesh,
      resetStage: () => {
        this.clearStage();
        this.applyViewUpAxis();
      },
      setExpandedVertexNormals: (geometry, points, indices) =>
        this.setExpandedVertexNormals(geometry, points, indices),
    });
  }

  frameCurrentStage(): void {
    this.frameStage();
  }

  setSplatViewOptions(options: SplatViewOptions): void {
    this.splatRenderer?.setOptions(options);
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

  setOutputColorSpace(colorSpace: ColorSpace): void {
    this.renderer.outputColorSpace = colorSpace;
  }

  setToneMapping(toneMapping: ToneMapping): void {
    this.renderer.toneMapping = toneMapping;
  }

  setToneMappingExposure(exposure: number): void {
    this.renderer.toneMappingExposure = Math.min(5, Math.max(0, exposure));
  }

  async loadHdriMap(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      const texture = await this.loadHdriTexture(file.name, url);
      this.applyHdriTexture(texture, file.name);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadHdriAsset(asset: RenderableTexture, label?: string): Promise<void> {
    const bytes = new Uint8Array(asset.data.byteLength);
    bytes.set(asset.data);
    const url = URL.createObjectURL(
      new Blob([bytes.buffer], { type: asset.mimeType || "application/octet-stream" })
    );
    try {
      const texture = await this.loadHdriTexture(asset.path, url);
      this.applyHdriTexture(texture, label ?? asset.path);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  useDefaultLighting(): void {
    this.disposeHdriTexture();
    this.scene.background = this.defaultBackground;
    this.applyDefaultEnvironment();
    this.setDefaultLightRigEnabled(true);
  }

  setHdriMapVisible(visible: boolean): void {
    this.hdriMapVisible = visible;
    if (!this.hdriTexture) {
      return;
    }
    this.scene.background = visible ? this.hdriTexture : this.defaultBackground;
  }

  setHdriIntensity(intensity: number): void {
    this.hdriIntensity = Math.min(5, Math.max(0, intensity));
    if (this.hdriTexture) {
      this.applyHdriIntensity();
    }
  }

  hasHdriMap(): boolean {
    return this.hdriTexture !== null;
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
        if (!this.sceneMeshMatchesRenderable(existing, renderable)) {
          this.stageRoot.remove(existing);
          existing.geometry.dispose();
          this.disposeMeshMaterials(existing);
          this.pathByMesh.delete(existing);
          this.highlightedMeshes.delete(existing);

          const replacement = this.createSceneMesh(renderable);
          replacement.name = renderable.name || renderable.path;
          replacement.userData.ptsLen = renderable.points.length;
          replacement.userData.ptsFingerprint = geometryFingerprint(renderable.points);
          replacement.userData.materialKey = getRenderableMaterialKey(renderable, this.materialXFlipV);
          replacement.userData.instanceCount = renderable.instanceMatrices?.length ?? 0;
          this.meshByPath.set(renderable.path, replacement);
          this.pathByMesh.set(replacement, renderable.path);
          this.applyRenderableTransform(replacement, renderable);
          this.stageRoot.add(replacement);
          continue;
        }
        this.applyRenderableTransform(existing, renderable);
        const len = renderable.points.length;
        const fingerprint = geometryFingerprint(renderable.points);
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
        const mesh = this.createSceneMesh(renderable);
        mesh.name = renderable.name || renderable.path;
        mesh.userData.ptsLen = renderable.points.length;
        mesh.userData.ptsFingerprint = geometryFingerprint(renderable.points);
        mesh.userData.materialKey = getRenderableMaterialKey(renderable, this.materialXFlipV);
        mesh.userData.instanceCount = renderable.instanceMatrices?.length ?? 0;
        this.meshByPath.set(renderable.path, mesh);
        this.pathByMesh.set(mesh, renderable.path);
        this.applyRenderableTransform(mesh, renderable);
        this.stageRoot.add(mesh);
      }
    }
  }

  // Materials-only pass: called once after initial load to apply PBR materials
  // and textures onto geometry that was already built by renderStage/Hydra.
  // Never removes or rebuilds geometry — Hydra owns the geometry.
  async updateRenderablesAsync(renderables: RenderableMesh[]): Promise<void> {
    const textureLoads: Promise<void>[] = [];
    if (renderables.some((renderable) => renderableHasMaterialX(renderable))) {
      await this.ensureWebGpuRenderer();
    }
    for (const renderable of renderables) {
      const existing = this.meshByPath.get(renderable.path);
      if (!existing) continue;

      // Hydra skips UV extraction for skinned meshes — inject from legacy data.
      if (renderable.uvs?.length) {
        const shouldRewriteUvs =
          !existing.geometry.attributes.uv || renderableHasMaterialX(renderable);
        if (shouldRewriteUvs) {
          const faceUvs = faceExpandAttr(renderable.uvs as number[], renderable.indices as number[], 2);
          if (existing.geometry.attributes.position?.count === faceUvs.length / 2) {
            const uvAttr = new Float32BufferAttribute(faceUvs, 2);
            applyMaterialXUvOptions(uvAttr, renderable, this.materialXFlipV);
            existing.geometry.setAttribute("uv", uvAttr);
            existing.geometry.setAttribute("uv1", uvAttr.clone());
          }
        }
      }
      this.applyGeometryGroups(existing.geometry, renderable);
      this.updateMeshMaterials(existing, renderable, textureLoads);
    }
    await Promise.all(textureLoads);
  }

  private createRenderableMaterials(renderable: RenderableMesh): Material | Material[] {
    if (renderable.materialSubsets?.length) {
      return getUniqueSubsetMaterials(renderable).map((material) =>
        this.createMaterialForRenderable(renderable, material)
      );
    }
    return this.createMaterialForRenderable(renderable, renderable.material);
  }

  private createSceneMesh(renderable: RenderableMesh): Mesh {
    const geometry = this.buildGeometry(renderable);
    const material = this.createRenderableMaterials(renderable);
    if (renderable.instanceMatrices?.length) {
      const mesh = new InstancedMesh(geometry, material, renderable.instanceMatrices.length);
      mesh.userData.instanceOwnerPath = renderable.instanceOwnerPath ?? renderable.path;
      return mesh;
    }
    return new Mesh(geometry, material);
  }

  private sceneMeshMatchesRenderable(mesh: Mesh, renderable: RenderableMesh): boolean {
    const instanceCount = renderable.instanceMatrices?.length ?? 0;
    if (mesh instanceof InstancedMesh) {
      return instanceCount > 0 && mesh.count === instanceCount;
    }
    return instanceCount === 0;
  }

  private applyRenderableTransform(mesh: Mesh, renderable: RenderableMesh): void {
    if (renderable.matrix.length === 16) {
      mesh.matrix.set(...(renderable.matrix as Parameters<typeof mesh.matrix.set>));
      mesh.matrix.transpose();
      mesh.matrixAutoUpdate = false;
    } else {
      mesh.matrix.identity();
      mesh.matrixAutoUpdate = false;
    }

    if (!(mesh instanceof InstancedMesh)) {
      return;
    }

    const instanceMatrices = renderable.instanceMatrices ?? [];
    for (let index = 0; index < instanceMatrices.length; ++index) {
      const values = instanceMatrices[index];
      if (values?.length === 16) {
        const matrix = new Matrix4();
        matrix.set(...(values as Parameters<typeof matrix.set>));
        matrix.transpose();
        mesh.setMatrixAt(index, matrix);
      } else {
        mesh.setMatrixAt(index, IDENTITY_MATRIX);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }

  private updateMeshMaterials(
    mesh: Mesh,
    renderable: RenderableMesh,
    textureLoads?: Promise<void>[]
  ): void {
    const materialSources = renderable.materialSubsets?.length
      ? getUniqueSubsetMaterials(renderable)
      : [renderable.material];
    const currentIsArray = Array.isArray(mesh.material);
    const nextIsArray = !!renderable.materialSubsets?.length;
    const nextHasMaterialX = renderableHasMaterialX(renderable);
    const currentHasMaterialX = this.meshHasMaterialXMaterial(mesh);
    const nextMaterialKey = getRenderableMaterialKey(renderable, this.materialXFlipV);
    // Build fresh materials only when the key or shape changed. Building them
    // unconditionally re-parsed MaterialX on every update and leaked the
    // discarded (undisposed) materials.
    if (currentIsArray !== nextIsArray ||
        currentHasMaterialX !== nextHasMaterialX ||
        mesh.userData.materialKey !== nextMaterialKey ||
        (nextIsArray && (mesh.material as Material[]).length !== materialSources.length)) {
      const nextMaterials = this.createRenderableMaterials(renderable);
      this.disposeMeshMaterials(mesh);
      mesh.material = nextMaterials;
      mesh.userData.materialKey = nextMaterialKey;
    }

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    for (let index = 0; index < materials.length; ++index) {
      const material = materials[index];
      if (material instanceof MeshPhysicalMaterial) {
        this.updateMaterialProperties(material, renderable, materialSources[index]);
        this.applyMaterialTextures(material, materialSources[index], textureLoads);
      }
    }
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
  }

  private createMaterialForRenderable(
    renderable: RenderableMesh,
    rmat = renderable.material
  ): Material {
    const materialXMaterial = this.createMaterialXMaterial(rmat);
    return materialXMaterial ?? this.createMaterial(renderable, rmat);
  }

  private createMaterialXMaterial(rmat?: RenderableMaterial): Material | null {
    const materialX = rmat?.materialX;
    if (!materialX) {
      return null;
    }
    if (!materialX.data?.length) {
      return null;
    }
    if (!this.isWebGpuRenderer()) {
      console.warn("[USD WebView] Skipping MaterialX material because WebGPU renderer is unavailable", {
        path: materialX.path,
        materialName: materialX.materialName,
      });
      return null;
    }

    try {
      const materialXText = TEXT_DECODER.decode(materialX.data);
      const result = this.materialXLoader.parse(materialXText, {
        materialName: materialX.materialName,
        archiveResolver: (uri: string) => this.resolveMaterialXResource(uri, materialX.path, materialX.resources ?? []),
        path: materialX.path,
        uvSpace: "bottom-left",
        issuePolicy: "warn",
      });
      materialX.report = result.report;
      const material = materialX.materialName
        ? result.materials[materialX.materialName]
        : Object.values(result.materials)[0];
      if (!material) {
        console.warn("[USD WebView] MaterialX loader did not produce a usable material", {
          path: materialX.path,
          materialName: materialX.materialName,
          availableMaterials: Object.keys(result.materials),
          report: result.report,
        });
        return null;
      }
      material.side = DoubleSide;
      material.userData.webviewMaterialX = true;
      this.experimentalMaterialXMode = true;
      return material;
    } catch (error) {
      console.warn("[USD WebView] Failed to create MaterialX material", {
        path: materialX.path,
        materialName: materialX.materialName,
        error,
      });
      return null;
    }
  }

  private meshHasMaterialXMaterial(mesh: Mesh): boolean {
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    return materials.some((material) => material.userData.webviewMaterialX === true);
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
  // Preserves UVs, normals/tangents re-computed from the original indexed topology.
  // Falls back to full rebuild only when vertex count changes (topology shift).
  private updateGeometryPositions(geo: BufferGeometry, renderable: RenderableMesh): void {
    const pos = faceExpandAttr(renderable.points as number[], renderable.indices as number[], 3);
    const posAttr = geo.attributes.position;
    if (posAttr && posAttr.count * 3 === pos.length) {
      // Same vertex count — update in place, keep UVs untouched
      (posAttr.array as Float32Array).set(pos);
      posAttr.needsUpdate = true;
      this.setExpandedVertexNormals(geo, renderable.points, renderable.indices);
      this.setExpandedVertexTangents(geo, renderable);
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

  private buildGeometry(renderable: RenderableMesh): BufferGeometry {
    const { points, indices, uvs } = renderable;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(faceExpandAttr(points, indices, 3), 3));
    if (uvs?.length) {
      const uvAttr = new Float32BufferAttribute(faceExpandAttr(uvs, indices, 2), 2);
      applyMaterialXUvOptions(uvAttr, renderable, this.materialXFlipV);
      geo.setAttribute("uv", uvAttr);
      geo.setAttribute("uv1", uvAttr.clone());
    }
    if (renderable.materialSubsets?.length) {
      this.applyGeometryGroups(geo, renderable);
    }
    this.setExpandedVertexNormals(geo, points, indices);
    this.setExpandedVertexTangents(geo, renderable);
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
      const key = getSubsetMaterialKey(subset.material, subset.path);
      if (!slots.has(key)) {
        slots.set(key, slots.size);
      }
      geo.addGroup(subset.start, subset.count, slots.get(key) ?? 0);
    }
  }

  private setExpandedVertexNormals(
    geo: BufferGeometry,
    points: ArrayLike<number>,
    indices: ArrayLike<number>
  ): void {
    const normals = buildIndexedVertexNormals(points, indices);
    geo.setAttribute("normal", new Float32BufferAttribute(faceExpandAttr(normals, indices, 3), 3));
    geo.attributes.normal.needsUpdate = true;
  }

  private setExpandedVertexTangents(
    geo: BufferGeometry,
    renderable: RenderableMesh
  ): void {
    const tangentAttribute = this.buildExpandedVertexTangents(renderable);
    if (tangentAttribute) {
      geo.setAttribute("tangent", tangentAttribute);
      geo.attributes.tangent.needsUpdate = true;
      return;
    }

    if (geo.getAttribute("tangent")) {
      geo.deleteAttribute("tangent");
    }
  }

  private buildExpandedVertexTangents(renderable: RenderableMesh): Float32BufferAttribute | null {
    const { points, indices, uvs } = renderable;
    if (!uvs?.length) {
      this.warnIfMaterialXNeedsTangents(renderable, "MaterialX tangent generation skipped because the mesh has no UVs.");
      return null;
    }

    const indexedGeometry = new BufferGeometry();
    try {
      indexedGeometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(points), 3));

      const uvAttribute = new Float32BufferAttribute(new Float32Array(uvs), 2);
      applyMaterialXUvOptions(uvAttribute, renderable, this.materialXFlipV);
      indexedGeometry.setAttribute("uv", uvAttribute);
      indexedGeometry.setAttribute("normal", new Float32BufferAttribute(buildIndexedVertexNormals(points, indices), 3));
      indexedGeometry.setIndex(Array.from(indices, (value) => Number(value)));
      indexedGeometry.computeTangents();

      const tangent = indexedGeometry.getAttribute("tangent");
      if (!tangent) {
        this.warnIfMaterialXNeedsTangents(renderable, "MaterialX tangent generation finished without producing a tangent attribute.");
        return null;
      }

      return new Float32BufferAttribute(faceExpandAttr(tangent.array as ArrayLike<number>, indices, 4), 4);
    } catch (error) {
      console.warn("[USD WebView] Failed to compute tangents for mesh geometry", {
        path: renderable.path,
        materialPaths: this.getRenderableMaterialXPathList(renderable),
        error,
      });
      this.warnIfMaterialXNeedsTangents(renderable, "MaterialX tangent generation failed for this mesh.");
      return null;
    } finally {
      indexedGeometry.dispose();
    }
  }

  private warnIfMaterialXNeedsTangents(renderable: RenderableMesh, detail: string): void {
    for (const materialX of this.getRenderableMaterialXEntries(renderable)) {
      if (!this.materialXMayNeedTangents(materialX)) {
        continue;
      }

      const key = `${renderable.path}:${materialX.path}:${materialX.materialName ?? ""}`;
      if (this.materialXTangentWarnings.has(key)) {
        continue;
      }
      this.materialXTangentWarnings.add(key);
      console.warn("[USD WebView] MaterialX material may render incorrectly without mesh tangents", {
        meshPath: renderable.path,
        materialXPath: materialX.path,
        materialName: materialX.materialName,
        detail,
      });
    }
  }

  private getRenderableMaterialXEntries(renderable: RenderableMesh): NonNullable<RenderableMaterial["materialX"]>[] {
    const entries: NonNullable<RenderableMaterial["materialX"]>[] = [];
    const seen = new Set<string>();
    const pushEntry = (materialX?: RenderableMaterial["materialX"]) => {
      if (!materialX) {
        return;
      }
      const key = `${materialX.path}:${materialX.materialName ?? ""}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      entries.push(materialX);
    };

    pushEntry(renderable.material?.materialX);
    for (const subset of renderable.materialSubsets ?? []) {
      pushEntry(subset.material?.materialX);
    }

    return entries;
  }

  private getRenderableMaterialXPathList(renderable: RenderableMesh): string[] {
    return this.getRenderableMaterialXEntries(renderable).map((materialX) => materialX.path);
  }

  private materialXMayNeedTangents(materialX: NonNullable<RenderableMaterial["materialX"]>): boolean {
    if (!materialX.data?.length) {
      return false;
    }

    const text = TEXT_DECODER.decode(materialX.data).toLowerCase();
    return (
      /(?:normalmap|gltf_normalmap|hextilednormalmap|<\s*bump\b|<\s*tangent\b|<\s*bitangent\b)/.test(text) ||
      /name\s*=\s*["'](?:normal|coat_normal|geometry_coat_normal|specular_anisotropy|specular_rotation|anisotropy_strength|anisotropy_rotation)["']/.test(text)
    );
  }

  private clearStage(): void {
    this.textureGeneration += 1;
    this.splatRenderer?.clear();
    this.meshByPath.clear();
    this.pathByMesh.clear();
    this.highlightedMeshes.clear();
    this.materialXTangentWarnings.clear();
    this.selectedInstance = null;
    this.clearSelectedInstanceOverlays();
    this.revokeTextureUrls();
    this.revokeMaterialXResourceUrls();
    this.experimentalMaterialXMode = false;
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
    this.splatRenderer?.setViewUpAxis(this.viewUpAxis);
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

    const previous = materialRecord[slot as string];
    const hasExpectedTexture =
      previous instanceof Texture &&
      previous.name === asset.path;

    if (userData[textureKey] === asset.path && hasExpectedTexture) {
      return Promise.resolve();
    }

    userData[textureKey] = asset.path;
    const generation = this.textureGeneration;

    return this.loadTextureAsset(asset).then((baseTexture) => {
      if (generation !== this.textureGeneration) {
        return;
      }
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
      const nextPrevious = materialRecord[slot as string];
      if (nextPrevious instanceof Texture && nextPrevious.userData.webviewManaged) {
        nextPrevious.dispose();
        this.managedTextures.delete(nextPrevious);
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
    const generation = this.textureGeneration;

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
          if (generation !== this.textureGeneration) {
            texture.dispose();
            resolve(null);
            return;
          }
          texture.name = asset.path;
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

  private resolveMaterialXResource(
    uri: string,
    materialXPath: string,
    resources: RenderableTexture[]
  ): string | null {
    const normalizedUri = normalizeAssetPath(uri);
    const basePath = normalizeAssetPath(materialXPath).split("/").slice(0, -1).join("/");
    const candidates = new Set([
      normalizedUri,
      basePath ? `${basePath}/${normalizedUri}` : normalizedUri,
      normalizedUri.split("/").pop() ?? normalizedUri,
    ]);

    const resource = resources.find((candidate) => {
      const path = normalizeAssetPath(candidate.path);
      const basename = path.split("/").pop() ?? path;
      return candidates.has(path) || candidates.has(basename);
    });
    if (!resource?.data?.length) {
      return null;
    }

    const cached = this.materialXResourceUrls.get(resource.path);
    if (cached) {
      return cached;
    }

    const url = createDataUrl(resource.data, resource.mimeType);
    this.materialXResourceUrls.set(resource.path, url);
    return url;
  }

  private revokeMaterialXResourceUrls(): void {
    for (const url of this.materialXResourceUrls.values()) {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    }
    this.materialXResourceUrls.clear();
  }

  private isExrTexture(asset: RenderableTexture): boolean {
    return asset.path.toLowerCase().endsWith(".exr") || asset.mimeType === "image/x-exr";
  }

  private loadHdriTexture(name: string, url: string): Promise<Texture> {
    if (name.toLowerCase().endsWith(".exr")) {
      return this.exrLoader.loadAsync(url);
    }
    return this.hdrLoader.loadAsync(url);
  }

  private applyHdriTexture(texture: Texture, name: string): void {
    texture.name = name;
    texture.mapping = EquirectangularReflectionMapping;
    texture.colorSpace = LinearSRGBColorSpace;
    texture.needsUpdate = true;

    this.disposeHdriTexture();
    this.hdriTexture = texture;
    this.scene.environment = texture;
    this.scene.background = this.hdriMapVisible ? texture : this.defaultBackground;
    this.applyHdriIntensity();
    this.setDefaultLightRigEnabled(false);
  }

  private setDefaultLightRigEnabled(enabled: boolean): void {
    this.ambientLight.intensity = enabled ? this.defaultAmbientIntensity : 0;
    this.hemisphereLight.intensity = enabled ? this.defaultHemisphereIntensity : 0;
  }

  private applyDefaultEnvironment(): void {
    this.scene.environment = this.defaultEnvironmentTarget.texture;
    this.scene.environmentIntensity = this.defaultEnvironmentIntensity;
    this.scene.backgroundIntensity = 1;
  }

  private applyHdriIntensity(): void {
    this.scene.environmentIntensity = this.hdriIntensity;
    this.scene.backgroundIntensity = this.hdriIntensity;
  }

  private disposeHdriTexture(): void {
    if (!this.hdriTexture) {
      return;
    }
    if (this.scene.environment === this.hdriTexture) {
      this.scene.environment = null;
    }
    if (this.scene.background === this.hdriTexture) {
      this.scene.background = this.defaultBackground;
    }
    this.hdriTexture.dispose();
    this.hdriTexture = null;
  }

  private disposeMaterialTextures(material: Material): void {
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
      ? mesh.material
      : [mesh.material];
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
    this.selectedInstance = null;
    const rect = this.host.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.stageRoot.children, true);
    for (const hit of hits) {
      if (hit.object instanceof Mesh) {
        const meshPath = this.pathByMesh.get(hit.object);
        if (!meshPath) continue;
        const ownerPath = hit.object.userData.instanceOwnerPath as string | undefined;
        const path = ownerPath ?? meshPath;
        this.selectedInstance = {
          path,
          instanceId: hit.object instanceof InstancedMesh && typeof hit.instanceId === "number"
            ? hit.instanceId
            : null,
        };
        if (path) return path;
      }
    }
    return null;
  }

  setSelectedPrim(primPath: string | null): void {
    if (!primPath || this.selectedInstance?.path !== primPath) {
      this.selectedInstance = null;
    }
    this.clearSelectedInstanceOverlays();
    for (const mesh of this.highlightedMeshes) {
      this.clearHighlight(mesh);
    }
    this.highlightedMeshes.clear();
    if (!primPath) return;
    const prefix = primPath + "/";
    for (const [path, mesh] of this.meshByPath) {
      if (path === primPath || path.startsWith(prefix)) {
        if (mesh instanceof InstancedMesh && mesh.userData.instanceOwnerPath === primPath) {
          this.addSelectedInstanceOverlay(mesh, primPath);
        } else {
          this.applyHighlight(mesh);
          this.highlightedMeshes.add(mesh);
        }
      }
    }
  }

  private addSelectedInstanceOverlay(mesh: InstancedMesh, primPath: string): void {
    const selected = this.selectedInstance;
    if (!selected || selected.path !== primPath || selected.instanceId === null) {
      return;
    }

    const overlay = new Mesh(
      mesh.geometry,
      new MeshBasicMaterial({
        color: 0xffb347,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    const instanceMatrix = new Matrix4();
    mesh.getMatrixAt(selected.instanceId, instanceMatrix);
    overlay.matrix.copy(mesh.matrix).multiply(instanceMatrix);
    overlay.matrixAutoUpdate = false;
    this.scene.add(overlay);
    this.selectedInstanceOverlays.push(overlay);
  }

  private clearSelectedInstanceOverlays(): void {
    for (const overlay of this.selectedInstanceOverlays) {
      this.scene.remove(overlay);
      const materials = Array.isArray(overlay.material)
        ? overlay.material
        : [overlay.material];
      for (const material of materials) {
        material.dispose();
      }
    }
    this.selectedInstanceOverlays = [];
  }

  private applyHighlight(mesh: Mesh): void {
    const materials = this.getEmissiveMaterials(mesh);
    if (!materials.length) return;
    if (!mesh.userData.selEmissive) {
      mesh.userData.selEmissive = materials.map((mat) => mat.emissive.clone());
    }
    for (const mat of materials) {
      mat.emissive.set(0x3d1a00); // warm amber, visible on most materials
      mat.needsUpdate = true;
    }
  }

  private clearHighlight(mesh: Mesh): void {
    const materials = this.getEmissiveMaterials(mesh);
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

  private getEmissiveMaterials(mesh: Mesh): Array<Material & { emissive: Color; needsUpdate: boolean }> {
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    return materials.filter((mat): mat is Material & { emissive: Color; needsUpdate: boolean } => {
      return "emissive" in mat && mat.emissive instanceof Color;
    });
  }

  framePrim(primPath: string): void {
    const instanceBox = this.getSelectedInstanceBox(primPath);
    if (instanceBox) {
      this.animateToBox(instanceBox, true);
      return;
    }
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

  private getSelectedInstanceBox(primPath: string): Box3 | null {
    const selected = this.selectedInstance;
    if (!selected || selected.path !== primPath || selected.instanceId === null) {
      return null;
    }

    const box = new Box3();
    for (const mesh of this.meshByPath.values()) {
      if (!(mesh instanceof InstancedMesh) || mesh.userData.instanceOwnerPath !== primPath) {
        continue;
      }
      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
      }
      const bounds = mesh.geometry.boundingBox;
      if (!bounds) {
        return null;
      }
      const instanceMatrix = new Matrix4();
      mesh.getMatrixAt(selected.instanceId, instanceMatrix);
      const worldMatrix = new Matrix4().multiplyMatrices(mesh.matrixWorld, instanceMatrix);
      box.union(bounds.clone().applyMatrix4(worldMatrix));
    }

    return box.isEmpty() ? null : box;
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

function normalizeAssetPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function createDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}
