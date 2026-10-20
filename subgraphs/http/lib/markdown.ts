export interface EdgeView {
  direction: "out" | "in";
  documentId: string;
  linkType: string;
  title?: string | null;
  reason?: string | null;
  confidence?: string | null;
}

const yamlString = (value: string) => JSON.stringify(value);
const yamlList = (values: string[]) =>
  `[${values.map((v) => (v.includes(" ") ? yamlString(v) : v)).join(", ")}]`;

export function renderNoteMarkdown(
  doc: { id: string; name: string; documentType: string; state: unknown },
  edges: EdgeView[],
  linkBase: string,
  drive: string,
): string {
  const global: Record<string, unknown> =
    (doc.state as { global?: Record<string, unknown> } | undefined)?.global ??
    {};
  const lines: string[] = ["---"];
  const title = typeof global.title === "string" ? global.title : doc.name;
  lines.push(`title: ${yamlString(title)}`);
  if (typeof global.description === "string") {
    lines.push(`description: ${yamlString(global.description)}`);
  }
  if (typeof global.noteType === "string") lines.push(`noteType: ${global.noteType}`);
  if (typeof global.status === "string") lines.push(`status: ${global.status}`);
  const topics = Array.isArray(global.topics)
    ? (global.topics as { name?: string }[])
        .map((t) => t.name ?? "")
        .filter(Boolean)
    : [];
  if (topics.length) lines.push(`topics: ${yamlList(topics)}`);
  const provenance = global.provenance as
    | { author?: string; sourceOrigin?: string; createdAt?: string }
    | null
    | undefined;
  if (provenance?.author) lines.push(`author: ${yamlString(provenance.author)}`);
  if (provenance?.sourceOrigin) lines.push(`sourceOrigin: ${provenance.sourceOrigin}`);
  if (provenance?.createdAt) lines.push(`createdAt: ${provenance.createdAt}`);
  lines.push("links:");
  for (const edge of edges) {
    const suffix = edge.direction === "in" ? "backlink" : "link";
    lines.push(`  - type: ${edge.linkType}`);
    lines.push(`    ${suffix}: ${edge.documentId}`);
    if (edge.title) lines.push(`    title: ${yamlString(edge.title)}`);
    if (edge.reason) lines.push(`    reason: ${yamlString(edge.reason)}`);
    if (edge.confidence) lines.push(`    confidence: ${edge.confidence}`);
  }
  lines.push("---", "");
  for (const edge of edges) {
    lines.push(
      `> ${edge.direction === "in" ? "Backlink" : "Link"} ${edge.linkType}: [${edge.title ?? edge.documentId}](${linkBase}/notes/${edge.documentId}.md?drive=${drive})${edge.reason ? ` — ${edge.reason}` : ""}`,
    );
  }
  if (edges.length) lines.push("");
  lines.push(typeof global.content === "string" ? global.content : "");
  return lines.join("\n");
}