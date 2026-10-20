# @wllama/wllama 3.8.1 (vendored)

Unmodified files from the npm tarball
`https://registry.npmjs.org/@wllama/wllama/-/wllama-3.8.1.tgz`
(shasum `e0353359cbfa3d93c844bf5787914bfedc1190cb`, integrity
`sha512-Pl7BEJhPU8OHnV/yhn3DFZYhLLOdSHh+4TND79WCftHnlUAdQPAsyc/CfIOY+4mVxvf5VW3Xw3Uf7BBfotS1gw==`).

| File          | Tarball path                   | sha256                                                             |
| ------------- | ------------------------------ | ------------------------------------------------------------------ |
| `index.js`    | `package/esm/index.js`         | `e5506753e41a59c11f61f2c52422045be9fc76e32a7e47f037aaad5df4ec723e` |
| `wllama.wasm` | `package/esm/wasm/wllama.wasm` | `551f13439366eff11e057b1b91fe46a7fdac29d56d67372d4c5f19a549dfe70c` |
| `LICENCE`     | `package/LICENCE`              | `5866e3bd7e3cbd3f7c8bea6efd8a1e7fa7cc8de68c30f428aff7c6584a0fb720` |

`index.d.ts` is ours (see its header).

Why vendored: the npm package has no `exports` and its `main` points at a
missing file, so it can't be imported as a dependency. Connect's CSP
(`script-src 'self' … https://registry.vetra.io`) blocks importing it from a
CDN. The chat loader (`editors/knowledge-vault/chat/core/llm-client.ts`)
imports `index.js` with a relative dynamic import, so the bundler emits it as
a lazy chunk of this package, and passes wllama a
`new URL("…/wllama.wasm", import.meta.url)` path, which the browser build
emits as a hashed asset in `dist/browser/assets/`. Both are served from the
same origin as the package.

Not vendored: `@wllama/wllama-compat` (16 MB unpacked). wllama uses it only
in browsers without JSPI or WebAssembly memory64 (`needCompat()`), and then
fetches its worker JS and wasm from `cdn.jsdelivr.net/npm/@wllama/wllama-compat@3.8.1/`.

To upgrade: extract the same paths from the new tarball into a new
`vendor/wllama/<version>/` directory and update the import paths and
`WLLAMA_VERSION` in `llm-client.ts`.
