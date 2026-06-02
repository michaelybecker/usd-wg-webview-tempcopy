import "./style.css";
import { UsdWebViewRuntime } from "./usd/UsdWebViewRuntime";
import { collectDroppedFiles, pickLikelyRootFile } from "./usd/fileIntake";
import type {
  PrimAttribute,
  RenderableGaussianSplat,
  RenderableMaterial,
  RenderableMesh,
  RuntimeStatus,
  SceneGraphPrim,
  StageLoadResult,
  StageSummary,
} from "./usd/types";
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  CustomToneMapping,
  LinearSRGBColorSpace,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
  SRGBColorSpace,
  type ColorSpace,
  type ToneMapping,
} from "three";

import { ThreeViewport, type NavigationMode, type ViewUpAxis } from "./viewer/ThreeViewport";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("USD Web View root element was not found.");
}

app.innerHTML = `
  <main class="shell" id="shell">
    <nav class="menubar" id="menubar" aria-label="Application menu">
      <div class="menu-item">
        <button class="menu-btn">File</button>
        <ul class="menu-dropdown">
          <li><button class="menu-option" id="menuOpenFile">Open File…</button></li>
          <li><button class="menu-option" id="menuOpenFolder">Open Folder…</button></li>
        </ul>
      </div>
      <div class="menu-item">
        <button class="menu-btn">Edit</button>
        <ul class="menu-dropdown">
          <li><button class="menu-option" disabled>Undo</button></li>
          <li><button class="menu-option" disabled>Redo</button></li>
        </ul>
      </div>
      <div class="menu-item">
        <button class="menu-btn">Settings</button>
        <ul class="menu-dropdown">
          <li class="menu-submenu">
            <button class="menu-option menu-submenu-trigger">Navigation</button>
            <ul class="menu-dropdown menu-submenu-dropdown">
              <li class="menu-submenu">
                <button class="menu-option menu-submenu-trigger">Mode</button>
                <ul class="menu-dropdown menu-submenu-dropdown">
                  <li><button class="menu-option" data-navigation-mode="orbital">Orbital</button></li>
                  <li><button class="menu-option" data-navigation-mode="game">Game Engine</button></li>
                </ul>
              </li>
              <li class="menu-submenu">
                <button class="menu-option menu-submenu-trigger">Camera Speed</button>
                <ul class="menu-dropdown menu-submenu-dropdown">
                  <li><button class="menu-option" data-camera-speed="0.5">0.5x</button></li>
                  <li><button class="menu-option" data-camera-speed="1">1x</button></li>
                  <li><button class="menu-option" data-camera-speed="2">2x</button></li>
                  <li><button class="menu-option" data-camera-speed="5">5x</button></li>
                  <li><button class="menu-option" data-camera-speed="10">10x</button></li>
                </ul>
              </li>
              <li class="menu-submenu">
                <button class="menu-option menu-submenu-trigger">Up Axis</button>
                <ul class="menu-dropdown menu-submenu-dropdown">
                  <li><button class="menu-option" data-up-axis="stage">From Stage</button></li>
                  <li class="menu-separator" role="separator"></li>
                  <li><button class="menu-option" data-up-axis="y">Y Up</button></li>
                  <li><button class="menu-option" data-up-axis="z">Z Up</button></li>
                </ul>
              </li>
            </ul>
          </li>
          <li class="menu-submenu">
            <button class="menu-option menu-submenu-trigger">Display</button>
            <ul class="menu-dropdown menu-submenu-dropdown">
              <li class="menu-submenu">
                <button class="menu-option menu-submenu-trigger">Color Space</button>
                <ul class="menu-dropdown menu-submenu-dropdown">
                  <li><button class="menu-option" data-output-color-space="srgb">sRGB</button></li>
                  <li><button class="menu-option" data-output-color-space="srgb-linear">Linear sRGB</button></li>
                </ul>
              </li>
              <li class="menu-submenu">
                <button class="menu-option menu-submenu-trigger">Tone Mapping</button>
                <ul class="menu-dropdown menu-submenu-dropdown">
                  <li><button class="menu-option" data-tone-mapping="none">None</button></li>
                  <li><button class="menu-option" data-tone-mapping="linear">Linear</button></li>
                  <li><button class="menu-option" data-tone-mapping="reinhard">Reinhard</button></li>
                  <li><button class="menu-option" data-tone-mapping="cineon">Cineon</button></li>
                  <li><button class="menu-option" data-tone-mapping="aces">ACES Filmic</button></li>
                  <li><button class="menu-option" data-tone-mapping="agx">AgX</button></li>
                  <li><button class="menu-option" data-tone-mapping="neutral">Neutral</button></li>
                  <li><button class="menu-option" data-tone-mapping="custom">Custom</button></li>
                </ul>
              </li>
              <li class="menu-meter" id="toneMappingExposureControl">
                <label class="menu-meter-label" for="toneMappingExposureInput">Tone Mapping Exposure <span id="toneMappingExposureValue">1.00</span></label>
                <input id="toneMappingExposureInput" class="menu-meter-input" type="range" min="0" max="5" step="0.01" value="1" />
              </li>
            </ul>
          </li>
          <li class="menu-submenu">
            <button class="menu-option menu-submenu-trigger">Lighting</button>
            <ul class="menu-dropdown menu-submenu-dropdown">
              <li><button class="menu-option" data-lighting-mode="default">Default lighting</button></li>
              <li class="menu-submenu">
                <button class="menu-option menu-submenu-trigger">HDR</button>
                <ul class="menu-dropdown menu-submenu-dropdown">
                  <li><button class="menu-option" id="menuLoadHdriMap">Load HDRi map...</button></li>
                  <li><button class="menu-option" id="menuHdriVisible">Visible HDRi</button></li>
                  <li class="menu-meter" id="hdriIntensityControl">
                    <label class="menu-meter-label" for="hdriIntensityInput">IBL intensity <span id="hdriIntensityValue">1.00</span></label>
                    <input id="hdriIntensityInput" class="menu-meter-input" type="range" min="0" max="5" step="0.01" value="1" />
                  </li>
                </ul>
              </li>
            </ul>
          </li>
          <li class="menu-submenu">
            <button class="menu-option menu-submenu-trigger">Rendering</button>
            <ul class="menu-dropdown menu-submenu-dropdown">
              <li class="menu-submenu">
                <button class="menu-option menu-submenu-trigger">Splat Fidelity</button>
                <ul class="menu-dropdown menu-submenu-dropdown">
                  <li><button class="menu-option" data-splat-fidelity="0">Base Color</button></li>
                  <li><button class="menu-option" data-splat-fidelity="1">Low SH</button></li>
                  <li><button class="menu-option" data-splat-fidelity="2">High SH</button></li>
                  <li><button class="menu-option" data-splat-fidelity="3">Full SH</button></li>
                </ul>
              </li>
              <li class="menu-submenu">
                <button class="menu-option menu-submenu-trigger">Splat Detail</button>
                <ul class="menu-dropdown menu-submenu-dropdown">
                  <li><button class="menu-option" data-splat-detail="0">Crisp</button></li>
                  <li><button class="menu-option" data-splat-detail="1">Normal</button></li>
                  <li><button class="menu-option" data-splat-detail="2">Smooth</button></li>
                </ul>
              </li>
              <li><button class="menu-option" id="menuMaterialXFlipV">MaterialX Flip V</button></li>
            </ul>
          </li>
          <li class="menu-submenu">
            <button class="menu-option menu-submenu-trigger">Stage</button>
            <ul class="menu-dropdown menu-submenu-dropdown">
              <li class="menu-submenu">
                <button class="menu-option menu-submenu-trigger">Payloads</button>
                <ul class="menu-dropdown menu-submenu-dropdown">
                  <li><button class="menu-option" id="menuLoadAllPayloads">Load All</button></li>
                  <li><button class="menu-option" id="menuUnloadAllPayloads">Unload All</button></li>
                  <li class="menu-separator" role="separator"></li>
                  <li class="menu-submenu">
                    <button class="menu-option menu-submenu-trigger">Load all payloads on Stage Open</button>
                    <ul class="menu-dropdown menu-submenu-dropdown">
                      <li><button class="menu-option" data-load-payloads-on-open="true">True</button></li>
                      <li><button class="menu-option" data-load-payloads-on-open="false">False</button></li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
          </li>
        </ul>
      </div>
      <div class="menu-item">
        <button class="menu-btn">?</button>
        <ul class="menu-dropdown">
          <li><button class="menu-option" id="menuTutorial">Show Tutorial</button></li>
          <li><button class="menu-option" id="menuStats">Stats</button></li>
        </ul>
      </div>
      <div class="status-bar" id="statusBar" role="status" aria-live="polite">
        <span class="status-spinner" id="statusSpinner" hidden></span>
        <span class="status-mode" id="materialXModeLabel" hidden>Experimental MaterialX / WebGPU</span>
        <span class="status-label" id="statusLabel">Idle</span>
      </div>
      <input id="filePicker" type="file" multiple accept=".usd,.usda,.usdc,.usdz,.mtlx,.zip,.png,.jpg,.jpeg,.webp,.svg,.exr" style="display:none" />
      <input id="folderPicker" type="file" webkitdirectory style="display:none" />
      <input id="hdriPicker" type="file" accept=".hdr,.exr" style="display:none" />
    </nav>
    <nav class="scene-graph" aria-label="Scene graph">
      <div class="panel-header">Scene Graph</div>
      <ol id="sceneGraphList" class="sg-list"></ol>
      <div class="sg-resize-x" id="sgResizeX"></div>
    </nav>
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
    <div class="attr-panel" id="attrPanel">
      <div class="attr-resize-y" id="attrResizeY"></div>
      <div class="panel-header">
        <span>Attributes</span>
        <span id="attrPrimPath" class="attr-prim-path"></span>
      </div>
      <div id="attrList" class="attr-list">
        <p class="sg-empty">Select a prim to inspect</p>
      </div>
    </div>
  </main>
  <div class="stats-panel" id="statsPanel" hidden>
    <div class="stats-header">
      <span>Stats</span>
      <button class="stats-close" id="statsClose" aria-label="Close">&times;</button>
    </div>
    <div class="stats-body">
      <p class="stats-section-title">USD Stage</p>
      <dl id="usdStageSummary" class="status-list"></dl>
      <p class="stats-section-title">Renderer</p>
      <dl id="rendererSummary" class="status-list"></dl>
    </div>
  </div>
  <div class="tutorial-overlay" id="tutorialOverlay" hidden>
    <div class="tutorial-modal">
      <div class="tutorial-header">
        <span>Controls</span>
        <button class="tutorial-close" id="tutorialClose" aria-label="Close">&times;</button>
      </div>
      <table class="tutorial-table">
        <thead><tr><th colspan="2">Viewport</th></tr></thead>
        <tbody>
          <tr><td>Left drag</td><td>Orbit camera</td></tr>
          <tr><td>Right drag / Two-finger</td><td>Pan camera</td></tr>
          <tr><td>Scroll / Pinch</td><td>Zoom camera</td></tr>
          <tr><td>F</td><td>Frame selected prim</td></tr>
          <tr><td>Click mesh</td><td>Select prim</td></tr>
          <tr><td>Settings &gt; Navigation &gt; Mode &gt; Game Engine</td><td>Hold right mouse and use WASD + Q/E to fly; scroll while held changes speed</td></tr>
        </tbody>
        <thead><tr><th colspan="2">Scene Graph</th></tr></thead>
        <tbody>
          <tr><td>Click item</td><td>Select &amp; highlight prim</td></tr>
          <tr><td>Drop USD / folder</td><td>Load stage</td></tr>
          <tr><td><span class="sg-badge sg-badge--variant" style="pointer-events:none">V</span> badge</td><td>Prim has USD variant sets — click to cycle, dropdown to pick</td></tr>
          <tr><td><span class="sg-badge sg-badge--payload sg-badge--payload-loaded" style="pointer-events:none">P</span> badge (amber)</td><td>Payload loaded — click to unload; prim stays in tree but dims</td></tr>
          <tr><td><span class="sg-badge sg-badge--payload" style="pointer-events:none">P</span> badge (grey)</td><td>Payload unloaded — click to reload geometry and materials</td></tr>
          <tr><td>Settings &gt; Stage &gt; Payloads</td><td>Bulk-toggle payloads and choose the stage-open payload policy</td></tr>
        </tbody>
      </table>
    </div>
  </div>
`;

