import type {
  UsdWebViewBindings,
  RuntimeStatus,
  StageLoadRequest,
  StageLoadResult,
  StageSummary
} from "./types";

const RUNTIME_ENTRYPOINT = "/usd-webview-bindings/usdWebViewBindings.js";
const RUNTIME_ASSET_ROOT = "/usd-webview-bindings/";

export class UsdWebViewRuntime {
  private bindings: UsdWebViewBindings | null = null;

  status: RuntimeStatus = {
    state: "idle",
    source: RUNTIME_ENTRYPOINT,
    detail: "Not loaded"
  };

  async load(): Promise<RuntimeStatus> {
    this.status = {
      state: "loading",
      source: RUNTIME_ENTRYPOINT,
      detail: "Looking for USD Web View bindings"
    };

    try {
      await loadRuntimeEntrypoint(RUNTIME_ENTRYPOINT);

      if (!window.UsdWebViewBindings?.createRuntime) {
        this.status = {
          state: "unavailable",
          source: RUNTIME_ENTRYPOINT,
          detail: "Bindings entrypoint loaded, but window.UsdWebViewBindings.createRuntime was not registered"
        };
        return this.status;
      }

      this.bindings = await window.UsdWebViewBindings.createRuntime({
        locateFile: (path) => `${RUNTIME_ASSET_ROOT}${path}`
      });
      await this.bindings.ready;

      this.status = {
        state: "ready",
        source: RUNTIME_ENTRYPOINT,
        detail: "USD Web View bindings ready"
      };
      return this.status;
    } catch (error) {
      this.status = {
        state: "unavailable",
        source: RUNTIME_ENTRYPOINT,
        detail: describeError(error)
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
          rootFile: rootFile.webkitRelativePath || rootFile.name
        }
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
    return {
      summary: normalizedSummary,
      renderables: normalizedSummary.error ? [] : this.bindings.extractRenderables?.(rootPath) ?? []
    };
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
      existingScript.addEventListener("error", () => reject(new Error(`Failed to load ${source}`)), {
        once: true
      });
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
    script.addEventListener("error", () => reject(new Error(`Failed to load ${source}`)), {
      once: true
    });

    document.head.append(script);
  });
}

function normalizeStageSummary(rootFile: string, summary: StageSummary | null): StageSummary {
  return {
    rootFile,
    ...summary
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
