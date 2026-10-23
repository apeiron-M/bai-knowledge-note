# Held-out-5 blind run 1: X7 pre-registered C1 / C2 / C3

## Part A (written BEFORE any held-out-5 producer ran)

### Integrity checks
- `x7-fusion/PREREGISTRATION.md` sha256 `eac4ad28e53e5aad1435b64236231f07d3d4bb5c6d7fb925a7275df58bf765d5` (= required, = PREREGISTRATION.sha256).
- `blind/heldout5/heldout5-eval.json` sha256 `c472bbaae3fca5b96f89a6715c9119e7b26a27c79507aa5d837707f47f83354e` (= `.sha256` file). 165 single-action + 15 no-action + 0 multi.
- Frozen artifacts, all sha256-equal to the pre-registration: LoRA GGUF `6930e31e…`, Kev Q4_K_M `64f479de…` (exp/x4-kev/export/, as registered), `x3-lora-scoring/lib.ts` `b48ff64f…`, `x4-kev/node/decide.mjs` `feed74fe…`, `x4-kev/data/catalog.json` `b257573b…`, `x6-args/patch/x6-args-ship.patch` `8d29e48a…`, evaluator copy `heldout5-run1/prereg_eval.py` `f981613b…`.
- Repo HEAD `5e9c39046dcd8f08951a308e66c610dbd4c55c73` (registered commit); llama.cpp `46ca246`, native Metal llama-server.

### Producers (adapter-only changes; diffs are against the frozen files)
- **LoRA step 1 + trie + baseline step 2:** `lora-run.ts` = `x3-lora-scoring/run.ts` + an h5 loader (same field mapping as `heldout()`), absolute import of the frozen `lib.ts`, env-configurable output path, optional id filter. Server: `logs/lora-server.cmd` (`-c 4096 -np 1 --no-jinja`), log line `n_slots = 1, n_ctx_slot = 4096, kv_unified = 'false'` = X3's.
- **Ship step 2:** patch applied with `git apply` to fresh copies of the repo files in `patched/`; byte-identical to `x6-args/ship/`; `x6-args/ship-run/` (what X6 ran) equals them modulo import paths. `ship-run.ts` = `x6-args/run-ship.ts` + h5 loader (same mapping as `loadDev`) + output path; variant `v1` (= patched V1_ARGS, no post-processing), its own `startNative` server.
- **Kev:** unmodified `decide.mjs --runtime server --decider kev08q4 --variant desc --wording W3 --servedT 2.3510959148406982` (descField default `override`). Server `-c 8192` (`logs/kev-server.cmd`): log `n_slots = 4, n_ctx_slot = 8192, kv_unified = 'true'` = X4's Q4 server that produced the dev h3/h4 rows (X7's gap-fill server showed n_ctx_slot 32768; it matched X4 at Δ=0). Input items built by `build-kev-items.py`: candidates = the LoRA runner's scoped list, asserted in catalog.json order with model == context.model.

### Parity gates (dev data, before held-out-5)
- LoRA (h3 kn3-04, kn3-05, moc3-02, none3-01): picks identical, gold step-2 args/exact/refExact identical, step-2 key sets identical; trie `exact_sum` |Δ| ≤ 0.024 nat (0 on moc3-02), branch ≤ 0.019 — Metal/KV-cache order noise from running 4 items in isolation instead of X3's full sequence.
- Ship (h3 kn3-02, kn3-04, kn3-05, kn3-06, moc3-08): args, raw and ok identical to `ship-v1.json`.
- Kev (5 R8-val items incl. 2 no-action): candidates identical, `logprobsT1` |Δ| = 0, picks identical.
- Evaluator copy on `x7-fusion/out/prereg-input-{h3,h4,dev,val}.jsonl`: output identical to `prereg-expected-*.json`.
- NORMALISED scorer (`score-args.ts`, literal §4: string leaves of predicted `args` and gold `args` only, then `scoreArgRow` unchanged) on X6's stored dev rows: base 157→158, ship 165→166, the only flip is kn3-02 under both (= X7 REPORT). STRICT re-score equals the runner's `ok` on all 196 rows.

