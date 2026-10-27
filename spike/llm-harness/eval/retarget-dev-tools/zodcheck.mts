// Parses every full input through its model's <Op>InputSchema().strict().
// Run from the repo root: npx --no-install tsx spike/llm-harness/eval/retarget-dev-tools/zodcheck.mts <full-inputs.json>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const dirOf = (m: string) => (m === "wbs" ? "work-breakdown-structure" : m);
const pascal = (op: string) => op.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
let ok = 0, bad = 0;
for (const r of rows) {
  const [model, op] = r.op.split(":");
  const mod = await import(pathToFileURL(resolve(`document-models/${dirOf(model)}/v1/gen/schema/zod.ts`)).href);
  const fn = mod[`${pascal(op)}InputSchema`];
  if (typeof fn !== "function") { console.log("MISSING", r.id, r.op); bad++; continue; }
  const res = fn().strict().safeParse(r.input);
  if (res.success) ok++; else { bad++; console.log("FAIL", r.id, r.op, JSON.stringify(res.error.issues)); }
}
console.log(`zod ${ok}/${ok + bad} ok`);
process.exit(bad ? 1 : 0);