const viewportElement = app.querySelector<HTMLElement>(".viewport");
const usdStageSummaryElement = app.querySelector<HTMLElement>("#usdStageSummary");
const rendererSummaryElement = app.querySelector<HTMLElement>("#rendererSummary");
const filePicker = app.querySelector<HTMLInputElement>("#filePicker");
const folderPicker = app.querySelector<HTMLInputElement>("#folderPicker");
const hdriPicker = app.querySelector<HTMLInputElement>("#hdriPicker");
const playbar = app.querySelector<HTMLElement>("#playbar");
const playBtn = app.querySelector<HTMLButtonElement>("#playBtn");
const playbarTime = app.querySelector<HTMLElement>("#playbarTime");
const playbarEnd = app.querySelector<HTMLElement>("#playbarEnd");
const playbarScrubber = app.querySelector<HTMLInputElement>("#playbarScrubber");
const statusSpinner = app.querySelector<HTMLElement>("#statusSpinner");
const statusLabel = app.querySelector<HTMLElement>("#statusLabel");
const materialXModeLabel = app.querySelector<HTMLElement>("#materialXModeLabel");
const sceneGraphList = app.querySelector<HTMLElement>("#sceneGraphList");
const attrPrimPath = app.querySelector<HTMLElement>("#attrPrimPath");
const attrList = app.querySelector<HTMLElement>("#attrList");
const statsPanel = app.querySelector<HTMLElement>("#statsPanel")!;
const statsClose = app.querySelector<HTMLButtonElement>("#statsClose")!;
const tutorialOverlay = app.querySelector<HTMLElement>("#tutorialOverlay")!;
const tutorialClose = app.querySelector<HTMLButtonElement>("#tutorialClose")!;
const hdriIntensityInput = app.querySelector<HTMLInputElement>("#hdriIntensityInput")!;
const hdriIntensityValue = app.querySelector<HTMLElement>("#hdriIntensityValue")!;
const toneMappingExposureInput = app.querySelector<HTMLInputElement>("#toneMappingExposureInput")!;
const toneMappingExposureValue = app.querySelector<HTMLElement>("#toneMappingExposureValue")!;