### Decisions locked before the run
- **Style split.** `prereg_eval.py` hard-codes `natural`/`paraphrase`; held-out-5 uses `plain`/`messy`, so those two blocks print n = 0. Not relabelled. The headline is the untouched evaluator on all rows; plain/messy, difficulty and style×difficulty come from the same file's `evaluate()` called on row subsets. No-action items carry no `difficulty`, so difficulty subsets are action-only (their ask denominators exclude no-action).
- **STRICT** ok = `exact !== false && refExact !== false` (requiredPresent not folded in; it is not in the registered scorer).
- Categories (ids only): per config op-wrong, false-none, op-right-args-wrong (base/ship STRICT), wrong dispatches, no-action false positives; C2/C3 fixed/broken vs C1; C3 asked with gold offered / not offered / on no-action; args base-vs-ship flips.
- One run. Any crash / retry / missing item is logged here, not silently fixed.

## Part B: results (one run, no re-runs)

Run log: LoRA runner 180/180 rows, exit 0; ship runner 165/165, exit 0; Kev 180/180, exit 0; STRICT re-score equals both runners' `ok` on every row; assembler invariants (key sets, `none` last, Kev order == opts, pick in opts) all held; 0 floored trie children; 0 items where normalising changed `refExact`. **No producer crashed, was retried or missed an item. No deviation from the pre-registration.** One glue note: `score-args.ts` (pure scoring, no inference) failed twice on a zsh quoting error in my shell loop before reading any input, then ran correctly; no producer was re-run. Headline numbers are the untouched evaluator's output (`out/prereg-result-h5.json`); its `natural`/`paraphrase` blocks are n = 0 by construction (labels are plain/messy).

### Headline (165 single-action, 15 no-action, 0 multi)

| | C1 control | C2 PoE one-shot | C3 PoE + gate |
|---|---|---|---|
| Op one-shot | 135/165 (81.8%) | 146/165 (88.5%) | 146/165 (88.5%) |
| Fully STRICT, baseline args | 104 | 111 | 111 (effective 121) |
| Fully STRICT, ship args | 111 | 118 | 118 (effective 128) |
| Fully NORMALISED, baseline args | 106 | 113 | 113 (effective 123) |
| Fully NORMALISED, ship args | 113 | 120 | 120 (effective 130) |
| Gold-in-choices | – | – | 160/165 (97.0%) |
| Ask (single + no-action) | 0/180 | 0/180 | 44/180 (24.4%) |
| Wrong dispatches | 33 | 22 | 6 |
| No-action TP / predicted none | 12/15, 12 | 12/15, 12 | 12/15, 12 |
| Fixed / broken vs C1 (op) | – | +14 / −3, one-sided exact McNemar p = 0.0064 | +14 / −3, p = 0.0064 |

Args on the gold op (all 165): baseline STRICT 124, ship STRICT 131, baseline NORMALISED 126, ship NORMALISED 133. Ship vs baseline: +10 / −3 items.

### Hypotheses and shipping rule
- **H1 (primary): confirmed.** C2 op 146 vs C1 135; fixed 14 > broken 3, p = 0.0064 < 0.05.
- **H2:** C2 fully (ship, STRICT) 118 vs C1 fully (baseline, STRICT) 104: +14. At equal args: baseline 111 vs 104 (+7), ship 118 vs 111 (+7). So the +14 splits as +7 op effect and +7 args effect. The pre-registration sets no significance test for H2.
- **H3: all three bars met.** Gold-in-choices 97.0% ≥ 92%; ask 24.4% ≤ 30%; effective fully (ship) 128 − C1 fully (ship) 111 = +17 = +10.3 per 100 ≥ +8. Baseline-args equivalent: 121 − 104 = +10.3 per 100. (Optimistic simulated user.)
- **No-action guard: holds.** TP 12/15 and predicted-none 12 for all three configs.
- **Shipping rule:** H1 holds and C2 breaks 3 ≤ ⅓ × 14 fixed → **recommend C2 as the op decider**; H3 also holds → **recommend C3 for Flow 4**.

### Against the dev expectation (pre-registration §6)
Op C1 81.8% (dev 83.7%), C2 88.5% (dev 90.3%), gain +6.7 pp (dev +6.6). Fixed/broken +14/−3 (dev +14/−1). Gate: gold-in-choices 97.0% (dev 95.4%), but ask 24.4% (dev 16.2%), wrong dispatches 6 (dev 12). Args are weaker in absolute terms: 124/165 (75%) baseline and 131/165 (79%) ship on the gold op, against dev 157/196 (80%) and 165/196 (84%). The ship patch's first out-of-sample test gives +7 net (+10/−3).

### By style (the set's own labels) and difficulty
`evaluate()` from the same frozen file, on row subsets. Style subsets include that style's no-action items; difficulty subsets are action-only.

