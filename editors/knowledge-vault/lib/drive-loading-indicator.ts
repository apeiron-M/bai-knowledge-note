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
let spin: Animation | null = null;
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

  const spinner = document.createElement("span");
  Object.assign(spinner.style, {
    display: "inline-block",
    width: "1rem",
    height: "1rem",
    border: "2px solid currentColor",
    borderTopColor: "transparent",
    borderRadius: "9999px",
    opacity: "0.85",
  } satisfies Partial<CSSStyleDeclaration>);

  const label = document.createElement("span");
  label.textContent = "Loading Drive…";

  host.append(spinner, label);
  document.body.appendChild(host);
  element = host;
  spin = spinner.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 800, iterations: Number.POSITIVE_INFINITY },
  );
}

export function hideDriveLoading(): void {
  openCount = Math.max(0, openCount - 1);
  if (openCount > 0) return;
  spin?.cancel();
  spin = null;
  element?.remove();
  element = null;
}
