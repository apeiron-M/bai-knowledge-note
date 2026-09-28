// The pieces this package ships: what each is called, the version this package
// installs, and where the node build emits its module.
import type { PackagePiece } from "@powerhousedao/pieces-framework";

export const pieces: PackagePiece[] = [
  {
    name: "@powerhousedao/piece-knowledge-vault",
    version: "1.0.0",
    entry: "dist/node/pieces/knowledge-vault/index.mjs",
  },
];

export default pieces;
