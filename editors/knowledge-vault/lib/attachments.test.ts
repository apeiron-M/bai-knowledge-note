/**
 * From dev.26 the Switchboard serves attachment bytes only through the read
 * gate of a document that references them (reactor #3109/#3112): a bare
 * `GET /attachments/<hash>` is 404. These pin that the document id reaches both
 * read paths — Connect's attachment service and the direct-fetch fallback.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const HASH = "59624c70a5a810da6ad56b80a152a1b9f5fb15ee70493ebfb66e5638d77bfd20";
const REF = `attachment://v1:${HASH}`;

vi.mock("@powerhousedao/reactor-browser", () => ({ setAttachmentService: vi.fn() }));
vi.mock("../../shared/subgraph-endpoint.js", () => ({
  resolveSwitchboardOrigin: () => "http://switchboard.test",
}));
vi.mock("../../shared/authed-fetch.js", () => ({ getBearerToken: () => Promise.resolve("jwt") }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("fetchAttachmentDataUrl", () => {
  it("passes the document id to the attachment service", async () => {
    const get = vi.fn(() =>
      Promise.resolve({ body: new Blob([new Uint8Array([1, 2, 3])]).stream(), header: { mimeType: "image/png" } }),
    );
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("ph", { attachmentService: { get } });
    const { fetchAttachmentDataUrl } = await import("./attachments.js");
    const url = await fetchAttachmentDataUrl(REF, "doc-1");
    expect(url).toBe("data:image/png;base64,AQID");
    expect(get).toHaveBeenCalledWith(REF, { documentId: "doc-1" });
  });

  it("anchors the direct fetch with ?documentId= when the service fails", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("ph", { attachmentService: { get: () => Promise.reject(new Error("404")) } });
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([9]), { headers: { "content-type": "image/png" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAttachmentDataUrl } = await import("./attachments.js");
    await fetchAttachmentDataUrl(REF, "doc/with space");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `http://switchboard.test/attachments/${HASH}?documentId=doc%2Fwith%20space`,
    );
  });

  it("sends no anchor without a document id, as on hosts before dev.26", async () => {
    vi.stubGlobal("window", globalThis);
    const get = vi.fn(() => Promise.reject(new Error("unavailable")));
    vi.stubGlobal("ph", { attachmentService: { get } });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new Uint8Array([9]))));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAttachmentDataUrl } = await import("./attachments.js");
    await fetchAttachmentDataUrl(REF);
    expect(get).toHaveBeenCalledWith(REF, undefined);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://switchboard.test/attachments/${HASH}`);
  });
});
