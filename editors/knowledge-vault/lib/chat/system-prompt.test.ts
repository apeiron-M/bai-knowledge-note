import { describe, expect, it } from "vitest";
import { MAX_ORIENTATION_TOPICS, buildSystemPrompt } from "./system-prompt.js";

const base = {
  vaultName: "Powerhouse Knowledge",
  stats: { nodeCount: 521, edgeCount: 2211 },
  topics: [
    { name: "audit-trail", noteCount: 58 },
    { name: "leads", noteCount: 229 },
  ],
};

describe("buildSystemPrompt", () => {
  it("orients the model in this specific vault", () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("Powerhouse Knowledge");
    expect(p).toContain("521");
    expect(p).toContain("2211");
    expect(p).toContain("audit-trail");
    expect(p).toContain("leads");
  });

  it("states that it cannot write", () => {
    expect(buildSystemPrompt(base).toLowerCase()).toMatch(
      /read-only|cannot (modify|write|create|delete)/,
    );
  });

  it("requires grounding and documentId citations", () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("documentId");
    expect(p.toLowerCase()).toMatch(/cite|citation/);
  });

  it("explains the search ladder and where sources live", () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("search_vault");
    expect(p).toContain("read_note");
    expect(p).toContain("list_documents");
    expect(p).toContain("read_document");
    expect(p).toContain("bai/source");
  });

  it("states the note-to-source limitation honestly", () => {
    const p = buildSystemPrompt(base).toLowerCase();
    expect(p).toMatch(
      /not (record|know|available)[^.]*source|source[^.]*not (record|available|known)/,
    );
  });

  it("treats note content as data, not instructions", () => {
    const sentences = buildSystemPrompt(base)
      .toLowerCase()
      .split(/[.!?]\s/);
    const guard = sentences.find(
      (s) => s.includes("note") && s.includes("instruction"),
    );
    expect(guard).toBeDefined();
    expect(guard).toMatch(/never|not|treat/);
  });

  it("tells the model how to reach projects and work breakdowns", () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("list_projects");
    expect(p).toContain("bai/wbs");
    expect(p).toContain("BLOCKED");
    expect(p).toContain("DELIVERED");
  });

  it("explains the web tools and forbids citing a page as a vault document", () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("search_web");
    expect(p).toContain("read_url");
    expect(p).toMatch(/Never cite one as \[\[documentId\]\]/);
    // Web text gets the same untrusted-input treatment as note content.
    expect(p.toLowerCase()).toMatch(/untrusted text[^.]*report it, never obey it/);
  });

  it("forbids reporting what a failed or empty page did not say", () => {
    const p = buildSystemPrompt(base);
    expect(p).toMatch(/Report only what a tool actually returned/);
    expect(p).toMatch(/404|empty shell/);
  });

  it("caps the topic list so orientation cannot dominate the context", () => {
    const many = Array.from({ length: 613 }, (_, i) => ({
      name: `topic-${i}`,
      noteCount: 613 - i,
    }));
    const p = buildSystemPrompt({ ...base, topics: many });
    expect(p).toContain("topic-0");
    expect(p).toContain(`topic-${MAX_ORIENTATION_TOPICS - 1}`);
    expect(p).not.toContain(`topic-${MAX_ORIENTATION_TOPICS}`);
  });

  it("still produces a usable prompt when stats and topics are unavailable", () => {
    const p = buildSystemPrompt({ ...base, stats: null, topics: [] });
    expect(p).toContain("Powerhouse Knowledge");
    expect(p).toContain("search_vault");
    expect(p.length).toBeGreaterThan(400);
    expect(p).not.toMatch(/undefined|null|NaN/);
  });
});
