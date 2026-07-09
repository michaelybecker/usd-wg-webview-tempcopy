import type { SceneGraphPrim } from "../usd/types";
import { runtime, state } from "./appState";
import { attrList, attrPrimPath, escHtml, sceneGraphList } from "./dom";
import { renderAttributes } from "./attributesPanel";
import { applyVariantChange } from "./stageEdits";

function isAncestorCollapsed(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    if (state.collapsedNodes.has("/" + parts.slice(0, i).join("/"))) return true;
  }
  return false;
}

function renderPrimItem(p: SceneGraphPrim): string {
  const indent = 4 + p.depth * 14;
  const isCollapsed = state.collapsedNodes.has(p.path);
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
  if (!state.allPrims.length) {
    sceneGraphList.innerHTML = '<li class="sg-empty">No prims</li>';
    return;
  }
  sceneGraphList.innerHTML = state.allPrims
    .filter((p) => !isAncestorCollapsed(p.path))
    .map(renderPrimItem)
    .join("");
  if (state.selectedPrimPath) {
    sceneGraphList
      .querySelector<HTMLElement>(`[data-path="${state.selectedPrimPath.replace(/"/g, '\\"')}"]`)
      ?.classList.add("sg-selected");
  }
}

export function renderSceneGraph(prims: SceneGraphPrim[]): void {
  state.allPrims = prims;
  _renderSceneGraphList();
}

export function clearSceneGraph(): void {
  state.allPrims = [];
  state.collapsedNodes.clear();
  state.selectedPrimPath = null;
  sceneGraphList.innerHTML = "";
  attrList.innerHTML = '<p class="sg-empty">Select a prim to inspect</p>';
  attrPrimPath.textContent = "";
  state.viewport.setSelectedPrim(null);
}

export function selectPrimByPath(path: string): void {
  // Expand any collapsed ancestors so the item is visible
  const parts = path.split("/").filter(Boolean);
  let changed = false;
  for (let i = 1; i < parts.length; i++) {
    const ancestor = "/" + parts.slice(0, i).join("/");
    if (state.collapsedNodes.has(ancestor)) { state.collapsedNodes.delete(ancestor); changed = true; }
  }
  if (changed) _renderSceneGraphList();

  state.selectedPrimPath = path;
  sceneGraphList.querySelectorAll(".sg-item").forEach((el) => el.classList.remove("sg-selected"));
  const el = sceneGraphList.querySelector<HTMLElement>(`[data-path="${path.replace(/"/g, '\\"')}"]`);
  if (el) { el.classList.add("sg-selected"); el.scrollIntoView({ block: "nearest" }); }

  renderAttributes(path, runtime.getPrimAttributes(path));
  state.viewport.setSelectedPrim(path);
}

sceneGraphList.addEventListener("click", (e) => {
  const toggleBtn = (e.target as Element).closest<HTMLElement>(".sg-toggle");
  if (toggleBtn?.dataset.togglePath) {
    const path = toggleBtn.dataset.togglePath;
    if (state.collapsedNodes.has(path)) {
      state.collapsedNodes.delete(path);
    } else {
      state.collapsedNodes.add(path);
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
