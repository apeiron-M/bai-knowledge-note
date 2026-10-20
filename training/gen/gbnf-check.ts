/**
 * GBNF recognizer for training-data checks. Copied from
 * `tests/unit/gbnf-recognizer.ts` (test-only, round 5) and extended with
 * bounded repetition `{n}` / `{m,}` / `{m,n}`, which llama.cpp's
 * json-schema-to-grammar output uses (e.g. the `space` rule). The copy keeps
 * `training/` self-contained; it is not imported by app code.
 * `accepts(grammar, text)` is true when `root` derives exactly `text`.
 */
type Node =
  | { t: "lit"; s: string }
  | { t: "cls"; neg: boolean; ranges: [number, number][] }
  | { t: "ref"; name: string }
  | { t: "seq"; xs: Node[] }
  | { t: "alt"; xs: Node[] }
  | { t: "rep"; x: Node; min: number; max: number };

function unescape(src: string, i: number): [number, number] {
  const c = src[i + 1];
  if (c === "x") return [parseInt(src.slice(i + 2, i + 4), 16), i + 4];
  const map: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
  return [(map[c] ?? c).codePointAt(0) ?? 0, i + 2];
}

function parseExpr(src: string): Node {
  let i = 0;
  const ws = () => {
    while (src[i] === " ") i++;
  };
  function alt(): Node {
    const xs = [seq()];
    ws();
    while (src[i] === "|") {
      i++;
      xs.push(seq());
      ws();
    }
    return xs.length === 1 ? xs[0] : { t: "alt", xs };
  }
  function seq(): Node {
    const xs: Node[] = [];
    for (;;) {
      ws();
      if (i >= src.length || src[i] === "|" || src[i] === ")") break;
      let a = atom();
      ws();
      const p = src[i];
      if (p === "?" || p === "*" || p === "+") {
        i++;
        a = {
          t: "rep",
          x: a,
          min: p === "+" ? 1 : 0,
          max: p === "?" ? 1 : Infinity,
        };
      } else if (p === "{") {
        // Bounded repetition: {n}, {m,}, {m,n} (json-schema-to-grammar emits these).
        const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
        if (!m)
          throw new Error(`bad repetition at ${i}: ${src.slice(i, i + 10)}`);
        i += m[0].length;
        const [, lo, comma, hi] = m;
        const min = Number(lo);
        const max = comma ? (hi ? Number(hi) : Infinity) : min;
        a = { t: "rep", x: a, min, max };
      }
      xs.push(a);
    }
    return xs.length === 1 ? xs[0] : { t: "seq", xs };
  }
  function atom(): Node {
    const c = src[i];
    if (c === '"') {
      i++;
      let s = "";
      while (src[i] !== '"') {
        if (src[i] === "\\") {
          const [cp, j] = unescape(src, i);
          s += String.fromCodePoint(cp);
          i = j;
        } else {
          const cp = src.codePointAt(i) ?? 0;
          s += String.fromCodePoint(cp);
          i += cp > 0xffff ? 2 : 1;
        }
      }
      i++;
      return { t: "lit", s };
    }
    if (c === "[") {
      i++;
      const neg = src[i] === "^";
      if (neg) i++;
      const ranges: [number, number][] = [];
      const one = (): number => {
        if (src[i] === "\\") {
          const [cp, j] = unescape(src, i);
          i = j;
          return cp;
        }
        const cp = src.codePointAt(i) ?? 0;
        i += cp > 0xffff ? 2 : 1;
        return cp;
      };
      while (src[i] !== "]") {
        const lo = one();
        if (src[i] === "-" && src[i + 1] !== "]") {
          i++;
          ranges.push([lo, one()]);
        } else ranges.push([lo, lo]);
      }
      i++;
      return { t: "cls", neg, ranges };
    }
    if (c === "(") {
      i++;
      const x = alt();
      ws();
      if (src[i] !== ")") throw new Error(`expected ) at ${i} in ${src}`);
      i++;
      return x;
    }
    const m = /^[a-zA-Z0-9-]+/.exec(src.slice(i));
    if (!m) throw new Error(`bad token at ${i}: ${src.slice(i, i + 20)}`);
    i += m[0].length;
    return { t: "ref", name: m[0] };
  }
  const node = alt();
  ws();
  if (i !== src.length) throw new Error(`trailing input at ${i}: ${src}`);
  return node;
}

export function parseGrammar(grammar: string): Map<string, Node> {
  const rules = new Map<string, Node>();
  for (const line of grammar.split("\n")) {
    if (!line.trim()) continue;
    const m = /^([a-zA-Z0-9-]+) ::= ?(.*)$/.exec(line);
    if (!m) throw new Error(`bad rule: ${line}`);
    if (rules.has(m[1])) throw new Error(`duplicate rule ${m[1]}`);
    rules.set(
      m[1],
      m[2].trim() === "" ? { t: "seq", xs: [] } : parseExpr(m[2]),
    );
  }
  for (const node of rules.values()) checkRefs(node, rules);
  return rules;
}

function checkRefs(n: Node, rules: Map<string, Node>): void {
  if (n.t === "ref" && !rules.has(n.name))
    throw new Error(`undefined rule ${n.name}`);
  if (n.t === "seq" || n.t === "alt") n.xs.forEach((x) => checkRefs(x, rules));
  if (n.t === "rep") checkRefs(n.x, rules);
}

export function accepts(grammar: string, text: string): boolean {
  const rules = parseGrammar(grammar);
  const cps = Array.from(text, (c) => c.codePointAt(0) ?? 0);
  const memo = new Map<string, Set<number>>();
  function ends(n: Node, pos: number): Set<number> {
    switch (n.t) {
      case "lit": {
        const lc = Array.from(n.s, (c) => c.codePointAt(0) ?? 0);
        for (let k = 0; k < lc.length; k++)
          if (cps[pos + k] !== lc[k]) return new Set();
        return new Set([pos + lc.length]);
      }
      case "cls": {
        if (pos >= cps.length) return new Set();
        const cp = cps[pos];
        const hit = n.ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
        return hit !== n.neg ? new Set([pos + 1]) : new Set();
      }
      case "ref": {
        const key = `${n.name}@${pos}`;
        const cached = memo.get(key);
        if (cached) return cached;
        memo.set(key, new Set());
        const node = rules.get(n.name);
        const r = node ? ends(node, pos) : new Set<number>();
        memo.set(key, r);
        return r;
      }
      case "seq": {
        let cur = new Set([pos]);
        for (const x of n.xs) {
          const next = new Set<number>();
          for (const p of cur) for (const e of ends(x, p)) next.add(e);
          cur = next;
          if (cur.size === 0) break;
        }
        return cur;
      }
      case "alt": {
        const out = new Set<number>();
        for (const x of n.xs) for (const e of ends(x, pos)) out.add(e);
        return out;
      }
      case "rep": {
        const out = new Set<number>();
        if (n.min === 0) out.add(pos);
        let frontier = new Set([pos]);
        for (let k = 1; k <= n.max && frontier.size > 0; k++) {
          const next = new Set<number>();
          for (const p of frontier)
            for (const e of ends(n.x, p)) if (e > p) next.add(e);
          for (const e of next) if (k >= n.min) out.add(e);
          frontier = next;
        }
        return out;
      }
    }
  }
  const root = rules.get("root");
  if (!root) throw new Error("no root rule");
  return ends(root, 0).has(cps.length);
}