if (
  !viewportElement ||
  !usdStageSummaryElement ||
  !rendererSummaryElement ||
  !filePicker ||
  !folderPicker ||
  !hdriPicker ||
  !playbar ||
  !playBtn ||
  !playbarTime ||
  !playbarEnd ||
  !playbarScrubber ||
  !statusSpinner ||
  !statusLabel ||
  !materialXModeLabel ||
  !sceneGraphList ||
  !attrPrimPath ||
  !attrList
) {
  throw new Error("USD Web View UI failed to initialize.");
}

const usdStageSummaryList = usdStageSummaryElement;
const rendererSummaryList = rendererSummaryElement;

let viewport = new ThreeViewport(viewportElement!);
const runtime = new UsdWebViewRuntime();
runtime.setHydraSyncDriverEnabled(
  localStorage.getItem("usdWebView.hydraSyncDriver") !== "0"
);
type UpAxisChoice = "stage" | ViewUpAxis;
type LightingMode = "default" | "hdri";
type OutputColorSpaceChoice = typeof SRGBColorSpace | typeof LinearSRGBColorSpace;
type ToneMappingChoice =
  | "none"
  | "linear"
  | "reinhard"
  | "cineon"
  | "aces"
  | "agx"
  | "neutral"
  | "custom";

const splatFidelityOptions = [
  { label: "Base Color", maxShDegree: 0 },
  { label: "Low SH", maxShDegree: 1 },
  { label: "High SH", maxShDegree: 2 },
  { label: "Full SH", maxShDegree: 3 },
] as const;

const splatDetailOptions = [
  { label: "Crisp", scaleMultiplier: 0.8 },
  { label: "Normal", scaleMultiplier: 1 },
  { label: "Smooth", scaleMultiplier: 1.2 },
] as const;

let splatFidelityIndex = splatFidelityOptions.length - 1;
let splatDetailIndex = 1;
let navigationMode: NavigationMode = "orbital";
let upAxisChoice: UpAxisChoice = "stage";
let outputColorSpace: OutputColorSpaceChoice = SRGBColorSpace;
let toneMappingChoice: ToneMappingChoice = "none";
let toneMappingExposure = 1;
let lightingMode: LightingMode = "default";
let materialXFlipV = true;
let hdriMapVisible = true;
let hdriIntensity = 1;
let hdriMapLabel: string | null = null;
let gameCameraSpeed = 2;
const loadAllPayloadsOnStageOpenStorageKey = "usdWebView.loadAllPayloadsOnStageOpen";
if (localStorage.getItem(loadAllPayloadsOnStageOpenStorageKey) === null) {
  localStorage.setItem(loadAllPayloadsOnStageOpenStorageKey, "true");
}
let loadAllPayloadsOnStageOpen =
  localStorage.getItem(loadAllPayloadsOnStageOpenStorageKey) !== "false";
let currentStageSummary: StageSummary | null = null;
type RendererStats = {
  meshes: number;
  vertices: number;
  triangles: number;
  materialBindings: number;
  materials: number;
  textures: number;
  gaussianSplats: number;
  splatPoints: number;
};

let currentRendererStats: RendererStats | null = null;
let isLoadingStage = false;
let variantChangeSerial = 0;
let stageLoadSerial = 0;

function setStatus(message: string, busy = false): void {
  statusLabel!.textContent = message;
  statusSpinner!.hidden = !busy;
  materialXModeLabel!.hidden = !viewport.isExperimentalMaterialXMode();
}

function waitForUiPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

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

function sampleAnimationFrame(timeCode: number): void {
  if (isLoadingStage) {
    return;
  }
  const renderables = runtime.extractHydraRenderablesAtTime(timeCode);
  if (renderables.length > 0) {
    viewport.updateRenderables(renderables);
  }
}

function onTick(): void {
  if (!animPlaying) return;
  const now = performance.now();
  animCurrent += ((now - animLastTimestamp) / 1000) * animFps;
  animLastTimestamp = now;
  if (animCurrent >= animEnd) animCurrent = animStart;
  updatePlaybarScrubber();
  sampleAnimationFrame(animCurrent);
}

playBtn.addEventListener("click", () => setPlaying(!animPlaying));

playbarScrubber.addEventListener("input", () => {
  animCurrent = Number(playbarScrubber.value);
  playbarTime.textContent = animCurrent.toFixed(1);
  if (!animPlaying) {
    sampleAnimationFrame(animCurrent);
  }
});

// --- Scene graph ---
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let allPrims: SceneGraphPrim[] = [];
const collapsedNodes = new Set<string>();
let selectedPrimPath: string | null = null;

function isAncestorCollapsed(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    if (collapsedNodes.has("/" + parts.slice(0, i).join("/"))) return true;
  }
  return false;
}

function renderPrimItem(p: SceneGraphPrim): string {
  const indent = 4 + p.depth * 14;
  const isCollapsed = collapsedNodes.has(p.path);
  const toggle = p.hasChildren
    ? `<button class="sg-toggle" data-toggle-path="${escHtml(p.path)}" aria-label="${isCollapsed ? "Expand" : "Collapse"}">` +
      `<span class="sg-arrow${isCollapsed ? "" : " sg-arrow--open"}"></span></button>`
    : `<span class="sg-toggle-leaf"></span>`;
  const variantBadge = p.hasVariantSets
    ? `<span class="sg-badge sg-badge--variant" title="Has variant sets">V</span>`
    : "";
  const payloadUnloaded = p.hasPayloads && !p.isPayloadLoaded;
  const payloadBtn = p.hasPayloads
    ? `<button class="sg-badge sg-badge--payload${p.isPayloadLoaded ? " sg-badge--payload-loaded" : ""}" ` +
      `data-payload-path="${escHtml(p.path)}" data-payload-loaded="${p.isPayloadLoaded ? "1" : "0"}" ` +
      `title="${p.isPayloadLoaded ? "Unload payload" : "Load payload"}">P</button>`
    : "";
  return (
    `<li class="sg-item${p.isActive ? "" : " sg-inactive"}${payloadUnloaded ? " sg-payload-unloaded" : ""}" data-path="${escHtml(p.path)}" style="padding-left:${indent}px">` +
    toggle +
    `<span class="sg-name">${escHtml(p.name)}</span>` +
    variantBadge +
    payloadBtn +
    `<span class="sg-type">${escHtml(p.typeName || "?")}</span>` +
    `</li>`
  );
}

