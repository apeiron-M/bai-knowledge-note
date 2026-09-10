/**
 * Make Connect's "Log in to access this drive" modal dismissible.
 *
 * When a share link (`?driveUrl=…`) points at a protected drive, Connect calls
 * `addRemoteDrive` while signed out; the auth failure makes `reactor-browser`
 * do `showPHModal({ type: "driveAuthRequired" })`. That modal is upstream and
 * has no way out: `DriveAuthRequiredModal` renders `DriveAuthGate` with only an
 * `onLogin` handler, the backdrop is `pointer-events-none`, and nothing closes
 * the modal except the login button (whose own flow must then be cancelled on
 * the Renown side). A visitor who does not want to sign in yet is stuck looking
 * at the card.
 *
 * This shim adds a `✕` Cancel control inside the card, without touching
 * `node_modules`. Dismissal is deliberately limited to that button: the cookie
 * banner mounts over the page, and a document-level outside-click or Escape
 * handler also fired on it, closing the card the moment a visitor answered the
 * cookies. The modal's own state is `window.ph.modal` (see reactor-browser's
 * `makePHEventFunctions("modal")`) and `closePHModal()` is the supported setter,
 * so this is a consumer-side mitigation, not a monkey-patch. It is installed
 * once, at package load, from `startRemoteFirstBoot()`.
 */
import { closePHModal } from "@powerhousedao/reactor-browser";

const DRIVE_AUTH_MODAL_TYPE = "driveAuthRequired";
const DISMISS_ATTR = "data-vault-drive-auth-dismiss";

type PhModal = { type?: unknown };

function activeModalType(): string | undefined {
  const type = (globalThis as { ph?: { modal?: PhModal } }).ph?.modal?.type;
  return typeof type === "string" ? type : undefined;
}

/** Whether Connect's drive-auth modal is the one currently open. */
export function isDriveAuthModalOpen(modalType: string | undefined): boolean {
  return modalType === DRIVE_AUTH_MODAL_TYPE;
}

/** The portaled dialog `DriveAuthRequiredModal` renders. */
function findDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-modal="false"]');
}

function findDismissButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${DISMISS_ATTR}]`);
}

function injectDismissButton(dialog: HTMLElement): void {
  if (dialog.querySelector(`[${DISMISS_ATTR}]`)) return;
  // The dialog is `grid place-items-center`; the card is its only child. The
  // button is appended to the card and taken out of flow, so it neither adds a
  // grid track nor reflows the card.
  const card = dialog.firstElementChild as HTMLElement | null;
  if (!card) return;
  if (window.getComputedStyle(card).position === "static") {
    card.style.position = "relative";
  }

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(DISMISS_ATTR, "");
  button.setAttribute("aria-label", "Cancel");
  button.title = "Cancel";
  button.textContent = "✕";
  Object.assign(button.style, {
    position: "absolute",
    top: "0.75rem",
    right: "0.75rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.75rem",
    height: "1.75rem",
    padding: "0",
    border: "none",
    borderRadius: "9999px",
    background: "transparent",
    // The card is `bg-background` with no text colour of its own, so inherited
    // colour can be the UA default — black, and invisible on the dark card.
    // Connect's own theme tokens are the reliable source: `--foreground` is
    // slate-100 under `.dark` and gray-800 in light mode.
    color: "var(--foreground, currentColor)",
    opacity: "0.7",
    cursor: "pointer",
    font: "inherit",
    fontSize: "0.875rem",
    lineHeight: "1",
    transition: "opacity 120ms ease, background-color 120ms ease",
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener("click", () => closePHModal());
  button.addEventListener("mouseenter", () => {
    button.style.opacity = "1";
    button.style.backgroundColor = "var(--muted, rgba(128, 128, 128, 0.2))";
  });
  button.addEventListener("mouseleave", () => {
    button.style.opacity = "0.7";
    button.style.backgroundColor = "transparent";
  });
  card.appendChild(button);
}

/** Keep the injected button in step with the modal's presence. */
function syncDismissButton(): void {
  const active = isDriveAuthModalOpen(activeModalType());
  const dialog = active ? findDialog() : null;
  const existing = findDismissButton();
  if (!active || !dialog) {
    existing?.remove();
    return;
  }
  if (existing && dialog.contains(existing)) return;
  existing?.remove();
  injectDismissButton(dialog);
}

/**
 * Install the modal's Cancel control. Idempotent usage is the caller's job
 * (`startRemoteFirstBoot` runs once). Returns a cleanup for tests, though
 * nothing in the app ever uninstalls it.
 */
export function installDriveAuthModalDismissal(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  window.addEventListener("ph:modalUpdated", syncDismissButton);

  const observer =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => syncDismissButton());
  // React renders the card a tick after the modal event, and can re-render it
  // while open; the observer is what re-injects the button if that drops it.
  observer?.observe(document.body, { childList: true, subtree: true });
  syncDismissButton();

  return () => {
    window.removeEventListener("ph:modalUpdated", syncDismissButton);
    observer?.disconnect();
    findDismissButton()?.remove();
  };
}
