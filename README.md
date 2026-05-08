# USD Web View

USD Web View is an OpenUSD inspection environment. The architecture combines a WASM-based C++ binding layer with a modern TypeScript frontend powered by Vite, Three.js, and a clean separation of concerns.

## Development

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Binding Work

Binding rebuild notes live in:

```text
docs/bindings-workflow.md
```

Generated USD Web View WASM runtime files should install into:

```text
public/usd-webview-bindings/
```

The app currently expects `public/usd-webview-bindings/usdWebViewBindings.js`. Until that runtime exists, the viewport shell runs and the runtime panel reports bindings as unavailable.