function _renderSceneGraphList(): void {
  if (!allPrims.length) {
    sceneGraphList!.innerHTML = '<li class="sg-empty">No prims</li>';
    return;
  }
  sceneGraphList!.innerHTML = allPrims
    .filter((p) => !isAncestorCollapsed(p.path))
    .map(renderPrimItem)
    .join("");
  if (selectedPrimPath) {
    sceneGraphList!
      .querySelector<HTMLElement>(`[data-path="${selectedPrimPath.replace(/"/g, '\\"')}"]`)
      ?.classList.add("sg-selected");
  }
}

function renderSceneGraph(prims: SceneGraphPrim[]): void {
  allPrims = prims;
  _renderSceneGraphList();
}

function clearSceneGraph(): void {
  allPrims = [];
  collapsedNodes.clear();
  selectedPrimPath = null;
  sceneGraphList!.innerHTML = "";
  attrList!.innerHTML = '<p class="sg-empty">Select a prim to inspect</p>';
  attrPrimPath!.textContent = "";
  viewport.setSelectedPrim(null);
}

function selectPrimByPath(path: string): void {
  // Expand any collapsed ancestors so the item is visible
  const parts = path.split("/").filter(Boolean);
  let changed = false;
  for (let i = 1; i < parts.length; i++) {
    const ancestor = "/" + parts.slice(0, i).join("/");
    if (collapsedNodes.has(ancestor)) { collapsedNodes.delete(ancestor); changed = true; }
  }
  if (changed) _renderSceneGraphList();

  selectedPrimPath = path;
  sceneGraphList!.querySelectorAll(".sg-item").forEach((el) => el.classList.remove("sg-selected"));
  const el = sceneGraphList!.querySelector<HTMLElement>(`[data-path="${path.replace(/"/g, '\\"')}"]`);
  if (el) { el.classList.add("sg-selected"); el.scrollIntoView({ block: "nearest" }); }

  renderAttributes(path, runtime.getPrimAttributes(path));
  viewport.setSelectedPrim(path);
}

function renderAttributes(primPath: string, attrs: PrimAttribute[]): void {
  attrPrimPath!.textContent = primPath;
  attrList!.innerHTML = attrs.length
    ? attrs.map((a) => {
        if (a.typeName === "variantSet" && a.variantOptions) {
          const opts = a.variantOptions
            .map((o) => `<option value="${escHtml(o)}"${o === a.value ? " selected" : ""}>${escHtml(o)}</option>`)
            .join("");
          return (
            `<div class="attr-row attr-authored">` +
            `<span class="attr-name">${escHtml(a.name)}</span>` +
            `<span class="attr-type">variantSet</span>` +
            `<select class="attr-variant-select" data-primpath="${escHtml(primPath)}" data-variantset="${escHtml(a.name)}">${opts}</select>` +
            `</div>`
          );
        }
        return (
          `<div class="attr-row${a.isAuthored ? " attr-authored" : ""}">` +
          `<span class="attr-name">${escHtml(a.name)}</span>` +
          `<span class="attr-type">${escHtml(a.typeName)}</span>` +
          renderAttributeValue(a) +
          `</div>`
        );
      }).join("")
    : '<p class="sg-empty">No attributes</p>';
}

function renderAttributeValue(attr: PrimAttribute): string {
  const value = attr.value ?? "—";
  if (!attr.valueIsArray) {
    return `<span class="attr-value">${escHtml(value)}</span>`;
  }

  const count = attr.valueElementCount ?? 0;
  return (
    `<div class="attr-value attr-value-array-shell" title="${escHtml(String(count))} elements">` +
    `<button class="attr-array-scroll" type="button" data-array-scroll="-1" aria-label="Scroll attribute values left">‹</button>` +
    `<div class="attr-value-array" tabindex="0">` +
    `<span class="attr-array-count">${count} elements</span>` +
    `<span class="attr-array-items">${escHtml(value)}</span>` +
    `</div>` +
    `<button class="attr-array-scroll" type="button" data-array-scroll="1" aria-label="Scroll attribute values right">›</button>` +
    `</div>`
  );
}

async function applyVariantChange(
  primPath?: string,
  variantSetName?: string,
  loadingMessage = "loading variant..."
): Promise<void> {
  const serial = ++variantChangeSerial;
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
      ? runtime.extractHydraRenderableSubtreeAtTime(primPath, animCurrent)
      : null;
    if (primPath && !isAnimationVariant && subtreeRenderables && subtreeRenderables.length > 0) {
      refreshedRenderables = subtreeRenderables;
      viewport.updateRenderablesUnderRoot(
        primPath,
        subtreeRenderables,
        isModelingVariant
      );
    } else {
      let renderables = runtime.extractHydraRenderableSnapshotAtTime(animCurrent);
      if (!renderables || renderables.length === 0) {
        renderables = runtime.extractRenderables();
      }
      refreshedRenderables = renderables;
      if (isAnimationVariant) {
        viewport.renderStage(renderables, currentStageSummary, false);
      } else {
        viewport.updateRenderables(renderables, isModelingVariant);
      }
    }
    viewport.renderGaussianSplats(runtime.extractGaussianSplats());
  }

  if (isMaterialVariant || refreshedRenderables.length === 0) {
    refreshedRenderables = primPath
      ? runtime.extractRenderablesWithMaterialsUnderRoot(primPath)
      : runtime.extractRenderablesWithMaterials();
  }
  if (refreshedRenderables.length > 0) {
    await viewport.updateRenderablesAsync(refreshedRenderables);
  }

  if (serial !== variantChangeSerial) {
    return;
  }

  const newPrims = runtime.getSceneGraph();
  renderSceneGraph(newPrims);
  currentRendererStats = collectRendererStats(
    refreshedRenderables.length > 0
      ? refreshedRenderables
      : runtime.extractHydraRenderableSnapshotAtTime(animCurrent) ?? runtime.extractRenderables(),
    runtime.extractGaussianSplats()
  );
  renderStageSummary(currentStageSummary);
  if (selectedPrimPath) {
    if (newPrims.some((p) => p.path === selectedPrimPath)) {
      viewport.setSelectedPrim(selectedPrimPath);
      renderAttributes(selectedPrimPath, runtime.getPrimAttributes(selectedPrimPath));
    } else {
      selectedPrimPath = null;
      attrList!.innerHTML = '<p class="sg-empty">Select a prim to inspect</p>';
      attrPrimPath!.textContent = "";
    }
  }
  setStatus("Ready", false);
}

