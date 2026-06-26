# USD Web View

USD Web View is a browser-based OpenUSD inspection and rendering environment. It parses USD files entirely in-browser using a WASM build of OpenUSD, renders meshes in Three.js, and plays back animation — no server required.

## Features

- **File formats** — USD, USDA, USDC, USDZ (including multi-file folder drops)
- **Material extraction** — UsdPreviewSurface PBR scalars and all texture slots (diffuse, roughness, metallic, normal, occlusion, emissive, clearcoat, clearcoat roughness, opacity)
- **Mesh rendering** — triangulated geometry with UV support and smooth vertex normals
- **Animation playback** — timecode scrubbing and play/pause via a minimal playbar, shown only when the asset has actual animated transforms
- **Stage summary** — prim count, layer count, fps, time range, up axis
- **USD 26 compatibility** — works with older USDZ files that authored `material:binding` before `UsdShadeMaterialBindingAPI` became a formal applied-API schema

## Planned Features

The following are scoped and in-progress. Features marked **[WASM]** require a C++ rebuild of the bindings; **[lib]** require a new JS dependency.

| # | Feature | Notes |
|---|---------|-------|
| 1 | **Variant sets** — read and select USD variant sets | Shown as `V` badge in scene graph; dropdown selector in attributes panel; re-renders on change. **[WASM]** |
| 2 | **Payloads** — per-prim load/unload + global load/unload all | `P` badge (grey = unloaded, green = loaded); right-click context menu on prim; View > Load/Unload All. **[WASM]** |
| 3 | **Gaussian Splat support** — drop `.splat`/`.ply`/`.spz` files | Rendered via SparkJS alongside the Three.js scene; USD asset-reference path is future scope. **[lib]** |
| 4 | **Wireframe** — quad-based, artist-friendly topology | Reconstructed from USD `faceVertexCounts` / `faceVertexIndices` (not triangulated diagonals); toggled from View menu. **[WASM]** |
| 5 | **Unlit view** — flat/unlit shading mode | Swaps `MeshPhysicalMaterial` → `MeshBasicMaterial` preserving color + textures; toggled from View menu. |
| 6 | **Viewport orientation gizmo** — Unity-style 3D axis cube | Uses Three.js `ViewHelper`; renders in viewport corner; click a face to snap camera. |

## Architecture

```
C++ (OpenUSD + Emscripten)          native/usd-webview-bindings/main.cpp
        ↓  compiled to WASM
JS wrapper                           native/usd-webview-bindings/usdWebViewBindings.js
        ↓  installed to public/
TypeScript runtime                   src/usd/UsdWebViewRuntime.ts
        ↓
Three.js viewport + app shell        src/viewer/ThreeViewport.ts  ·  src/main.ts
```

## Development

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The WASM bindings must be built first — see [docs/building.md](docs/building.md).

## Documentation

- [Building](docs/building.md) — Prerequisites and build instructions for the WASM bindings and frontend
- [Material and Geometry Strategy](docs/material-geometry-strategy.md) — Native/Hydra vs authored-material responsibilities, plus the fresh-start stage-load methodology
- [USD Material Fidelity](docs/usd-material-fidelity.md) — Local harness for USD-wrapping `material-fidelity` cases and validating the viewer translation boundary
