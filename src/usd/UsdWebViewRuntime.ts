import type {
  UsdWebViewBindings,
  HydraSyncDriver,
  ReferenceHydraDriver,
  PrimAttribute,
  PrimTransform,
  RenderableGaussianSplat,
  RenderableMesh,
  RenderableTexture,
  RuntimeStatus,
  SceneGraphPrim,
  StageLoadRequest,
  StageLoadResult,
  StageSummary,
} from "./types";

import { WASM_BUILD_NAME } from "./generated/buildId";

const RUNTIME_ENTRYPOINT = `/usd-webview-bindings/usdWebViewBindings.js?v=${WASM_BUILD_NAME}`;
const RUNTIME_ASSET_ROOT = "/usd-webview-bindings/";

export class UsdWebViewRuntime {
  private bindings: UsdWebViewBindings | null = null;
  private hydraSyncDriver: HydraSyncDriver | null = null;
  private referenceHydraDriver: ReferenceHydraDriver | null = null;
  private materialXResources: RenderableTexture[] = [];
  private useHydraSyncDriver = true;
  currentStagePath: string | null = null;

  status: RuntimeStatus = {
    state: "idle",
    source: RUNTIME_ENTRYPOINT,
    detail: "Not loaded",
  };

  async load(): Promise<RuntimeStatus> {
    this.status = {
      state: "loading",
      source: RUNTIME_ENTRYPOINT,
      detail: "Looking for USD Web View bindings",
    };

    try {
      await loadRuntimeEntrypoint(RUNTIME_ENTRYPOINT);

      if (!window.UsdWebViewBindings?.createRuntime) {
        this.status = {
          state: "unavailable",
          source: RUNTIME_ENTRYPOINT,
          detail:
            "Bindings entrypoint loaded, but window.UsdWebViewBindings.createRuntime was not registered",
        };
        return this.status;
      }

      this.bindings = await window.UsdWebViewBindings.createRuntime({
        locateFile: (path) => `${RUNTIME_ASSET_ROOT}${path}`,
      });
      await this.bindings.ready;

      this.status = {
        state: "ready",
        source: RUNTIME_ENTRYPOINT,
        detail: `USD Web View bindings ready (${WASM_BUILD_NAME})`,
      };
      console.info(`[USD WebView] runtime ready on WASM build ${WASM_BUILD_NAME}`);
      return this.status;
    } catch (error) {
      this.status = {
        state: "unavailable",
        source: RUNTIME_ENTRYPOINT,
        detail: describeError(error),
      };
      return this.status;
    }
  }

  async loadStage(request: StageLoadRequest): Promise<StageLoadResult> {
    const rootFile = request.rootFile ?? request.files[0];

    if (!rootFile) {
      return { summary: null };
    }

    if (!this.bindings?.createDataFile || !this.bindings.openStage) {
      return {
        summary: {
          rootFile: rootFile.webkitRelativePath || rootFile.name,
        },
      };
    }

    this.referenceHydraDriver?.delete?.();
    this.referenceHydraDriver = null;
    this.hydraSyncDriver?.delete?.();
    this.hydraSyncDriver = null;

    const materialXResources: RenderableTexture[] = [];
    for (const file of request.files) {
      const path = file.webkitRelativePath || file.name;
      const data = new Uint8Array(await file.arrayBuffer());
      this.bindings.createDataFile(path, data);
      if (isMaterialXResourcePath(path)) {
        materialXResources.push({
          path,
          mimeType: mimeTypeForPath(path),
          data,
        });
      }
    }
    this.materialXResources = materialXResources;

    const rootPath = rootFile.webkitRelativePath || rootFile.name;
    const summary = await this.bindings.openStage(rootPath, request.loadAllPayloads ?? true);
    const normalizedSummary = normalizeStageSummary(rootPath, summary);

    if (normalizedSummary.error) {
      return { summary: normalizedSummary, renderables: [] };
    }

    const gaussianSplats = this.bindings.extractGaussianSplats?.(rootPath) ?? [];
    this.currentStagePath = rootPath;
    const startTime = normalizedSummary.startTimeCode ?? 0;
    const endTime = normalizedSummary.endTimeCode ?? startTime;
    const hasAnimationRange = Number.isFinite(startTime) && endTime > startTime;

    if (
      hasAnimationRange &&
      request.referenceHydraRenderInterface &&
      this.bindings.createReferenceHydraDriver
    ) {
      this.referenceHydraDriver = this.bindings.createReferenceHydraDriver(
        rootPath,
        request.referenceHydraRenderInterface
      );
      if (this.referenceHydraDriver) {
        this.referenceHydraDriver.SetTime(startTime);
        this.referenceHydraDriver.Draw();
        return {
          summary: normalizedSummary,
          renderables: [],
          gaussianSplats,
          usedReferenceHydraDriver: true,
        };
      }
      console.warn("[USD WebView] reference hydra load path unavailable; falling back");
    }

    this.hydraSyncDriver = this.bindings.createHydraSyncDriver?.(rootPath) ?? null;
    const hydraRenderables = this.extractHydraRenderablesAtTime(startTime);

    // Use Hydra for initial geometry — same path as animation frames, avoids
    // the legacy extractor which produces wrong topology for complex assets.
    // Fall back to legacy only if Hydra gives nothing (e.g. no Hydra support).
    let renderables = hydraRenderables;
    if (renderables.length === 0) {
      renderables = this.withMaterialXResources(this.bindings.extractRenderables?.(rootPath) ?? []);
    }

    return { summary: normalizedSummary, renderables, gaussianSplats };
  }

