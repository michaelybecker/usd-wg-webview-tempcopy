import { collectDroppedFiles, pickLikelyRootFile } from "../usd/fileIntake";
import type { StageLoadResult } from "../usd/types";
import { runtime, state } from "./appState";
import { filePicker, folderPicker, playbarScrubber, viewportElement } from "./dom";
import {
  automationEnabled,
  getAutomationState,
  setAutomationState,
  waitForSettledFrames,
  waitForUiPaint,
  type AutomationManifest,
} from "./automation";
import { hidePlaybar, showPlaybar, updatePlaybarScrubber } from "./animation";
import { applyLightingOptions, applyUpAxisOptions, replaceViewport } from "./menus";
import { clearSceneGraph, renderSceneGraph } from "./sceneGraphPanel";
import { renderRuntimeStatus, setStatus } from "./statusBar";
import { assetLabel, collectRendererStats, renderStageSummary } from "./summaries";

export async function loadFiles(files: File[]): Promise<void> {
  if (!files.length) {
    return;
  }
  const loadSerial = ++state.stageLoadSerial;

  hidePlaybar();
  state.isLoadingStage = true;
  setStatus("loading USD stage...", true);
  if (automationEnabled) {
    setAutomationState("loading", "loading USD stage...");
  }
  await waitForUiPaint();
  if (loadSerial !== state.stageLoadSerial) {
    return;
  }
  clearSceneGraph();
  state.currentRendererStats = null;
  viewportElement.classList.remove("has-stage");

  const rootFile = pickLikelyRootFile(files);
  state.currentStageSummary = {
    rootFile: rootFile?.webkitRelativePath || rootFile?.name || "Unknown",
  };
  renderStageSummary(state.currentStageSummary);
  replaceViewport();

  let result: StageLoadResult;
  try {
    const referenceHydraRenderInterface = state.viewport.createReferenceHydraRenderInterface();
    result = await runtime.loadStage({
      files,
      rootFile,
      referenceHydraRenderInterface,
      loadAllPayloads: state.loadAllPayloadsOnStageOpen,
    });
  } catch (error) {
    if (loadSerial === state.stageLoadSerial) {
      state.isLoadingStage = false;
      setStatus(`Stage load failed: ${error instanceof Error ? error.message : String(error)}`, false);
      if (automationEnabled) {
        setAutomationState(
          "error",
          `Stage load failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    throw error;
  }
  if (loadSerial !== state.stageLoadSerial) {
    return;
  }

  state.currentStageSummary = result.summary;
  applyUpAxisOptions();
  renderRuntimeStatus(runtime.status);
  const gaussianSplats = result.gaussianSplats ?? [];
  let rendererStatsRenderables = result.renderables ?? [];
  if (!result.usedReferenceHydraDriver && rendererStatsRenderables.length > 0) {
    setStatus("loading materials...", true);
    await waitForUiPaint();
    if (loadSerial !== state.stageLoadSerial) {
      return;
    }
    const materializedRenderables = runtime.extractRenderablesWithMaterials();
    if (materializedRenderables.length > 0) {
      rendererStatsRenderables = materializedRenderables;
    }
  }
  await state.viewport.prepareForRenderables(rendererStatsRenderables);
  if (loadSerial !== state.stageLoadSerial) {
    return;
  }
  const environment = result.summary?.environment;
  if (environment) {
    state.hdriIntensity = environment.intensity ?? 1;
    state.hdriMapLabel = assetLabel(environment.texture.path);
    state.lightingMode = "hdri";
    try {
      await state.viewport.loadHdriAsset(environment.texture, state.hdriMapLabel);
    } catch (error) {
      state.lightingMode = "default";
      state.hdriMapLabel = null;
      state.viewport.useDefaultLighting();
      console.warn("Failed to load stage dome-light environment", {
        sourcePath: environment.sourcePath,
        texturePath: environment.texture.path,
        error,
      });
    }
    applyLightingOptions();
  }
  if (result.usedReferenceHydraDriver) {
    state.viewport.frameCurrentStage();
  } else {
    state.viewport.renderStage(rendererStatsRenderables, result.summary, gaussianSplats.length > 0);
  }
  state.viewport.renderGaussianSplats(gaussianSplats);
  state.currentRendererStats = collectRendererStats(rendererStatsRenderables, gaussianSplats);
  renderStageSummary(state.currentStageSummary);
  renderSceneGraph(runtime.getSceneGraph());
  viewportElement.classList.add("has-stage");

  if (result.summary) {
    const s = result.summary;
    const start = s.startTimeCode ?? 0;
    const end = s.endTimeCode ?? 0;
    if (end > start) {
      showPlaybar(s);
      // Override with authoritative driver timing if available
      const driverTiming = runtime.getStageTiming();
      if (driverTiming && driverTiming.end > driverTiming.start) {
        state.animStart = driverTiming.start;
        state.animEnd = driverTiming.end;
        state.animFps = driverTiming.fps;
        state.animCurrent = state.animStart;
        playbarScrubber.min = String(state.animStart);
        playbarScrubber.max = String(state.animEnd);
        updatePlaybarScrubber();
      }
    }
  }
  await waitForUiPaint();
  if (loadSerial !== state.stageLoadSerial) {
    return;
  }
  if (result.usedReferenceHydraDriver || rendererStatsRenderables.length > 0) {
    if (result.usedReferenceHydraDriver) {
      setStatus("loading materials...", true);
      await waitForUiPaint();
      if (loadSerial !== state.stageLoadSerial) {
        return;
      }
    }
    const materializedRenderables = result.usedReferenceHydraDriver
      ? runtime.extractRenderablesWithMaterials()
      : rendererStatsRenderables;
    if (materializedRenderables.length > 0) {
      setStatus("decoding textures...", true);
      await waitForUiPaint();
      if (loadSerial !== state.stageLoadSerial) {
        return;
      }
      await state.viewport.updateRenderablesAsync(materializedRenderables);
      if (loadSerial !== state.stageLoadSerial) {
        return;
      }
      rendererStatsRenderables = materializedRenderables;
      state.currentRendererStats = collectRendererStats(rendererStatsRenderables, gaussianSplats);
      renderStageSummary(state.currentStageSummary);
    }
  }
  if (loadSerial === state.stageLoadSerial) {
    state.isLoadingStage = false;
    const stageFailed = !!result.summary?.error;
    setStatus(stageFailed ? "Stage load failed" : "Ready", false);
    if (automationEnabled) {
      setAutomationState(
        stageFailed ? "error" : "ready",
        stageFailed ? result.summary?.error ?? "Stage load failed" : "Ready",
        rootFile?.webkitRelativePath || rootFile?.name || null
      );
    }
  }
}

export async function loadAutomationManifestStage(manifestUrl: string): Promise<void> {
  if (automationEnabled) {
    setAutomationState("loading", `fetching automation manifest ${manifestUrl}`);
  }

  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch automation manifest: ${manifestUrl}`);
  }

  const manifest = await response.json() as AutomationManifest;
  const files = await Promise.all(
    manifest.files.map(async (entry) => {
      const fileUrl = entry.url ?? (entry.absolutePath ? `/@fs/${entry.absolutePath.replace(/\\/g, "/")}` : null);
      if (!fileUrl) {
        throw new Error(`Automation manifest entry is missing a fetchable URL: ${entry.path}`);
      }
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        throw new Error(`Failed to fetch automation file: ${fileUrl}`);
      }
      const bytes = await fileResponse.arrayBuffer();
      const file = new File([bytes], entry.path.split("/").pop() || entry.path, {
        type: entry.mimeType || fileResponse.headers.get("content-type") || "application/octet-stream",
      });
      defineRelativePath(file, entry.path);
      return file;
    })
  );

  setAutomationState("loading", `loading ${manifest.caseId ?? manifest.rootFile ?? "automation stage"}`, manifest.caseId ?? null);
  await loadFiles(files);
  await waitForSettledFrames();
  if (getAutomationState().state !== "error") {
    setAutomationState("ready", "automation stage ready", manifest.caseId ?? manifest.rootFile ?? null);
  }
}

function defineRelativePath(file: File, relativePath: string): void {
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: relativePath,
  });
}

filePicker.addEventListener("change", () => {
  void loadFiles(Array.from(filePicker.files ?? []));
});

folderPicker.addEventListener("change", () => {
  void loadFiles(Array.from(folderPicker.files ?? []));
});

viewportElement.addEventListener("dragover", (event) => {
  event.preventDefault();
  viewportElement.classList.add("is-dragging");
});

viewportElement.addEventListener("dragleave", () => {
  viewportElement.classList.remove("is-dragging");
});

viewportElement.addEventListener("drop", async (event) => {
  event.preventDefault();
  viewportElement.classList.remove("is-dragging");
  const files = await collectDroppedFiles(event);
  await loadFiles(files);
});
