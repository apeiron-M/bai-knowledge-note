import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bindingLabel,
  defaultBindingText,
  detectPlatform,
  parseBinding,
  readBindingText,
  saveBindingText,
  sheetKeyAction,
} from "../chat/ui/hotkey.js";
import type { CreateIntent } from "../chat/core/target-document.js";
import { useChatContext } from "../hooks/use-chat-context.js";
import { useChatSession } from "../hooks/use-chat-session.js";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { ChatPanel } from "./ChatPanel.js";
import { ChatTargetTag } from "./ChatTargetTag.js";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";

/**
 * The chat as a bottom sheet over the drive app's content area. Rendered
 * by `DriveExplorer`, so it persists while a document editor is open and
 * the tag follows navigation. Collapsed it is a pill with the tag and the
 * shortcut; expanded, a panel of about 45% of the viewport height. The
 * panel stays mounted while collapsed, so a running turn keeps going.
 */
export function ChatSheet() {
  const driveId = useSelectedDriveId() ?? "";
  const session = useChatSession(driveId);
  const context = useChatContext(session.state.recent);
  const target = context.frame.target;
  const { touchRecent } = session;

  const platform = useMemo(detectPlatform, []);
  const [bindingText, setBindingText] = useState(() => readBindingText(platform));
  const binding = useMemo(() => parseBinding(bindingText, platform), [bindingText, platform]);
  const shortcut = binding ? bindingLabel(binding, platform) : "";

  const [expanded, setExpanded] = useState(false);
  const [createIntent, setCreateIntent] = useState<CreateIntent | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // the recent ring: documents the user opens (with their loaded title)
  useEffect(() => {
    if (target.kind === "document" && target.docType) touchRecent(target);
  }, [target, touchRecent]);

  const open = useCallback(() => {
    const a = document.activeElement;
    returnFocus.current =
      a instanceof HTMLElement && !sheetRef.current?.contains(a) ? a : null;
    setExpanded(true);
  }, []);
  const collapse = useCallback(() => {
    setExpanded(false);
    const back = returnFocus.current;
    requestAnimationFrame(() => (back?.isConnected ? back : pillRef.current)?.focus());
  }, []);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inSheet = e.target instanceof Node && !!sheetRef.current?.contains(e.target);
      const action = sheetKeyAction(e, binding, { expanded, inSheet });
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === "open") open();
      else if (action === "collapse") collapse();
      else {
        const a = document.activeElement;
        if (a instanceof HTMLElement) returnFocus.current = a;
        inputRef.current?.focus();
      }
    }
    // capture phase: before editor fields and Connect's own handlers
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [binding, expanded, open, collapse]);

  return (
    <>
    <div
      ref={sheetRef}
      data-testid="chat-sheet"
      data-expanded={expanded}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4"
    >
      {!expanded && (
        <button
          ref={pillRef}
          type="button"
          data-testid="chat-sheet-pill"
          onClick={open}
          className="pointer-events-auto mb-3 flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs shadow-lg"
          style={{
            border: "1px solid var(--bai-border)",
            backgroundColor: "var(--bai-surface)",
            color: "var(--bai-text-tertiary)",
          }}
        >
          <ChatTargetTag target={target} />
          <span className="shrink-0">Ask or change…</span>
          {shortcut && (
            <kbd
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              style={{ border: "1px solid var(--bai-border)", color: "var(--bai-text-muted)" }}
            >
              {shortcut}
            </kbd>
          )}
        </button>
      )}
      <div
        role="dialog"
        aria-label="Chat"
        aria-modal="false"
        data-testid="chat-sheet-panel"
        className="pointer-events-auto w-full max-w-4xl flex-col rounded-t-xl shadow-2xl"
        style={{
          display: expanded ? "flex" : "none",
          height: "45vh",
          minHeight: 280,
          border: "1px solid var(--bai-border)",
          borderBottom: "none",
          backgroundColor: "var(--bai-surface)",
        }}
      >
        <button
          type="button"
          aria-label="Collapse chat"
          onClick={collapse}
          className="mx-auto mt-1.5 h-1.5 w-10 rounded-full"
          style={{ backgroundColor: "var(--bai-border)" }}
        />
        <div
          className="flex flex-wrap items-center gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid var(--bai-border)" }}
        >
          <ChatTargetTag target={target} />
          <span className="flex-1" />
          <SheetMenu
            persistent={session.persistent}
            entries={session.state.entries.length}
            onClear={session.clear}
            bindingText={bindingText}
            defaultText={defaultBindingText(platform)}
            onBinding={(t) => {
              if (!saveBindingText(t, platform)) return false;
              setBindingText(t.trim() || defaultBindingText(platform));
              return true;
            }}
          />
          <button
            type="button"
            data-testid="chat-sheet-collapse"
            onClick={collapse}
            className="rounded-md px-2 py-0.5 text-xs"
            style={{ border: "1px solid var(--bai-border)", color: "var(--bai-text-tertiary)" }}
          >
            Esc
          </button>
        </div>
        <div className="min-h-0 flex-1 px-3 pb-3 pt-2">
          <ChatPanel
            context={context}
            session={session}
            inputRef={inputRef}
            onCreate={setCreateIntent}
          />
        </div>
      </div>
    </div>
    {/* outside the sheet, so its own Esc handler gets the key */}
    <CreateDocumentDialog
      open={!!createIntent}
      documentType={createIntent?.docType ?? ""}
      documentTypeLabel={createIntent?.label ?? ""}
      onClose={() => setCreateIntent(null)}
    />
    </>
  );
}

