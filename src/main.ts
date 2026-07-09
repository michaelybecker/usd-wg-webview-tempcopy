import "./style.css";
// Module evaluation order matters: dom.ts builds the shell, appState.ts
// creates the viewport/runtime, then the feature modules wire their events.
import "./app/dom";
import { runtime, state } from "./app/appState";
import "./app/animation";
import "./app/sceneGraphPanel";
import "./app/attributesPanel";
import "./app/stageEdits";
import "./app/menus";
import "./app/layout";
import {
  automationEnabled,
  automationManifestUrl,
  setAutomationState,
} from "./app/automation";
import { onTick } from "./app/animation";
import { loadAutomationManifestStage } from "./app/loadOrchestrator";
import { syncViewportState } from "./app/menus";
import { renderRuntimeStatus } from "./app/statusBar";
import { renderStageSummary } from "./app/summaries";

async function boot(): Promise<void> {
  renderRuntimeStatus(runtime.status);
  state.currentStageSummary = null;
  renderStageSummary(null);
  syncViewportState(state.viewport);
  state.viewport.start(onTick);

  try {
    const status = await runtime.load();
    renderRuntimeStatus(status);
    if (automationManifestUrl) {
      await loadAutomationManifestStage(automationManifestUrl);
    } else if (automationEnabled) {
      setAutomationState("ready", "viewer ready");
    }
  } catch (error) {
    if (automationEnabled) {
      setAutomationState(
        "error",
        `Viewer boot failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    throw error;
  }
}

void boot();