attrList!.addEventListener("change", (e) => {
  const select = (e.target as Element).closest<HTMLSelectElement>(".attr-variant-select");
  if (!select) return;
  const changed = runtime.setVariantSelection(select.dataset.primpath!, select.dataset.variantset!, select.value);
  if (!changed) {
    renderAttributes(select.dataset.primpath!, runtime.getPrimAttributes(select.dataset.primpath!));
    return;
  }
  const normalizedVariantSet = select.dataset.variantset?.toLowerCase() ?? "";
  if (!normalizedVariantSet.includes("shading") && !normalizedVariantSet.includes("material")) {
    runtime.resetHydraDrivers();
  }
  void applyVariantChange(select.dataset.primpath, select.dataset.variantset);
});

attrList!.addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>("[data-array-scroll]");
  if (!button) return;
  const scroller = button.parentElement?.querySelector<HTMLElement>(".attr-value-array");
  if (!scroller) return;
  const direction = Number(button.dataset.arrayScroll) || 1;
  scroller.scrollBy({
    left: direction * Math.max(160, Math.floor(scroller.clientWidth * 0.75)),
    behavior: "smooth",
  });
});

sceneGraphList!.addEventListener("click", (e) => {
  const toggleBtn = (e.target as Element).closest<HTMLElement>(".sg-toggle");
  if (toggleBtn?.dataset.togglePath) {
    const path = toggleBtn.dataset.togglePath;
    if (collapsedNodes.has(path)) {
      collapsedNodes.delete(path);
    } else {
      collapsedNodes.add(path);
    }
    _renderSceneGraphList();
    return;
  }

  const payloadBtn = (e.target as Element).closest<HTMLElement>(".sg-badge--payload");
  if (payloadBtn?.dataset.payloadPath) {
    e.stopPropagation();
    const path = payloadBtn.dataset.payloadPath;
    const currentlyLoaded = payloadBtn.dataset.payloadLoaded === "1";
    runtime.setPayloadLoaded(path, !currentlyLoaded);
    void applyVariantChange(
      path,
      undefined,
      currentlyLoaded ? "unloading payload..." : "loading payload..."
    );
    return;
  }

  const item = (e.target as Element).closest<HTMLElement>(".sg-item");
  if (!item?.dataset.path) return;
  selectPrimByPath(item.dataset.path);
});

// --- Inspector rendering ---
function renderRuntimeStatus(status: RuntimeStatus): void {
  if (!isLoadingStage) {
    setStatus(status.detail, status.state === "loading");
  }
}

function renderStageSummary(summary: StageSummary | null): void {
  const viewerUpAxis = getEffectiveUpAxis(summary?.upAxis);
  if (!summary) {
    usdStageSummaryList.innerHTML = renderDefinitionList({
      file: "None",
      prims: "-",
      layers: "-",
      "mesh prims": "-",
      "authored points": "-",
      "authored faces": "-",
      materials: "-",
      "texture assets": "-",
      payloads: "-",
      variants: "-",
      instances: "-",
      "stage up": "-",
      "viewer up": formatUpAxis(viewerUpAxis),
    });
    renderRendererSummary(null);
    return;
  }

  usdStageSummaryList.innerHTML = renderDefinitionList({
    file: summary.rootFile,
    root: summary.rootLayerIdentifier ?? "-",
    prims: String(summary.primCount ?? "-"),
    layers: String(summary.layerCount ?? "-"),
    "mesh prims": formatCount(summary.meshPrimCount),
    "authored points": formatCount(summary.authoredPointCount),
    "authored faces": formatCount(summary.authoredFaceCount),
    materials: formatCount(summary.materialPrimCount),
    "material bindings": formatCount(summary.materialBindingCount),
    "texture assets": formatCount(summary.textureAssetCount),
    payloads: formatCount(summary.payloadPrimCount),
    variants: formatCount(summary.variantSetCount),
    instances: formatCount(summary.instancePrimCount),
    time: summary.timeCodesPerSecond
      ? `${summary.timeCodesPerSecond} fps`
      : "-",
    range:
      summary.startTimeCode !== undefined && summary.endTimeCode !== undefined
        ? `${summary.startTimeCode} - ${summary.endTimeCode}`
        : "-",
    "stage up": summary.upAxis ?? "-",
    "viewer up": formatUpAxis(viewerUpAxis),
    error: summary.error ?? "-",
  });
  renderRendererSummary(currentRendererStats);
}

function renderRendererSummary(stats: RendererStats | null): void {
  rendererSummaryList.innerHTML = renderDefinitionList({
    "rendered meshes": stats ? formatCount(stats.meshes) : "-",
    "rendered vertices": stats ? formatCount(stats.vertices) : "-",
    "rendered triangles": stats ? formatCount(stats.triangles) : "-",
    "material bindings": stats ? formatCount(stats.materialBindings) : "-",
    "rendered materials": stats ? formatCount(stats.materials) : "-",
    "texture maps": stats ? formatCount(stats.textures) : "-",
    "gaussian splats": stats ? formatCount(stats.gaussianSplats) : "-",
    "splat points": stats ? formatCount(stats.splatPoints) : "-",
  });
}

function collectRendererStats(
  renderables: RenderableMesh[],
  splats: RenderableGaussianSplat[]
): RendererStats {
  const materialKeys = new Set<string>();
  const textureKeys = new Set<string>();
  let materialBindings = 0;

  for (const renderable of renderables) {
    if (renderable.material) {
      addRenderableMaterialStats(renderable.material, renderable.path, materialKeys, textureKeys);
      materialBindings += 1;
    }
    for (const subset of renderable.materialSubsets ?? []) {
      addRenderableMaterialStats(subset.material, subset.path, materialKeys, textureKeys);
      materialBindings += 1;
    }
  }

  return {
    meshes: renderables.length,
    vertices: renderables.reduce((sum, renderable) => sum + Math.floor(renderable.points.length / 3), 0),
    triangles: renderables.reduce((sum, renderable) => sum + Math.floor(renderable.indices.length / 3), 0),
    materialBindings,
    materials: materialKeys.size,
    textures: textureKeys.size,
    gaussianSplats: splats.length,
    splatPoints: splats.reduce((sum, splat) => sum + splat.count, 0),
  };
}

function addRenderableMaterialStats(
  material: RenderableMaterial | undefined,
  fallbackKey: string,
  materialKeys: Set<string>,
  textureKeys: Set<string>
): void {
  if (!material) {
    return;
  }
  materialKeys.add(material.path ?? fallbackKey);
  for (const texture of [
    material.diffuseTexture,
    material.roughnessTexture,
    material.metallicTexture,
    material.normalTexture,
    material.occlusionTexture,
    material.emissiveTexture,
    material.clearcoatTexture,
    material.clearcoatRoughnessTexture,
    material.opacityTexture,
  ]) {
    if (texture?.path) {
      textureKeys.add(texture.path);
    }
  }
}

function getEffectiveUpAxis(stageUpAxis?: string | null): ViewUpAxis {
  if (upAxisChoice !== "stage") {
    return upAxisChoice;
  }
  return normalizeUpAxis(stageUpAxis);
}

function normalizeUpAxis(axis?: string | null): ViewUpAxis {
  return axis?.toLowerCase() === "z" ? "z" : "y";
}

function formatUpAxis(axis: ViewUpAxis): string {
  return axis === "z" ? "Z Up" : "Y Up";
}

