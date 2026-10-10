/**
 * One readable line for an error the vault app shows. A sentence passes unchanged; a raw failure —
 * a GraphQL client dump (`GraphQL Error (Code: 401): {"response":…}`), a bare network error,
 * unreadable JSON — becomes a sentence that says what happened and what to do next.
 */
const GRAPHQL_DUMP = ': {"response":';
const BARE_NETWORK =
  /^(typeerror:\s*)?(failed to fetch|load failed|networkerror when attempting to fetch resource|fetch failed|network request failed|the network connection was lost|could not connect\b.*|connection refused)\.?$/i;
const UNREADABLE = /(unexpected token|json\.parse|is not valid json|unexpected end of json|unexpected character)/i;

function textOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error === null || error === undefined) return "";
  try {
    return JSON.stringify(error);
  } catch {
    return ""; // circular or otherwise unprintable: said as "something went wrong"
  }
}

/** The status and the server's own words, from a GraphQL client dump. */
function readDump(text: string): { status?: number; server?: string } {
  const cut = text.indexOf(GRAPHQL_DUMP);
  const code = /GraphQL Error \(Code: (\d{3})\)/.exec(text)?.[1];
  const out: { status?: number; server?: string } = code ? { status: Number(code) } : {};
  if (cut < 0) return out;
  const head = text.slice(0, cut);
  try {
    const dump = JSON.parse(text.slice(cut + 2)) as { response?: { status?: number; body?: string; errors?: { message?: string }[] } };
    if (typeof dump.response?.status === "number") out.status = dump.response.status;
    const first = dump.response?.errors?.[0]?.message;
    if (first) out.server = first;
    else if (dump.response?.body) {
      try {
        const body = JSON.parse(dump.response.body) as { error?: unknown; message?: unknown };
        const said = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : undefined;
        if (said) out.server = said;
      } catch {
        // a non-JSON body says nothing useful
      }
    }
  } catch {
    const escaped = /\\"(?:error|message)\\":\\"([^\\"]{1,200})\\"/.exec(text)?.[1];
    if (escaped) out.server = escaped;
  }
  if (out.server === undefined && !/GraphQL Error \(Code: \d{3}\)/.test(head)) out.server = head;
  return out;
}

function sentenceFor(status: number | undefined, server: string | undefined): string {
  const said = server ?? "";
  if (status === 401) {
    if (/credentials? no longer valid/i.test(said)) return "Renown didn't confirm your sign-in. Try again in a moment; if it keeps happening, sign in again.";
    return "The vault's server asks you to sign in. Sign in, then try again.";
  }
  if (status === 403 || /forbidden|insufficient permissions?|not authori[sz]ed|permission denied|access denied|you must be an admin/i.test(said))
    return "You don't have access to this. Ask the vault's administrator for access.";
  if (status === 404 || /\bnot found\b|does not exist/i.test(said)) return "It isn't there any more: it may have been deleted or moved.";
  if (status === 502 || status === 503 || status === 504) return "The vault's server isn't answering right now. Try again in a moment.";
  if (status !== undefined && status >= 500) return "The vault's server ran into a problem. Try again in a moment.";
  if (server) return server;
  return "Something went wrong. Try again in a moment.";
}

export function plainError(error: unknown): string {
  const text = textOf(error).trim();
  if (!text) return "Something went wrong. Try again in a moment.";
  if (text.includes(GRAPHQL_DUMP) || /GraphQL Error \(Code: \d{3}\)/.test(text)) {
    const { status, server } = readDump(text);
    const sentence = sentenceFor(status, server);
    // Keep a lead the app wrote in front of the dump ("Could not save: …").
    const at = text.indexOf("GraphQL Error (Code");
    const lead = at > 0 ? text.slice(0, at).trim() : "";
    return lead.endsWith(":") && lead.length < 80 && !lead.includes("{") ? `${lead} ${sentence}` : sentence;
  }
  if (BARE_NETWORK.test(text)) return "Couldn't reach the vault's server. Check your connection, then try again.";
  if (error instanceof SyntaxError || UNREADABLE.test(text)) return "The server sent an answer the app couldn't read. Try again in a moment.";
  if (/^[{[]/.test(text)) return "Something went wrong. Try again in a moment.";
  return text.length > 400 ? `${text.slice(0, 400).replace(/\s+\S*$/, "")}…` : text;
}
