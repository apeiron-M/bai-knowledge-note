/** What the browser vault says about the AI that turns its sources into notes. */
export function aiWorkLine(count: number): string {
  return count === 1
    ? "Your AI turns this source into notes."
    : `Your AI turns these ${count} sources into notes, one after another.`;
}
