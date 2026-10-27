/**
 * Deterministic dates for step 2 (X9): the LoRA saw no date in its step-2
 * rows, so the request's date is resolved against `today` in code and the
 * field's grammar narrowed to it; no date, or two different ones, resolve
 * to nothing. A day and month without a year is the next one on or after
 * today; `next <weekday>` is in next week (weeks start Monday), a bare
 * weekday the first after today; `end of week` is its Friday; `end of …`
 * is a period's last day, `next month|year` its first.
 */

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_ABBR: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
];
const COUNTS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

interface Ymd {
  y: number;
  m: number; // 0-based
  d: number;
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const ymd = (t: Date): Ymd => ({
  y: t.getUTCFullYear(),
  m: t.getUTCMonth(),
  d: t.getUTCDate(),
});
const addDays = (t: Ymd, n: number) => ymd(utc(t.y, t.m, t.d + n));
const lastOfMonth = (y: number, m: number): Ymd => ymd(utc(y, m + 1, 0));
const cmp = (a: Ymd, b: Ymd) =>
  utc(a.y, a.m, a.d).getTime() - utc(b.y, b.m, b.d).getTime();
const iso = (t: Ymd) =>
  `${String(t.y).padStart(4, "0")}-${String(t.m + 1).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
const weekday = (t: Ymd) => utc(t.y, t.m, t.d).getUTCDay();

function addMonths(t: Ymd, n: number): Ymd {
  const m = t.m + n;
  const y = t.y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return { y, m: mm, d: Math.min(t.d, lastOfMonth(y, mm).d) };
}

/** Monday of the week containing `t`. */
const mondayOf = (t: Ymd) => addDays(t, -((weekday(t) + 6) % 7));

function validDay(y: number, m: number, d: number): boolean {
  return d >= 1 && d <= lastOfMonth(y, m).d;
}

/** The next `m`/`d` on or after today, or in `year` when given. */
function dayMonth(today: Ymd, m: number, d: number, year?: number): Ymd | null {
  if (year !== undefined)
    return validDay(year, m, d) ? { y: year, m, d } : null;
  for (const y of [
    today.y,
    today.y + 1,
    today.y + 2,
    today.y + 3,
    today.y + 4,
  ]) {
    if (!validDay(y, m, d)) continue;
    const c = { y, m, d };
    if (cmp(c, today) >= 0) return c;
  }
  return null;
}

function monthIndex(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  const full = MONTHS.indexOf(w);
  if (full >= 0) return full;
  return w in MONTH_ABBR ? MONTH_ABBR[w] : null;
}

function dayNumber(word: string): number | null {
  const w = word.toLowerCase();
  const n = /^(\d{1,2})(st|nd|rd|th)?$/.exec(w);
  if (n) return Number(n[1]);
  const o = ORDINALS.indexOf(w);
  if (o >= 0) return o + 1;
  const tw =
    /^(twenty|thirty)-?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)?$/.exec(
      w,
    );
  if (tw && (tw[1] === "twenty" ? true : !tw[2] || tw[2] === "first"))
    return (
      (tw[1] === "twenty" ? 20 : 30) + (tw[2] ? ORDINALS.indexOf(tw[2]) + 1 : 0)
    );
  return null;
}

function parseToday(today: string): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!m) throw new Error(`today must be YYYY-MM-DD, got ${today}`);
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}

/** Every date expression in `utterance`, resolved (distinct, ISO dates). */
export function resolveDates(utterance: string, today: string): string[] {
  const t = parseToday(today);
  const text = utterance.toLowerCase().replace(/[’']/g, "'");
  const found: Ymd[] = [];
  const push = (x: Ymd | null) => {
    if (x) found.push(x);
  };
  const MON = `(${MONTHS.join("|")}|${Object.keys(MONTH_ABBR).join("|")})\\.?(?![a-z])`;
  const DAY = `(\\d{1,2}(?:st|nd|rd|th)?|${ORDINALS.join("|")}|(?:twenty|thirty)-?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)?)`;
  const YEAR = `(?:,?\\s+(\\d{4}))?`;
  // Spans already consumed, so "end of March" is not also "March …".
  const used: [number, number][] = [];
  const free = (a: number, b: number) =>
    used.every(([x, y]) => b <= x || a >= y);
  const scan = (re: RegExp, f: (m: RegExpExecArray) => Ymd | null) => {
    for (const m of text.matchAll(re)) {
      const a = m.index ?? 0;
      const b = a + m[0].length;
      if (!free(a, b)) continue;
      const r = f(m);
      if (r) {
        used.push([a, b]);
        push(r);
      }
    }
  };

  // ISO dates.
  scan(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    return mo >= 0 && mo < 12 && validDay(y, mo, d) ? { y, m: mo, d } : null;
  });
  // end of …
  scan(
    /\bend of (?:the )?(this |next |the next )?(week|month|year|quarter)\b/g,
    (m) => {
      const next = Boolean(m[1]?.includes("next"));
      switch (m[2]) {
        case "week":
          return addDays(mondayOf(t), (next ? 7 : 0) + 4);
        case "month": {
          const b = addMonths({ ...t, d: 1 }, next ? 1 : 0);
          return lastOfMonth(b.y, b.m);
        }
        case "year":
          return { y: t.y + (next ? 1 : 0), m: 11, d: 31 };
        default: {
          const q = Math.floor(t.m / 3) + (next ? 1 : 0);
          const y = t.y + Math.floor(q / 4);
          return lastOfMonth(y, (q % 4) * 3 + 2);
        }
      }
    },
  );
  scan(
    /\bend of (?:q([1-4])|the (first|second|third|fourth) quarter)\b/g,
    (m) => {
      const q = m[1]
        ? Number(m[1]) - 1
        : ["first", "second", "third", "fourth"].indexOf(m[2]);
      const cand = lastOfMonth(t.y, q * 3 + 2);
      return cmp(cand, t) >= 0 ? cand : lastOfMonth(t.y + 1, q * 3 + 2);
    },
  );
  scan(new RegExp(`\\bend of ${MON}${YEAR}`, "g"), (m) => {
    const mo = monthIndex(m[1]);
    if (mo === null) return null;
    const y = m[2] ? Number(m[2]) : undefined;
    const last = (yy: number) => lastOfMonth(yy, mo);
    if (y !== undefined) return last(y);
    return cmp(last(t.y), t) >= 0 ? last(t.y) : last(t.y + 1);
  });
  // "<day> of <Month>", "<day> <Month>", "<Month> <day>".
  scan(
    new RegExp(`\\b(?:the )?${DAY} (?:of )?${MON}${YEAR}(?![a-z])`, "g"),
    (m) => {
      const d = dayNumber(m[1]);
      const mo = monthIndex(m[2]);
      if (d === null || mo === null) return null;
      return dayMonth(t, mo, d, m[3] ? Number(m[3]) : undefined);
    },
  );
  scan(new RegExp(`\\b${MON} (?:the )?${DAY}${YEAR}(?![a-z0-9])`, "g"), (m) => {
    const mo = monthIndex(m[1]);
    const d = dayNumber(m[2]);
    if (d === null || mo === null) return null;
    // "may" is also a verb: only with a numeric day ("may 3"), not "may third".
    if (m[1] === "may" && !/^\d/.test(m[2])) return null;
    return dayMonth(t, mo, d, m[3] ? Number(m[3]) : undefined);
  });
  // Relative days.
  scan(/\b(?:the )?day after tomorrow\b/g, () => addDays(t, 2));
  scan(/\btomorrow\b/g, () => addDays(t, 1));
  scan(/\b(today|tonight)\b/g, () => t);
  scan(/\bnext week\b/g, () => addDays(mondayOf(t), 7));
  scan(/\bnext month\b/g, () => addMonths({ ...t, d: 1 }, 1));
  scan(/\bnext year\b/g, () => ({ y: t.y + 1, m: 0, d: 1 }));
  scan(
    /\b(?:in (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (day|week|month|year)s?|(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (day|week|month|year)s? from (?:now|today))\b/g,
    (m) => {
      const w = m[1] ?? m[3];
      const unit = m[2] ?? m[4];
      const n = /^\d+$/.test(w) ? Number(w) : COUNTS[w];
      if (!n) return null;
      if (unit === "day") return addDays(t, n);
      if (unit === "week") return addDays(t, 7 * n);
      if (unit === "month") return addMonths(t, n);
      return addMonths(t, 12 * n);
    },
  );
  scan(
    new RegExp(`\\b(next |this |coming |by )?(${WEEKDAYS.join("|")})\\b`, "g"),
    (m) => {
      const wd = WEEKDAYS.indexOf(m[2]);
      if (m[1] === "next ") return addDays(mondayOf(t), 7 + ((wd + 6) % 7));
      const ahead = (wd - weekday(t) + 7) % 7 || 7;
      return addDays(t, ahead);
    },
  );

  return [...new Set(found.map(iso))];
}

/** The one date the request names, as `YYYY-MM-DD`, else null. */
export function resolveDate(utterance: string, today: string): string | null {
  const all = resolveDates(utterance, today);
  return all.length === 1 ? all[0] : null;
}

/**
 * A one-line hint for the proposal card: the date step 2 fixed and, when
 * the request says `next <weekday>`, this resolver's reading of it (that
 * weekday in next week, weeks start Monday). English is split on it (said
 * on a Tuesday, "next Friday" is the coming Friday to some and the one a
 * week later to others); the card shows the date before anything is
 * dispatched.
 */
export function dateRuleNote(utterance: string, iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const day = m
    ? WEEKDAYS[utc(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getUTCDay()]
    : null;
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const base = `Date read from your words: ${iso}${day ? ` (${cap(day)})` : ""}.`;
  const next = new RegExp(`\\bnext (${WEEKDAYS.join("|")})\\b`).exec(
    utterance.toLowerCase(),
  );
  if (!next) return base;
  const wd = cap(next[1]);
  return `${base} "Next ${wd}" means ${wd} of next week (weeks start Monday); say "this ${wd}" for the coming one.`;
}
