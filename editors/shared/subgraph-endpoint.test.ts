import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveAuthEndpoint,
  resolveKnowledgeGraphEndpoint,
  resolveReactorEndpoint,
  resolveSwitchboardOrigin,
} from "./subgraph-endpoint.js";

/**
 * Every Switchboard call in the vault — GraphQL, the REST package routes, the
 * auth subgraph, attachments — goes through `resolveSwitchboardOrigin`. A host
 * it does not recognise returns `null`, which is ALSO the right answer for a
 * co-hosted deployment, so the failure is silent: the app looks configured
 * until the first request comes back as Connect's own HTML. These cases pin
 * each Vetra host shape so a new domain cannot quietly fall through again.
 */
function onHost(hostname: string): void {
  vi.stubGlobal("window", { location: { hostname } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveSwitchboardOrigin", () => {
  it.each([
    // bare slug — a named Vetra domain
    ["knowledge-vault.vetra.io", "https://switchboard.knowledge-vault.vetra.io"],
    // subdomain
    ["connect.knowledge-vault.vetra.io", "https://switchboard.knowledge-vault.vetra.io"],
    // suffix — per-environment cloud deployments
    ["light-colt-c497cfbd-connect.vetra.io", "https://light-colt-c497cfbd-switchboard.vetra.io"],
    // explicit map
    ["connect-dev.powerhouse.xyz", "https://switchboard-dev.powerhouse.xyz"],
    // local dev
    ["localhost", "http://localhost:4001"],
    ["127.0.0.1", "http://localhost:4001"],
  ])("maps %s to %s", (host, expected) => {
    onHost(host);
    expect(resolveSwitchboardOrigin()).toBe(expected);
  });

  // The suffix form is a single label under vetra.io too. If the bare-slug rule
  // ran first it would produce `switchboard.<slug>-connect.vetra.io`.
  it("keeps the suffix mapping for a -connect host rather than the bare-slug one", () => {
    onHost("rare-emu-780314b9-connect.vetra.io");
    expect(resolveSwitchboardOrigin()).toBe("https://rare-emu-780314b9-switchboard.vetra.io");
  });

  // A page already served from a Switchboard host is co-hosted: same-origin is
  // correct, and prefixing it would point at a host that does not exist.
  it.each(["switchboard.vetra.io", "light-colt-c497cfbd-switchboard.vetra.io"])(
    "leaves a Switchboard host (%s) same-origin",
    (host) => {
      onHost(host);
      expect(resolveSwitchboardOrigin()).toBeNull();
    },
  );

  it.each(["vault.example.com", "switchboard.knowledge-vault.vetra.io"])(
    "returns null for a host it does not know (%s), meaning same-origin",
    (host) => {
      onHost(host);
      expect(resolveSwitchboardOrigin()).toBeNull();
    },
  );

  it("returns null outside a browser", () => {
    vi.stubGlobal("window", undefined);
    expect(resolveSwitchboardOrigin()).toBeNull();
  });
});

describe("endpoints built on the origin", () => {
  it("point every Switchboard surface at the new domain", () => {
    onHost("knowledge-vault.vetra.io");
    expect(resolveReactorEndpoint()).toBe("https://switchboard.knowledge-vault.vetra.io/graphql");
    expect(resolveAuthEndpoint()).toBe("https://switchboard.knowledge-vault.vetra.io/graphql/auth");
    expect(resolveKnowledgeGraphEndpoint()).toBe(
      "https://switchboard.knowledge-vault.vetra.io/graphql/knowledgeGraph",
    );
  });

  it("fall back to relative paths when co-hosted", () => {
    onHost("vault.example.com");
    expect(resolveReactorEndpoint()).toBe("/graphql");
    expect(resolveAuthEndpoint()).toBe("/graphql/auth");
  });
});
