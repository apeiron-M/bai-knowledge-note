/**
 * The attachment services authenticate with the vault's own bearer (the desktop host's sign-in,
 * or Connect's session) — not Connect's Renown client alone, which a desktop window does not have:
 * uploads to a protected local engine were refused (401) and the source kept refs to bytes that
 * never arrived. And a service follows the engine the vault talks to: a remote vault opened after
 * a local one must not read or upload through the local engine.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const made: { remoteUrl: string; jwtHandler: () => Promise<string | undefined> }[] = [];
let origin = "http://127.0.0.1:4201";

vi.mock("@powerhousedao/reactor-browser", () => ({ setAttachmentService: vi.fn() }));
vi.mock("../../shared/subgraph-endpoint.js", () => ({ resolveSwitchboardOrigin: () => origin }));
vi.mock("../../shared/authed-fetch.js", () => ({ getBearerToken: () => Promise.resolve("host-jwt") }));
vi.mock("@powerhousedao/reactor-attachments/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createRemoteAttachmentService: (opts: { remoteUrl: string; jwtHandler: () => Promise<string | undefined> }) => {
    made.push(opts);
    return { remoteUrl: opts.remoteUrl } as unknown;
  },
}));

afterEach(() => {
  made.length = 0;
  origin = "http://127.0.0.1:4201";
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("attachment services", () => {
  it("send the vault's bearer — a desktop window has no Connect session", async () => {
    vi.stubGlobal("window", globalThis); // no ph.renown, as in the desktop app
    const { getAttachmentService, getRemoteAttachmentReader } = await import("./attachments.js");
    getAttachmentService();
    getRemoteAttachmentReader();
    expect(made).toHaveLength(2);
    for (const m of made) expect(await m.jwtHandler()).toBe("host-jwt");
  });
  it("follow the engine the vault talks to: another origin gets its own service", async () => {
    vi.stubGlobal("window", globalThis);
    const { getAttachmentService } = await import("./attachments.js");
    const local = getAttachmentService() as unknown as { remoteUrl: string };
    expect(getAttachmentService()).toBe(local); // cached while the origin stays
    origin = "https://switchboard.knowledge-vault.vetra.io";
    const remote = getAttachmentService() as unknown as { remoteUrl: string };
    expect(remote.remoteUrl).toBe("https://switchboard.knowledge-vault.vetra.io");
    expect(remote).not.toBe(local);
  });
  it("the loader gives up at once on a refusal (401/403) instead of retrying for forty seconds", async () => {
    vi.stubGlobal("window", globalThis);
    vi.useFakeTimers();
    const get = vi.fn(() => Promise.reject(new Error("Attachment download-target request failed with status 401")));
    vi.stubGlobal("ph", { attachmentService: { get } });
    const { useAttachmentLoader } = await import("./attachments.js");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    let load: ((ref: string) => Promise<unknown>) | undefined;
    renderToStaticMarkup(createElement(() => { load = useAttachmentLoader("doc-1"); return null; }));
    const settled = load!("attachment://v1:" + "a".repeat(64)).then(() => "ok", (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(0);
    expect(await settled).toMatch(/401/);
    expect(get.mock.calls.length).toBeLessThanOrEqual(2); // the service, and at most the second opinion
    vi.useRealTimers();
  });
});