| Subset | n act / na | C1 op | C2 op | C2 fixed/broken (p) | Fully STRICT base/ship C1 | C2 | C3 gold-in-choices | C3 ask | C3 eff base/ship | Wrong C1/C2/C3 | NA TP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| style=plain | 67 / 6 | 65 | 65 | +0/−0 (1) | 52/58 | 52/58 | 66/67 | 5/73 | 53/59 | 3/3/2 | 5/6 |
| style=messy | 98 / 9 | 70 | 81 | +14/−3 (0.00636) | 52/53 | 59/60 | 94/98 | 39/107 | 68/69 | 30/19/4 | 7/9 |
| difficulty=easy | 35 / 0 | 35 | 35 | +0/−0 (1) | 30/34 | 30/34 | 35/35 | 1/35 | 30/34 | 0/0/0 | 0/0 |
| style=plain x difficulty=easy | 31 / 0 | 31 | 31 | +0/−0 (1) | 26/30 | 26/30 | 31/31 | 0/31 | 26/30 | 0/0/0 | 0/0 |
| style=messy x difficulty=easy | 4 / 0 | 4 | 4 | +0/−0 (1) | 4/4 | 4/4 | 4/4 | 1/4 | 4/4 | 0/0/0 | 0/0 |
| difficulty=medium | 68 / 0 | 60 | 62 | +4/−2 (0.344) | 48/49 | 50/50 | 67/68 | 12/68 | 54/55 | 8/6/1 | 0/0 |
| style=plain x difficulty=medium | 32 / 0 | 30 | 30 | +0/−0 (1) | 23/24 | 23/24 | 31/32 | 3/32 | 24/25 | 2/2/1 | 0/0 |
| style=messy x difficulty=medium | 36 / 0 | 30 | 32 | +4/−2 (0.344) | 25/25 | 27/26 | 36/36 | 9/36 | 30/30 | 6/4/0 | 0/0 |
| difficulty=hard | 62 / 0 | 40 | 49 | +10/−1 (0.00586) | 26/28 | 31/34 | 58/62 | 31/62 | 37/39 | 22/13/2 | 0/0 |
| style=plain x difficulty=hard | 4 / 0 | 4 | 4 | +0/−0 (1) | 3/4 | 3/4 | 4/4 | 2/4 | 3/4 | 0/0/0 | 0/0 |
| style=messy x difficulty=hard | 58 / 0 | 36 | 45 | +10/−1 (0.00586) | 23/24 | 28/30 | 54/58 | 29/58 | 34/35 | 22/13/2 | 0/0 |

NORMALISED fully (base/ship), C1 | C2 | C3 effective:

- style=plain: 54/60 | 54/60 | 55/61
- style=messy: 52/53 | 59/60 | 68/69
- difficulty=easy (action only): 31/35 | 31/35 | 31/35
- style=plain x difficulty=easy (action only): 27/31 | 27/31 | 27/31
- style=messy x difficulty=easy (action only): 4/4 | 4/4 | 4/4
- difficulty=medium (action only): 49/50 | 51/51 | 55/56
- style=plain x difficulty=medium (action only): 24/25 | 24/25 | 25/26
- style=messy x difficulty=medium (action only): 25/25 | 27/26 | 30/30
- difficulty=hard (action only): 26/28 | 31/34 | 37/39
- style=plain x difficulty=hard (action only): 3/4 | 3/4 | 3/4
- style=messy x difficulty=hard (action only): 23/24 | 28/30 | 34/35

All 14 fixes and all 3 breaks are messy items; on plain, C2 = C1 item for item (65/67). Style and difficulty are confounded (58 of 62 hard items are messy).

### Item ids per category

