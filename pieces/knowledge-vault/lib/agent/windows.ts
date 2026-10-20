// pieces/knowledge-vault/lib/agent/windows.ts
/**
 * Long sources are read in windows. A model on this computer keeps its attention on about 8,000
 * characters; a hosted one on far more. A window breaks at a paragraph, keeps a heading with the
 * text under it, and cuts a paragraph longer than itself at sentence ends.
 */

export const LOCAL_WINDOW_CHARS = 8_000;
export const HOSTED_WINDOW_CHARS = 24_000;
export const MIN_WINDOW_CHARS = 2_000;
/** Characters per token, to turn a context size into characters: a conservative average for prose. */
const CHARS_PER_TOKEN = 3.5;

export type Locality = "local" | "hosted";
export type TextWindow = { id: string; heading: string | null; text: string };

/** How many windows run at once: one on this computer's model, three on a hosted one. */
export const paceFor = (locality: Locality): number => (locality === "local" ? 1 : 3);
/** How many claims one drafting call writes. */
export const draftBatchFor = (locality: Locality): number => (locality === "local" ? 8 : 16);

/** Characters per window for this model: its kind sets the base, a known context caps it, an override wins. */
export function windowSize(args: { locality: Locality; contextTokens?: number | null; override?: number | null }): number {
  const override = Number(args.override);
  if (args.override !== null && args.override !== undefined && Number.isFinite(override) && override > 0) return Math.max(MIN_WINDOW_CHARS, Math.round(override));
  const base = args.locality === "local" ? LOCAL_WINDOW_CHARS : HOSTED_WINDOW_CHARS;
  const context = Number(args.contextTokens);
  const cap = args.contextTokens && Number.isFinite(context) && context > 0 ? Math.floor(context * 0.25 * CHARS_PER_TOKEN) : Number.POSITIVE_INFINITY;
  return Math.max(MIN_WINDOW_CHARS, Math.min(base, cap));
}

type Unit = { text: string; heading: boolean };
const HEADING = /^#{1,6}\s+\S/;
const headingText = (line: string) => line.replace(/^#{1,6}\s+/, "").trim();

/** The text's paragraphs, in order; a one-line `# heading` paragraph is marked as a heading. */
function units(text: string): Unit[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ text: p, heading: HEADING.test(p) && !p.includes("\n") }));
}

/** Text longer than `size`, cut at sentence ends; a sentence longer than `size` is cut where it must be. */
export function splitLong(text: string, size: number): string[] {
  const sentences = text.split(/(?<=[.!?]["')\]]*)\s+/).filter(Boolean);
  const out: string[] = [];
  let current = "";
  const push = () => {
    if (current) out.push(current);
    current = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > size) {
      push();
      for (let i = 0; i < sentence.length; i += size) out.push(sentence.slice(i, i + size));
      continue;
    }
    if (current && current.length + 1 + sentence.length > size) push();
    current = current ? `${current} ${sentence}` : sentence;
  }
  push();
  return out;
}

/** Hands out a source's windows one at a time, so each is sized for the model answering when it is cut. */
export class WindowCursor {
  private queue: Unit[];
  private heading: string | null = null;
  private count = 0;

  constructor(text: string, private readonly prefix = "w") {
    this.queue = units(text);
  }

  get done(): boolean {
    return this.queue.length === 0;
  }

  /**
   * The next window of at most `size` characters, or null when the text is used up. With `fill`, the
   * paragraph that straddles the end is cut at a sentence end so the window comes out close to `size`
   * (used when halving a window that failed); otherwise a window ends at a paragraph.
   */
  next(size: number, fill = false): TextWindow | null {
    if (this.queue.length === 0) return null;
    const taken: Unit[] = [];
    let length = 0;
    while (this.queue.length) {
      const unit = this.queue[0];
      const added = taken.length ? unit.text.length + 2 : unit.text.length;
      if (length + added <= size) {
        taken.push(unit);
        this.queue.shift();
        length += added;
        continue;
      }
      // Too long for what is left: cut it at sentences and take what fits, when the window is
      // empty or holds only the heading this text belongs under.
      const room = size - length - (taken.length ? 2 : 0);
      if (taken.length === 0 || (taken.length === 1 && taken[0].heading && room >= MIN_WINDOW_CHARS / 2) || (fill && !unit.heading && room >= MIN_WINDOW_CHARS / 4)) {
        const [first, ...rest] = splitLong(unit.text, room);
        this.queue.splice(0, 1, ...rest.map((text) => ({ text, heading: false })));
        taken.push({ text: first, heading: false });
      }
      break;
    }
    // A heading never ends a window: it goes back to start the next one, with the text under it.
    while (taken.length > 1 && taken[taken.length - 1].heading) this.queue.unshift(taken.pop()!);
    const own = taken[0].heading ? headingText(taken[0].text) : this.heading;
    for (const u of taken) if (u.heading) this.heading = headingText(u.text);
    return { id: `${this.prefix}${++this.count}`, heading: own, text: taken.map((u) => u.text).join("\n\n") };
  }

  /** Everything not handed out yet, as one window. */
  rest(): TextWindow | null {
    if (this.queue.length === 0) return null;
    const own = this.queue[0].heading ? headingText(this.queue[0].text) : this.heading;
    const text = this.queue.map((u) => u.text).join("\n\n");
    this.queue = [];
    return { id: `${this.prefix}${++this.count}`, heading: own, text };
  }
}

/** A window cut in two near its middle, at a paragraph or at a sentence end inside the paragraph that straddles it; null when a half would be under the minimum. */
export function splitInHalf(w: TextWindow): [TextWindow, TextWindow] | null {
  if (w.text.length < 2 * MIN_WINDOW_CHARS) return null;
  const cursor = new WindowCursor(w.text, `${w.id}.`);
  const first = cursor.next(Math.ceil(w.text.length / 2), true);
  const second = cursor.rest();
  if (!first || !second) return null;
  return [
    { ...first, heading: first.heading ?? w.heading },
    { ...second, heading: second.heading ?? w.heading },
  ];
}
