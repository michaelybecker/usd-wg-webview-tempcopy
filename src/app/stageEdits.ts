import { runtime, state } from "./appState";
import { attrList, attrPrimPath } from "./dom";
import { waitForUiPaint } from "./automation";
import { renderAttributes } from "./attributesPanel";
import { renderSceneGraph } from "./sceneGraphPanel";
import { setStatus } from "./statusBar";
import { collectRendererStats, renderStageSummary } from "./summaries";

// Uniform stage-edit refresh: every composition-changing edit (variant
// selection, payload load/unload) funnels through the unified stage driver.
// NotifyStageEdited recomposes the private driver stage (re-mirrors load
// rules, re-infers skel bindings, re-bakes), so geometry and materials
// arrive coherently in one full redraw — no per-edit-kind forking.
export async function applyStageEdit(
  _primPath?: string,
  loadingMessage = "applying stage edit..."
): Promise<void> {
  const serial = ++state.variantChangeSerial;

  setStatus(loadingMessage, true);
  await waitForUiPaint();

  const renderables = runtime.refreshAfterStageEdit(state.animCurrent);
  state.viewport.updateRenderables(renderables, true);
  state.viewport.renderGaussianSplats(runtime.extractGaussianSplats());
  if (renderables.length > 0) {
    await state.viewport.updateRenderablesAsync(renderables);
  }

  if (serial !== state.variantChangeSerial) {
    return;
  }

  const newPrims = runtime.getSceneGraph();
  renderSceneGraph(newPrims);
  state.currentRendererStats = collectRendererStats(
    renderables,
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
