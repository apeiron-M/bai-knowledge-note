// The vault's training recipe for powerhouse-nl's `nl` CLI (M3). Paths are
// relative to training/. Run from the vault root, e.g.
//   nl teacher --config training/nl.config.ts --round 10 --set contrast
// (`nl --help` lists every command). Outputs go under training/artifacts/
// (gitignored).
import { defineConfig } from "nl";
import { C_FUSION, C_LOAD } from "../editors/knowledge-vault/chat/core/model-manifest.js";

const SUBMIT = { op: "knowledge-note:SUBMIT_FOR_REVIEW", args: {} };
const APPROVE = { op: "knowledge-note:APPROVE_NOTE", args: {} };
const TENSION = {
  op: "tension:CREATE_TENSION",
  args: { title: "Ship fast vs stable", description: "Release cadence vs bugs", involvedRefs: [] },
};
const PERSON = ["assignee", "owner", "author", "assignedTo"];

export default defineConfig({
  appRoot: "..",
  manifest: "chat-manifest/index.ts",
  overrides: "chat.overrides.ts",
  recipes: "gen/ref-scenarios.ts",
  artifactRoot: "artifacts",
  seed: 20261021,
  evals: { dirs: ["../spike/llm-harness/eval"] },
  teacher: {
    model: "claude-sonnet-5",
    app: "a personal knowledge vault app",
    personas: [
      "a PhD student keeping research notes",
      "a product manager tracking a launch",
      "a software engineer writing design notes",
      "a writer organizing book research",
      "a team lead running a small project",
      "a hobbyist gardener keeping a journal",
    ],
    // teacher.py's FIXTURES, unchanged (new rounds add openQuestions / childRefs states here).
    fixtures: {
      "knowledge-note:REJECT_NOTE": [SUBMIT],
      "knowledge-note:APPROVE_NOTE": [SUBMIT],
      "knowledge-note:ARCHIVE_NOTE": [SUBMIT, APPROVE],
      "knowledge-note:RESTORE_NOTE": [
        SUBMIT,
        APPROVE,
        { op: "knowledge-note:ARCHIVE_NOTE", args: { comment: "superseded" } },
      ],
      "tension:RESOLVE_TENSION": [TENSION],
      "tension:DISSOLVE_TENSION": [TENSION],
    },
    personFields: {
      "*": PERSON,
      "project:ADD_MEMBER": [...PERSON, "name"],
      "project:UPDATE_MEMBER": [...PERSON, "name"],
    },
    run: { concurrency: 5, timeout: 600, maxBudgetUsd: 1.0 },
    rounds: {
      "10": {
        sets: {
          contrast: {
            plans: [
              {
                name: "contrast",
                plan: { ops: "contrast", groups: "data/round10/sibling-groups.json", rounds: 2, itemsPerOp: 6, avoidShare: 0.65, seed: 20261022 },
              },
              {
                name: "contrast-dev",
                plan: { ops: "contrast", groups: "data/round10/sibling-groups-dev.json", rounds: 2, itemsPerOp: 6, avoidShare: 0.65, seed: 20261022 },
              },
            ],
            label: { batch: 8 },
            agree: { maxFree: 0.7, nameCap: 0, step1Only: true },
          },
          stress: {
            plan: { ops: "stress", batchSize: 10, itemsPerOp: 10, spanItems: 6, seed: 20261022 },
            label: { batch: 8 },
            agree: { maxFree: 0.7, nameCap: 0, step1Only: true },
          },
        },
        include: ["artifacts/teacher-full/agreed-s1.jsonl"], // Round 8's agreed rows, first in final-in
        normalizePeriods: false, // Round 10 predates the X6/X9 pass
        blindFilter: false, // Round 10 predates blind filtering (powerhouse-nl docs/notes/m3/acceptance-runbook.md)
        split: { share: 0.05, seed: 20261021 },
      },
    },
  },
  models: {
    lora: {
      base: "models/LFM2.5-350M",
      baseGguf: "models/LFM2.5-350M-GGUF/LFM2.5-350M-Q4_K_M.gguf",
      stem: "LFM2.5-350M-vault-m3a-20261028",
      pin: "LiquidAI/LFM2.5-350M@9e6c6ccf47cd318696e137d381a7ded8fe4df09f",
      license: {
        id: "other",
        name: "lfm1.0",
        file: "models/LFM2.5-350M/LICENSE",
        upstream: "LiquidAI/LFM2.5-350M",
        upstreamUrl: "https://huggingface.co/LiquidAI/LFM2.5-350M",
      },
    },
    kev: {
      gguf: "artifacts/kev-ft/gguf/Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf",
      label: "Kev-FT",
      pins: [
        "jaredpalmer/kev@2074cc44256200bb37540103fa4572901faa10f3",
        "jaredpalmer/kev-0.8b@bf75a6a8848ea6960ff2ed108d9ed44c2941174f",
        "Qwen/Qwen3.5-0.8B-Base@dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68",
      ],
      // Kev-0.8B and Qwen3.5-0.8B-Base are Apache-2.0 (powerhouse-nl overview §5.3): a licence
      // copy (the stock Apache-2.0 text, sha256 cfc7749b…) and a change notice beside the GGUF.
      license: {
        id: "apache-2.0",
        file: "kev/LICENSE-Apache-2.0",
        upstream: "jaredpalmer/kev-0.8b (itself from Qwen/Qwen3.5-0.8B-Base)",
        upstreamUrl: "https://huggingface.co/jaredpalmer/kev-0.8b",
      },
    },
  },
  train: { lora: { epochs: 2, batch: 8, gradAccum: 4, saveSteps: 50, saveLimit: 2 } },
  export: {
    // Configuration C's values, read from the chat core so they cannot drift.
    fusion: C_FUSION,
    load: C_LOAD,
    integrity: "hf-etag",
    devPathPrefix: "/models",
    checkRows: 16,
  },
  rig: {
    repo: "..", // the vault itself
    rev: "5e9c39046dcd8f08951a308e66c610dbd4c55c73",
    patches: "../docs/superpowers/notes/in-browser-llm/exp-2026-10-23",
    devSets: "../spike/llm-harness/eval", // heldout3 as h3, heldout4 as h4
    // Step 2's scorer (rig.scorer) is left at its default, nl-eval's own
    // producers/step2-scorer.ts: spike/llm-harness/r6.ts's scoreArgRow, moved
    // out of the vault in M5 with the old training/eval-rig/.
  },
});