  extractTransformsAtTime(timeCode: number): PrimTransform[] {
    if (!this.bindings?.extractTransformsAtTime || !this.currentStagePath) {
      return [];
    }
    return this.bindings.extractTransformsAtTime(this.currentStagePath, timeCode);
  }

  extractRenderablesAtTime(timeCode: number): RenderableMesh[] {
    if (!this.bindings?.extractRenderablesAtTime || !this.currentStagePath) {
      return [];
    }
    return this.withMaterialXResources(this.bindings.extractRenderablesAtTime(this.currentStagePath, timeCode));
  }

  extractHydraRenderablesAtTime(timeCode: number): RenderableMesh[] {
    if (this.referenceHydraDriver) {
      this.referenceHydraDriver.SetTime(timeCode);
      this.referenceHydraDriver.Draw();
      return [];
    }
    if (this.useHydraSyncDriver && this.hydraSyncDriver) {
      this.hydraSyncDriver.SetTime(timeCode);
      return this.withMaterialXResources(this.hydraSyncDriver.Draw());
    }
    if (!this.bindings?.extractHydraRenderablesAtTime || !this.currentStagePath) {
      return [];
    }
    return this.withMaterialXResources(this.bindings.extractHydraRenderablesAtTime(this.currentStagePath, timeCode));
  }

  extractHydraRenderableSnapshotAtTime(timeCode: number): RenderableMesh[] | null {
    if (!this.bindings?.extractHydraRenderableSnapshotAtTime || !this.currentStagePath) {
      return null;
    }
    const renderables = this.bindings.extractHydraRenderableSnapshotAtTime(this.currentStagePath, timeCode);
    return renderables ? this.withMaterialXResources(renderables) : null;
  }

  extractHydraRenderableSubtreeAtTime(primPath: string, timeCode: number): RenderableMesh[] | null {
    if (!this.bindings?.extractHydraRenderableSubtreeAtTime || !this.currentStagePath) {
      return null;
    }
    const renderables = this.bindings.extractHydraRenderableSubtreeAtTime(this.currentStagePath, primPath, timeCode);
    return renderables ? this.withMaterialXResources(renderables) : null;
  }

  getStageTiming(): { start: number; end: number; fps: number } | null {
    if (this.referenceHydraDriver) {
      const start = this.referenceHydraDriver.GetStartTimeCode?.() ?? 0;
      const end = this.referenceHydraDriver.GetEndTimeCode?.() ?? 0;
      const fps = this.referenceHydraDriver.GetTimeCodesPerSecond?.() ?? 24;
      return { start, end, fps };
    }
    if (!this.hydraSyncDriver) return null;
    const start = this.hydraSyncDriver.GetStartTimeCode?.() ?? 0;
    const end = this.hydraSyncDriver.GetEndTimeCode?.() ?? 0;
    const fps = this.hydraSyncDriver.GetTimeCodesPerSecond?.() ?? 24;
    return { start, end, fps };
  }

  setHydraSyncDriverEnabled(enabled: boolean): void {
    this.useHydraSyncDriver = enabled;
  }

  resetHydraDrivers(): void {
    this.referenceHydraDriver?.delete?.();
    this.referenceHydraDriver = null;
    this.hydraSyncDriver?.delete?.();
    this.hydraSyncDriver = null;
    if (this.currentStagePath) {
      this.hydraSyncDriver = this.bindings?.createHydraSyncDriver?.(this.currentStagePath) ?? null;
    }
  }

