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
  Scene,
  SRGBColorSpace,
  LinearSRGBColorSpace,
  TextureLoader,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PrimTransform, RenderableMesh, RenderableTexture, StageSummary } from "../usd/types";

export class ThreeViewport {
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly stageRoot = new Group();
  private readonly textureLoader = new TextureLoader();
  private readonly textureUrls: string[] = [];
  private readonly meshByPath = new Map<string, Mesh>();
  private animationFrame = 0;
  private readonly resizeObserver: ResizeObserver;

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

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
  }

  start(onTick?: () => void): void {
    const render = () => {
      onTick?.();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.animationFrame = window.requestAnimationFrame(render);
    };

    render();
  }

  dispose(): void {
    window.cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
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
    this.frameStage();
  }

  renderStage(
    renderables: RenderableMesh[],
    summary: StageSummary | null
  ): void {
    if (!renderables.length) {
      this.setPlaceholderStage(summary?.rootFile ?? "USD stage");
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

      // Weld duplicate positions so computeVertexNormals can average across
      // shared vertices. Without this every triangle has unique indices and
      // the averaging has no effect, producing flat faceted shading.
      const geometry = mergeVertices(rawGeometry);
      rawGeometry.dispose();
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
      this.meshByPath.set(renderable.path, mesh);

      if (renderable.matrix.length === 16) {
        mesh.matrix.set(
          ...(renderable.matrix as Parameters<typeof mesh.matrix.set>)
        );
        mesh.matrix.transpose();
        mesh.matrixAutoUpdate = false;
      }

      this.stageRoot.add(mesh);
    }

    if (summary?.upAxis?.toLowerCase() === "z") {
      this.stageRoot.rotation.x = -Math.PI / 2;
    }

    this.frameStage();
  }

  updateTransforms(transforms: PrimTransform[]): void {
    for (const { path, matrix } of transforms) {
      const mesh = this.meshByPath.get(path);
      if (!mesh || matrix.length !== 16) continue;
      mesh.matrix.set(...(matrix as Parameters<typeof mesh.matrix.set>));
      mesh.matrix.transpose();
    }
  }

  private clearStage(): void {
    this.meshByPath.clear();
    this.revokeTextureUrls();
    this.stageRoot.rotation.set(0, 0, 0);
    this.stageRoot.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          material.dispose();
        }
      }
    });
    this.stageRoot.clear();
  }

  private applyTexture(
    material: MeshPhysicalMaterial,
    slot: keyof MeshPhysicalMaterial,
    asset: RenderableTexture | undefined,
    sRGB: boolean
  ): void {
    if (!asset?.data?.length) {
      return;
    }

    const bytes = new ArrayBuffer(asset.data.byteLength);
    new Uint8Array(bytes).set(asset.data);
    const blob = new Blob([bytes], { type: asset.mimeType });
    const url = URL.createObjectURL(blob);
    this.textureUrls.push(url);

    this.textureLoader.load(
      url,
      (texture: Texture) => {
        texture.name = asset.path;
        texture.colorSpace = sRGB ? SRGBColorSpace : LinearSRGBColorSpace;
        // When emissiveMap is applied, emissive must be non-black
        if (slot === "emissiveMap" && material.emissive.getHex() === 0x000000) {
          material.emissive.set(0xffffff);
        }
        (material as unknown as Record<string, unknown>)[slot as string] = texture;
        material.needsUpdate = true;
      },
      undefined,
      (error) => {
        console.warn(`Failed to load ${slot} for ${asset.path}`, error);
      }
    );
  }

  private revokeTextureUrls(): void {
    for (const url of this.textureUrls) {
      URL.revokeObjectURL(url);
    }
    this.textureUrls.length = 0;
  }

  private frameStage(): void {
    const box = new Box3().setFromObject(this.stageRoot);
    const size = new Vector3();
    const center = new Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxSize = Math.max(size.x, size.y, size.z, 1);
    const distance = maxSize * 3;
    this.controls.target.copy(center);
    this.camera.position
      .copy(center)
      .add(new Vector3(distance, distance * 0.65, distance));
    this.camera.near = Math.max(distance / 100, 0.01);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private resize(): void {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
