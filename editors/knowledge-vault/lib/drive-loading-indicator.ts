/**
 * A small "Loading Drive…" pill, shown while a drive snapshot is being re-read
 * after a Renown session change.
 *
 * The drive list on Connect's home screen comes from `window.ph.drives`, which
 * this package has to re-hydrate from the Switchboard. On a logout/login as a
 * different account that re-read is not instant (probe, then a full drive
 * read), and the home screen otherwise sits on the previous session's view with
 * nothing to say why. This is deliberately a fixed, self-contained element
 * rather than something rendered into Connect's tree: it must show on the home
 * screen, where none of this package's React components are mounted.
 *
 * The element is created lazily, so the node build and tests (no `document`)
 * never touch it. Show/hide are reference-counted so overlapping recoveries
 * cannot remove it out from under each other.
 */

let element: HTMLElement | null = null;
let glows: Animation[] = [];
let openCount = 0;

export function showDriveLoading(): void {
  openCount += 1;
  if (typeof document === "undefined" || element) return;

  const host = document.createElement("div");
  host.setAttribute("data-vault-drive-loading", "");
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  Object.assign(host.style, {
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: "60",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 0.875rem",
    borderRadius: "9999px",
    // Connect's theme tokens, so the pill tracks light/dark with the rest.
    background: "var(--card, var(--background, rgba(20, 20, 20, 0.9)))",
    color: "var(--card-foreground, var(--foreground, #fff))",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
    font: "500 0.875rem/1.2 system-ui, -apple-system, sans-serif",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  const mark = vaultMark();
  const label = document.createElement("span");
  label.textContent = "Loading Drive…";

  host.append(mark.svg, label);
  document.body.appendChild(host);
  element = host;
  // The vault loader's mark: the three notes light in turn. Still under reduced motion.
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!still) {
    glows = mark.notes.map((note, i) =>
      note.animate(
        [{ opacity: 0.3 }, { opacity: 1, offset: 0.3 }, { opacity: 0.3 }],
        {
          duration: 1200,
          delay: i * 400,
          iterations: Number.POSITIVE_INFINITY,
          easing: "ease-in-out",
        },
      ),
    );
  }
}

/**
 * The vault loader's three-node mark (shared/vault-loader.tsx), drawn in the
 * pill's text colour: Connect's tokens, not the vault's, live here.
 */
function vaultMark(): { svg: SVGSVGElement; notes: SVGCircleElement[] } {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.style.overflow = "visible";
  const points: [number, number][] = [
    [8, 2.4],
    [13.4, 12],
    [2.6, 12],
  ];
  for (const [x, y] of points) {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", "8");
    line.setAttribute("y1", "8.6");
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-opacity", "0.35");
    line.setAttribute("stroke-width", "1.2");
    line.setAttribute("stroke-linecap", "round");
    svg.append(line);
  }
  const hub = document.createElementNS(ns, "circle");
  hub.setAttribute("cx", "8");
  hub.setAttribute("cy", "8.6");
  hub.setAttribute("r", "2.4");
  hub.setAttribute("fill", "currentColor");
  svg.append(hub);
  const notes = points.map(([x, y]) => {
    const note = document.createElementNS(ns, "circle");
    note.setAttribute("cx", String(x));
    note.setAttribute("cy", String(y));
    note.setAttribute("r", "1.7");
    note.setAttribute("fill", "currentColor");
    note.style.opacity = "0.7";
    svg.append(note);
    return note;
  });
  return { svg, notes };
}

export function hideDriveLoading(): void {
  openCount = Math.max(0, openCount - 1);
  if (openCount > 0) return;
  for (const glow of glows) glow.cancel();
  glows = [];
  element?.remove();
  element = null;
}