  getSceneGraph(): SceneGraphPrim[] {
    if (!this.bindings?.getSceneGraph || !this.currentStagePath) return [];
    return this.bindings.getSceneGraph(this.currentStagePath);
  }

  getPrimAttributes(primPath: string): PrimAttribute[] {
    if (!this.bindings?.getPrimAttributes || !this.currentStagePath) return [];
    return this.bindings.getPrimAttributes(this.currentStagePath, primPath);
  }

  getSkelDebugInfo(primPath: string, timeA = 0, timeB = 60): unknown {
    if (!this.bindings?.getSkelDebugInfo || !this.currentStagePath) {
      return null;
    }
    return this.bindings.getSkelDebugInfo(this.currentStagePath, primPath, timeA, timeB);
  }

  getLastSkelBindingOverlayContents(): string {
    if (!this.bindings?.getLastSkelBindingOverlayContents || !this.currentStagePath) {
      return "";
    }
    return this.bindings.getLastSkelBindingOverlayContents(this.currentStagePath);
  }

  extractRenderables(): RenderableMesh[] {
    if (!this.bindings?.extractRenderables || !this.currentStagePath) return [];
    return this.withMaterialXResources(this.bindings.extractRenderables(this.currentStagePath));
  }

  extractRenderablesWithMaterials(): RenderableMesh[] {
    if (!this.bindings?.extractRenderablesWithMaterials || !this.currentStagePath) return [];
    return this.withMaterialXResources(this.bindings.extractRenderablesWithMaterials(this.currentStagePath));
  }

  extractRenderablesWithMaterialsUnderRoot(primPath: string): RenderableMesh[] {
    if (!this.bindings?.extractRenderablesWithMaterialsUnderRoot || !this.currentStagePath) {
      return this.extractRenderablesWithMaterials();
    }
    return this.withMaterialXResources(
      this.bindings.extractRenderablesWithMaterialsUnderRoot(this.currentStagePath, primPath)
    );
  }

  extractGaussianSplats(): RenderableGaussianSplat[] {
    if (!this.bindings?.extractGaussianSplats || !this.currentStagePath) return [];
    return this.bindings.extractGaussianSplats(this.currentStagePath);
  }

  setVariantSelection(primPath: string, variantSetName: string, selection: string): boolean {
    if (!this.bindings?.setVariantSelection || !this.currentStagePath) return false;
    return this.bindings.setVariantSelection(this.currentStagePath, primPath, variantSetName, selection);
  }

  setPayloadLoaded(primPath: string, loaded: boolean): boolean {
    if (!this.bindings?.setPayloadLoaded || !this.currentStagePath) return false;
    return this.bindings.setPayloadLoaded(this.currentStagePath, primPath, loaded);
  }

  setAllPayloadsLoaded(loaded: boolean): void {
    if (!this.bindings?.setAllPayloadsLoaded || !this.currentStagePath) return;
    this.bindings.setAllPayloadsLoaded(this.currentStagePath, loaded);
  }

  private withMaterialXResources(renderables: RenderableMesh[] | null | undefined): RenderableMesh[] {
    if (!renderables?.length || !this.materialXResources.length) {
      return renderables ?? [];
    }

    for (const renderable of renderables) {
      attachMaterialXResources(renderable.material, this.materialXResources);
      for (const subset of renderable.materialSubsets ?? []) {
        attachMaterialXResources(subset.material, this.materialXResources);
      }
    }
    return renderables;
  }
}

export function attachMaterialXResources(
  material: RenderableMesh["material"],
  resources: RenderableTexture[]
): void {
  if (!material?.materialX) {
    return;
  }
  material.materialX.resources = resources;
}

export function isMaterialXResourcePath(path: string): boolean {
  return /\.(png|jpe?g|webp|svg)$/i.test(path);
}

export function mimeTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".hdr")) return "image/vnd.radiance";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function loadRuntimeEntrypoint(source: string): Promise<void> {
  const existingScript = document.querySelector<HTMLScriptElement>(
    `script[data-usd-webview-runtime="${source}"]`
  );

  if (existingScript?.dataset.loaded === "true") {
    return Promise.resolve();
  }

  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error(`Failed to load ${source}`)),
        {
          once: true,
        }
      );
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = source;
    script.dataset.usdWebviewRuntime = source;

    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${source}`)),
      {
        once: true,
      }
    );

    document.head.append(script);
  });
}

export function normalizeStageSummary(
  rootFile: string,
  summary: StageSummary | null
): StageSummary {
  return {
    rootFile,
    ...summary,
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
