import "../../../shared/test/browser-globals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_WEB_SETTINGS,
  duckDuckGoTarget,
  pageWarning,
  parseDuckDuckGoMarkdown,
  readUrl,
  readWebSettings,
  readerFailure,
  searchWeb,
  writeWebSettings,
} from "./web.js";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const ddgLink = (url: string) =>
  `https://duckduckgo.com/l/?uddg=${encodeURIComponent(url)}&rut=abc123`;

/** Trimmed from a real r.jina.ai response for a DuckDuckGo HTML search. */
const READER_MARKDOWN = `Title: powerhouse document model at DuckDuckGo

URL Source: https://duckduckgo.com/html/?q=powerhouse+document+model

Markdown Content:
[](https://duckduckgo.com/html/?q=powerhouse+document+model)

[](https://duckduckgo.com/html/ "DuckDuckGo")

## [Document Models | powerhouse-inc/powerhouse-docs | DeepWiki](${ddgLink("https://deepwiki.com/powerhouse-inc/powerhouse-docs/3-document-models")})

[![Image 1](https://external-content.duckduckgo.com/ip3/deepwiki.com.ico)](${ddgLink("https://deepwiki.com/powerhouse-inc/powerhouse-docs/3-document-models")})[deepwiki.com/powerhouse-inc/powerhouse-docs](${ddgLink("https://deepwiki.com/powerhouse-inc/powerhouse-docs/3-document-models")}) 2025-05-16T00:00:00.0000000

[**Document****Models** are the core data structure in the **Powerhouse** ecosystem, providing a structured way to define, store and manipulate application data.](${ddgLink("https://deepwiki.com/powerhouse-inc/powerhouse-docs/3-document-models")})

## [GitHub - powerhouse-inc/document-model](${ddgLink("https://github.com/powerhouse-inc/document-model")})

[![Image 7](https://external-content.duckduckgo.com/ip3/github.com.ico)](${ddgLink("https://github.com/powerhouse-inc/document-model")})[github.com/powerhouse-inc/document-model](${ddgLink("https://github.com/powerhouse-inc/document-model")})

[Contribute to **powerhouse**-inc/**document**-**model** development by creating an account on GitHub.](${ddgLink("https://github.com/powerhouse-inc/document-model")})
`;

function mockFetch(...responses: { ok?: boolean; status?: number; body?: string; json?: unknown }[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: () => Promise.resolve(r.body ?? ""),
      json: () => Promise.resolve(r.json),
    });
  }
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}
const requestAt = (i: number) =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[i] as [string, RequestInit | undefined];

describe("duckDuckGoTarget", () => {
  it("unwraps the redirect that carries the real address", () => {
    expect(duckDuckGoTarget(ddgLink("https://example.com/a?b=1"))).toBe("https://example.com/a?b=1");
  });

  it("ignores DuckDuckGo's own links and anything unparseable", () => {
    expect(duckDuckGoTarget("https://duckduckgo.com/html/?q=x")).toBeNull();
    expect(duckDuckGoTarget("not a url at all ]")).toBeNull();
    // A plain external link (no redirect wrapper) is still a target.
    expect(duckDuckGoTarget("https://example.com/x")).toBe("https://example.com/x");
  });
});

describe("parseDuckDuckGoMarkdown", () => {
  it("pulls title, real url and snippet out of the reader's markdown", () => {
    expect(parseDuckDuckGoMarkdown(READER_MARKDOWN)).toEqual([
      {
        title: "Document Models | powerhouse-inc/powerhouse-docs | DeepWiki",
        url: "https://deepwiki.com/powerhouse-inc/powerhouse-docs/3-document-models",
        snippet:
          "Document Models are the core data structure in the Powerhouse ecosystem, providing a structured way to define, store and manipulate application data.",
      },
      {
        title: "GitHub - powerhouse-inc/document-model",
        url: "https://github.com/powerhouse-inc/document-model",
        snippet: "Contribute to powerhouse-inc/document-model development by creating an account on GitHub.",
      },
    ]);
  });

  it("restores the space DuckDuckGo's bolding loses between adjacent terms", () => {
    // "**Document****Models**" is two bold runs, not one word.
    expect(parseDuckDuckGoMarkdown(READER_MARKDOWN)[0].snippet).toMatch(/^Document Models are/);
  });

  it("keeps the favicon line out of the snippet and never repeats a result", () => {
    const parsed = parseDuckDuckGoMarkdown(READER_MARKDOWN);
    expect(parsed.every((r) => !r.snippet.includes("Image"))).toBe(true);
    expect(new Set(parsed.map((r) => r.url)).size).toBe(parsed.length);
  });

  it("returns nothing for a page with no results rather than throwing", () => {
    expect(parseDuckDuckGoMarkdown("Title: x\n\nMarkdown Content:\nNo results.")).toEqual([]);
  });
});

