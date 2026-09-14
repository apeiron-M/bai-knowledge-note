export interface MocLine {
  tier: string;
  title: string;
  id: string;
}

export interface LlmsVault {
  title: string;
  description?: string;
  mocs: MocLine[];
}

const TIER_ORDER: Record<string, number> = { HUB: 0, DOMAIN: 1, TOPIC: 2 };

export function renderLlmsTxt(
  vault: LlmsVault,
  drive: string,
  base: string,
): string {
  const lines = [`# ${vault.title}`, ""];
  if (vault.description) lines.push(`> ${vault.description}`, "");
  lines.push("## Maps of Content", "");
  const sorted = [...vault.mocs].sort(
    (a, b) => (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3),
  );
  for (const moc of sorted) {
    lines.push(
      `- [${moc.title}](${base}/notes/${moc.id}.md?drive=${drive}) (${moc.tier})`,
    );
  }
  return lines.join("\n");
}

export function renderLlmsFull(vault: {
  sections: { title: string; body: string }[];
}): string {
  return vault.sections
    .map((section) => `# ${section.title}\n\n${section.body}`)
    .join("\n\n---\n\n");
}