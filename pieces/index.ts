// The pieces this package ships: what each is called and where the node build
// emits its module. A piece's version is this package's (package.json).
import type { PackagePiece } from "@powerhousedao/pieces-framework";

export const pieces: PackagePiece[] = [
  {
    name: "@powerhousedao/piece-knowledge-vault",
    entry: "dist/node/pieces/knowledge-vault/index.mjs",
  },
];

export default pieces;