describe("searchWeb", () => {
  it("uses the keyless reader path and asks DuckDuckGo for the query", async () => {
    mockFetch({ body: READER_MARKDOWN });
    const r = await searchWeb("powerhouse document model", { limit: 5, settings: NO_WEB_SETTINGS });
    expect(requestAt(0)[0]).toBe(
      "https://r.jina.ai/https://duckduckgo.com/html/?q=powerhouse%20document%20model",
    );
    expect(r.via).toBe("duckduckgo");
    expect(r.results).toHaveLength(2);
    expect(r.answer).toBeUndefined();
  });

  it("honours the limit", async () => {
    mockFetch({ body: READER_MARKDOWN });
    const r = await searchWeb("q", { limit: 1, settings: NO_WEB_SETTINGS });
    expect(r.results).toHaveLength(1);
  });

  it("uses Tavily when a key is configured, sending the key in the body", async () => {
    mockFetch({
      json: {
        answer: "Alan Turing was a British mathematician.",
        results: [
          { title: "Alan Turing", url: "https://en.wikipedia.org/wiki/Alan_Turing", content: "English mathematician…" },
          { title: "no url", content: "dropped" },
        ],
      },
    });
    const r = await searchWeb("alan turing", { limit: 3, settings: { tavilyKey: "tvly-secret" } });
    const [url, init] = requestAt(0);
    expect(url).toBe("https://api.tavily.com/search");
    expect(JSON.parse(init!.body as string)).toEqual({
      api_key: "tvly-secret",
      query: "alan turing",
      max_results: 3,
      include_answer: true,
    });
    expect(r.via).toBe("tavily");
    expect(r.answer).toBe("Alan Turing was a British mathematician.");
    // A result without a url cannot be cited, so it is dropped.
    expect(r.results.map((x) => x.url)).toEqual(["https://en.wikipedia.org/wiki/Alan_Turing"]);
  });

  it("reports a refusal from either backend in words the model can act on", async () => {
    mockFetch({ ok: false, status: 401, body: '{"detail":"invalid api key"}' });
    await expect(searchWeb("q", { limit: 3, settings: { tavilyKey: "bad" } })).rejects.toThrow(
      /Tavily answered 401.*invalid api key/,
    );
    mockFetch({ ok: false, status: 451, body: "" });
    await expect(searchWeb("q", { limit: 3, settings: NO_WEB_SETTINGS })).rejects.toThrow(
      /reader answered 451/,
    );
  });
});

