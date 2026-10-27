// A static JSON import behind a dynamic one (see op-embeddings-asset.ts):
// dev-only data, loaded only when the parity check runs.
import asset from "./parity-c-items.json" with { type: "json" };

export default asset;
