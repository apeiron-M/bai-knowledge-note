/**
 * What the chat can do, shown where the person decides what to ask.
 *
 * Under the composer of an empty chat: four task cards, each a real prompt
 * the vault can answer, sent with one click — the way every chat a person
 * already knows opens, and the fastest way to learn what this one does (by
 * doing it). Below them, the vault's own topics, and a link to the whole list.
 *
 * The whole list is a panel, opened on demand — from that link, or the "?"
 * in the chat's header at any time — never pushed at the person on arrival:
 * a tour that opens before anything has been asked is closed unread. Until
 * it has been opened once, the link says "New here?"; after that it is quiet.
 *
 * Every example is sendable as written: topic examples use the vault's own
 * top topic, and are left out when the vault has none yet.
 */
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { VaultIcon, type VaultIconName } from "../vault-icons.js";

/** One thing the chat does, in the person's words, with prompts that show it. */
export interface Ability {
  icon: VaultIconName;
  title: string;
  /** What it does for the person, in a sentence or two. */
  does: string;
  /** Prompts that show it, sent as written. */
  examples: string[];
}

/** Everything the chat can do, in the order a person comes to need it. */
export function chatAbilities(topic: string | null): Ability[] {
  const about = (q: string) => (topic ? [q.replace("{topic}", topic)] : []);
  return [
    {
      icon: "ask",
      title: "Ask your notes",
      does: "Answers come from your notes, with the ones it used as numbered links you can open.",
      examples: [...about("What does the vault say about {topic}?"), "What are the main ideas in this vault?", ...about("Summarise what I know about {topic}")],
    },
    {
      icon: "sources",
      title: "Trace where ideas come from",
      does: "Finds the source a note was taken from, and tells you what each source holds.",
      examples: ["What sources are in the vault?", "Which sources did the newest notes come from?"],
    },
    {
      icon: "contradictions",
      title: "Spot disagreements and gaps",
      does: "Shows where your notes contradict each other, what is waiting for your review, and how your topics are organised.",
      examples: ["Where do my notes disagree?", "What is waiting for my review?", "How is the vault organised?"],
    },
    {
      icon: "clock",
      title: "Catch up on changes",
      does: "Says what changed in the vault, when, and who changed it.",
      examples: ["What changed in the vault this week?", "Who has worked on the vault recently?"],
    },
    {
      icon: "work",
      title: "Plan and track work",
      does: "Sets up a project with its deliverables, goals, roadmap and milestones — and keeps them up to date. Every change comes as a card you can edit first; nothing is saved until you press Apply.",
      examples: ["Help me plan a new project", "What is the status of my projects?", "Which deliverables are due next?"],
    },
    {
      icon: "search",
      title: "Look beyond the vault",
      does: "Reads a web page or searches the web, and compares what it finds with your notes.",
      examples: [...about("What is new on the web about {topic}, compared with my notes?")],
    },
    {
      icon: "notes",
      title: "Keep a good answer",
      does: "“Save as note” under any answer turns it into a draft note, linked to the notes it used.",
      examples: [],
    },
  ];
}

/** The four the empty chat opens with: one task each, covering the range. */
export function starterCards(topic: string | null): { icon: VaultIconName; title: string; prompt: string }[] {
  return [
    { icon: "ask", title: "Ask your notes", prompt: topic ? `What does the vault say about ${topic}?` : "What are the main ideas in this vault?" },
    { icon: "work", title: "Plan a project", prompt: "Help me plan a new project" },
    { icon: "contradictions", title: "Find disagreements", prompt: "Where do my notes disagree?" },
    { icon: "clock", title: "Catch up", prompt: "What changed in the vault this week?" },
  ];
}

/* ------------------------------------------------------------------ */
/*  Seen once                                                         */
/* ------------------------------------------------------------------ */

const SEEN_KEY = "bai-chat-help-seen:v1";
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
};

/** The panel's open state, and whether the person has ever opened it — kept in this browser. */
export function useChatHelp() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const show = useCallback(() => {
    setOpen(true);
    setSeen(true);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode: it says "New here?" again next time, nothing worse */
    }
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, seen, show, hide };
}

/* ------------------------------------------------------------------ */
/*  Under the composer                                                */
/* ------------------------------------------------------------------ */

