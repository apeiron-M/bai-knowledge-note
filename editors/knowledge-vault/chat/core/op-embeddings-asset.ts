// A static JSON import behind a dynamic one: Vite dev serves JSON as a JS
// module, which a dynamic `import(…, { with: { type: "json" } })` rejects.
import asset from "./op-embeddings.gte-small.json" with { type: "json" };

export default asset;