function formatCount(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString();
}

function renderDefinitionList(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
    .join("");
}

// --- Menubar ---
const menuItems = Array.from(app.querySelectorAll<HTMLElement>(".menu-item"));
let activeMenu: HTMLElement | null = null;
let menuClickActive = false;

function openMenu(item: HTMLElement): void {
  activeMenu?.classList.remove("menu-open");
  activeMenu = item;
  item.classList.add("menu-open");
}

function closeMenus(): void {
  activeMenu?.classList.remove("menu-open");
  activeMenu = null;
  menuClickActive = false;
}

for (const item of menuItems) {
  const btn = item.querySelector<HTMLButtonElement>(".menu-btn");
  if (!btn) continue;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activeMenu === item && menuClickActive) {
      closeMenus();
    } else {
      openMenu(item);
      menuClickActive = true;
    }
  });
  btn.addEventListener("mouseenter", () => {
    if (menuClickActive && activeMenu !== item) openMenu(item);
  });
}

document.addEventListener("click", () => closeMenus());

app.querySelector("#menuOpenFile")?.addEventListener("click", () => {
  filePicker.click();
});

app.querySelector("#menuOpenFolder")?.addEventListener("click", () => {
  folderPicker.click();
});

app.querySelector("#menuStats")?.addEventListener("click", () => {
  statsPanel.hidden = !statsPanel.hidden;
});

function applyNavigationOptions(): void {
  viewport.setNavigationMode(navigationMode);
  viewport.setGameCameraSpeed(gameCameraSpeed);

  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-navigation-mode]")) {
    button.classList.toggle("menu-option--checked", button.dataset.navigationMode === navigationMode);
  }
  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-camera-speed]")) {
    button.classList.toggle("menu-option--checked", Number(button.dataset.cameraSpeed) === gameCameraSpeed);
  }
}

function applyUpAxisOptions(): void {
  const effectiveUpAxis = getEffectiveUpAxis(currentStageSummary?.upAxis);
  viewport.setViewUpAxis(effectiveUpAxis);

  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-up-axis]")) {
    button.classList.toggle("menu-option--checked", button.dataset.upAxis === upAxisChoice);
  }
  renderStageSummary(currentStageSummary);
}

function applyColorSpaceOptions(): void {
  viewport.setOutputColorSpace(outputColorSpace as ColorSpace);
  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-output-color-space]")) {
    button.classList.toggle("menu-option--checked", button.dataset.outputColorSpace === outputColorSpace);
  }
}

async function applyMaterialXOptions(): Promise<void> {
  viewport.setMaterialXFlipV(materialXFlipV);
  app!.querySelector<HTMLButtonElement>("#menuMaterialXFlipV")
    ?.classList.toggle("menu-option--checked", materialXFlipV);

  if (!runtime.currentStagePath || isLoadingStage) {
    return;
  }

  const materializedRenderables = runtime.extractRenderablesWithMaterials();
  if (materializedRenderables.length === 0) {
    return;
  }

  setStatus("reloading MaterialX...", true);
  await viewport.updateRenderablesAsync(materializedRenderables);
  setStatus("Ready", false);
}

function toneMappingForChoice(choice: ToneMappingChoice): ToneMapping {
  switch (choice) {
    case "linear":
      return LinearToneMapping;
    case "reinhard":
      return ReinhardToneMapping;
    case "cineon":
      return CineonToneMapping;
    case "aces":
      return ACESFilmicToneMapping;
    case "agx":
      return AgXToneMapping;
    case "neutral":
      return NeutralToneMapping;
    case "custom":
      return CustomToneMapping;
    case "none":
    default:
      return NoToneMapping;
  }
}

function applyToneMappingOptions(): void {
  viewport.setToneMapping(toneMappingForChoice(toneMappingChoice));
  viewport.setToneMappingExposure(toneMappingExposure);
  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-tone-mapping]")) {
    button.classList.toggle("menu-option--checked", button.dataset.toneMapping === toneMappingChoice);
  }
  toneMappingExposureInput.value = String(toneMappingExposure);
  toneMappingExposureValue.textContent = toneMappingExposure.toFixed(2);
}

function applyLightingOptions(): void {
  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-lighting-mode]")) {
    button.classList.toggle("menu-option--checked", button.dataset.lightingMode === lightingMode);
  }
  app!.querySelector<HTMLButtonElement>("#menuHdriVisible")
    ?.classList.toggle("menu-option--checked", hdriMapVisible);
  const loadButton = app!.querySelector<HTMLButtonElement>("#menuLoadHdriMap");
  if (loadButton) {
    loadButton.classList.toggle("menu-option--checked", lightingMode === "hdri");
    loadButton.textContent = hdriMapLabel
      ? `Load HDRi map... (${hdriMapLabel})`
      : "Load HDRi map...";
  }
  hdriIntensityInput.value = String(hdriIntensity);
  hdriIntensityValue.textContent = hdriIntensity.toFixed(2);
}

function syncViewportState(target: ThreeViewport): void {
  target.setSplatViewOptions({
    maxShDegree: splatFidelityOptions[splatFidelityIndex].maxShDegree,
    scaleMultiplier: splatDetailOptions[splatDetailIndex].scaleMultiplier,
  });
  target.setNavigationMode(navigationMode);
  target.setGameCameraSpeed(gameCameraSpeed);
  target.setViewUpAxis(getEffectiveUpAxis(currentStageSummary?.upAxis));
  target.setOutputColorSpace(outputColorSpace as ColorSpace);
  target.setMaterialXFlipV(materialXFlipV);
  target.setToneMapping(toneMappingForChoice(toneMappingChoice));
  target.setToneMappingExposure(toneMappingExposure);
  if (lightingMode === "default" || !hdriMapLabel) {
    target.useDefaultLighting();
  }
  target.setHdriMapVisible(hdriMapVisible);
  target.setHdriIntensity(hdriIntensity);
}

function replaceViewport(): void {
  viewport.dispose();
  viewport = new ThreeViewport(viewportElement!);
  syncViewportState(viewport);
  viewport.start(onTick);
}

for (const button of app.querySelectorAll<HTMLButtonElement>("[data-navigation-mode]")) {
  button.addEventListener("click", () => {
    navigationMode = button.dataset.navigationMode as NavigationMode;
    applyNavigationOptions();
  });
}

for (const button of app.querySelectorAll<HTMLButtonElement>("[data-camera-speed]")) {
  button.addEventListener("click", () => {
    gameCameraSpeed = Number(button.dataset.cameraSpeed);
    applyNavigationOptions();
  });
}

viewportElement.addEventListener("camera-speed-change", (event) => {
  gameCameraSpeed = (event as CustomEvent<{ speed: number }>).detail.speed;
  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-camera-speed]")) {
    button.classList.toggle("menu-option--checked", Number(button.dataset.cameraSpeed) === gameCameraSpeed);
  }
});

