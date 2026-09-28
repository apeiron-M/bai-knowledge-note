/**
 * The acceptance gate for the BUILT piece: what `bun run build` emits has to
 * load through the reactor's own loader, describe into a descriptor, and run
 * inside the forked worker the way a Switchboard runs it. Skips until built.
 */
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDescriptor, loadPieceFromDir, PieceRegistry, PieceWorker } from "@powerhousedao/reactor-workflow/testing";
import type { LocalPiece, PackagePiece } from "@powerhousedao/reactor-workflow/testing";
import { DRIVE, GOOD_TOKEN, startVaultServer, type VaultServer } from "./vault-server.js";

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const PIECE = "@powerhousedao/piece-knowledge-vault";
const VERSION = "1.0.0";
const entryPath = join(root, "dist", "node", "pieces", "knowledge-vault", "index.mjs");
const listPath = join(root, "dist", "node", "pieces", "index.mjs");
const ready = existsSync(entryPath) && existsSync(listPath);

let server: VaultServer;
let bundleDir = "";
let declared: LocalPiece | undefined;

describe.skipIf(!ready)("built piece conformance", () => {
  beforeAll(async () => {
    const { pieces } = (await import(pathToFileURL(listPath).href)) as { pieces: PackagePiece[] };
    const registry = new PieceRegistry();
    registry.setPieces(pieces.map((p) => ({ name: p.name, version: p.version, ...(p.entry ? { entryPath: join(root, p.entry) } : {}) })));
    declared = registry.lookup(PIECE);
    bundleDir = await mkdtemp(join(tmpdir(), "vault-piece-"));
    await copyFile(entryPath, join(bundleDir, "index.mjs"));
    await writeFile(join(bundleDir, "package.json"), JSON.stringify({ name: PIECE, version: VERSION, main: "./index.mjs" }));
    server = await startVaultServer();
  }, 60_000);
  afterAll(async () => server?.close());

  it("is declared where a host reads it", () => {
    expect(declared).toMatchObject({ name: PIECE, version: VERSION, entryPath });
  });

  it("loads through the reactor's loader with its constructor name intact", async () => {
    const loaded = await loadPieceFromDir(bundleDir);
    expect(loaded.check).toBe("constructor-name");
    expect(loaded.piece.displayName).toBe("Knowledge Vault");
  });

  it("describes into the descriptor Studio draws its forms from", async () => {
    const { piece } = await loadPieceFromDir(bundleDir);
    const descriptor = buildDescriptor(piece, { packageName: PIECE, version: VERSION });
    expect(descriptor.actions.map((a) => a.name)).toEqual(["search", "agent-extract"]);
    expect(descriptor.triggers).toEqual([]);
    expect(descriptor.auth).toMatchObject({ type: "CUSTOM_AUTH" });
    const drive = descriptor.actions[0]?.props.find((p) => p.name === "drive");
    expect(drive?.type).toBe("DROPDOWN");
    expect(drive?.hasDynamicResolver).toBe(true);
    const agent = descriptor.actions.find((a) => a.name === "agent-extract");
    for (const name of ["drive", "source", "model"]) {
      const prop = agent?.props.find((p) => p.name === name);
      expect(prop?.type, name).toBe("DROPDOWN");
      expect(prop?.hasDynamicResolver, name).toBe(true);
    }
    const authProps = JSON.stringify(descriptor.auth);
    expect(authProps).toMatch(/llm_api_key/);
  });

  it("inlines the framework: the worker has no node_modules beside it", async () => {
    const built = await readFile(entryPath, "utf8");
    expect(built).not.toMatch(/from\s+["']@powerhousedao\//);
  });

  it("runs search inside the forked worker against the vault's real route", async () => {
    const worker = new PieceWorker();
    try {
      const result = await worker.runAction({
        entryPath,
        actionName: "search",
        propsValue: { drive: DRIVE.id, query: "how does sync work", limit: 2 },
        auth: { type: "CUSTOM_AUTH", props: { base_url: server.baseUrl, token: GOOD_TOKEN } },
      });
      expect(result.output).toMatchObject({ count: 3, first_id: "n1" });
      expect(result.tlsPoisoned).toBe(false);
    } finally {
      worker.dispose();
    }
  }, 60_000);

  it("answers the connection check with an account label", async () => {
    const worker = new PieceWorker();
    try {
      const result = await worker.checkConnection({
        entryPath,
        auth: { type: "CUSTOM_AUTH", props: { base_url: server.baseUrl, token: GOOD_TOKEN } },
      });
      expect(result.output).toMatchObject({ valid: true });
    } finally {
      worker.dispose();
    }
  }, 60_000);

  it("reports a rejected token as a typed piece error across the worker boundary", async () => {
    const worker = new PieceWorker();
    try {
      await expect(
        worker.runAction({
          entryPath,
          actionName: "search",
          propsValue: { drive: DRIVE.id, query: "x" },
          auth: { type: "CUSTOM_AUTH", props: { base_url: server.baseUrl, token: "stale" } },
        }),
      ).rejects.toMatchObject({ serialized: { name: "KnowledgeVaultApiError", properties: { status: 401, category: "credential" } } });
    } finally {
      worker.dispose();
    }
  }, 60_000);
});
