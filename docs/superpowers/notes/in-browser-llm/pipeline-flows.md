# High-level flows: user text → reactor api

Sources: the findings doc and three research notes. **[spec]** = speculation.

## Flow 1: v1 today (reference)
`user text → target doc → op pick → args fill → envelope → user confirm → reactor api`
- target doc: code (picked doc, title match, or ask).
- op pick: LLM generative (LFM2.5-350M + R8 LoRA, 229 MB) under a grammar over 4–19 scoped ops. Output: one op key, or `[]` (goes to the answer path).
- args fill: LLM generative under a copy-span grammar. The first required ref is picked by calibrated likelihood: already a decision-style stage, with the LLM as scorer.
- envelope: code (labels → ids, new ids, timestamps, zod).
- confirm: the user clicks Confirm → `dispatchActions`.
- Measured: 81–86% op, 65–73% fully right; misses are mostly sibling targets.

## Flow 2: decision networks choose, the LLM only fills
`user text → scope decider → op decider → ref decider → LLM span fill → envelope → user confirm → reactor api`
- deciders: one decision net asked `choice` questions over a shared state. Output: calibrated probabilities over document/type (or "question"), then over ≤19 ops, then over ref labels.
- span fill: LLM under the copy-span grammar, for free text only.
- In wllama 3.8.1 today:
  - Julia-1: 168 MB, 2–20 options, about 12 tokens per option at 19 ops.
  - Laya: 449 MB, about 9 tokens per option.
  - Kev-0.8B: 812 MB, no token cap; the only one with an MPS fine-tune path.
  - d1 needs a wllama rebuild.
- Targets: the op choice, the missing confidence signal, and unscoped requests (37–39%).
- Unknown:
  - Zero-shot accuracy. The model cards point to no better than 81–86%.
  - Option truncation under the head-token cap.
  - Multi-op requests need extra questions.
  - wllama latency is unpublished; decision.js reports 34–75 ms.
- Cheapest experiment: zero-shot scoring through `llama-server` on held-out rows (~half a day); fine-tune Kev only if it matches R2c or calibrates usefully.

## Flow 3: reactor layer / document-model layer
`user text → reactor layer → model layer → frame table → LLM span fill → envelope → user confirm → reactor api`
- reactor layer: the same LoRA with an extra task (no extra download), or a decision net. Output: intent (a drive op such as MOVE_NODE, an edit, or a question), scope, verb.
- model layer: picks the target, ≤13 per model. Virtual targets grow knowledge-note's list to about 36.
- frame table: code maps (verb, target) → op. 96/99 ops map; 3 need code logic.
- Targets: drive commands, reuse, unscoped requests.
- Split note's verdict: the verb is already right 91–96% of the time, the target only 81–85%. A perfect verb module fixes at most 28/73 misses. So build the split as code architecture, not as separate weights.
- Unknown:
  - Whether a target-first format moves sibling confusion or only renames it.
  - There is no fair router baseline.
- Cheapest experiment: re-render the existing rows target-first, retrain (~52 min), and test on a fresh blind set.

## Flow 4: scored cascade with a confidence gate (recommended)
`user text → target doc → op scorer → margin gate → top-3 user pick → LLM args fill → envelope → user confirm → reactor api`
- op scorer: the R2c generative pick, then forced-literal logprobs over every scoped op in the same prompt (K1). Same LoRA, no extra download.
  - Later, a decision net (Julia-1 or Kev) could replace both calls with one pass, if Flow 2 wins.
- margin gate: code. Ask when the generated pick is not the top score, or the margin is below τ = 0.2.
- top-3 user pick, only when the gate fails: the pick plus 2 best-scored frame neighbours, labelled by description. "None of these" dispatches nothing.
- Unscoped requests: the same gate one level up, falling back to today's "Which document?".
- Targets: the near-misses. The right op was ranked 2nd or 3rd in 16/19 misses.
- Unknown:
  - The 16/19 comes from k=5 scoring on retired sets, not R2c.
  - Full-list scoring adds about 1.5–2.5 s (estimate).
  - The simulated user is optimistic.
- Cheapest experiment: the pre-registered experiment 1 (K1), about half a day plus a 10-minute run. Bars: gold among the choices ≥ 92%, ask rate ≤ 30%, and +8 fully right per 100 items.

## Recommendation: Flow 4, with Flow 2's decider as a later swap-in

Ordering decisions:
1. **Choose before generating.** Grammars held on every test (0/20 violations), yet the op was right only 43% of the time. Generation fills spans only after the scorer has fixed the slot.
2. **Coarse to fine: document → op → ref.** Each candidate list depends on the earlier choice.
3. **Gate right after the op scorer.** The only stage with a margin, and where the errors are.
4. **The user is the decider only when the gate fails.** Confirm stays on every item.
5. **Embeddings stay out.** gte-small top-1 (47%) only matched the base LLM, and routing by best hit reached 36/91. At most, it could serve as a consistency check.
6. **Decision-net slot:** start with the LoRA, which needs no download and no training. Swap in a decision net only if it beats the LoRA on accuracy or calibration [spec].

Team decisions: whether "gold among the choices" plus ask rate replaces the 90% one-shot bar, and held-out-5 vs a third use of held-out-4.
