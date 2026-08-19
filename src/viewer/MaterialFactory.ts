// Material creation and update for renderable meshes: MeshPhysicalMaterial
// mapping from UsdPreviewSurface data, MaterialX parsing through Three,
// material-key change detection, and MaterialX resource resolution.

import {
  Color,
  DoubleSide,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
} from "three";
import { MaterialXLoader } from "three/examples/jsm/loaders/MaterialXLoader.js";
import type { RenderableMaterial, RenderableMesh } from "../usd/types";
import { MaterialXAssetResolver } from "../materialx/MaterialXAssetResolver";
import {
  getRenderableMaterialKey,
  getRenderableMaterialXEntries,
  getUniqueSubsetMaterials,
  renderableHasMaterialX,
} from "./GeometryBuilder";
import type { TextureCache } from "./TextureCache";
import { materialShouldUseTextureFallback, prepareMaterialXForThree } from "./materialXCompatibility";

const TEXT_DECODER = new TextDecoder();
export type MaterialXDebugOutputMode = "none" | "graphColor";

export class MaterialFactory {
  readonly materialXLoader = new MaterialXLoader();
  private readonly materialXResolver = new MaterialXAssetResolver();
  private readonly materialXMaterials = new Map<string, Material | null>();
  private readonly materialXTangentWarnings = new Set<string>();
  private experimentalMaterialXMode = false;

  constructor(
    private readonly textures: TextureCache,
    private readonly isWebGpuRenderer: () => boolean
  ) {}

  isExperimentalMaterialXMode(): boolean {
    return this.experimentalMaterialXMode;
  }

  // Reset per-stage state (warnings, resource URLs, MaterialX mode flag).
  clearStageState(): void {
    this.materialXTangentWarnings.clear();
    this.materialXMaterials.clear();
    this.materialXResolver.revokeUrls();
    this.experimentalMaterialXMode = false;
  }

  dispose(): void {
    this.materialXLoader.dispose();
    this.materialXResolver.revokeUrls();
  }

  setMaterialXDebugOutputMode(_mode: MaterialXDebugOutputMode): boolean {
    return false;
  }

  async prepareMaterialXMaterials(renderables: RenderableMesh[]): Promise<void> {
    const entries = renderables.flatMap((renderable) => getRenderableMaterialXEntries(renderable));
    for (const materialX of entries) {
      const key = materialXCacheKey(materialX.path, materialX.materialName);
      if (this.materialXMaterials.has(key)) continue;
      try {
        this.materialXMaterials.set(key, this.createThreeMaterialXMaterial(materialX));
      } catch (error) {
        console.warn("[USD WebView] Failed to create Three MaterialX material", {
          path: materialX.path,
          materialName: materialX.materialName,
          error,
        });
        this.materialXMaterials.set(key, null);
      }
    }
  }

  createRenderableMaterials(renderable: RenderableMesh): Material | Material[] {
    if (renderable.materialSubsets?.length) {
      return getUniqueSubsetMaterials(renderable).map((material) =>
        this.createMaterialForRenderable(renderable, material)
      );
    }
    return this.createMaterialForRenderable(renderable, renderable.material);
  }

  updateMeshMaterials(
    mesh: Mesh,
    renderable: RenderableMesh,
    materialXFlipV: boolean,
    textureLoads?: Promise<void>[]
  ): void {
    const materialSources = renderable.materialSubsets?.length
      ? getUniqueSubsetMaterials(renderable)
      : [renderable.material];
    const currentIsArray = Array.isArray(mesh.material);
    const nextIsArray = !!renderable.materialSubsets?.length;
    const nextHasMaterialX = renderableHasMaterialX(renderable);
    const currentHasMaterialX = this.meshHasMaterialXMaterial(mesh);
    const nextMaterialKey = getRenderableMaterialKey(renderable, materialXFlipV);
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
      if (material instanceof MeshPhysicalMaterial && material.userData.webviewMaterialX !== true) {
        this.updateMaterialProperties(material, renderable, materialSources[index]);
        this.textures.applyMaterialTextures(material, materialSources[index], textureLoads);
      }
    }
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
  }

  disposeMeshMaterials(mesh: Mesh): void {
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      this.textures.disposeMaterialTextures(material);
      material.dispose();
    }
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

    if (materialShouldUseTextureFallback(rmat)) {
      return null;
    }
    const material = this.materialXMaterials.get(materialXCacheKey(materialX.path, materialX.materialName));
    if (material) {
      this.experimentalMaterialXMode = true;
      return material.clone();
    }
    return null;
  }

  private createThreeMaterialXMaterial(materialX: NonNullable<RenderableMaterial["materialX"]>): Material | null {
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

    const originalMaterialXText = TEXT_DECODER.decode(materialX.data);
    const materialXText = prepareMaterialXForThree(originalMaterialXText);
    const textureResolutions: Array<{
      uri: string;
      resourceCount: number;
      resolved: boolean;
      resolvedPath?: string;
      byteLength?: number;
      bytePrefix?: number[];
    }> = [];
    const result = this.materialXLoader.parse(materialXText, {
      materialName: materialX.materialName,
      archiveResolver: (uri: string) => {
        const resolved = this.materialXResolver.resolve(uri, materialX.path, materialX.resources ?? []);
        textureResolutions.push({
          uri,
          resourceCount: materialX.resources?.length ?? 0,
          resolved: !!resolved,
          resolvedPath: resolved?.path,
          byteLength: resolved?.data?.length,
          bytePrefix: resolved?.data ? Array.from(resolved.data.slice(0, 8)) : undefined,
        });
        return resolved?.url ?? null;
      },
      path: "",
      uvSpace: "top-left",
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

    material.userData.webviewMaterialX = true;
    material.userData.webviewMaterialXRuntime = "three";
    material.userData.webviewMaterialXHost = "three-materialx-loader";
    material.userData.webviewMaterialXTextureResolutions = textureResolutions;
    return material;
  }

  meshHasMaterialXMaterial(mesh: Mesh): boolean {
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    return materials.some((material) => material.userData.webviewMaterialX === true);
  }

  private createMaterial(
    renderable: RenderableMesh,
    rmat = renderable.material
  ): MeshPhysicalMaterial {
    const [r = 0.72, g = 0.72, b = 0.72] = rmat?.diffuseTexture
      ? [1, 1, 1]
      : rmat?.diffuseColor ?? renderable.color ?? [];
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

  updateMaterialProperties(
    material: MeshPhysicalMaterial,
    renderable: RenderableMesh,
    rmat = renderable.material
  ): void {
    const [r = 0.72, g = 0.72, b = 0.72] = rmat?.diffuseTexture
      ? [1, 1, 1]
      : rmat?.diffuseColor ?? renderable.color ?? [];
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

  private isTransparentMaterial(rmat?: RenderableMaterial): boolean {
    return (rmat?.opacity ?? 1) < 1 || !!rmat?.opacityTexture;
  }

  warnIfMaterialXNeedsTangents(renderable: RenderableMesh, detail: string): void {
    for (const materialX of getRenderableMaterialXEntries(renderable)) {
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
}

function materialXCacheKey(
  path: string,
  materialName?: string
): string {
  return `${path}:${materialName ?? ""}`;
}
