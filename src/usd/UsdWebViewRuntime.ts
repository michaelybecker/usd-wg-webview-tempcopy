import type {
  UsdWebViewBindings,
  HydraSyncDriver,
  PrimAttribute,
  PrimTransform,
  RenderableGaussianSplat,
  RenderableMesh,
  RuntimeStatus,
  SceneGraphPrim,
  StageLoadRequest,
  StageLoadResult,
  StageSummary,
} from "./types";

const RUNTIME_ENTRYPOINT = "/usd-webview-bindings/usdWebViewBindings.js";
const RUNTIME_ASSET_ROOT = "/usd-webview-bindings/";

export class UsdWebViewRuntime {
  private bindings: UsdWebViewBindings | null = null;
  private hydraSyncDriver: HydraSyncDriver | null = null;
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
        detail: "USD Web View bindings ready",
      };
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

    for (const file of request.files) {
      const path = file.webkitRelativePath || file.name;
      const data = new Uint8Array(await file.arrayBuffer());
      this.bindings.createDataFile(path, data);
    }

    const rootPath = rootFile.webkitRelativePath || rootFile.name;
    const summary = await this.bindings.openStage(rootPath);
    const normalizedSummary = normalizeStageSummary(rootPath, summary);
    this.hydraSyncDriver?.delete?.();
    this.hydraSyncDriver = null;

    if (normalizedSummary.error) {
      return { summary: normalizedSummary, renderables: [] };
    }

    const gaussianSplats = this.bindings.extractGaussianSplats?.(rootPath) ?? [];
    this.currentStagePath = rootPath;
    this.hydraSyncDriver = this.bindings.createHydraSyncDriver?.(rootPath) ?? null;

    // Use Hydra for initial geometry — same path as animation frames, avoids
    // the legacy extractor which produces wrong topology for complex assets.
    // Fall back to legacy only if Hydra gives nothing (e.g. no Hydra support).
    let renderables = this.extractHydraRenderablesAtTime(normalizedSummary.startTimeCode ?? 0);
    if (renderables.length === 0) {
      renderables = this.bindings.extractRenderables?.(rootPath) ?? [];
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
    return this.bindings.extractRenderablesAtTime(this.currentStagePath, timeCode);
  }

  extractHydraRenderablesAtTime(timeCode: number): RenderableMesh[] {
    if (this.useHydraSyncDriver && this.hydraSyncDriver) {
      this.hydraSyncDriver.SetTime(timeCode);
      return this.hydraSyncDriver.Draw();
    }
    if (!this.bindings?.extractHydraRenderablesAtTime || !this.currentStagePath) {
      return [];
    }
    return this.bindings.extractHydraRenderablesAtTime(this.currentStagePath, timeCode);
  }

  getStageTiming(): { start: number; end: number; fps: number } | null {
    if (!this.hydraSyncDriver) return null;
    const start = this.hydraSyncDriver.GetStartTimeCode?.() ?? 0;
    const end = this.hydraSyncDriver.GetEndTimeCode?.() ?? 0;
    const fps = this.hydraSyncDriver.GetTimeCodesPerSecond?.() ?? 24;
    return { start, end, fps };
  }

  setHydraSyncDriverEnabled(enabled: boolean): void {
    this.useHydraSyncDriver = enabled;
  }

  getSceneGraph(): SceneGraphPrim[] {
    if (!this.bindings?.getSceneGraph || !this.currentStagePath) return [];
    return this.bindings.getSceneGraph(this.currentStagePath);
  }

  getPrimAttributes(primPath: string): PrimAttribute[] {
    if (!this.bindings?.getPrimAttributes || !this.currentStagePath) return [];
    return this.bindings.getPrimAttributes(this.currentStagePath, primPath);
  }

  extractRenderables(): RenderableMesh[] {
    if (!this.bindings?.extractRenderables || !this.currentStagePath) return [];
    return this.bindings.extractRenderables(this.currentStagePath);
  }

  extractRenderablesWithMaterials(): RenderableMesh[] {
    if (!this.bindings?.extractRenderablesWithMaterials || !this.currentStagePath) return [];
    return this.bindings.extractRenderablesWithMaterials(this.currentStagePath);
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

function normalizeStageSummary(
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
