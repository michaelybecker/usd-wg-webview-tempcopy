import { runtime, state } from "./appState";
import { sampleAnimationFrame, updatePlaybarScrubber } from "./animation";
import { loadAutomationManifestStage } from "./loadOrchestrator";
import { applyVariantChange } from "./stageEdits";

export type AutomationManifest = {
  caseId?: string;
  rootFile?: string;
  files: Array<{
    path: string;
    url?: string;
    absolutePath?: string;
    mimeType?: string;
  }>;
};

export type AutomationState =
  | { state: "idle" | "booting" | "loading" | "ready"; detail: string; caseId: string | null }
  | { state: "error"; detail: string; caseId: string | null };

export type AutomationApi = {
  getState(): AutomationState;
  waitForReady(timeoutMs?: number): Promise<AutomationState>;
  loadManifest(manifestUrl: string, timeoutMs?: number): Promise<AutomationState>;
  setTime(timeCode: number): Promise<void>;
  setVariantSelection(
    primPath: string,
    variantSetName: string,
    selection: string
  ): Promise<boolean>;
  setPayloadLoaded(primPath: string, loaded: boolean): Promise<boolean>;
  settle(frameCount?: number): Promise<void>;
};

declare global {
  interface Window {
    __USD_WEBVIEW_AUTOMATION__?: AutomationApi;
  }
}

const searchParams = new URLSearchParams(window.location.search);
export const automationManifestUrl = searchParams.get("automationManifest");
export const automationEnabled =
  searchParams.get("automation") === "1" || !!automationManifestUrl;
export const automationSettleFrames = Math.max(
  1,
  Number(searchParams.get("settleFrames") ?? "6") || 6
);
document.documentElement.classList.toggle("automation-mode", automationEnabled);

let automationState: AutomationState = {
  state: automationEnabled ? "booting" : "idle",
  detail: automationEnabled ? "booting viewer" : "idle",
  caseId: null,
};
const automationListeners = new Set<(state: AutomationState) => void>();

export function setAutomationState(
  state: AutomationState["state"],
  detail: string,
  caseId = automationState.caseId
): void {
  automationState = {
    state,
    detail,
    caseId: caseId ?? null,
  };
  for (const listener of automationListeners) {
    listener(automationState);
  }
}

export function getAutomationState(): AutomationState {
  return automationState;
}

export function waitForAutomationReady(timeoutMs = 30000): Promise<AutomationState> {
  if (automationState.state === "ready") {
    return Promise.resolve(automationState);
  }
  if (automationState.state === "error") {
    return Promise.reject(new Error(automationState.detail));
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      automationListeners.delete(onStateChange);
      reject(new Error(`Timed out waiting for automation readiness: ${automationState.detail}`));
    }, timeoutMs);

    const onStateChange = (nextState: AutomationState): void => {
      if (nextState.state === "ready") {
        window.clearTimeout(timeout);
        automationListeners.delete(onStateChange);
        resolve(nextState);
      } else if (nextState.state === "error") {
        window.clearTimeout(timeout);
        automationListeners.delete(onStateChange);
        reject(new Error(nextState.detail));
      }
    };

    automationListeners.add(onStateChange);
  });
}

export function waitForUiPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export async function waitForSettledFrames(frameCount = automationSettleFrames): Promise<void> {
  for (let index = 0; index < frameCount; index += 1) {
    await waitForUiPaint();
  }
}

window.__USD_WEBVIEW_AUTOMATION__ = {
  getState(): AutomationState {
    return automationState;
  },
  waitForReady(timeoutMs?: number): Promise<AutomationState> {
    return waitForAutomationReady(timeoutMs);
  },
  async loadManifest(manifestUrl: string, timeoutMs = 30000): Promise<AutomationState> {
    await loadAutomationManifestStage(manifestUrl);
    return waitForAutomationReady(timeoutMs);
  },
  // The mutation entrypoints below intentionally re-use the exact code paths
  // the UI handlers hit (scrubber input, variant select, payload badge) so
  // automation captures exercise real user behavior.
  async setTime(timeCode: number): Promise<void> {
    state.animCurrent = timeCode;
    updatePlaybarScrubber();
    sampleAnimationFrame(timeCode);
    await waitForSettledFrames();
  },
  async setVariantSelection(
    primPath: string,
    variantSetName: string,
    selection: string
  ): Promise<boolean> {
    const changed = runtime.setVariantSelection(primPath, variantSetName, selection);
    if (!changed) {
      return false;
    }
    const normalizedVariantSet = variantSetName.toLowerCase();
    if (!normalizedVariantSet.includes("shading") && !normalizedVariantSet.includes("material")) {
      runtime.resetHydraDrivers();
    }
    await applyVariantChange(primPath, variantSetName);
    await waitForSettledFrames();
    return true;
  },
  async setPayloadLoaded(primPath: string, loaded: boolean): Promise<boolean> {
    const changed = runtime.setPayloadLoaded(primPath, loaded);
    await applyVariantChange(
      primPath,
      undefined,
      loaded ? "loading payload..." : "unloading payload..."
    );
    await waitForSettledFrames();
    return changed;
  },
  async settle(frameCount?: number): Promise<void> {
    await waitForSettledFrames(frameCount);
  },
};
