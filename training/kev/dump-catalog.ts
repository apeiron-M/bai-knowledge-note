// Dump the runtime catalog (R2c order) with spec + override descriptions: Kev's option text.
//   npx --no-install tsx training/kev/dump-catalog.ts <out catalog.json>
// The shipped copy is training/kev/data/catalog.json (sha256 b257573b...); the eval rig reads that frozen copy.
// Reads the generated chat manifest (chat-manifest/, `npx nl-generate`).
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { ChatManifest } from "nl-runtime";
import { chatManifest } from "../../chat-manifest/index.js";

export function kevCatalog(m: ChatManifest = chatManifest) {
  return m.catalog
    .filter((e) => e.scope === "global")
    .map((e) => ({
      key: e.key,
      model: e.model,
      docType: e.docType,
      opName: e.opName,
      module: e.module,
      specDescription: e.description ?? "",
      override: m.opDescriptions[e.key] ?? null,
      fields: e.fields
        .filter((f) => f.fieldClass === "semantic" || f.fieldClass === "ref-id")
        .map((f) => f.name),
    }));
}

/** catalog.json's bytes. */
export const kevCatalogJson = (m: ChatManifest = chatManifest): string =>
  JSON.stringify(kevCatalog(m), null, 1);

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const out = kevCatalog();
  writeFileSync(process.argv[2], kevCatalogJson());
  console.log(
    out.length,
    "ops;",
    out.filter((o) => !o.specDescription.trim()).length,
    "empty spec;",
    out.filter((o) => o.override).length,
    "overrides",
  );
}