function SheetMenu({
  persistent,
  entries,
  onClear,
  bindingText,
  defaultText,
  onBinding,
}: {
  persistent: boolean | null;
  entries: number;
  onClear: () => void;
  bindingText: string;
  defaultText: string;
  onBinding: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState(bindingText);
  const [bad, setBad] = useState(false);
  return (
    <details className="relative text-xs" style={{ color: "var(--bai-text-muted)" }}>
      <summary className="cursor-pointer" data-testid="chat-sheet-menu">
        History{persistent === false ? " (not saved)" : ""}
      </summary>
      <div
        className="absolute right-0 z-10 mt-1 flex w-72 flex-col gap-2 rounded-md p-3 shadow-xl"
        style={{ border: "1px solid var(--bai-border)", backgroundColor: "var(--bai-surface)" }}
      >
        <span data-testid="chat-history-status">
          {persistent === false
            ? "History is kept in memory only (IndexedDB is unavailable here); it is lost on reload."
            : `${entries} entries, saved in this browser for this drive.`}{" "}
          The models never see it: each request runs on its own.
        </span>
        <button
          type="button"
          data-testid="chat-history-clear"
          onClick={onClear}
          className="self-start rounded-md px-2 py-1"
          style={{ border: "1px solid var(--bai-border)", color: "var(--bai-text-tertiary)" }}
        >
          Clear history
        </button>
        <label className="flex flex-col gap-1">
          Shortcut (e.g. {defaultText}; Mod is ⌘ on macOS, Ctrl elsewhere)
          <span className="flex gap-1">
            <input
              aria-label="Chat shortcut"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setBad(false);
              }}
              className="flex-1 rounded px-2 py-1"
              style={{
                border: `1px solid ${bad ? "#ef4444" : "var(--bai-border)"}`,
                backgroundColor: "var(--bai-surface)",
                color: "var(--bai-text)",
              }}
            />
            <button
              type="button"
              onClick={() => setBad(!onBinding(draft))}
              className="rounded px-2 py-1"
              style={{ border: "1px solid var(--bai-border)" }}
            >
              Save
            </button>
          </span>
        </label>
      </div>
    </details>
  );
}
