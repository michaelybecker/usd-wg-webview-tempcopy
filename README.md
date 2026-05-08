# USD Web View

USD Web View is a browser-based OpenUSD inspection and rendering environment. It parses USD files entirely in-browser using a WASM build of OpenUSD, renders meshes in Three.js, and plays back animation — no server required.

## Features

- **File formats** — USD, USDA, USDC, USDZ (including multi-file folder drops)
- **Material extraction** — UsdPreviewSurface PBR scalars and all texture slots (diffuse, roughness, metallic, normal, occlusion, emissive, clearcoat, clearcoat roughness, opacity)
- **Mesh rendering** — triangulated geometry with UV support and smooth vertex normals
- **Animation playback** — timecode scrubbing and play/pause via a minimal playbar, shown only when the asset has actual animated transforms
- **Stage summary** — prim count, layer count, fps, time range, up axis
- **USD 26 compatibility** — works with older USDZ files that authored `material:binding` before `UsdShadeMaterialBindingAPI` became a formal applied-API schema

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
