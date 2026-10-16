import { useState } from "react";
import { isDesktopHost } from "../../shared/host-config.js";
import { resolveReactorEndpoint } from "../../shared/subgraph-endpoint.js";
import type { VaultMenuItem } from "./VaultMenu.js";
import type { VaultPlace } from "./VaultPlaces.js";

/**
 * The lists the guide is printed from. `DriveExplorer` passes its own
 * `GUIDE_PLACES`, `VAULT_MENU` and `CREATE_ITEMS`, so a renamed place or menu
 * entry renames itself here. This file imports only types from the vault's
 * views: importing `DriveExplorer` would be a cycle.
 */
export type GuideLists = {
  places: VaultPlace[];
  menu: VaultMenuItem[];
  createItems: ReadonlyArray<VaultMenuItem>;
};

export const GUIDE_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "sources", label: "Adding sources" },
  { id: "notes", label: "Notes" },
  { id: "pipeline", label: "Processing" },
  { id: "graph", label: "Graph and links" },
  { id: "plugin", label: "AI agent" },
] as const;

export type GuideSectionId = (typeof GUIDE_SECTIONS)[number]["id"];

/** What each place holds, by place id. The place's name comes from the list it is given. */
const PLACE_DESC: Record<string, string> = {
  ask: "Ask the vault a question; the answer names the notes it used.",
  notes: "Every note: one idea each, with its links and its source.",
  topics: "Maps of your topics, from the vault's top map down.",
  sources: "What you added, and what became of each.",
  work: "Scopes of work, their projects, and the breakdowns that deliver them.",
  graph: "How notes connect. Find a note, or hide kinds of notes from the legend.",
  contradictions: "Notes that disagree. Listed while any are open.",
};

