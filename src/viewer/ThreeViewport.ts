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
import type { PrimTransform, RenderableMesh, RenderableTexture, StageSummary } from "../usd/types";

interface FrameAnim {
  startPos: Vector3;
  startTarget: Vector3;
  endPos: Vector3;
  endTarget: Vector3;
  t: number; // 0 → 1
}

export class ThreeViewport {
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly stageRoot = new Group();
  private readonly textureLoader = new TextureLoader();
  private readonly textureUrls: string[] = [];
  private readonly meshByPath = new Map<string, Mesh>();
  private readonly pathByMesh = new Map<Mesh, string>();
  private readonly highlightedMeshes = new Set<Mesh>();
  private readonly raycaster = new Raycaster();
  private animationFrame = 0;
  private frameAnim: FrameAnim | null = null;
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
      mesh.userData.ptsLen  = renderable.points.length;
      mesh.userData.ptsHead = renderable.points[0];
      mesh.userData.ptsTail = renderable.points[renderable.points.length - 1];
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

    if (summary?.upAxis?.toLowerCase() === "z") {
      this.stageRoot.rotation.x = -Math.PI / 2;
    }

    this.frameStage();
  }

  updateRenderables(renderables: RenderableMesh[]): void {
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
        // Swap geometry only when the points actually changed.
        // Compare pre-merge length + first/last values as a O(1) fingerprint.
        const len = renderable.points.length;
        if (
          existing.userData.ptsLen  !== len ||
          existing.userData.ptsHead !== renderable.points[0] ||
          existing.userData.ptsTail !== renderable.points[len - 1]
        ) {
          const raw = new BufferGeometry();
          raw.setAttribute("position", new Float32BufferAttribute(renderable.points, 3));
          if (renderable.uvs?.length) {
            const uvAttr = new Float32BufferAttribute(renderable.uvs, 2);
            raw.setAttribute("uv", uvAttr);
            raw.setAttribute("uv1", uvAttr);
          }
          raw.setIndex(renderable.indices);
          const geometry = mergeVertices(raw);
          raw.dispose();
          geometry.computeVertexNormals();
          existing.geometry.dispose();
          existing.geometry = geometry;
          existing.userData.ptsLen  = len;
          existing.userData.ptsHead = renderable.points[0];
          existing.userData.ptsTail = renderable.points[len - 1];
        }

        // Material scalars are cheap to update unconditionally
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
        material.needsUpdate = true;

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
        const geometry = mergeVertices(raw);
        raw.dispose();
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
        this.applyTexture(material, "map",                    rmat?.diffuseTexture,            true);
        this.applyTexture(material, "roughnessMap",           rmat?.roughnessTexture,          false);
        this.applyTexture(material, "metalnessMap",           rmat?.metallicTexture,           false);
        this.applyTexture(material, "normalMap",              rmat?.normalTexture,             false);
        this.applyTexture(material, "aoMap",                  rmat?.occlusionTexture,          false);
        this.applyTexture(material, "emissiveMap",            rmat?.emissiveTexture,           true);
        this.applyTexture(material, "clearcoatMap",           rmat?.clearcoatTexture,          false);
        this.applyTexture(material, "clearcoatRoughnessMap",  rmat?.clearcoatRoughnessTexture, false);
        this.applyTexture(material, "alphaMap",               rmat?.opacityTexture,            false);

        const mesh = new Mesh(geometry, material);
        mesh.name = renderable.name || renderable.path;
        mesh.userData.ptsLen  = renderable.points.length;
        mesh.userData.ptsHead = renderable.points[0];
        mesh.userData.ptsTail = renderable.points[renderable.points.length - 1];
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
