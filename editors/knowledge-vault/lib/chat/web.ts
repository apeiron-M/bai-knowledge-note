/**
 * Looking things up outside the vault.
 *
 * The chat runs in a browser, which rules out most search APIs: they either
 * need a key that would have to be shipped to the page, or they refuse the
 * cross-origin request. Measured from a Connect origin (2026-09-05):
 *
 *   r.jina.ai (read a URL as text)   200, allow-origin: <origin>   keyless
 *   DuckDuckGo HTML via r.jina.ai    200, real result list         keyless
 *   Tavily  (POST /search)           preflight 200, allow-origin   key in body
 *   Brave   (GET /res/v1/...)        preflight 405                 unusable
 *   searx.be                         no allow-origin header        unusable
 *
 * So: Tavily when the user has a key, otherwise DuckDuckGo's HTML results
 * read through Jina's reader — no key, no account, and the same path serves
 * `read_url`, which is what turns a result list into something quotable.
 *
 * Everything here is read-only HTTP GET/POST to a search endpoint. Nothing
 * executes, and the vault is never written. Web text is untrusted input
 * exactly like note content: the system prompt tells the model to treat it
 * as data, never as instructions.
 */

const STORAGE_KEY = "bai-chat-web:v1";
const READER = "https://r.jina.ai/";
const DUCKDUCKGO = "https://duckduckgo.com/html/?q=";
const TAVILY = "https://api.tavily.com/search";

/** Long enough for the reader to fetch and convert a slow page. */
const SEARCH_TIMEOUT_MS = 25_000;
const READ_TIMEOUT_MS = 25_000;
const SNIPPET_MAX = 400;
/** One page of text the model can hold in context alongside its other reads. */
export const PAGE_MAX_CHARS = 8000;

export interface WebSettings {
  /**
   * Tavily key, or null for the keyless DuckDuckGo path. There is no UI for
   * it yet: set `bai-chat-web:v1` to `{"tavilyKey":"tvly-…"}` in this
   * browser's local storage to upgrade search quality.
   */
  tavilyKey: string | null;
}

export const NO_WEB_SETTINGS: WebSettings = { tavilyKey: null };

export function readWebSettings(): WebSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return NO_WEB_SETTINGS;
    const p = JSON.parse(raw) as { tavilyKey?: unknown };
    return {
      tavilyKey:
        typeof p.tavilyKey === "string" && p.tavilyKey.trim()
          ? p.tavilyKey.trim()
          : null,
    };
  } catch {
    return NO_WEB_SETTINGS;
  }
}

export function writeWebSettings(s: WebSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private mode / quota: the setting simply does not persist.
  }
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  query: string;
  /** Which backend answered — the model should say where it looked. */
  via: "tavily" | "duckduckgo";
  /** Tavily's one-line answer, when it offers one. */
  answer?: string;
  results: WebResult[];
}

function clean(text: string): string {
  return (
    text
      // DuckDuckGo bolds every matched term and the conversion drops the
      // space between two adjacent runs ("**Document****Models**"), so the
      // seam has to become a space or the words are glued together.
      .replace(/\*{4,}/g, " ")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max);
  return `${text.slice(0, cut > max / 2 ? cut : max).trimEnd()}…`;
}

/**
 * DuckDuckGo wraps every result in a redirect whose `uddg` parameter holds
 * the real address. A link that is not one of those (its own logo, an image)
 * has no `uddg` and is skipped.
 */
