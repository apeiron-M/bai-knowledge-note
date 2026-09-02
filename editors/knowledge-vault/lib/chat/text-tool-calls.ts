/**
 * Tool calls that arrived as prose.
 *
 * With native function calling the provider returns `tool_calls` and empty
 * content. Some model/provider routes — free ones especially — instead write
 * the call into the answer text in their training-time template. Seen on
 * this vault, verbatim:
 *
 *   GLM        <tool_call>read_note\n<arg_key>documentId</arg_key>\n<arg_value>…</arg_value>\n</tool_call>
 *   dots       <dots_function_call><invoke name="read_note"><parameter name="documentId">…</parameter></invoke></dots_function_call>
 *
 * plus the templates other families are known for:
 *
 *   Hermes/Qwen  <tool_call>{"name":"read_note","arguments":{"documentId":"…"}}</tool_call>
 *   Llama 3      <function=read_note>{"documentId":"…"}</function>
 *   Mistral      [TOOL_CALLS][{"name":"read_note","arguments":{"documentId":"…"}}]
 *   Anthropic    <function_calls><invoke name="read_note"><parameter name="documentId">…</parameter></invoke></function_calls>
 *
 * The loop turns these into real tool calls and strips them from the text,
 * so the user sees the tools run — not the template.
 */
import type { ToolCall } from "./openrouter-client.js";

export interface ParsedTextToolCalls {
  /** The text with every recognised call removed. */
  text: string;
  calls: ToolCall[];
}

type RawCall = { name: string; args: Record<string, unknown> };

/** XML-ish parameter values are strings; recover the types JSON would carry. */
function coerce(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^[[{]/.test(v)) {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      /* not JSON after all — keep the string */
    }
  }
  return v;
}

function argsObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** `{"name": …, "arguments"|"parameters"|"input": …}` → call, or null. */
function fromJsonCall(v: unknown): RawCall | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const name =
    typeof o.name === "string"
      ? o.name
      : typeof (o.function as { name?: unknown } | undefined)?.name === "string"
        ? ((o.function as { name: string }).name)
        : null;
  if (!name) return null;
  let args: unknown =
    o.arguments ?? o.parameters ?? o.input ??
    (o.function as { arguments?: unknown } | undefined)?.arguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      args = {};
    }
  }
  return { name: name.trim(), args: argsObject(args) };
}

/** `<arg_key>k</arg_key><arg_value>v</arg_value>…` → args. */
function fromArgKeyValue(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const re =
    /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
  for (const m of body.matchAll(re)) args[m[1].trim()] = coerce(m[2]);
  return args;
}

/** `<invoke name="f"><parameter name="k">v</parameter>…</invoke>` → calls. */
function fromInvokes(body: string): RawCall[] {
  const out: RawCall[] = [];
  const invoke = /<invoke\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/g;
  const param =
    /<parameter\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/g;
  for (const m of body.matchAll(invoke)) {
    const args: Record<string, unknown> = {};
    for (const p of m[2].matchAll(param)) args[p[1].trim()] = coerce(p[2]);
    out.push({ name: m[1].trim(), args });
  }
  return out;
}

type Template = {
  re: RegExp;
  extract: (m: RegExpMatchArray) => RawCall[];
};

const TEMPLATES: Template[] = [
  // <tool_call>…</tool_call> — GLM arg_key/arg_value, or Hermes/Qwen JSON.
  {
    re: /<tool_call>([\s\S]*?)<\/tool_call>/g,
    extract: (m) => {
      const body = m[1].trim();
      if (/<arg_key>/.test(body)) {
        const name = body.split(/\s|</, 1)[0]?.trim();
        return name ? [{ name, args: fromArgKeyValue(body) }] : [];
      }
      // A bare tool name is a call with no arguments (GLM, zero-arg tool).
      if (/^[\w.-]+$/.test(body)) return [{ name: body, args: {} }];
      try {
        const call = fromJsonCall(JSON.parse(body));
        return call ? [call] : [];
      } catch {
        return [];
      }
    },
  },
  // <function_calls>…</function_calls>, <dots_function_call>…, <invoke> bare.
  {
    re: /<(\w*function_calls?)>([\s\S]*?)<\/\1>/g,
    extract: (m) => fromInvokes(m[2]),
  },
  {
    re: /<invoke\s+name\s*=\s*["'][^"']+["']\s*>[\s\S]*?<\/invoke>/g,
    extract: (m) => fromInvokes(m[0]),
  },
  // Llama 3: <function=name>{json}</function>
  {
    re: /<function=([\w.-]+)>([\s\S]*?)<\/function>/g,
    extract: (m) => {
      try {
        return [{ name: m[1], args: argsObject(JSON.parse(m[2])) }];
      } catch {
        return [{ name: m[1], args: {} }];
      }
    },
  },
  // Mistral: [TOOL_CALLS][{…},{…}]
  {
    re: /\[TOOL_CALLS\]\s*(\[[\s\S]*?\])(?=\s*(?:\n|$))/g,
    extract: (m) => {
      try {
        const arr: unknown = JSON.parse(m[1]);
        return Array.isArray(arr)
          ? arr.map(fromJsonCall).filter((c): c is RawCall => c !== null)
          : [];
      } catch {
        return [];
      }
    },
  },
];

/**
 * Find every tool call written into `text`, in the order they appear, and
 * return them as the structured calls the loop already knows how to run,
 * with the text they occupied removed. `idPrefix` keeps ids unique per round.
 */
export function parseTextToolCalls(
  text: string,
  idPrefix = "text",
): ParsedTextToolCalls {
  if (!/<tool_call>|<invoke\s|<function=|\[TOOL_CALLS\]|function_calls?>/.test(text)) {
    return { text, calls: [] };
  }
  const found: { at: number; call: RawCall }[] = [];
  let remaining = text;
  for (const t of TEMPLATES) {
    remaining = remaining.replace(t.re, (whole: string, ...rest: unknown[]) => {
      const offset = rest[rest.length - 2] as number;
      const m = [whole, ...rest.slice(0, -2)] as unknown as RegExpMatchArray;
      for (const call of t.extract(m)) found.push({ at: offset, call });
      return "";
    });
  }
  found.sort((a, b) => a.at - b.at);
  return {
    text: remaining.replace(/\n{3,}/g, "\n\n").trim(),
    calls: found.map(({ call }, i) => ({
      id: `${idPrefix}-${i + 1}`,
      type: "function" as const,
      function: { name: call.name, arguments: JSON.stringify(call.args) },
    })),
  };
}
