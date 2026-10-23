# X5: human-style paraphrase rows (Round 11 data), 2026-10-23

Status: data done, copied to Constantine, training NOT started. Nothing committed.
Teacher: claude-sonnet-5 via isolated `claude -p` (empty cwd, no tools/MCP/settings). Auth check before resume: 1 trivial call, ok ($0.0012).

## Funnel (counts at every stage)

| Stage | Count |
|---|---|
| Round 10 kept rows (source pool) | 4,609 |
| Blind prefilter (source row hits held-out-5) | -1 -> 4,608 clean |
| Sources picked / rewrites planned | 3,374 sources / 5,088 items in 509 requests |
| Requests sent (gen) | 508 (5,078 items). `para-health-report--GENERATE_REPORT-1` (10 items) is in the plan meta but not in requests.jsonl; the previous agent left no reason. |
| Generation prompt leaks (held-out 1-4 / 5 / 6) | 0 / 0 / 0 |
| `rows` (value preserved, op-word rule, account/email filter) | 4,838 kept, 240 dropped: value not preserved 154, op word in avoid item 65, same as source 21; 0 email/context hits |
| `leak` (eval leak held-out 1-4+dev/seed, blind 5/6; near-dup vs Round 10 + earlier rewrites) | 4,630 kept: near-duplicate -198, eval-leak default -9, eval-leak heldout5 -1, heldout6 0 |
| render.sh dedup / zod + reducer replay | 4,630 / 4,630 (0 dropped) |
| r6.1 render | 8,698 sequences; 64 step-2 targets rejected by grammar (whole row dropped in agree) |
| Label prompt leaks (counts) | 0 / 0 / 0 |
| Blind label (batch 8, 584 calls; 504 from journal + 80 resumed) | 4,566 rows labeled |
| Agreement (op + args exact; case-only rewrites may match source gold) | **3,661 / 4,566 = 80.2%**; on op 4,328 / 4,566 = 94.8%; 238 op and 667 args disagreements; case/final-punct tolerant would be 3,723. Via: rewrite 3,246, source-gold 86, no-action 329 |
| Op-word quota (max-free 0.7) | -46 |
| **Kept new rows** | **3,615** (3,286 action over 92 ops, 329 no-action; 1,559 ref rows; 2,863 distinct sources) |
| Re-render of kept rows (merge) | 3,615 rows -> 6,707 sequences, parity clean, 0 grammar rejects |

Action vs no-action agreement: 3,332/4,232 (78.7%) vs 329/334 (98.5%).
Top op disagreements by gold op: moc:REORDER_CORE_IDEAS 17, moc:REMOVE_OPEN_QUESTION 12, moc:UPDATE_DESCRIPTION 10, observation:ARCHIVE_OBSERVATION 10, knowledge-note:SET_DESCRIPTION 9.

## Style distribution

| Style | planned | rows | after leak | labeled | agree rate | kept | median words |
|---|---|---|---|---|---|---|---|
| terse | 509 | 492 | 479 | 473 | 80.5% | 377 | 7 |
| lowercase | 509 | 473 | 410 | 410 | 80.0% | 323 | 19 |
| typos | 508 | 481 | 438 | 433 | 82.2% | 353 | 21 |
| abbrev | 509 | 480 | 473 | 472 | 80.3% | 370 | 20 |
| phone | 509 | 487 | 457 | 427 (30 gated) | 81.7% | 343 | 20 |
| nonnative | 509 | 484 | 482 | 481 | 80.7% | 385 | 21 |
| question | 508 | 492 | 472 | 469 | 81.0% | 375 | 19 |
| indirect | 509 | 477 | 467 | 460 | 77.2% | 354 | 22 |
| synonyms | 509 | 483 | 466 | 456 | 77.0% | 349 | 21 |
| rambling | 509 | 489 | 486 | 485 | 81.2% | 386 | 40 |

Secondary style on 35% of items (typos 626, abbrev 645, lowercase 525 planned).
Kept rows: 1,736 all-lowercase, 521 end in "?", 1,927/3,286 action rows op-word-free, 241 case-only value changes, 108 from step-1-only sources. Word-trigram Jaccard to the source: median 0.119, p90 0.333 (genuinely rewritten).

## Merged training file (Round 10 + new)

The brief said "Round 10 kept rows minus Round 8 val ids, as the Round 10 split did". **That premise is wrong:** Round 10's split was a fresh `split.py` (seed 20261021, share 0.05) over all 4,609 kept rows; 140 of Round 8's 168 val ids are in Round 10's train-split. So I mirrored what Round 10 actually did and kept its val split byte for byte:

- train = `round10/split/train-split.jsonl` (7,187 seqs / 4,381 rows, kept byte-identical, in order) **minus 1 row / 1 seq that hits held-out-5** (a Round 10 training row Round 10 never checked against the blind sets. It also means the Round 10 LoRA saw one near-copy of a held-out-5 item.) + new sequences whose source row is not in Round 10 val.
- Rewrites of Round 10 val rows dropped from train: 187 rows / 346 seqs. New rows added: 3,428 rows / 6,361 seqs.
- **train-split.jsonl: 13,547 sequences / 7,808 rows. val.jsonl: 377 sequences / 228 rows (identical to Round 10's val, sha256 match).**
- Checks: train/val id overlap 0; no new train row has a val source; merged train + val eval-leak scan after the drop: 0; account email / user / home-dir terms (5 terms loaded, email included): 0 hits in kept rows, merged train and val.
- Format: r6.1, same catalogHash (4e7029ec...) and topK 0 as Round 10, so concatenation is sound. train_lora.py's HF Trainer shuffles, so file order does not matter.

## Constantine

Copied to `trainbox:~/bai-training/training/artifacts/round11-para/` (train-split.jsonl, val.jsonl, split.json). sha256 matches on both ends. Training not started.

## Cost / time (CLI total_cost_usd = API list-price equivalent, not subscription usage)

| Step | Calls | Wall | Cost |
|---|---|---|---|
| Generation | 508 (20 from journal) | 2,296.7 s this invocation (median 21.5 s/call, concurrency 5) | $21.02 |
| Blind label | 584 | 874 s first pass (stopped at 504, auth lost) + 131.2 s resume | $11.83 (all 584) |
| Pilots (previous agent) | gen 20, labels 27 + 27 | ~228 s | $1.95 |
| Local: rows/leak/render ~63 s; merge (render + mirror) ~40 s | | | |
| **Total full run** | 1,092 calls | ~55 min teacher wall | **$32.84** (+ $1.95 pilots) |

Tokens: gen 2.38M cache-write in, 1.15M out (0.83M thinking); label 1.49M cache-write + 1.63M cache-read in, 0.56M out.

## Files (sha256)

Under the repo `training/artifacts/round11-para/` (gitignored):
- `full/chain/agreed.jsonl` (kept new rows, 3,615): faa56aea54b803896afc90e05d15e3963c76932fdf28c61f4034a02779884235
- `merged/new-final/rows-valid.jsonl` (same 3,615 after zod/replay): 8e76faf2bac1dda4fe78b7f5c51396f8b31855d6ee530ec5edcf09571a8068cd
- `merged/new-final/train.jsonl` (6,707 new seqs): 607bdf9784d79e3c680d411d75b00b0fd91085efb43ad84abb2bdfe0ed0dfc89
- `merged/split/train-split.jsonl` (13,547): 1c4718d377e96f848e60733da48e3d8dcfa4d59be86dae6c9920320cd97b7f7d
- `merged/split/val.jsonl` (377): 1aa6b1c50688335292304d7d7d456e83eff9ee853604ba7adf9a00f059592e39 (= round10/split/val.jsonl)
- `merged/split/split.json`: d568825abf9a74613d9a54cca0e6a343cd0d6c8a8507f3db4d28f552153faa93
- `full/chain/label-results.jsonl`: 13680f6065d196b80d2477e5f7e3fa1afd3c69ffe6055307ccee0a0306b71401
- Stats: `exp/x5-paraphrase-data/stats.json` (this directory)
- Partial-label backup (pre-resume journal): scratchpad `label-partial-backup.jsonl`; first label log kept as `full/chain/label-run.1.log`.

Suggested training command (not run): `~/bai-training/launch.sh r11-train training/artifacts/round11-para/train-split.jsonl --val training/artifacts/round11-para/val.jsonl --out training/artifacts/round11-para/run --epochs 2 --save-steps 50 --save-limit 2` (Round 10's settings; about 1.9x Round 10's 450 steps).

## Code review: training/round11-para/ (untracked)

Changes this session: added `para.py mirror` (keeps Round 10's split, drops rewrites of val sources and eval-leaking base rows). `merge.sh` is rewritten to use it. The old merge.sh re-ran leak + split over everything, which would have changed Round 10's val split.

Fit to commit? **Nearly. Fix 1 first:**
1. `para.py` hardcodes this session's scratchpad path (`SCRATCH` / `BLIND_FILES`, `/private/tmp/claude-501/-Users-<username>-.../scratchpad`). It is session-specific, and it carries the local username (the only context-term hit in the code). Make it an env var or `--blind-dir` argument before committing.
2. No secrets: 0 '@' characters, 0 API-key/token patterns, and the account email does not appear in any of the 3 files. The email filter stays on: `rows` drops any item carrying a `context_leak_terms()` term. The filter would silently weaken if `claude auth status` returned `{}`, so I re-scanned the outputs (0 hits).
3. `chain.sh` overwrites `label-run.log` on re-run (`2>` not `2>>`). I preserved the old log by hand.
4. One planned gen request was dropped from requests.jsonl without a recorded reason (GENERATE_REPORT-1). It is harmless, but should be documented.
5. Blind-set handling is sound: hits are reported as set + score only, `blind_provenance` records sha256 and checks the sidecar.
6. Style is consistent with teacher.py and passes py_compile. The previous agent wrote no unit tests. `cmd_split` is now unused by merge.sh, so remove it or keep it as an alternative. There is no README section for X5 yet.

## Verification addenda

- Costs re-summed from per-call `attempts[].usage`: label 584 attempts, $11.8265; gen 508 attempts, $21.0155 (they match usage.json).
- Trainer contract: every line in train-split and val has `input_ids` / `completion_mask` of equal length with at least 1 completion token. Max length is 594 (train) / 583 (val), under train_lora's default `--max-length` of 1024. There are 0 duplicate (id, step, input_ids) sequences.
- Superseded file: a first mirror run, made before the held-out-5 row was dropped, wrote train-split.jsonl sha256 7a61e2ccfb6502cba903527e554b4beedb5228563e73c3544c53cc4a10342b5b (13,548 seqs). It was overwritten and never copied to Constantine. The current file is 1c4718d3...
- This REPORT.md and stats.json: 0 account/context-term hits.