export function duckDuckGoTarget(href: string): string | null {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    if (target) return target;
    return /^https?:$/.test(u.protocol) && u.host !== "duckduckgo.com"
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Pull the result list out of the reader's markdown. Each result is a
 * heading link followed by a snippet link to the same address; image lines
 * in between are ignored.
 */
export function parseDuckDuckGoMarkdown(markdown: string): WebResult[] {
  const lines = markdown.split("\n");
  const results: WebResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const heading = /^#{1,6}\s+\[([\s\S]*?)\]\(([^)]+)\)\s*$/.exec(lines[i]);
    if (!heading) continue;
    const url = duckDuckGoTarget(heading[2]);
    const title = clean(heading[1]);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    // The snippet is the next plain link to the same target — the line
    // between them is the favicon plus the display domain.
    let snippet = "";
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const line = lines[j].trim();
      if (/^#{1,6}\s+\[/.test(line)) break;
      const link = /^\[([\s\S]+)\]\(([^)]+)\)/.exec(line);
      if (!link || line.startsWith("[![")) continue;
      if (duckDuckGoTarget(link[2]) !== url) continue;
      const text = clean(link[1]);
      if (text.length > snippet.length) snippet = text;
    }
    results.push({ title, url, snippet: truncate(snippet, SNIPPET_MAX) });
  }
  return results;
}

async function getText(url: string, timeoutMs: number): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`the reader answered ${res.status} for ${url}`);
  }
  return res.text();
}

interface TavilyResponse {
  answer?: string | null;
  results?: { title?: string; url?: string; content?: string }[];
}

/**
 * Search the web. Tavily when a key is configured — better ranking and a
 * synthesised answer — otherwise DuckDuckGo's own results, read through
 * Jina. Throws with a readable message; the tool layer turns that into a
 * tool failure the model can react to.
 */
export async function searchWeb(
  query: string,
  options: { limit: number; settings: WebSettings },
): Promise<WebSearchResult> {
  const { limit, settings } = options;
  if (settings.tavilyKey) {
    const res = await fetch(TAVILY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      body: JSON.stringify({
        api_key: settings.tavilyKey,
        query,
        max_results: limit,
        include_answer: true,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Tavily answered ${res.status}${detail ? `: ${truncate(clean(detail), 200)}` : ""}`,
      );
    }
    const body = (await res.json()) as TavilyResponse;
    const results = (body.results ?? [])
      .filter((r): r is { title: string; url: string; content?: string } =>
        typeof r.url === "string" && typeof r.title === "string",
      )
      .slice(0, limit)
      .map((r) => ({
        title: clean(r.title),
        url: r.url,
        snippet: truncate(clean(r.content ?? ""), SNIPPET_MAX),
      }));
    return {
      query,
      via: "tavily",
      ...(body.answer ? { answer: clean(body.answer) } : {}),
      results,
    };
  }

  const markdown = await getText(
    `${READER}${DUCKDUCKGO}${encodeURIComponent(query)}`,
    SEARCH_TIMEOUT_MS,
  );
  return {
    query,
    via: "duckduckgo",
    results: parseDuckDuckGoMarkdown(markdown).slice(0, limit),
  };
}

/** Hosts a browser must not be asked to reach through a public fetcher. */
const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?)|\.local$/i;

export interface WebPage {
  url: string;
  title: string | null;
  text: string;
  truncated: boolean;
}

/**
 * Read one web page as plain text. Goes through Jina's reader, which does
 * the fetching and the HTML-to-markdown conversion; a private address is
 * refused here rather than handed to a public service that cannot reach it
 * anyway.
 */
export async function readUrl(
  url: string,
  options: { maxChars?: number } = {},
): Promise<WebPage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a URL. Give a full address, e.g. https://example.com/page.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`only http and https addresses can be read — got ${parsed.protocol}`);
  }
  if (PRIVATE_HOST.test(parsed.hostname)) {
    throw new Error(
      `${parsed.hostname} is a private address; this tool reads public web pages only.`,
    );
  }
  const raw = await getText(`${READER}${parsed.toString()}`, READ_TIMEOUT_MS);
  // The reader prefixes `Title:`, `URL Source:` and `Markdown Content:`.
  const title = /^Title:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? null;
  const body = raw.split(/^Markdown Content:\s*$/m).slice(1).join("\n").trim() || raw.trim();
  const max = options.maxChars ?? PAGE_MAX_CHARS;
  return {
    url: parsed.toString(),
    title,
    text: body.slice(0, max),
    truncated: body.length > max,
  };
}
