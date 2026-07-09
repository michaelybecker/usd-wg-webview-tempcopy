import type { RenderableMesh } from "../usd/types";
import { runtime, state } from "./appState";
import { attrList, attrPrimPath } from "./dom";
import { waitForUiPaint } from "./automation";
import { renderAttributes } from "./attributesPanel";
import { renderSceneGraph } from "./sceneGraphPanel";
import { setStatus } from "./statusBar";
import { collectRendererStats, renderStageSummary } from "./summaries";

export async function applyVariantChange(
  primPath?: string,
  variantSetName?: string,
  loadingMessage = "loading variant..."
): Promise<void> {
  const serial = ++state.variantChangeSerial;
  const normalizedVariantSet = variantSetName?.toLowerCase() ?? "";
  const isMaterialVariant =
    normalizedVariantSet.includes("shading") ||
    normalizedVariantSet.includes("material");
  const isAnimationVariant = normalizedVariantSet.includes("animation");
  const isModelingVariant = normalizedVariantSet.includes("modeling");

  setStatus(loadingMessage, true);
  await waitForUiPaint();

  let refreshedRenderables: RenderableMesh[] = [];

  if (!isMaterialVariant) {
    const subtreeRenderables = primPath && !isAnimationVariant
      ? runtime.extractHydraRenderableSubtreeAtTime(primPath, state.animCurrent)
      : null;
    if (primPath && !isAnimationVariant && subtreeRenderables && subtreeRenderables.length > 0) {
      refreshedRenderables = subtreeRenderables;
      state.viewport.updateRenderablesUnderRoot(
        primPath,
        subtreeRenderables,
        isModelingVariant
      );
    } else {
      let renderables = runtime.extractHydraRenderableSnapshotAtTime(state.animCurrent);
      if (!renderables || renderables.length === 0) {
        renderables = runtime.extractRenderables();
      }
      refreshedRenderables = renderables;
      if (isAnimationVariant) {
        state.viewport.renderStage(renderables, state.currentStageSummary, false);
      } else {
        state.viewport.updateRenderables(renderables, isModelingVariant);
      }
    }
    state.viewport.renderGaussianSplats(runtime.extractGaussianSplats());
  }

  if (isMaterialVariant || refreshedRenderables.length === 0) {
    refreshedRenderables = primPath
      ? runtime.extractRenderablesWithMaterialsUnderRoot(primPath)
      : runtime.extractRenderablesWithMaterials();
  }
  if (refreshedRenderables.length > 0) {
    await state.viewport.updateRenderablesAsync(refreshedRenderables);
  }

  if (serial !== state.variantChangeSerial) {
    return;
  }

  const newPrims = runtime.getSceneGraph();
  renderSceneGraph(newPrims);
  state.currentRendererStats = collectRendererStats(
    refreshedRenderables.length > 0
      ? refreshedRenderables
      : runtime.extractHydraRenderableSnapshotAtTime(state.animCurrent) ?? runtime.extractRenderables(),
    runtime.extractGaussianSplats()
  );
  renderStageSummary(state.currentStageSummary);
  if (state.selectedPrimPath) {
    if (newPrims.some((p) => p.path === state.selectedPrimPath)) {
      state.viewport.setSelectedPrim(state.selectedPrimPath);
      renderAttributes(state.selectedPrimPath, runtime.getPrimAttributes(state.selectedPrimPath));
    } else {
      state.selectedPrimPath = null;
      attrList.innerHTML = '<p class="sg-empty">Select a prim to inspect</p>';
      attrPrimPath.textContent = "";
    }
  }
  setStatus("Ready", false);
}
