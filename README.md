# USD Web View

USD Web View is a browser-based OpenUSD inspection and rendering environment.
It parses USD files entirely in-browser using a WASM build of OpenUSD, renders
meshes and Gaussian splats in Three.js, and plays back animation. No server is
required.

## Features

- **File formats** - USD, USDA, USDC, USDZ, multi-file folder drops, and
  MaterialX sidecar resources.
- **Unified mesh runtime** - one native `WebViewStageDriver` handles static
  meshes, animated transforms, skinned meshes, variants, payload edits, UVs,
  authored normals, subsets, and material bindings.
- **Materials** - UsdPreviewSurface PBR scalars and texture slots (diffuse,
  roughness, metallic, normal, occlusion, emissive, clearcoat, clearcoat
  roughness, opacity), plus MaterialX materials through the pinned Three.js
  `MaterialXLoader` fork.
- **Variant sets** - variant badges in the scene graph, dropdown selection in
  the attributes panel, and coherent geometry/material redraws after selection
  changes.
- **Payloads** - per-prim load/unload from the scene graph, bulk load/unload
  from the Stage menu, and a stage-open policy for loading payloads by default.
- **Gaussian splats** - USD-authored splat data rendered with SparkJS alongside
  mesh content, with fidelity and detail controls for spherical harmonics and
  splat scale.
- **Animation playback** - timecode scrubbing and play/pause via a minimal
  playbar, shown when the loaded stage has an animated time range.
- **Inspection UI** - scene graph, prim attributes, selection highlighting,
  payload and variant badges, stage summary, renderer stats, up-axis handling,
  and HDRI/default lighting controls.
- **USD 26 compatibility** - works with older USDZ files that authored
  `material:binding` before `UsdShadeMaterialBindingAPI` became a formal
  applied-API schema.

## Current Constraints

- **Gaussian splats + MaterialX** - SparkJS is WebGL-only. MaterialX content
  switches the viewport to `WebGPURenderer`, so splats are not rendered in that
  combined mode; the status bar calls this out explicitly.
- **MaterialX dependency** - `three` is pinned to a `bhouston/three.js` tarball
  until upstream Three.js has matching `MaterialXLoader` support.

## Architecture

```
C++ (OpenUSD + Emscripten)          native/usd-webview-bindings/src/*.cpp
        ↓  compiled to WASM
JS wrapper                           public/usd-webview-bindings/usdWebViewBindings.js
        ↓  installed to public/
TypeScript runtime                   src/usd/UsdWebViewRuntime.ts
        ↓
Three.js viewport + app shell        src/viewer/*  ·  src/app/*  ·  src/main.ts
```

The native side is split into translation units under
`native/usd-webview-bindings/src/` — `unifiedDriver.cpp` (the stage driver),
`materials.cpp`, `meshExtraction.cpp`, `pointInstancer.cpp`,
`skelBinding.cpp`, `splats.cpp`, `stageApi.cpp`, `stageRegistry.cpp`,
`jsInterop.cpp`, and `bindings.cpp` — sharing `webviewCommon.h`. The viewport
is a facade (`src/viewer/ThreeViewport.ts`) over focused modules:
`RendererManager`, `GeometryBuilder`, `MaterialFactory`, `TextureCache`,
`Lighting`, `Navigation`, and `Picking`. See
[Material and Geometry Strategy](docs/material-geometry-strategy.md) for the
runtime architecture.

The viewport geometry path is intentionally singular: `UsdWebViewRuntime`
creates one native `WebViewStageDriver` per loaded stage. Static meshes,
skinned meshes, animated transforms, variant changes, and payload changes all
draw through that driver. Authored material payloads and Gaussian splats are
side suppliers; they are not alternate mesh runtimes.

## Why the bhouston three.js fork?

`package.json` pins `three` to a tarball of `bhouston/three.js` because the
viewer's MaterialX path depends on `MaterialXLoader` work that has not landed
upstream yet. Swap back to upstream `three` once its `MaterialXLoader` reaches
parity.

## Testing

```sh
npm run test:unit        # vitest unit layer
npm run test:regression  # visual regression: corpus in tests/corpus/,
                         # committed baselines in tests/regression/baselines/
npm run test             # both
```

Baseline changes are re-blessed with `npm run test:regression:bless` and
reviewed as PNG diffs in git.

## Development

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The WASM bindings must be built first — see [docs/building.md](docs/building.md).

## Documentation

- [Building](docs/building.md) — Prerequisites and build instructions for the WASM bindings and frontend
- [Material and Geometry Strategy](docs/material-geometry-strategy.md) — Unified stage-driver geometry, authored-material payloads, and known rendering constraints
- [USD Material Fidelity](docs/usd-material-fidelity.md) — Local harness for USD-wrapping `material-fidelity` cases and validating the viewer translation boundary
