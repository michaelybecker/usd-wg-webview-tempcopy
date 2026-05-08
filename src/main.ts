import "./style.css";
import { UsdWebViewRuntime } from "./usd/UsdWebViewRuntime";
import { collectDroppedFiles, pickLikelyRootFile } from "./usd/fileIntake";
import type { RuntimeStatus, StageSummary } from "./usd/types";
import { ThreeViewport } from "./viewer/ThreeViewport";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("USD Web View root element was not found.");
}

app.innerHTML = `
  <main class="shell">
    <section class="viewport" aria-label="USD Web View viewport"></section>
    <aside class="inspector" aria-label="Stage inspector">
      <div class="brand">
        <p class="eyebrow">USD Web View</p>
        <h1>Stage environment</h1>
      </div>
      <div class="panel">
        <h2>Runtime</h2>
        <dl id="runtimeStatus" class="status-list"></dl>
      </div>
      <div class="panel">
        <h2>Stage</h2>
        <dl id="stageSummary" class="status-list"></dl>
      </div>
      <label class="file-target" for="filePicker">
        <span>Open USD files</span>
        <input id="filePicker" type="file" multiple accept=".usd,.usda,.usdc,.usdz" />
      </label>
    </aside>
  </main>
`;

const viewportElement = app.querySelector<HTMLElement>(".viewport");
const runtimeStatusElement = app.querySelector<HTMLElement>("#runtimeStatus");
const stageSummaryElement = app.querySelector<HTMLElement>("#stageSummary");
const filePicker = app.querySelector<HTMLInputElement>("#filePicker");

if (!viewportElement || !runtimeStatusElement || !stageSummaryElement || !filePicker) {
  throw new Error("USD Web View UI failed to initialize.");
}

const runtimeStatusList = runtimeStatusElement;
const stageSummaryList = stageSummaryElement;

const viewport = new ThreeViewport(viewportElement);
const runtime = new UsdWebViewRuntime();

function renderRuntimeStatus(status: RuntimeStatus): void {
  runtimeStatusList.innerHTML = renderDefinitionList({
    state: status.state,
    source: status.source,
    detail: status.detail
  });
}

function renderStageSummary(summary: StageSummary | null): void {
  if (!summary) {
    stageSummaryList.innerHTML = renderDefinitionList({
      file: "None",
      prims: "-",
      layers: "-",
      time: "-"
    });
    return;
  }

  stageSummaryList.innerHTML = renderDefinitionList({
    file: summary.rootFile,
    root: summary.rootLayerIdentifier ?? "-",
    prims: String(summary.primCount ?? "-"),
    layers: String(summary.layerCount ?? "-"),
    time: summary.timeCodesPerSecond ? `${summary.timeCodesPerSecond} fps` : "-",
    range:
      summary.startTimeCode !== undefined && summary.endTimeCode !== undefined
        ? `${summary.startTimeCode} - ${summary.endTimeCode}`
        : "-",
    up: summary.upAxis ?? "-",
    error: summary.error ?? "-"
  });
}

function renderDefinitionList(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
    .join("");
}

async function boot(): Promise<void> {
  renderRuntimeStatus(runtime.status);
  renderStageSummary(null);
  viewport.start();

  const status = await runtime.load();
  renderRuntimeStatus(status);
}

async function loadFiles(files: File[]): Promise<void> {
  if (!files.length) {
    return;
  }

  const rootFile = pickLikelyRootFile(files);
  renderStageSummary({
    rootFile: rootFile?.webkitRelativePath || rootFile?.name || "Unknown"
  });

  const result = await runtime.loadStage({
    files,
    rootFile
  });

  renderRuntimeStatus(runtime.status);
  renderStageSummary(result.summary);
  viewport.renderStage(result.renderables ?? [], result.summary);
}

filePicker.addEventListener("change", () => {
  void loadFiles(Array.from(filePicker.files ?? []));
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

void boot();
