import { useState } from "react";

export function GettingStartedButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-2 py-1.5 text-xs text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
        title="Getting started guide"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
      </button>
      {open && <GettingStartedModal onClose={() => setOpen(false)} />}
    </>
  );
}

function GettingStartedModal({ onClose }: { onClose: () => void }) {
  const [activeSection, setActiveSection] = useState<string>("overview");

  const sections = [
    { id: "overview", label: "Overview" },
    { id: "sources", label: "Adding Sources" },
    { id: "notes", label: "Notes & Claims" },
    { id: "pipeline", label: "Processing Pipeline" },
    { id: "graph", label: "Graph & Links" },
    { id: "plugin", label: "AI Agent" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex h-[80vh] w-[720px] max-w-[90vw] flex-col rounded-2xl bg-[#181825] shadow-2xl ring-1 ring-white/10">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-100">Getting Started</h2>
            <p className="text-xs text-gray-500">
              Learn how to use the Knowledge Vault
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
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
          <div className="w-44 shrink-0 border-r border-white/10 py-3">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={`flex w-full px-4 py-2 text-left text-xs transition-colors ${
                  activeSection === s.id
                    ? "bg-[#cba6f7]/10 text-[#cba6f7] font-medium"
                    : "text-gray-400 hover:bg-white/5 hover:text-gray-300"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {activeSection === "overview" && <OverviewSection />}
            {activeSection === "sources" && <SourcesSection />}
            {activeSection === "notes" && <NotesSection />}
            {activeSection === "pipeline" && <PipelineSection />}
            {activeSection === "graph" && <GraphSection />}
            {activeSection === "plugin" && <PluginSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-3 text-sm font-semibold text-gray-100">{children}</h3>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-4 text-xs leading-relaxed text-gray-400">{children}</p>
);
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
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#cba6f7]/10 text-[10px] font-bold text-[#cba6f7]">
      {n}
    </span>
    <div>
      <p className="text-xs font-medium text-gray-200">{title}</p>
      <p className="mt-0.5 text-xs text-gray-500">{children}</p>
    </div>
  </div>
);
const Tip = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-4 rounded-lg border border-[#cba6f7]/20 bg-[#cba6f7]/5 px-4 py-3">
    <p className="text-xs text-[#cba6f7]/80">{children}</p>
  </div>
);

function OverviewSection() {
  return (
    <div>
      <H>What is the Knowledge Vault?</H>
      <P>
        A structured knowledge management system where raw content (articles,
        notes, transcripts) is processed into atomic claims, connected into a
        knowledge graph, and maintained over time.
      </P>

      <H>The Navigation Tabs</H>
      <div className="space-y-2 mb-4">
        {[
          {
            tab: "Notes",
            desc: "All your extracted knowledge claims. Each note makes one point with a declarative title.",
          },
          {
            tab: "Graph",
            desc: "Visual map of how notes connect. Nodes are notes, edges are typed links.",
          },
          {
            tab: "Sources",
            desc: "Raw input material (articles, papers, transcripts) waiting to be processed.",
          },
          {
            tab: "Pipeline",
            desc: "Processing queue tracking tasks through extract, connect, reweave, and verify phases.",
          },
          {
            tab: "Health",
            desc: "Live vault diagnostics: orphan detection, link density, schema compliance.",
          },
          {
            tab: "Config",
            desc: "Vault settings: name, dimensions, vocabulary, pipeline configuration.",
          },
        ].map((item) => (
          <div
            key={item.tab}
            className="flex gap-2 rounded-lg bg-[#1e1e2e] px-3 py-2"
          >
            <span className="shrink-0 text-xs font-semibold text-[#cba6f7] w-16">
              {item.tab}
            </span>
            <span className="text-xs text-gray-400">{item.desc}</span>
          </div>
        ))}
      </div>

      <H>Quick Start Flow</H>
      <Step n={1} title="Add a source">
        Click &quot;+ Add Source&quot; in the sidebar or &quot;New &gt; Add
        Source&quot; in the top bar. Paste your raw content.
      </Step>
      <Step n={2} title="Queue for processing">
        In the source editor, click &quot;Queue for Processing&quot;. This adds
        a task to the pipeline.
      </Step>
      <Step n={3} title="Run the AI agent">
        In Claude Code with the powerhouse-knowledge plugin, run /pipeline to
        extract claims, connect them, and verify quality.
      </Step>
      <Step n={4} title="Explore your knowledge">
        Check the Notes tab for extracted claims, Graph tab for connections, and
        Health tab for quality metrics.
      </Step>
    </div>
  );
}

function SourcesSection() {
  return (
    <div>
      <H>Adding Source Material</H>
      <P>
        Sources are the raw input for your knowledge vault. Everything enters as
        a source first, then gets processed into atomic claims.
      </P>

      <H>How to add a source</H>
      <Step n={1} title="Click '+ Add Source'">
        In the sidebar header or use New &gt; Add Source in the top bar.
      </Step>
      <Step n={2} title="Fill in the details">
        Give it a title, select the type (Article, Paper, Transcript, etc.),
        paste the full content.
      </Step>
      <Step n={3} title="Save">
        Click &quot;Ingest Source&quot;. The source is now in /sources/ with
        status INBOX.
      </Step>

      <H>Source Types</H>
      <div className="mb-4 grid grid-cols-2 gap-1">
        {[
          "ARTICLE",
          "PAPER",
          "TRANSCRIPT",
          "DOCUMENTATION",
          "CONVERSATION",
          "WEB_PAGE",
          "BOOK_CHAPTER",
          "MANUAL_ENTRY",
        ].map((t) => (
          <span
            key={t}
            className="rounded bg-[#1e1e2e] px-2 py-1 text-[10px] text-gray-400"
          >
            {t}
          </span>
        ))}
      </div>

      <H>Source Lifecycle</H>
      <P>
        INBOX (new) &rarr; EXTRACTING (queued for AI) &rarr; EXTRACTED (claims
        created) &rarr; ARCHIVED (done)
      </P>

      <Tip>
        You can edit a source after creating it. Click &quot;Edit&quot; in the
        source viewer. Saving resets the status to INBOX so it can be
        re-processed with the updated content.
      </Tip>

      <H>Deleting Sources</H>
      <P>
        In the Sources tab, hover over a source and click the trash icon. A
        confirmation dialog will appear before deletion.
      </P>
    </div>
  );
}

function NotesSection() {
  return (
    <div>
      <H>Knowledge Notes</H>
      <P>
        Each note is an atomic claim — one idea, one point. Notes have
        declarative titles that read as complete sentences.
      </P>

      <H>Note Structure</H>
      <div className="space-y-1 mb-4">
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
            desc: "DRAFT \u2192 IN_REVIEW \u2192 CANONICAL \u2192 ARCHIVED",
          },
          {
            field: "Links",
            desc: "Typed connections to other notes (RELATES_TO, BUILDS_ON, CONTRADICTS, etc.)",
          },
          { field: "Topics", desc: "Tags for navigation and MOC grouping" },
        ].map((item) => (
          <div
            key={item.field}
            className="flex gap-2 rounded bg-[#1e1e2e] px-3 py-1.5"
          >
            <span className="shrink-0 text-[10px] font-semibold text-gray-300 w-20">
              {item.field}
            </span>
            <span className="text-[10px] text-gray-500">{item.desc}</span>
          </div>
        ))}
      </div>

      <Tip>
        Most notes are created by the AI agent during source extraction. You can
        also create notes directly via New &gt; Knowledge Note for claims you
        already have in mind.
      </Tip>

      <H>Creating a Note Manually</H>
      <Step n={1} title="New > Knowledge Note">
        Use the top bar menu. Give it a declarative title.
      </Step>
      <Step n={2} title="Fill in the editor">
        Add description, content, type, and topics in the note editor.
      </Step>
      <Step n={3} title="Add links">
        Use the Links section to connect it to related notes.
      </Step>
    </div>
  );
}

function PipelineSection() {
  return (
    <div>
      <H>Processing Pipeline</H>
      <P>
        The pipeline tracks how sources get transformed into connected
        knowledge. Each task moves through 4 phases.
      </P>

      <H>The 4 Phases</H>
      <div className="space-y-2 mb-4">
        {[
          {
            phase: "Create",
            color: "bg-amber-400",
            desc: "Extract atomic claims from the source into individual knowledge notes",
          },
          {
            phase: "Reflect",
            color: "bg-blue-400",
            desc: "Find connections between the new notes and existing knowledge",
          },
          {
            phase: "Reweave",
            color: "bg-purple-400",
            desc: "Update older notes with new context from the fresh extraction",
          },
          {
            phase: "Verify",
            color: "bg-emerald-400",
            desc: "Quality check: schema compliance, link density, description quality",
          },
        ].map((item) => (
          <div
            key={item.phase}
            className="flex items-center gap-3 rounded-lg bg-[#1e1e2e] px-3 py-2"
          >
            <span className={`h-2.5 w-8 rounded-full ${item.color}`} />
            <span className="text-xs font-medium text-gray-200 w-16">
              {item.phase}
            </span>
            <span className="text-[10px] text-gray-500">{item.desc}</span>
          </div>
        ))}
      </div>

      <H>How It Works</H>
      <Step n={1} title="Source gets queued">
        Click &quot;Queue for Processing&quot; in the source editor, or the AI
        agent queues it automatically.
      </Step>
      <Step n={2} title="Agent processes each phase">
        The AI agent picks up PENDING tasks and works through the phases,
        recording handoff notes at each step.
      </Step>
      <Step n={3} title="Track progress">
        Open the Pipeline tab to see task status, completed phases, and handoff
        details.
      </Step>

      <Tip>
        Click on a task name in the Pipeline view to jump directly to the source
        document.
      </Tip>
    </div>
  );
}

function GraphSection() {
  return (
    <div>
      <H>Knowledge Graph</H>
      <P>
        The Graph tab shows how your notes are connected. Each node is a note,
        each edge is a typed link.
      </P>

      <H>Link Types</H>
      <div className="space-y-1 mb-4">
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
          <div
            key={item.type}
            className="flex gap-2 rounded bg-[#1e1e2e] px-3 py-1.5"
          >
            <span className="shrink-0 text-[10px] font-mono font-medium text-[#cba6f7] w-28">
              {item.type}
            </span>
            <span className="text-[10px] text-gray-500">{item.desc}</span>
          </div>
        ))}
      </div>

      <H>Graph Health Metrics</H>
      <P>The Health tab shows quality metrics computed from the graph:</P>
      <div className="space-y-1 mb-4">
        {[
          {
            metric: "Orphans",
            desc: "Notes with zero incoming links \u2014 disconnected from the graph",
          },
          {
            metric: "Density",
            desc: "How interconnected the graph is (edges / possible edges)",
          },
          {
            metric: "Avg Links",
            desc: "Average connections per note \u2014 target is 2+",
          },
          {
            metric: "Bridges",
            desc: "Critical nodes whose removal would disconnect the graph",
          },
        ].map((item) => (
          <div
            key={item.metric}
            className="flex gap-2 rounded bg-[#1e1e2e] px-3 py-1.5"
          >
            <span className="shrink-0 text-[10px] font-medium text-gray-300 w-20">
              {item.metric}
            </span>
            <span className="text-[10px] text-gray-500">{item.desc}</span>
          </div>
        ))}
      </div>

      <Tip>
        The graph auto-syncs when notes change. If you add a link in the note
        editor, the graph view updates on the next tab switch.
      </Tip>
    </div>
  );
}

function PluginSection() {
  return (
    <div>
      <H>AI Agent (Claude Plugin)</H>
      <P>
        The powerhouse-knowledge plugin connects Claude Code to your vault. The
        AI agent can extract claims, find connections, verify quality, and
        analyze the graph.
      </P>

      <H>Setup — Local</H>
      <Step n={1} title="Start the reactor locally">
        Run ph vetra --watch in your project directory. MCP is served at
        http://localhost:4001/mcp
      </Step>
      <Step n={2} title="Open Claude Code with the plugin">
        claude --plugin-dir ~/path/to/powerhouse-knowledge
      </Step>
      <Step n={3} title="Run /setup">
        This imports the Ars Contexta methodology (249 research claims) if not
        already present.
      </Step>

      <H>Setup — Remote Vault</H>
      <P>
        You can also connect to any remote Switchboard instance instead of
        running locally. Edit .mcp.json in the plugin directory to point to the
        remote reactor:
      </P>
      <div className="mb-4 rounded-lg bg-[#1e1e2e] px-4 py-3 font-mono text-[11px] text-gray-300">
        <span className="text-gray-500">{`{`}</span>
        <br />
        <span className="text-gray-500">{`  "mcpServers": { "reactor-mcp": {`}</span>
        <br />
        <span className="text-gray-500">{`    "url": "`}</span>
        <span className="text-emerald-400">
          https://your-switchboard.example.com/mcp
        </span>
        <span className="text-gray-500">{`"`}</span>
        <br />
        <span className="text-gray-500">{`  }}`}</span>
        <br />
        <span className="text-gray-500">{`}`}</span>
      </div>
      <Tip>
        No local reactor needed when connecting remotely. The plugin talks to
        the remote Switchboard via MCP over HTTPS. All skills work the same way
        — the only difference is the endpoint URL.
      </Tip>

      <H>Key Commands</H>
      <div className="space-y-1 mb-4">
        {[
          { cmd: "/seed", desc: "Ingest source material for processing" },
          { cmd: "/extract", desc: "Extract atomic claims from a source" },
          { cmd: "/connect", desc: "Find and create links between notes" },
          { cmd: "/verify", desc: "Run quality checks on notes" },
          {
            cmd: "/pipeline",
            desc: "Run the full extract \u2192 connect \u2192 reweave \u2192 verify flow",
          },
          { cmd: "/health", desc: "Get vault health diagnostics" },
          {
            cmd: "/graph",
            desc: "Structural analysis (triangles, bridges, clusters)",
          },
          { cmd: "/search", desc: "Find notes by content, title, or topic" },
        ].map((item) => (
          <div
            key={item.cmd}
            className="flex gap-2 rounded bg-[#1e1e2e] px-3 py-1.5"
          >
            <span className="shrink-0 text-[10px] font-mono font-medium text-emerald-400 w-20">
              {item.cmd}
            </span>
            <span className="text-[10px] text-gray-500">{item.desc}</span>
          </div>
        ))}
      </div>

      <H>Typical Workflow</H>
      <P>
        1. Add a source in the app (paste article/transcript) &rarr; 2. Click
        &quot;Queue for Processing&quot; &rarr; 3. In Claude Code, run /pipeline
        &rarr; 4. Agent extracts claims, connects them, verifies quality &rarr;
        5. See results in the app (Notes, Graph, Health tabs)
      </P>

      <Tip>
        The AI agent references the 249 Ars Contexta methodology claims in
        /research/ when making design decisions. These explain WHY the vault
        works the way it does.
      </Tip>
    </div>
  );
}