for (const button of app.querySelectorAll<HTMLButtonElement>("[data-up-axis]")) {
  button.addEventListener("click", () => {
    upAxisChoice = button.dataset.upAxis as UpAxisChoice;
    applyUpAxisOptions();
  });
}

for (const button of app.querySelectorAll<HTMLButtonElement>("[data-output-color-space]")) {
  button.addEventListener("click", () => {
    outputColorSpace = button.dataset.outputColorSpace === LinearSRGBColorSpace
      ? LinearSRGBColorSpace
      : SRGBColorSpace;
    applyColorSpaceOptions();
  });
}

app.querySelector("#menuMaterialXFlipV")?.addEventListener("click", () => {
  materialXFlipV = !materialXFlipV;
  void applyMaterialXOptions();
});

for (const button of app.querySelectorAll<HTMLButtonElement>("[data-tone-mapping]")) {
  button.addEventListener("click", () => {
    toneMappingChoice = (button.dataset.toneMapping ?? "none") as ToneMappingChoice;
    applyToneMappingOptions();
  });
}

app.querySelector("#toneMappingExposureControl")?.addEventListener("click", (event) => {
  event.stopPropagation();
});

toneMappingExposureInput.addEventListener("input", () => {
  toneMappingExposure = Number(toneMappingExposureInput.value);
  applyToneMappingOptions();
});

app.querySelector("#menuLoadHdriMap")?.addEventListener("click", () => {
  hdriPicker.value = "";
  hdriPicker.click();
});

for (const button of app.querySelectorAll<HTMLButtonElement>("[data-lighting-mode]")) {
  button.addEventListener("click", () => {
    lightingMode = button.dataset.lightingMode as LightingMode;
    if (lightingMode === "default") {
      viewport.useDefaultLighting();
      hdriMapLabel = null;
    }
    applyLightingOptions();
    setStatus("Ready", false);
  });
}

app.querySelector("#menuHdriVisible")?.addEventListener("click", () => {
  hdriMapVisible = !hdriMapVisible;
  viewport.setHdriMapVisible(hdriMapVisible);
  applyLightingOptions();
});

app.querySelector("#hdriIntensityControl")?.addEventListener("click", (event) => {
  event.stopPropagation();
});

hdriIntensityInput.addEventListener("input", () => {
  hdriIntensity = Number(hdriIntensityInput.value);
  viewport.setHdriIntensity(hdriIntensity);
  applyLightingOptions();
});

function applySplatViewOptions(): void {
  const fidelity = splatFidelityOptions[splatFidelityIndex];
  const detail = splatDetailOptions[splatDetailIndex];
  viewport.setSplatViewOptions({
    maxShDegree: fidelity.maxShDegree,
    scaleMultiplier: detail.scaleMultiplier,
  });

  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-splat-fidelity]")) {
    button.classList.toggle("menu-option--checked", Number(button.dataset.splatFidelity) === splatFidelityIndex);
  }
  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-splat-detail]")) {
    button.classList.toggle("menu-option--checked", Number(button.dataset.splatDetail) === splatDetailIndex);
  }
}

function applyPayloadOpenOptions(): void {
  localStorage.setItem(
    loadAllPayloadsOnStageOpenStorageKey,
    String(loadAllPayloadsOnStageOpen)
  );
  for (const button of app!.querySelectorAll<HTMLButtonElement>("[data-load-payloads-on-open]")) {
    button.classList.toggle(
      "menu-option--checked",
      button.dataset.loadPayloadsOnOpen === String(loadAllPayloadsOnStageOpen)
    );
  }
}

for (const button of app.querySelectorAll<HTMLButtonElement>("[data-splat-fidelity]")) {
  button.addEventListener("click", () => {
    splatFidelityIndex = Number(button.dataset.splatFidelity);
    applySplatViewOptions();
  });
}

for (const button of app.querySelectorAll<HTMLButtonElement>("[data-splat-detail]")) {
  button.addEventListener("click", () => {
    splatDetailIndex = Number(button.dataset.splatDetail);
    applySplatViewOptions();
  });
}

for (const button of app.querySelectorAll<HTMLButtonElement>("[data-load-payloads-on-open]")) {
  button.addEventListener("click", () => {
    loadAllPayloadsOnStageOpen = button.dataset.loadPayloadsOnOpen === "true";
    applyPayloadOpenOptions();
  });
}

applySplatViewOptions();
applyNavigationOptions();
applyUpAxisOptions();
applyColorSpaceOptions();
void applyMaterialXOptions();
applyToneMappingOptions();
applyLightingOptions();
applyPayloadOpenOptions();

app.querySelector("#menuLoadAllPayloads")?.addEventListener("click", () => {
  runtime.setAllPayloadsLoaded(true);
  void applyVariantChange(undefined, undefined, "loading payloads...");
});

app.querySelector("#menuUnloadAllPayloads")?.addEventListener("click", () => {
  runtime.setAllPayloadsLoaded(false);
  void applyVariantChange(undefined, undefined, "unloading payloads...");
});

statsClose.addEventListener("click", () => {
  statsPanel.hidden = true;
});

app.querySelector("#menuTutorial")?.addEventListener("click", () => {
  tutorialOverlay.hidden = false;
});

tutorialClose.addEventListener("click", () => {
  tutorialOverlay.hidden = true;
});

tutorialOverlay.addEventListener("click", (e) => {
  if (e.target === tutorialOverlay) tutorialOverlay.hidden = true;
});

// --- Boot + file loading ---
async function boot(): Promise<void> {
  renderRuntimeStatus(runtime.status);
  currentStageSummary = null;
  renderStageSummary(null);
  syncViewportState(viewport);
  viewport.start(onTick);

  const status = await runtime.load();
  renderRuntimeStatus(status);

}

