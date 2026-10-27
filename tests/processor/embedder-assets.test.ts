import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ASSETS_PACKAGE,
  ASSETS_VERSION,
  DEFAULT_REGISTRY,
  assetsCdnBase,
  registryCandidates,
  registryOfModule,
} from "../../processors/graph-indexer/assets.js";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

describe("the embedder's assets package", () => {
  it("is the version this package pins and the version the repository builds", () => {
    const vault = json("package.json") as {
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional?: boolean }>;
    };
    expect(vault.peerDependencies[ASSETS_PACKAGE]).toBe(ASSETS_VERSION);
    // Optional: a Switchboard never installs it, and this repository resolves @powerhousedao from npmjs.
    expect(vault.peerDependenciesMeta[ASSETS_PACKAGE]?.optional).toBe(true);
    const assets = json("packages/knowledge-vault-assets/package.json");
    expect(assets.name).toBe(ASSETS_PACKAGE);
    expect(assets.version).toBe(ASSETS_VERSION);
  });

  it("is fetched from its CDN folder, whatever the registry URL looks like", () => {
    const base = `/-/cdn/@powerhousedao/knowledge-vault-assets@${ASSETS_VERSION}/`;
    expect(assetsCdnBase("https://registry.vetra.io")).toBe(`https://registry.vetra.io${base}`);
    expect(assetsCdnBase("https://registry.vetra.io//")).toBe(`https://registry.vetra.io${base}`);
  });
});

describe("registryOfModule", () => {
  it("reads the registry from a module served by its CDN", () => {
    expect(registryOfModule("https://registry.vetra.io/-/cdn/@powerhousedao/knowledge-note@1.0.54-dev.47/node/embedder-x.mjs")).toBe(
      "https://registry.vetra.io",
    );
    expect(registryOfModule("http://localhost:8080/npm/-/cdn/pkg@1/node/a.mjs")).toBe("http://localhost:8080/npm");
  });

  it("falls back to the origin of any other http module, and to nothing for a file", () => {
    expect(registryOfModule("https://cdn.example.com/x/y.mjs")).toBe("https://cdn.example.com");
    expect(registryOfModule("file:///srv/cache/@powerhousedao/knowledge-note@1.0.54-dev.47/node/embedder-x.mjs")).toBeNull();
  });
});

describe("registryCandidates", () => {
  it("tries the module's registry, the environment's, the configured one, then the public one — once each", () => {
    expect(
      registryCandidates({
        moduleUrl: "https://reg.internal/-/cdn/p@1/node/e.mjs",
        env: "https://env.example/",
        configured: "https://reg.internal",
      }),
    ).toEqual(["https://reg.internal", "https://env.example", DEFAULT_REGISTRY]);
  });

  it("ends on the public registry when nothing else is known (the Switchboard's file:// cache)", () => {
    expect(registryCandidates({ moduleUrl: "file:///srv/cache/e.mjs" })).toEqual([DEFAULT_REGISTRY]);
    expect(registryCandidates({ moduleUrl: "file:///srv/cache/e.mjs", env: "  ", configured: null })).toEqual([DEFAULT_REGISTRY]);
  });

  it("ignores values that are not http(s) URLs", () => {
    expect(registryCandidates({ moduleUrl: "file:///e.mjs", env: "registry.vetra.io", configured: "ftp://x" })).toEqual([
      DEFAULT_REGISTRY,
    ]);
  });
});