export function ChatStarters({
  topic,
  onAsk,
  onHelp,
  seen,
  children,
}: {
  /** The vault's top topic, for the "Ask your notes" card; null in a vault without topics yet. */
  topic: string | null;
  onAsk: (prompt: string) => void;
  onHelp: () => void;
  /** Whether the person has opened the full list before: until then, the link invites them. */
  seen: boolean;
  /** The topic chips, beneath the cards. */
  children?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-5 pt-6">
      {/* Two by two wherever two fit — four cards read as one set, not three and a straggler — and one column on the narrowest windows. */}
      <div className="grid w-full gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 17rem), 1fr))" }}>
        {starterCards(topic).map((c) => (
          <button
            key={c.title}
            type="button"
            onClick={() => onAsk(c.prompt)}
            className="group flex items-start gap-3 rounded-xl px-3.5 py-3 text-left transition-colors hover:border-[var(--bai-accent)] hover:bg-[var(--bai-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bai-accent)]"
            style={{ backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)" }}
          >
            <span className="mt-0.5 shrink-0 rounded-lg p-1.5" style={{ backgroundColor: "var(--bai-accent-soft)", color: "var(--bai-accent)" }}>
              <VaultIcon name={c.icon} size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold" style={{ color: "var(--bai-text)" }}>
                {c.title}
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-snug" style={{ color: "var(--bai-text-muted)" }}>
                “{c.prompt}”
              </span>
            </span>
          </button>
        ))}
      </div>
      {children}
      {seen ? (
        <button type="button" onClick={onHelp} className="rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[var(--bai-hover)]" style={{ color: "var(--bai-text-muted)" }}>
          What can the chat do?
        </button>
      ) : (
        <button
          type="button"
          onClick={onHelp}
          className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[var(--bai-accent-soft)]"
          style={{ color: "var(--bai-accent)", border: "1px solid color-mix(in srgb, var(--bai-accent) 45%, transparent)" }}
        >
          <VaultIcon name="help" size={14} />
          New here? See what the chat can do
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The whole list                                                    */
/* ------------------------------------------------------------------ */

/** The panel's content — apart from its portal, so it renders anywhere, tests included. */
export function ChatHelpPanel({ topic, onAsk, onClose }: { topic: string | null; onAsk: (prompt: string) => void; onClose: () => void }) {
  const headingId = useId();
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 100 }} role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{ maxWidth: 640, backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)" }}
      >
        <div className="flex items-start gap-3 px-6 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="text-[17px] font-semibold" style={{ color: "var(--bai-text)" }}>
              What the chat can do
            </h2>
            <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--bai-text-secondary)" }}>
              Ask in your own words — these are only examples. Pick one to try it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close"
            className="-mr-2 shrink-0 rounded-md p-1.5 hover:bg-[var(--bai-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bai-accent)]"
            style={{ color: "var(--bai-text-muted)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-2">
          {chatAbilities(topic).map((a) => (
            <li key={a.title} className="flex gap-3 rounded-xl px-3 py-3">
              <span className="mt-0.5 shrink-0 self-start rounded-lg p-1.5" style={{ backgroundColor: "var(--bai-accent-soft)", color: "var(--bai-accent)" }}>
                <VaultIcon name={a.icon} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[14px] font-semibold" style={{ color: "var(--bai-text)" }}>
                  {a.title}
                </h3>
                <p className="mt-0.5 text-[13px] leading-snug" style={{ color: "var(--bai-text-secondary)" }}>
                  {a.does}
                </p>
                {a.examples.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.examples.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => onAsk(q)}
                        className="rounded-full px-3 py-1 text-left text-[12.5px] transition-colors hover:border-[var(--bai-accent)] hover:text-[var(--bai-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bai-accent)]"
                        style={{ color: "var(--bai-text-secondary)", border: "1px solid var(--bai-border)", backgroundColor: "var(--bai-deep)" }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="px-6 py-3.5 text-[12.5px] leading-snug" style={{ color: "var(--bai-text-muted)", borderTop: "1px solid var(--bai-border)" }}>
          Answers come from your vault and show the notes they used. The chat changes nothing on its own: changes to your work come as a card you
          review, and only Apply saves them.
        </p>
      </div>
    </div>
  );
}

/** The panel, over everything else; Esc closes it. */
export function ChatHelpDialog({ topic, onAsk, onClose }: { topic: string | null; onAsk: (prompt: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(<ChatHelpPanel topic={topic} onAsk={onAsk} onClose={onClose} />, document.body);
}