async function loadFiles(files: File[]): Promise<void> {
  if (!files.length) {
    return;
  }
  const loadSerial = ++stageLoadSerial;

  hidePlaybar();
  isLoadingStage = true;
  setStatus("loading USD stage...", true);
  await waitForUiPaint();
  if (loadSerial !== stageLoadSerial) {
    return;
  }
  clearSceneGraph();
  currentRendererStats = null;
  viewportElement!.classList.remove("has-stage");

  const rootFile = pickLikelyRootFile(files);
  currentStageSummary = {
    rootFile: rootFile?.webkitRelativePath || rootFile?.name || "Unknown",
  };
  renderStageSummary(currentStageSummary);
  replaceViewport();

  let result: StageLoadResult;
  try {
    const referenceHydraRenderInterface = viewport.createReferenceHydraRenderInterface();
    result = await runtime.loadStage({
      files,
      rootFile,
      referenceHydraRenderInterface,
      loadAllPayloads: loadAllPayloadsOnStageOpen,
    });
  } catch (error) {
    if (loadSerial === stageLoadSerial) {
      isLoadingStage = false;
      setStatus(`Stage load failed: ${error instanceof Error ? error.message : String(error)}`, false);
    }
    throw error;
  }
  if (loadSerial !== stageLoadSerial) {
    return;
  }

  currentStageSummary = result.summary;
  applyUpAxisOptions();
  renderRuntimeStatus(runtime.status);
  const gaussianSplats = result.gaussianSplats ?? [];
  let rendererStatsRenderables = result.renderables ?? [];
  if (!result.usedReferenceHydraDriver && rendererStatsRenderables.length > 0) {
    setStatus("loading materials...", true);
    await waitForUiPaint();
    if (loadSerial !== stageLoadSerial) {
      return;
    }
    const materializedRenderables = runtime.extractRenderablesWithMaterials();
    if (materializedRenderables.length > 0) {
      rendererStatsRenderables = materializedRenderables;
    }
  }
  await viewport.prepareForRenderables(rendererStatsRenderables);
  if (loadSerial !== stageLoadSerial) {
    return;
  }
  if (result.usedReferenceHydraDriver) {
    viewport.frameCurrentStage();
  } else {
    viewport.renderStage(rendererStatsRenderables, result.summary, gaussianSplats.length > 0);
  }
  viewport.renderGaussianSplats(gaussianSplats);
  currentRendererStats = collectRendererStats(rendererStatsRenderables, gaussianSplats);
  renderStageSummary(currentStageSummary);
  renderSceneGraph(runtime.getSceneGraph());
  viewportElement!.classList.add("has-stage");

  if (result.summary) {
    const s = result.summary;
    const start = s.startTimeCode ?? 0;
    const end = s.endTimeCode ?? 0;
    if (end > start) {
      showPlaybar(s);
      // Override with authoritative driver timing if available
      const driverTiming = runtime.getStageTiming();
      if (driverTiming && driverTiming.end > driverTiming.start) {
        animStart = driverTiming.start;
        animEnd = driverTiming.end;
        animFps = driverTiming.fps;
        animCurrent = animStart;
        playbarScrubber!.min = String(animStart);
        playbarScrubber!.max = String(animEnd);
        updatePlaybarScrubber();
      }
    }
  }
  await waitForUiPaint();
  if (loadSerial !== stageLoadSerial) {
    return;
  }
  if (result.usedReferenceHydraDriver || rendererStatsRenderables.length > 0) {
    if (result.usedReferenceHydraDriver) {
      setStatus("loading materials...", true);
      await waitForUiPaint();
      if (loadSerial !== stageLoadSerial) {
        return;
      }
    }
    const materializedRenderables = result.usedReferenceHydraDriver
      ? runtime.extractRenderablesWithMaterials()
      : rendererStatsRenderables;
    if (materializedRenderables.length > 0) {
      setStatus("decoding textures...", true);
      await waitForUiPaint();
      if (loadSerial !== stageLoadSerial) {
        return;
      }
      await viewport.updateRenderablesAsync(materializedRenderables);
      if (loadSerial !== stageLoadSerial) {
        return;
      }
      rendererStatsRenderables = materializedRenderables;
      currentRendererStats = collectRendererStats(rendererStatsRenderables, gaussianSplats);
      renderStageSummary(currentStageSummary);
    }
  }
  if (loadSerial === stageLoadSerial) {
    isLoadingStage = false;
    setStatus(result.summary?.error ? "Stage load failed" : "Ready", false);
  }
}

filePicker.addEventListener("change", () => {
  void loadFiles(Array.from(filePicker.files ?? []));
});

folderPicker.addEventListener("change", () => {
  void loadFiles(Array.from(folderPicker.files ?? []));
});

hdriPicker.addEventListener("change", () => {
  const file = hdriPicker.files?.[0];
  if (!file) {
    return;
  }

  void (async () => {
    setStatus("loading HDRi map...", true);
    await waitForUiPaint();
    try {
      viewport.setHdriMapVisible(hdriMapVisible);
      viewport.setHdriIntensity(hdriIntensity);
      await viewport.loadHdriMap(file);
      lightingMode = "hdri";
      hdriMapLabel = file.name;
      applyLightingOptions();
      setStatus("Ready", false);
    } catch (error) {
      setStatus(`HDRi load failed: ${error instanceof Error ? error.message : String(error)}`, false);
      console.warn("Failed to load HDRi map", error);
    }
  })();
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

// --- Keyboard shortcuts ---
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  if ((e.key === "f" || e.key === "F") && selectedPrimPath) {
    viewport.framePrim(selectedPrimPath);
  }
  if (e.key === "Escape") {
    closeMenus();
    statsPanel.hidden = true;
    tutorialOverlay.hidden = true;
  }
});

// --- Viewport pick on click (distinguish from orbit drag) ---
let pickMouseStart: { x: number; y: number } | null = null;

viewportElement.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  pickMouseStart = { x: e.clientX, y: e.clientY };
});

viewportElement.addEventListener("mouseup", (e) => {
  if (e.button !== 0 || !pickMouseStart) return;
  const dx = e.clientX - pickMouseStart.x;
  const dy = e.clientY - pickMouseStart.y;
  pickMouseStart = null;
  if (dx * dx + dy * dy > 16) return; // was a drag
  const path = viewport.pickPrim(e.clientX, e.clientY);
  if (path) {
    selectPrimByPath(path);
  } else {
    // click on empty space — deselect
    selectedPrimPath = null;
    sceneGraphList!.querySelectorAll(".sg-item").forEach((el) => el.classList.remove("sg-selected"));
    attrList!.innerHTML = '<p class="sg-empty">Select a prim to inspect</p>';
    attrPrimPath!.textContent = "";
    viewport.setSelectedPrim(null);
  }
});

// --- Docked panel resize ---
const shell = app.querySelector<HTMLElement>("#shell")!;
const sgResizeX = app.querySelector<HTMLElement>("#sgResizeX")!;
const attrResizeY = app.querySelector<HTMLElement>("#attrResizeY")!;

let sgDrag: { startX: number; startW: number } | null = null;
let attrDrag: { startY: number; startH: number } | null = null;

sgResizeX.addEventListener("mousedown", (e) => {
  sgDrag = {
    startX: e.clientX,
    startW: parseInt(shell.style.getPropertyValue("--sg-w") || "240"),
  };
  document.body.style.cursor = "col-resize";
  e.preventDefault();
});

attrResizeY.addEventListener("mousedown", (e) => {
  attrDrag = {
    startY: e.clientY,
    startH: parseInt(shell.style.getPropertyValue("--attr-h") || "200"),
  };
  document.body.style.cursor = "row-resize";
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (sgDrag) {
    const w = Math.max(140, Math.min(600, sgDrag.startW + e.clientX - sgDrag.startX));
    shell.style.setProperty("--sg-w", `${w}px`);
  }
  if (attrDrag) {
    const h = Math.max(60, Math.min(600, attrDrag.startH + attrDrag.startY - e.clientY));
    shell.style.setProperty("--attr-h", `${h}px`);
  }
});

document.addEventListener("mouseup", () => {
  if (sgDrag || attrDrag) document.body.style.cursor = "";
  sgDrag = null;
  attrDrag = null;
});

void boot();
