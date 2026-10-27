// Dump the runtime catalog (R2c order) with spec + override descriptions: Kev's option text.
//   npx --no-install tsx training/kev/dump-catalog.ts <out catalog.json>
// The shipped copy is training/kev/data/catalog.json (sha256 b257573b...); the eval rig reads that frozen copy.
import { writeFileSync } from "node:fs";
import { buildRuntimeCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { OP_DESCRIPTIONS } from "../../editors/knowledge-vault/chat/core/op-descriptions.js";
const cat = buildRuntimeCatalog().filter((e) => e.scope === "global");
const out = cat.map((e) => ({
  key: e.key, model: e.model, docType: e.docType, opName: e.opName, module: e.module,
  specDescription: e.description ?? "",
  override: OP_DESCRIPTIONS[e.key] ?? null,
  fields: e.fields.filter((f) => f.fieldClass === "semantic" || f.fieldClass === "ref-id").map((f) => f.name),
}));
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(out.length, "ops;", out.filter((o) => !o.specDescription.trim()).length, "empty spec;", out.filter((o) => o.override).length, "overrides");
