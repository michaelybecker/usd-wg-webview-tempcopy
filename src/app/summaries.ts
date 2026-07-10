import type {
  RenderableGaussianSplat,
  RenderableMaterial,
  RenderableMesh,
  StageSummary,
} from "../usd/types";
import type { ViewUpAxis } from "../viewer/ThreeViewport";
import { state, type RendererStats } from "./appState";
import { rendererSummaryList, usdStageSummaryList } from "./dom";

export function renderStageSummary(summary: StageSummary | null): void {
  const viewerUpAxis = getEffectiveUpAxis(summary?.upAxis);
  if (!summary) {
    usdStageSummaryList.innerHTML = renderDefinitionList({
      file: "None",
      prims: "-",
      layers: "-",
      "mesh prims": "-",
      "authored points": "-",
      "authored faces": "-",
      materials: "-",
      "texture assets": "-",
      payloads: "-",
      variants: "-",
      instances: "-",
      "stage up": "-",
      "viewer up": formatUpAxis(viewerUpAxis),
    });
    renderRendererSummary(null);
    return;
  }

  usdStageSummaryList.innerHTML = renderDefinitionList({
    file: summary.rootFile,
    root: summary.rootLayerIdentifier ?? "-",
    prims: String(summary.primCount ?? "-"),
    layers: String(summary.layerCount ?? "-"),
    "mesh prims": formatCount(summary.meshPrimCount),
    "authored points": formatCount(summary.authoredPointCount),
    "authored faces": formatCount(summary.authoredFaceCount),
    materials: formatCount(summary.materialPrimCount),
    "material bindings": formatCount(summary.materialBindingCount),
    "texture assets": formatCount(summary.textureAssetCount),
    payloads: formatCount(summary.payloadPrimCount),
    variants: formatCount(summary.variantSetCount),
    instances: formatCount(summary.instancePrimCount),
    time: summary.timeCodesPerSecond
      ? `${summary.timeCodesPerSecond} fps`
      : "-",
    range:
      summary.startTimeCode !== undefined && summary.endTimeCode !== undefined
        ? `${summary.startTimeCode} - ${summary.endTimeCode}`
        : "-",
    "stage up": summary.upAxis ?? "-",
    "viewer up": formatUpAxis(viewerUpAxis),
    error: summary.error ?? "-",
  });
  renderRendererSummary(state.currentRendererStats);
}

export function renderRendererSummary(stats: RendererStats | null): void {
  rendererSummaryList.innerHTML = renderDefinitionList({
    "rendered meshes": stats ? formatCount(stats.meshes) : "-",
    "rendered vertices": stats ? formatCount(stats.vertices) : "-",
    "rendered triangles": stats ? formatCount(stats.triangles) : "-",
    "material bindings": stats ? formatCount(stats.materialBindings) : "-",
    "rendered materials": stats ? formatCount(stats.materials) : "-",
    "texture maps": stats ? formatCount(stats.textures) : "-",
    "gaussian splats": stats ? formatCount(stats.gaussianSplats) : "-",
    "splat points": stats ? formatCount(stats.splatPoints) : "-",
  });
}

export function collectRendererStats(
  renderables: RenderableMesh[],
  splats: RenderableGaussianSplat[]
): RendererStats {
  const materialKeys = new Set<string>();
  const textureKeys = new Set<string>();
  let materialBindings = 0;

  for (const renderable of renderables) {
    if (renderable.material) {
      addRenderableMaterialStats(renderable.material, renderable.path, materialKeys, textureKeys);
      materialBindings += 1;
    }
    for (const subset of renderable.materialSubsets ?? []) {
      addRenderableMaterialStats(subset.material, subset.path, materialKeys, textureKeys);
      materialBindings += 1;
    }
  }

  return {
    meshes: renderables.length,
    vertices: renderables.reduce((sum, renderable) => sum + Math.floor(renderable.points.length / 3), 0),
    triangles: renderables.reduce((sum, renderable) => sum + Math.floor(renderable.indices.length / 3), 0),
    materialBindings,
    materials: materialKeys.size,
    textures: textureKeys.size,
    gaussianSplats: splats.length,
    splatPoints: splats.reduce((sum, splat) => sum + splat.count, 0),
  };
}

function addRenderableMaterialStats(
  material: RenderableMaterial | undefined,
  fallbackKey: string,
  materialKeys: Set<string>,
  textureKeys: Set<string>
): void {
  if (!material) {
    return;
  }
  materialKeys.add(material.path ?? fallbackKey);
  for (const texture of [
    material.diffuseTexture,
    material.roughnessTexture,
    material.metallicTexture,
    material.normalTexture,
    material.occlusionTexture,
    material.emissiveTexture,
    material.clearcoatTexture,
    material.clearcoatRoughnessTexture,
    material.opacityTexture,
  ]) {
    if (texture?.path) {
      textureKeys.add(texture.path);
    }
  }
}

export function getEffectiveUpAxis(stageUpAxis?: string | null): ViewUpAxis {
  if (state.upAxisChoice !== "stage") {
    return state.upAxisChoice;
  }
  return normalizeUpAxis(stageUpAxis);
}

export function normalizeUpAxis(axis?: string | null): ViewUpAxis {
  return axis?.toLowerCase() === "z" ? "z" : "y";
}

export function formatUpAxis(axis: ViewUpAxis): string {
  return axis === "z" ? "Z Up" : "Y Up";
}

export function formatCount(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString();
}

export function assetLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function renderDefinitionList(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
    .join("");
}
