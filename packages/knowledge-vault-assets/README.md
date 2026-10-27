# @powerhousedao/knowledge-vault-assets

The files the Knowledge Vault's server-side embedder loads, published apart
from `@powerhousedao/knowledge-note` so a vault release does not carry 30 MB
that never changes between releases.

```
dist/
  models/Supabase/gte-small/…              the embedding model (q8, 384 dimensions)
  wasm/ort-wasm-simd-threaded.asyncify.*   the ONNX runtime (onnxruntime-web)
  transformers.web.bundle.mjs              transformers.js, web build, no bare imports
  assets.json                              what this build was made from
```

There is no JavaScript to import. The vault's embedder finds these files:

- **on disk**, where this package is installed (the desktop app) or in the
  vault's repository (`packages/knowledge-vault-assets/`);
- **on the registry CDN** everywhere else (a Switchboard running the vault
  from its registry cache):
  `<registry>/-/cdn/@powerhousedao/knowledge-vault-assets@<version>/`.

`@powerhousedao/knowledge-note` names the version it loads as an optional
peer dependency. Install this package only where the vault must embed
offline.

## Building and publishing

```bash
node scripts/build.mjs        # from this folder; uses the vault repository's node_modules
npm pack --dry-run            # check the file list
```

`prepack` runs the build, so a publish always carries a complete `dist/`.
The model in `models/` is committed; `scripts/fetch-model.mjs` restores it
from Hugging Face if it is ever lost. A new model or runtime version is a new
version of this package, and the vault's pin moves with it.

## Licences

The model ([thenlper/gte-small](https://huggingface.co/thenlper/gte-small),
as converted by [Supabase/gte-small](https://huggingface.co/Supabase/gte-small))
and onnxruntime-web are MIT; transformers.js is Apache-2.0.
