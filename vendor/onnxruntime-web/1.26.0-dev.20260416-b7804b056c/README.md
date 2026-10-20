# onnxruntime-web 1.26.0-dev.20260416-b7804b056c (vendored wasm runtime)

Unmodified files from `onnxruntime-web@1.26.0-dev.20260416-b7804b056c`, the
version `@huggingface/transformers@4.2.0` depends on and bundles into its web
build (`import "onnxruntime-web/webgpu"`). Copied from the installed package's
`dist/`; the npm tarball's shasum is `453f29768836322a6b8b6d1d730a8426b6582ae2`.

| File | Package path | sha256 |
| --- | --- | --- |
| `ort-wasm-simd-threaded.asyncify.mjs` | `dist/ort-wasm-simd-threaded.asyncify.mjs` | `5959c6733039619c9af710d8e1bae8d6e84402787990637be987c2b1bd6c5fa9` |
| `ort-wasm-simd-threaded.asyncify.wasm` | `dist/ort-wasm-simd-threaded.asyncify.wasm` | `e0c0c6d3e73d43b8a249972f8358f845b08cc16fec3c80efafdf8bed40366786` |
| `LICENSE` | not in the npm package; `LICENSE` of microsoft/onnxruntime at the package's commit `b7804b056c30aa35c1748f8e4e239d0e2ff25d6d` (MIT, as `package.json` states) | `2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c` |

Why vendored: transformers points onnxruntime-web at
`cdn.jsdelivr.net/npm/onnxruntime-web@<version>/dist/` unless `wasmPaths` is
set, and Connect's CSP (`script-src 'self' …`) blocks that import.
`onnxruntime-web` is a nested pnpm dependency of transformers, so the package
cannot resolve it by name. The chat embedder
(`editors/knowledge-vault/chat/core/gte-embedder.ts`) passes
`wasmPaths: { mjs, wasm }` built with `new URL("…", import.meta.url)`, so Vite
serves both files from the package origin in dev and emits them as hashed
assets in `dist/browser/assets/`. The asyncify pair is the one transformers
itself picks outside Safari.

These must match the onnxruntime-web version inside transformers' web build.
`tests/unit/chat-ort-vendor.test.ts` fails when the installed version differs
from this directory's name or the files differ from the installed ones. To
upgrade: copy the same two files from the new version's `dist/` into
`vendor/onnxruntime-web/<version>/` and update the paths in `gte-embedder.ts`.