describe("readUrl", () => {
  // As the reader returns example.com: short, but a real page.
  const PAGE = `Title: Example Domain

URL Source: https://example.com/

Markdown Content:
# Example Domain

This domain is for use in illustrative examples. You may use this domain in
literature without prior coordination or asking for permission.

[More information...](https://www.iana.org/domains/example)`;

  it("returns the page's title and body, fetched through the reader", async () => {
    mockFetch({ body: PAGE });
    const page = await readUrl("https://example.com/");
    expect(requestAt(0)[0]).toBe("https://r.jina.ai/https://example.com/");
    expect(page.title).toBe("Example Domain");
    expect(page.text).toContain("This domain is for use in illustrative examples.");
    expect(page.truncated).toBe(false);
    // A short but real page carries no warning.
    expect(page.warning).toBeUndefined();
  });

  it("marks a long page as truncated instead of flooding the answer", async () => {
    mockFetch({ body: `Title: Long\n\nMarkdown Content:\n${"x".repeat(500)}` });
    const page = await readUrl("https://example.com/long", { maxChars: 100 });
    expect(page.text).toHaveLength(100);
    expect(page.truncated).toBe(true);
  });

  it("reads a JSON API too — the reader hands back the body as it is", async () => {
    const body = '{"address":"0xadbA","name":"liberuum.eth"}';
    mockFetch({ body: `Title: \n\nURL Source: https://api.example/x\n\nMarkdown Content:\n${body}` });
    expect((await readUrl("https://api.example/x")).text).toBe(body);
  });

  it("refuses anything that is not a public http(s) address", async () => {
    const fn = mockFetch();
    await expect(readUrl("notaurl")).rejects.toThrow(/is not a URL/);
    await expect(readUrl("file:///etc/passwd")).rejects.toThrow(/only http and https/);
    for (const host of ["http://localhost:11434/v1", "http://127.0.0.1/x", "http://192.168.1.1/", "http://10.0.0.5/", "http://172.16.3.2/", "http://printer.local/"]) {
      await expect(readUrl(host)).rejects.toThrow(/private address/);
    }
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("web settings", () => {
  it("has no key by default, round-trips one, and survives a corrupt record", () => {
    expect(readWebSettings()).toEqual(NO_WEB_SETTINGS);
    writeWebSettings({ tavilyKey: "tvly-x" });
    expect(readWebSettings()).toEqual({ tavilyKey: "tvly-x" });
    writeWebSettings({ tavilyKey: "   " });
    expect(readWebSettings()).toEqual(NO_WEB_SETTINGS);
    localStorage.setItem("bai-chat-web:v1", "{oops");
    expect(readWebSettings()).toEqual(NO_WEB_SETTINGS);
  });
});

describe("a fetch that failed, and a page that is not an answer", () => {
  // Both payloads are verbatim from r.jina.ai (2026-09-05).
  const DEAD_HOST = '{"data":null,"path":"url","code":422,"name":"SubmittedDataMalformedError","status":42203,"message":"Domain \'ensdomain.info\' could not be resolved","readableMessage":"SubmittedDataMalformedError: Domain could not be resolved"}';
  const NOT_FOUND_PAGE = `Title: evmtools - Essential EVM Development Tools

URL Source: https://www.evmtools.xyz/ens-lookup

Markdown Content:
## 404

## This page could not be found.`;

  it("passes the reader's own reason through instead of a bare status", () => {
    expect(readerFailure(422, DEAD_HOST)).toBe("Domain 'ensdomain.info' could not be resolved");
    // No message, or not JSON at all: the status is still said plainly.
    expect(readerFailure(451, '{"data":null}')).toBe("the reader answered 451");
    expect(readerFailure(500, "<html>oops</html>")).toBe("the reader answered 500");
  });

  it("read_url reports which address failed and why", async () => {
    mockFetch({ ok: false, status: 422, body: DEAD_HOST });
    await expect(readUrl("https://ensdomain.info/?address=0xabc")).rejects.toThrow(
      /could not fetch https:\/\/ensdomain\.info\/\?address=0xabc — Domain 'ensdomain\.info' could not be resolved/,
    );
  });

  it("flags a 404 page so it cannot be mistaken for an answer", async () => {
    mockFetch({ body: NOT_FOUND_PAGE });
    const page = await readUrl("https://www.evmtools.xyz/ens-lookup");
    expect(page.warning).toMatch(/not-found page/);
    // The text is still returned — the warning is the judgement, not censorship.
    expect(page.text).toContain("404");
  });

  it("flags a page that came back essentially empty", () => {
    expect(pageWarning("Loading…")).toMatch(/almost no text/);
    // example.com is short and entirely real: no warning.
    expect(
      pageWarning(
        "# Example Domain\n\nThis domain is for use in illustrative examples. You may use this domain in literature without prior coordination.",
      ),
    ).toBeUndefined();
    expect(pageWarning("# Not Found\n\nno such page")).toMatch(/not-found page/);
    // A real page, and one that merely discusses 404s, are left alone.
    expect(pageWarning("x".repeat(700))).toBeUndefined();
    expect(pageWarning(`A long essay about HTTP status codes. ${"The 404 status means not found. ".repeat(30)}`)).toBeUndefined();
  });
});
