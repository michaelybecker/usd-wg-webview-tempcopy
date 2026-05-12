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
    <section class="viewport" aria-label="USD Web View viewport">
      <div class="playbar" id="playbar" hidden>
        <button class="playbar-btn" id="playBtn" aria-label="Play">&#9654;</button>
        <span class="playbar-time" id="playbarTime">0</span>
        <div class="playbar-track-wrap">
          <input class="playbar-scrubber" id="playbarScrubber" type="range" min="0" max="100" value="0" step="1" />
        </div>
        <span class="playbar-end" id="playbarEnd">0</span>
      </div>
    </section>
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
      <div class="file-actions">
        <label class="file-target" for="filePicker">
          <span>Open files</span>
          <input id="filePicker" type="file" multiple accept=".usd,.usda,.usdc,.usdz" />
        </label>
        <label class="file-target" for="folderPicker">
          <span>Open folder</span>
          <input id="folderPicker" type="file" webkitdirectory />
        </label>
      </div>
    </aside>
  </main>
`;

const viewportElement = app.querySelector<HTMLElement>(".viewport");
const runtimeStatusElement = app.querySelector<HTMLElement>("#runtimeStatus");
const stageSummaryElement = app.querySelector<HTMLElement>("#stageSummary");
const filePicker = app.querySelector<HTMLInputElement>("#filePicker");
const folderPicker = app.querySelector<HTMLInputElement>("#folderPicker");
const playbar = app.querySelector<HTMLElement>("#playbar");
const playBtn = app.querySelector<HTMLButtonElement>("#playBtn");
const playbarTime = app.querySelector<HTMLElement>("#playbarTime");
const playbarEnd = app.querySelector<HTMLElement>("#playbarEnd");
const playbarScrubber = app.querySelector<HTMLInputElement>("#playbarScrubber");

if (
  !viewportElement ||
  !runtimeStatusElement ||
  !stageSummaryElement ||
  !filePicker ||
  !folderPicker ||
  !playbar ||
  !playBtn ||
  !playbarTime ||
  !playbarEnd ||
  !playbarScrubber
) {
  throw new Error("USD Web View UI failed to initialize.");
}

const runtimeStatusList = runtimeStatusElement;
const stageSummaryList = stageSummaryElement;

const viewport = new ThreeViewport(viewportElement);
const runtime = new UsdWebViewRuntime();

// --- Animation state ---
let animStart = 0;
let animEnd = 0;
let animFps = 24;
let animCurrent = 0;
let animPlaying = false;
let animLastTimestamp = 0;

function setPlaying(playing: boolean): void {
  animPlaying = playing;
  animLastTimestamp = performance.now();
  playBtn!.innerHTML = playing ? "&#9646;&#9646;" : "&#9654;";
  playBtn!.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function updatePlaybarScrubber(): void {
  playbarScrubber!.value = String(animCurrent);
  playbarTime!.textContent = animCurrent.toFixed(1);
}

function showPlaybar(summary: StageSummary): void {
  animStart = summary.startTimeCode ?? 0;
  animEnd = summary.endTimeCode ?? 0;
  animFps = summary.timeCodesPerSecond ?? 24;
  animCurrent = animStart;

  if (animEnd <= animStart) {
    playbar!.hidden = true;
    return;
  }

  playbarScrubber!.min = String(animStart);
  playbarScrubber!.max = String(animEnd);
  playbarScrubber!.step = "1";
  playbarEnd!.textContent = animEnd.toFixed(0);

  // For long animations, widen the track so it becomes scrollable
  const frameCount = Math.ceil(animEnd - animStart);
  playbarScrubber!.style.width = frameCount > 200
    ? `${frameCount * 2}px`
    : "100%";

  setPlaying(false);
  updatePlaybarScrubber();
  playbar!.hidden = false;
}

function hidePlaybar(): void {
  animPlaying = false;
  playbar!.hidden = true;
}

function onTick(): void {
  if (!animPlaying) return;

  const now = performance.now();
  const elapsed = now - animLastTimestamp;
  animLastTimestamp = now;

  animCurrent += (elapsed / 1000) * animFps;
  if (animCurrent >= animEnd) {
    animCurrent = animStart;
  }

  updatePlaybarScrubber();
  const transforms = runtime.extractTransformsAtTime(animCurrent);
  if (transforms.length > 0) {
    viewport.updateTransforms(transforms);
  }
}

playBtn.addEventListener("click", () => setPlaying(!animPlaying));

playbarScrubber.addEventListener("input", () => {
  animCurrent = Number(playbarScrubber.value);
  playbarTime.textContent = animCurrent.toFixed(1);
  if (!animPlaying) {
    const transforms = runtime.extractTransformsAtTime(animCurrent);
    if (transforms.length > 0) {
      viewport.updateTransforms(transforms);
    }
  }
});

// --- Inspector rendering ---
function renderRuntimeStatus(status: RuntimeStatus): void {
  runtimeStatusList.innerHTML = renderDefinitionList({
    state: status.state,
    source: status.source,
    detail: status.detail,
  });
}

function renderStageSummary(summary: StageSummary | null): void {
  if (!summary) {
    stageSummaryList.innerHTML = renderDefinitionList({
      file: "None",
      prims: "-",
      layers: "-",
      time: "-",
    });
    return;
  }

  stageSummaryList.innerHTML = renderDefinitionList({
    file: summary.rootFile,
    root: summary.rootLayerIdentifier ?? "-",
    prims: String(summary.primCount ?? "-"),
    layers: String(summary.layerCount ?? "-"),
    time: summary.timeCodesPerSecond
      ? `${summary.timeCodesPerSecond} fps`
      : "-",
    range:
      summary.startTimeCode !== undefined && summary.endTimeCode !== undefined
        ? `${summary.startTimeCode} - ${summary.endTimeCode}`
        : "-",
    up: summary.upAxis ?? "-",
    error: summary.error ?? "-",
  });
}

function renderDefinitionList(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
    .join("");
}

// --- Boot + file loading ---
async function boot(): Promise<void> {
  renderRuntimeStatus(runtime.status);
  renderStageSummary(null);
  viewport.start(onTick);

  const status = await runtime.load();
  renderRuntimeStatus(status);
}

function hasActualAnimation(start: number, end: number): boolean {
  const t0 = runtime.extractTransformsAtTime(start);
  const t1 = runtime.extractTransformsAtTime(end);
  if (t0.length !== t1.length || t0.length === 0) return false;
  for (let i = 0; i < t0.length; i++) {
    const m0 = t0[i].matrix;
    const m1 = t1[i].matrix;
    for (let j = 0; j < 16; j++) {
      if (Math.abs(m0[j] - m1[j]) > 1e-6) return true;
    }
  }
  return false;
}

async function loadFiles(files: File[]): Promise<void> {
  if (!files.length) {
    return;
  }

  hidePlaybar();
  viewportElement!.classList.remove("has-stage");

  const rootFile = pickLikelyRootFile(files);
  renderStageSummary({
    rootFile: rootFile?.webkitRelativePath || rootFile?.name || "Unknown",
  });

  const result = await runtime.loadStage({
    files,
    rootFile,
  });

  renderRuntimeStatus(runtime.status);
  renderStageSummary(result.summary);
  viewport.renderStage(result.renderables ?? [], result.summary);
  viewportElement!.classList.add("has-stage");

  if (result.summary) {
    const s = result.summary;
    const start = s.startTimeCode ?? 0;
    const end = s.endTimeCode ?? 0;
    if (end > start && hasActualAnimation(start, end)) {
      showPlaybar(s);
    }
  }
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

void boot();
