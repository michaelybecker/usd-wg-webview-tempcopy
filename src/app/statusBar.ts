import type { RuntimeStatus } from "../usd/types";
import { state } from "./appState";
import { materialXModeLabel, statusLabel, statusSpinner } from "./dom";

export function setStatus(message: string, busy = false): void {
  statusLabel.textContent = message;
  statusSpinner.hidden = !busy;
  materialXModeLabel.hidden = !state.viewport.isExperimentalMaterialXMode();
}

export function renderRuntimeStatus(status: RuntimeStatus): void {
  if (!state.isLoadingStage) {
    setStatus(status.detail, status.state === "loading");
  }
}