/** The guide, opened from the sidebar's foot ("Getting started"). */
export function GettingStartedModal({
  onClose,
  places,
  menu,
  createItems,
}: { onClose: () => void } & GuideLists) {
  const [activeSection, setActiveSection] = useState<GuideSectionId>("overview");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative z-10 flex h-[80vh] w-[720px] max-w-[90vw] flex-col rounded-2xl shadow-2xl"
        style={{
          backgroundColor: "var(--bai-surface)",
          border: "1px solid var(--bai-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--bai-border)" }}
        >
          <div>
            <h2
              className="text-lg font-bold"
              style={{ color: "var(--bai-text)" }}
            >
              Getting started
            </h2>
            <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
              Learn how to use the Knowledge Vault
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 transition-colors"
            style={{ color: "var(--bai-text-muted)" }}
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left nav */}
          <div
            className="w-44 shrink-0 py-3"
            style={{ borderRight: "1px solid var(--bai-border)" }}
          >
            {GUIDE_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className="flex w-full px-4 py-2 text-left text-xs transition-colors"
                style={{
                  backgroundColor:
                    activeSection === s.id
                      ? "var(--bai-accent-soft)"
                      : "transparent",
                  color:
                    activeSection === s.id
                      ? "var(--bai-accent)"
                      : "var(--bai-text-tertiary)",
                  fontWeight: activeSection === s.id ? 500 : 400,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <GuideContent
              section={activeSection}
              places={places}
              menu={menu}
              createItems={createItems}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** One section's body, without the modal's frame. */
export function GuideContent({
  section,
  places,
  menu,
  createItems,
}: { section: GuideSectionId } & GuideLists) {
  switch (section) {
    case "overview":
      return <OverviewSection places={places} menu={menu} createItems={createItems} />;
    case "sources":
      return <SourcesSection />;
    case "notes":
      return <NotesSection createItems={createItems} />;
    case "pipeline":
      return <ProcessingSection menu={menu} />;
    case "graph":
      return <GraphSection menu={menu} />;
    case "plugin":
      return <PluginSection />;
  }
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h3
    className="mb-3 text-sm font-semibold"
    style={{ color: "var(--bai-text)" }}
  >
    {children}
  </h3>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p
    className="mb-4 text-xs leading-relaxed"
    style={{ color: "var(--bai-text-tertiary)" }}
  >
    {children}
  </p>
);
/** One numbered line: "Title — what to do". */
const Step = ({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="mb-4 flex gap-3">
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
      style={{
        backgroundColor: "var(--bai-accent-soft)",
        color: "var(--bai-accent)",
      }}
    >
      {n}
    </span>
    <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
      <b style={{ color: "var(--bai-text)", fontWeight: 500 }}>{title}</b>
      {" — "}
      {children}
    </p>
  </div>
);
const Tip = ({ children }: { children: React.ReactNode }) => (
  <div
    className="mb-4 rounded-lg px-4 py-3"
    style={{
      border: "1px solid var(--bai-accent-soft)",
      backgroundColor: "var(--bai-accent-soft)",
    }}
  >
    <p className="text-xs" style={{ color: "var(--bai-accent)", opacity: 0.8 }}>
      {children}
    </p>
  </div>
);
const Row = ({
  name,
  nameWidth,
  mono,
  children,
}: {
  name: string;
  nameWidth: string;
  mono?: boolean;
  children: React.ReactNode;
}) => (
  <div
    className="flex gap-2 rounded px-3 py-1.5"
    style={{ backgroundColor: "var(--bai-bg)" }}
  >
    <span
      className={`shrink-0 text-[10px] font-medium ${nameWidth}${mono ? " font-mono" : ""}`}
      style={{ color: "var(--bai-accent)" }}
    >
      {name}
    </span>
    <span className="text-[10px]" style={{ color: "var(--bai-text-muted)" }}>
      {children}
    </span>
  </div>
);
const Code = ({ children }: { children: React.ReactNode }) => (
  <div
    className="mb-4 break-all rounded-lg px-4 py-3 font-mono text-[11px]"
    style={{
      backgroundColor: "var(--bai-bg)",
      color: "var(--bai-text-secondary)",
    }}
  >
    {children}
  </div>
);

/** An entry's name as printed in prose. `data-ref` is what the guide's test checks against the real lists. */
function Ref({ kind, id, label }: { kind: "menu" | "create"; id: string; label: string }) {
  return (
    <b data-ref={`${kind}:${id}`} style={{ color: "var(--bai-text)", fontWeight: 500 }}>
      {label}
    </b>
  );
}

/** "A, B and C" over entries. */
function Entries({
  kind,
  items,
}: {
  kind: "menu" | "create";
  items: ReadonlyArray<VaultMenuItem>;
}) {
  return (
    <>
      {items.map((item, i) => (
        <span key={item.key}>
          {i === 0 ? "" : i === items.length - 1 ? " and " : ", "}
          <Ref kind={kind} id={item.key} label={item.label} />
        </span>
      ))}
    </>
  );
}

/** One named entry, found by key; nothing when the key does not exist. */
function Entry({
  kind,
  items,
  k,
}: {
  kind: "menu" | "create";
  items: ReadonlyArray<VaultMenuItem>;
  k: string;
}) {
  const item = items.find((i) => i.key === k);
  return item ? <Ref kind={kind} id={item.key} label={item.label} /> : null;
}

function OverviewSection({ places, menu, createItems }: GuideLists) {
  const desktop = isDesktopHost();
  return (
    <div>
      <H>What is the Knowledge Vault?</H>
      <P>
        A structured knowledge management system where raw content (articles,
        notes, transcripts) is processed into atomic claims, connected into a
        knowledge graph, and maintained over time.
      </P>

      <H>Find your way</H>
      <div className="mb-4 space-y-2">
        {places.map((p) => (
          <div
            key={p.id}
            data-guide-place={p.id}
            className="flex gap-2 rounded-lg px-3 py-2"
            style={{ backgroundColor: "var(--bai-bg)" }}
          >
            <span
              className="w-28 shrink-0 text-xs font-semibold"
              style={{ color: "var(--bai-accent)" }}
            >
              {p.label}
            </span>
            <span className="text-xs" style={{ color: "var(--bai-text-tertiary)" }}>
              {PLACE_DESC[p.id] ?? ""}
            </span>
          </div>
        ))}
      </div>

      <H>The vault menu</H>
      <P>
        {"Under the vault's name, and at the foot (Vault settings): "}
        <Entries kind="menu" items={menu} />.
      </P>

      <H>Search</H>
      <P>Search (Ctrl K, or ⌘ K on a Mac) finds notes, topics, sources and chats.</P>

      <H>Adding</H>
      <P>
        {"Add sources takes files; the arrow beside it offers "}
        <Entries kind="create" items={createItems} />.
      </P>

      <H>{desktop ? "Quick start on the desktop" : "Quick start on the web"}</H>
      <Step n={1} title="Add sources">
        drop files on the window or press Add sources.
      </Step>
      <Step n={2} title="Processing">
        {desktop
          ? "the app reads each source in the background and writes its notes; the status at the top of the window says how it is going."
          : "if this vault's server runs the pipeline, sources are processed on their own; otherwise an AI agent processes them (see AI agent)."}
      </Step>
      <Step n={3} title="Review">
        new notes wait in review; open one, check it, and Approve it.
      </Step>
      <Step n={4} title="Ask">
        the answer names the notes it used.
      </Step>
    </div>
  );
}

function SourcesSection() {
  return (
    <div>
      <H>Adding sources</H>
      <P>
        Add sources converts a PDF, a Word file, a web page or a book, and shows
        the sources it would create before anything is written. Each one is
        queued for processing.
      </P>
      <P>Paste text as a source, which is queued when added.</P>

      <H>What happens to a source</H>
      <P>Inbox → Extracting → Extracted, or Archived.</P>

      <Tip>Editing a source returns it to Inbox.</Tip>

      <H>Deleting a source</H>
      <P>{"\"Delete source\" is on each source's row."}</P>
    </div>
  );
}

function NotesSection({ createItems }: { createItems: ReadonlyArray<VaultMenuItem> }) {
  return (
    <div>
      <H>Knowledge notes</H>
      <P>
        Each note is an atomic claim — one idea, one point. Notes have
        declarative titles that read as complete sentences.
      </P>

      <H>Note structure</H>
      <div className="mb-4 space-y-1">
        {[
          {
            field: "Title",
            desc: 'A clear, declarative statement (e.g., "local-first architecture executes operations immediately")',
          },
          {
            field: "Description",
            desc: "~150 character summary for progressive disclosure",
          },
          {
            field: "Content",
            desc: "Full markdown body with arguments and evidence",
          },
          {
            field: "Type",
            desc: "concept, pattern, architecture, decision, observation, procedure, etc.",
          },
          {
            field: "Status",
            desc: "DRAFT → IN_REVIEW → CANONICAL → ARCHIVED",
          },
          {
            field: "Links",
            desc: "Typed connections to other notes (RELATES_TO, BUILDS_ON, CONTRADICTS, etc.). A link needs a reason.",
          },
          { field: "Topics", desc: "Tags for navigation and MOC grouping" },
        ].map((item) => (
          <Row key={item.field} name={item.field} nameWidth="w-20">
            {item.desc}
          </Row>
        ))}
      </div>

      <Tip>
        Most notes are written while a source is processed. To write one
        yourself, use <Entry kind="create" items={createItems} k="note" />,
        under the arrow beside Add sources.
      </Tip>

      <H>Writing a note</H>
      <Step n={1} title="Open the arrow beside Add sources">
        choose <Entry kind="create" items={createItems} k="note" /> and give the
        note a declarative title.
      </Step>
      <Step n={2} title="Fill in the editor">
        add description, content, type, and topics.
      </Step>
      <Step n={3} title="Add links">
        use the Links section to connect it to a related note, and say why.
      </Step>
    </div>
  );
}

function ProcessingSection({ menu }: { menu: ReadonlyArray<VaultMenuItem> }) {
  const desktop = isDesktopHost();
  return (
    <div>
      <H>Processing</H>
      <P>
        Processing turns a source into connected notes. Each source goes
        through four steps.
      </P>

      <div className="mb-4 space-y-2">
        {[
          {
            step: "Extract",
            phase: "create",
            color: "bg-amber-400",
            desc: "Write atomic notes from the source",
          },
          {
            step: "Connect",
            phase: "reflect",
            color: "bg-blue-400",
            desc: "Find connections between the new notes and existing ones",
          },
          {
            step: "Place in topics",
            phase: "reweave",
            color: "bg-purple-400",
            desc: "Add the new notes to your topics' maps",
          },
          {
            step: "Verify",
            phase: "verify",
            color: "bg-emerald-400",
            desc: "Check schema, links and descriptions",
          },
        ].map((item) => (
          <div
            key={item.step}
            className="flex items-center gap-3 rounded-lg px-3 py-2"
            style={{ backgroundColor: "var(--bai-bg)" }}
          >
            <span className={`h-2.5 w-8 shrink-0 rounded-full ${item.color}`} />
            <span
              className="w-28 shrink-0 text-xs font-medium"
              style={{ color: "var(--bai-text)" }}
            >
              {item.step}
            </span>
            <span
              className="w-14 shrink-0 font-mono text-[10px]"
              style={{ color: "var(--bai-text-muted)" }}
            >
              {item.phase}
            </span>
            <span className="text-[10px]" style={{ color: "var(--bai-text-muted)" }}>
              {item.desc}
            </span>
          </div>
        ))}
      </div>

      <P>
        {desktop
          ? "It runs on its own; See runs, at the top of the window, opens each run in Workflows."
          : "It runs where this vault's server runs the pipeline, or from an AI agent."}
      </P>
      <P>
        <Entry kind="menu" items={menu} k="pipeline" /> is in the vault menu.
      </P>

      <Tip>
        The Verify step finishes a source&apos;s task; its notes stay in review for
        you.
      </Tip>
    </div>
  );
}

function GraphSection({ menu }: { menu: ReadonlyArray<VaultMenuItem> }) {
  return (
    <div>
      <H>Knowledge graph</H>
      <P>
        The graph shows how your notes are connected. Each node is a note, each
        edge is a typed link. Find a note, or hide kinds of notes from the
        legend.
      </P>

      <H>Link types</H>
      <div className="mb-4 space-y-1">
        {[
          {
            type: "RELATES_TO",
            desc: "General connection between related concepts",
          },
          {
            type: "BUILDS_ON",
            desc: "This note extends or deepens the target",
          },
          { type: "CONTRADICTS", desc: "This note conflicts with the target" },
          { type: "SUPERSEDES", desc: "This note replaces an outdated claim" },
          {
            type: "DERIVED_FROM",
            desc: "This note was extracted from the target source",
          },
        ].map((item) => (
          <Row key={item.type} name={item.type} nameWidth="w-28" mono>
            {item.desc}
          </Row>
        ))}
      </div>

      <H>Health</H>
      <P>
        <Entry kind="menu" items={menu} k="health" /> (in the vault menu) shows
        orphans, link density and dangling links.
      </P>

      <Tip>The graph updates on its own when notes change.</Tip>
    </div>
  );
}

const PLUGIN_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: "setup", desc: "Point the plugin at this vault" },
  { cmd: "seed", desc: "Ingest source material for processing" },
  { cmd: "extract", desc: "Extract atomic claims from a source" },
  { cmd: "connect", desc: "Find and create links between notes" },
  { cmd: "verify", desc: "Run quality checks on notes" },
  {
    cmd: "pipeline",
    desc: "Run the full extract → connect → reweave → verify flow",
  },
  { cmd: "health", desc: "Get vault health diagnostics" },
  { cmd: "graph", desc: "Structural analysis (triangles, bridges, clusters)" },
  { cmd: "search", desc: "Find notes by content, title, or topic" },
];

function PluginSection() {
  const desktop = isDesktopHost();
  return (
    <div>
      <H>AI agent (optional)</H>
      <P>
        The powerhouse-knowledge plugin connects Claude Code to your vault. The
        AI agent can extract claims, find connections, verify quality, and
        analyze the graph.
      </P>

      <H>Connect it to this vault</H>
      {desktop ? (
        <P>
          Settings › Diagnostics shows the two things an agent needs: the
          Switchboard CLI command for this vault and the MCP address.
        </P>
      ) : (
        <>
          <P>Point the Switchboard CLI at this vault:</P>
          <Code>
            {`switchboard init --url ${resolveReactorEndpoint()} --name `}
            {"<vault>"}
            {" --use-profile"}
          </Code>
        </>
      )}

      <H>Install the plugin</H>
      <Code>
        claude plugin marketplace add liberuum/powerhouse-knowledge
        <br />
        claude plugin install powerhouse-knowledge@powerhouse-knowledge
      </Code>

      <H>Commands</H>
      <div className="mb-4 space-y-1">
        {PLUGIN_COMMANDS.map((item) => (
          <Row
            key={item.cmd}
            name={`/powerhouse-knowledge:${item.cmd}`}
            nameWidth="w-52"
            mono
          >
            {item.desc}
          </Row>
        ))}
      </div>
    </div>
  );
}
