import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setHostConfig } from "../../shared/host-config.js";
import {
  CREATE_ITEMS,
  GUIDE_PLACES,
  PLACE_VIEW,
  VAULT_MENU,
} from "./DriveExplorer.js";
import {
  absoluteEndpoint,
  GettingStartedModal,
  GUIDE_SECTIONS,
  GuideContent,
} from "./GettingStarted.js";

const lists = { places: GUIDE_PLACES, menu: VAULT_MENU, createItems: CREATE_ITEMS };

function section(id: (typeof GUIDE_SECTIONS)[number]["id"], over: Partial<typeof lists> = {}) {
  return renderToStaticMarkup(<GuideContent section={id} {...lists} {...over} />);
}

/** The words a reader sees: tags gone, entities decoded. */
function text(html: string) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function refs(html: string) {
  return [...html.matchAll(/data-ref="([a-z]+):([A-Za-z0-9_-]+)"/g)].map((m) => ({
    kind: m[1],
    key: m[2],
  }));
}

const desktop = () =>
  setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201" });

afterEach(() => setHostConfig(undefined));

describe("Getting started guide", () => {
  it("keeps six sections in sentence case", () => {
    expect(GUIDE_SECTIONS.map((s) => s.label)).toEqual([
      "Overview",
      "Adding sources",
      "Notes",
      "Processing",
      "Graph and links",
      "AI agent",
    ]);
    const modal = renderToStaticMarkup(<GettingStartedModal onClose={() => {}} {...lists} />);
    for (const s of GUIDE_SECTIONS) expect(modal).toContain(`>${s.label}<`);
    expect(modal).toContain(">Getting started<");
  });

  it("describes each place, one line per place the sidebar can show", () => {
    const html = section("overview");
    const rows = [...html.matchAll(/data-guide-place="([a-z]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual(GUIDE_PLACES.map((p) => p.id));
    expect([...rows].sort()).toEqual(Object.keys(PLACE_VIEW).sort());
    const t = text(html);
    expect(t).toContain("AskAsk the vault a question; the answer names the notes it used.");
    expect(t).toContain("NotesEvery note: one idea each, with its links and its source.");
    expect(t).toContain("TopicsMaps of your topics, from the vault's top map down.");
    expect(t).toContain("SourcesWhat you added, and what became of each.");
    expect(t).toContain("WorkScopes of work, their projects, and the breakdowns that deliver them.");
    expect(t).toContain("GraphHow notes connect. Find a note, or hide kinds of notes from the legend.");
    expect(t).toContain("ContradictionsNotes that disagree. Listed while any are open.");
  });

  it("takes the place names from the places it is given, so a rename shows up", () => {
    const renamed = GUIDE_PLACES.map((p) => (p.id === "notes" ? { ...p, label: "Library" } : p));
    const t = text(section("overview", { places: renamed }));
    expect(t).toContain("LibraryEvery note: one idea each");
    expect(t).not.toContain("NotesEvery note");
  });

  it("names every vault menu entry and every create item, from the real lists", () => {
    const html = section("overview");
    const t = text(html);
    expect(t).toContain(
      "Under the vault's name, and at the foot (Vault settings): Vault settings, Who has access, Processing queue, Activity, Health check and Files and folders.",
    );
    expect(t).toContain(
      "Add sources takes files; the arrow beside it offers Write a note, New topic and Paste text as a source.",
    );
    expect(t).toContain("Search (Ctrl K, or ⌘ K on a Mac) finds notes, topics, sources and chats.");
    const r = refs(html);
    expect(r.filter((x) => x.kind === "menu").map((x) => x.key)).toEqual(VAULT_MENU.map((i) => i.key));
    expect(r.filter((x) => x.kind === "create").map((x) => x.key)).toEqual(CREATE_ITEMS.map((i) => i.key));
  });

  it("names only places and menu entries that exist, in every section", () => {
    for (const host of [desktop, () => setHostConfig(undefined)]) {
      host();
      for (const s of GUIDE_SECTIONS) {
        for (const r of refs(section(s.id))) {
          const real =
            r.kind === "menu"
              ? VAULT_MENU.map((i) => i.key)
              : r.kind === "create"
                ? CREATE_ITEMS.map((i) => i.key)
                : GUIDE_PLACES.map((p) => p.id);
          expect(real, `${s.id}: ${r.kind}:${r.key}`).toContain(r.key);
        }
      }
    }
  });

  it("renames a menu entry in the prose that points at it", () => {
    const menu = VAULT_MENU.map((i) => (i.key === "pipeline" ? { ...i, label: "Work queue" } : i));
    expect(text(section("pipeline", { menu }))).toContain("Work queue is in the vault menu.");
    expect(text(section("graph", { menu }))).not.toContain("Processing queue");
  });

  it("gives the desktop and the web their own quick start", () => {
    desktop();
    const d = text(section("overview"));
    expect(d).toContain("Add sources — drop files on the window or press Add sources.");
    expect(d).toContain(
      "Processing — the app reads each source in the background and writes its notes; the status at the top of the window says how it is going.",
    );
    expect(d).toContain("Review — new notes wait in review; open one, check it, and Approve it.");
    expect(d).toContain("Ask — the answer names the notes it used.");
    setHostConfig(undefined);
    const w = text(section("overview"));
    expect(w).toContain(
      "Processing — if this vault's server runs the pipeline, sources are processed on their own; otherwise an AI agent processes them (see AI agent).",
    );
    expect(w).not.toContain("the app reads each source in the background");
    expect(w).toContain("Review — new notes wait in review; open one, check it, and Approve it.");
  });

  it("describes adding sources as the app does it now", () => {
    const t = text(section("sources"));
    expect(t).toContain("Add sources converts a PDF, a Word file, a web page or a book");
    expect(t).toContain("shows the sources it would create before anything is written");
    expect(t).toContain("Each one is queued for processing.");
    expect(t).toContain("Paste text as a source, which is queued when added.");
    expect(t).toContain("Inbox → Extracting → Extracted, or Archived");
    expect(t).toContain("Editing a source returns it to Inbox.");
    expect(t).toContain('"Delete source" is on each source\'s row.');
  });

  it("names the four processing steps with their phases, and says where it runs", () => {
    desktop();
    const d = text(section("pipeline"));
    expect(d).toContain("Extract");
    expect(d).toContain("Connect");
    expect(d).toContain("Place in topics");
    expect(d).toContain("Verify");
    for (const phase of ["create", "reflect", "reweave", "verify"]) expect(d).toContain(phase);
    expect(d).toContain("It runs on its own; See runs, at the top of the window, opens each run in Workflows.");
    expect(d).toContain("Processing queue is in the vault menu.");
    expect(d).toContain("The Verify step finishes a source's task; its notes stay in review for you.");
    setHostConfig(undefined);
    expect(text(section("pipeline"))).toContain(
      "It runs where this vault's server runs the pipeline, or from an AI agent.",
    );
  });

  it("describes the graph, find and filter, and health without Bridges", () => {
    const t = text(section("graph"));
    expect(t).toContain("Find a note, or hide kinds of notes from the legend.");
    expect(t).toContain("Health check (in the vault menu) shows orphans, link density and dangling links.");
    expect(t).toContain("The graph updates on its own when notes change.");
    for (const kind of ["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES", "DERIVED_FROM"]) {
      expect(t).toContain(kind);
    }
    expect(t).not.toContain("Bridges");
  });

  it("tells the desktop where the agent's settings are, and the web how to point the CLI", () => {
    desktop();
    const d = text(section("plugin"));
    expect(d).toContain(
      "Settings › Diagnostics shows the two things an agent needs: the Switchboard CLI command for this vault and the MCP address.",
    );
    setHostConfig(undefined);
    const w = text(section("plugin"));
    expect(w).toContain("switchboard init --url /graphql --name <vault> --use-profile");
    for (const t2 of [d, w]) {
      expect(t2).toContain("claude plugin marketplace add liberuum/powerhouse-knowledge");
      expect(t2).toContain("claude plugin install powerhouse-knowledge@powerhouse-knowledge");
      for (const c of ["setup", "seed", "extract", "connect", "verify", "pipeline", "health", "graph", "search"]) {
        expect(t2).toContain(`/powerhouse-knowledge:${c}`);
      }
    }
  });

  it("makes a same-origin endpoint absolute for the web's CLI command", () => {
    expect(absoluteEndpoint("/graphql", "https://vault.example.org")).toBe(
      "https://vault.example.org/graphql",
    );
    expect(absoluteEndpoint("https://sb.example/graphql", "https://other")).toBe(
      "https://sb.example/graphql",
    );
    expect(absoluteEndpoint("/graphql", undefined)).toBe("/graphql");
  });

  it("no longer carries the stale passages", () => {
    desktop();
    const all = GUIDE_SECTIONS.map((s) => text(section(s.id))).join("\n");
    setHostConfig(undefined);
    const web = GUIDE_SECTIONS.map((s) => text(section(s.id))).join("\n");
    for (const body of [all, web]) {
      for (const stale of [
        "Navigation Tabs",
        "Pipeline tab",
        "Health tab",
        "Graph tab",
        "Notes tab",
        "Queue for Processing",
        "Ingest Source",
        "Add Source in the top bar",
        "New > Knowledge Note",
        "top bar menu",
        "Bridges",
        "next tab switch",
        "--plugin-dir",
        ".mcp.json",
        "249",
        "Ars Contexta",
        "/research/",
        "Run /pipeline",
        "run /pipeline",
        "Config",
      ]) {
        expect(body, stale).not.toContain(stale);
      }
    }
  });
});