- **C1 op wrong (one-shot dispatch)** (30): kn5-04, kn5-06, kn5-08, kn5-18, moc5-08, moc5-10, moc5-12, moc5-22, moc5-24, prj5-06, prj5-08, prj5-13, prj5-15, prj5-16, prj5-23, wbs5-02, wbs5-07, wbs5-09, wbs5-11, pq5-04, pq5-09, vc5-02, vc5-04, src5-04, src5-06, rc5-02, obs5-02, ten5-04, der5-02, der5-03
- **C1 op wrong -> dispatched none (false none)** (0): –
- **C1 op right, args wrong (base, STRICT)** (31): kn5-09, kn5-10, kn5-12, kn5-14, moc5-02, moc5-17, moc5-18, moc5-20, moc5-25, prj5-10, prj5-12, prj5-21, wbs5-03, wbs5-04, wbs5-08, wbs5-10, wbs5-12, wbs5-14, wbs5-16, pq5-05, pq5-10, vc5-03, vc5-06, src5-01, rc5-01, rc5-03, rc5-05, ten5-02, hr5-02, der5-04, der5-05
- **C1 op right, args wrong STRICT but ok NORMALISED (base)** (2): rc5-01, rc5-03
- **C1 op right, args wrong (ship, STRICT)** (24): kn5-10, kn5-12, moc5-02, moc5-17, moc5-18, prj5-10, prj5-12, prj5-21, wbs5-03, wbs5-04, wbs5-12, wbs5-16, wbs5-22, pq5-02, vc5-03, vc5-06, src5-01, rc5-01, rc5-03, rc5-05, ten5-02, hr5-02, der5-04, der5-05
- **C1 op right, args wrong STRICT but ok NORMALISED (ship)** (2): rc5-01, rc5-03
- **C1 wrong dispatch (after gate)** (33): kn5-04, kn5-06, kn5-08, kn5-18, moc5-08, moc5-10, moc5-12, moc5-22, moc5-24, prj5-06, prj5-08, prj5-13, prj5-15, prj5-16, prj5-23, wbs5-02, wbs5-07, wbs5-09, wbs5-11, pq5-04, pq5-09, vc5-02, vc5-04, src5-04, src5-06, rc5-02, obs5-02, ten5-04, der5-02, der5-03, none5-07, none5-09, none5-13
- **C1 no-action false positive** (3): none5-07, none5-09, none5-13
- **C2 op wrong (one-shot dispatch)** (19): kn5-04, kn5-18, kn5-28, moc5-08, moc5-10, moc5-12, moc5-24, prj5-04, prj5-06, prj5-08, prj5-15, prj5-16, prj5-23, wbs5-02, wbs5-11, wbs5-14, pq5-04, src5-04, rc5-02
- **C2 op wrong -> dispatched none (false none)** (0): –
- **C2 op right, args wrong (base, STRICT)** (35): kn5-09, kn5-10, kn5-12, kn5-14, moc5-02, moc5-17, moc5-18, moc5-20, moc5-22, moc5-25, prj5-10, prj5-12, prj5-13, prj5-21, wbs5-03, wbs5-04, wbs5-08, wbs5-09, wbs5-10, wbs5-12, wbs5-16, pq5-05, pq5-10, vc5-02, vc5-03, vc5-06, src5-01, rc5-01, rc5-03, rc5-05, obs5-02, ten5-02, hr5-02, der5-04, der5-05
- **C2 op right, args wrong STRICT but ok NORMALISED (base)** (2): rc5-01, rc5-03
- **C2 op right, args wrong (ship, STRICT)** (28): kn5-10, kn5-12, moc5-02, moc5-17, moc5-18, moc5-22, prj5-10, prj5-12, prj5-13, prj5-21, wbs5-03, wbs5-04, wbs5-12, wbs5-16, wbs5-22, pq5-02, vc5-02, vc5-03, vc5-06, src5-01, rc5-01, rc5-03, rc5-05, obs5-02, ten5-02, hr5-02, der5-04, der5-05
- **C2 op right, args wrong STRICT but ok NORMALISED (ship)** (2): rc5-01, rc5-03
- **C2 wrong dispatch (after gate)** (22): kn5-04, kn5-18, kn5-28, moc5-08, moc5-10, moc5-12, moc5-24, prj5-04, prj5-06, prj5-08, prj5-15, prj5-16, prj5-23, wbs5-02, wbs5-11, wbs5-14, pq5-04, src5-04, rc5-02, none5-07, none5-09, none5-13
- **C2 no-action false positive** (3): none5-07, none5-09, none5-13
- **C3 op wrong (one-shot dispatch)** (19): kn5-04, kn5-18, kn5-28, moc5-08, moc5-10, moc5-12, moc5-24, prj5-04, prj5-06, prj5-08, prj5-15, prj5-16, prj5-23, wbs5-02, wbs5-11, wbs5-14, pq5-04, src5-04, rc5-02
- **C3 op wrong -> dispatched none (false none)** (0): –
- **C3 op right, args wrong (base, STRICT)** (35): kn5-09, kn5-10, kn5-12, kn5-14, moc5-02, moc5-17, moc5-18, moc5-20, moc5-22, moc5-25, prj5-10, prj5-12, prj5-13, prj5-21, wbs5-03, wbs5-04, wbs5-08, wbs5-09, wbs5-10, wbs5-12, wbs5-16, pq5-05, pq5-10, vc5-02, vc5-03, vc5-06, src5-01, rc5-01, rc5-03, rc5-05, obs5-02, ten5-02, hr5-02, der5-04, der5-05
- **C3 op right, args wrong STRICT but ok NORMALISED (base)** (2): rc5-01, rc5-03
- **C3 op right, args wrong (ship, STRICT)** (28): kn5-10, kn5-12, moc5-02, moc5-17, moc5-18, moc5-22, prj5-10, prj5-12, prj5-13, prj5-21, wbs5-03, wbs5-04, wbs5-12, wbs5-16, wbs5-22, pq5-02, vc5-02, vc5-03, vc5-06, src5-01, rc5-01, rc5-03, rc5-05, obs5-02, ten5-02, hr5-02, der5-04, der5-05
- **C3 op right, args wrong STRICT but ok NORMALISED (ship)** (2): rc5-01, rc5-03
- **C3 wrong dispatch (after gate)** (6): prj5-08, prj5-23, wbs5-02, none5-07, none5-09, none5-13
- **C3 no-action false positive** (3): none5-07, none5-09, none5-13
- **C2 fixed vs C1** (14): kn5-06, kn5-08, moc5-22, prj5-13, wbs5-07, wbs5-09, pq5-09, vc5-02, vc5-04, src5-06, obs5-02, ten5-04, der5-02, der5-03
- **C2 broken vs C1** (3): kn5-28, prj5-04, wbs5-14
- **C3 fixed vs C1** (14): kn5-06, kn5-08, moc5-22, prj5-13, wbs5-07, wbs5-09, pq5-09, vc5-02, vc5-04, src5-06, obs5-02, ten5-04, der5-02, der5-03
- **C3 broken vs C1** (3): kn5-28, prj5-04, wbs5-14
- **C3 asked, gold offered** (42): kn5-03, kn5-04, kn5-06, kn5-08, kn5-10, kn5-11, kn5-12, kn5-16, kn5-18, kn5-23, kn5-28, moc5-04, moc5-08, moc5-10, moc5-12, moc5-15, moc5-23, moc5-24, moc5-25, prj5-02, prj5-04, prj5-06, prj5-13, prj5-16, wbs5-12, wbs5-14, wbs5-24, pq5-04, pq5-05, pq5-12, vc5-02, vc5-10, src5-01, src5-02, src5-04, src5-06, rc5-02, obs5-02, obs5-06, ten5-04, der5-02, der5-03
- **C3 asked, gold NOT offered** (2): prj5-15, wbs5-11
- **C3 asked on no-action item** (0): –
- **C3 not asked, dispatch wrong** (3): prj5-08, prj5-23, wbs5-02
- **args: base ok, ship not (STRICT)** (3): moc5-12, wbs5-22, pq5-02
- **args: ship ok, base not (STRICT)** (10): kn5-09, kn5-14, moc5-20, moc5-25, wbs5-08, wbs5-09, wbs5-10, wbs5-14, pq5-05, pq5-10
- **args wrong under both (STRICT)** (31): kn5-10, kn5-12, kn5-18, moc5-02, moc5-17, moc5-18, moc5-22, prj5-10, prj5-12, prj5-13, prj5-21, wbs5-02, wbs5-03, wbs5-04, wbs5-11, wbs5-12, wbs5-16, vc5-02, vc5-03, vc5-06, src5-01, src5-04, rc5-01, rc5-02, rc5-03, rc5-05, obs5-02, ten5-02, hr5-02, der5-04, der5-05

### Exploratory (§8; logged, not used for any decision)
- C2 with branch-only LoRA scores instead of exact: op 147/165.
- Kev Q4 alone (LoRA none rule): op 118/165.
- Not run: Kev Q8, L+K+H, none override, disagreement gate, pGen gate.

### Files
- `out/prereg-input-h5.jsonl`: evaluator rows. `out/prereg-result-h5.json`: the frozen evaluator's output. `out/splits-h5.json`, `out/categories-h5.json`, `out/exploratory-h5.json`.
- Producer outputs: `out/lora-h5.jsonl` (pick, gen, slow, exact, branch, baseline step 2), `out/ship-v1-h5.json` (ship step 2), `out/kev08q4-desc-h5.jsonl`, `out/kev-items-h5.json`, `out/args-{base,ship}-h5.json` (STRICT + NORMALISED per item).
- Code: `lora-run.ts`, `ship-run.ts` (+ `ship-run/`), `build-kev-items.py`, `score-args.ts`, `assemble.py`, `prereg_eval.py` (sha-identical copy); `patched/` (patch applied to repo-file copies); `parity/` (dev gates); `logs/` (server commands and logs, runner logs).

