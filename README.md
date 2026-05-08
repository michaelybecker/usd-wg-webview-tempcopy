# USD Web View

USD Web View is an OpenUSD inspection environment. The architecture combines a WASM-based C++ binding layer with a modern TypeScript frontend powered by Vite, Three.js, and a clean separation of concerns.

## Development

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The WASM bindings must be built first — see [docs/building.md](docs/building.md).

## Documentation

- [Building](docs/building.md) — Prerequisites and build instructions for the WASM bindings and frontend
