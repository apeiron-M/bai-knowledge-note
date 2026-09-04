/** True when an optional input field carries a real value — neither omitted nor null. */
export const isSet = <T>(value: T | null | undefined): value is T =>
  value !== undefined && value !== null;

/** Every stored number in this model carries at most two decimal places (1.005 → 1.01, not 1). */
export const round2 = (n: number): number => {
  if (!Number.isFinite(n)) return n;
  const s = String(n);
  if (s.includes("e")) return Math.round(n * 100) / 100;
  return Number(`${Math.round(Number(`${s}e2`))}e-2`);
};
