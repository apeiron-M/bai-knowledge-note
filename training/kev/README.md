# Kev-0.8B fine-tune (Kev-FT): the second step-1 expert

The recipe that produced `Kev-0.8B-vault-ft1-20261024-Q4_K_M.gguf`, step-1 expert B of configuration C
(`training/docs/TRAINING-GUIDE.md` §0, §8). It was moved here from the session experiment tree (`exp/x4-kev/`, backup
`training/artifacts/exp-2026-10-23/x4-kev/`) and the training Mac's `~/x4/`. Only paths were parameterised. The
commands, flags and record bytes are the ones that ran. No weights or training data are committed: they stay under
the gitignored `training/artifacts/` and `training/models/`.

## Upstream pins

| What | Pin |
|---|---|
| Kev code | `github.com/jaredpalmer/kev` @ `2074cc44256200bb37540103fa4572901faa10f3` (checked on the training Mac, 2026-10-27) |
| Initial weights | `jaredpalmer/kev-0.8b` @ `bf75a6a8848ea6960ff2ed108d9ed44c2941174f` (HF) |
| Base weights | `Qwen/Qwen3.5-0.8B-Base` @ `dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68` (HF) |
| GGUF converter and runtime | llama.cpp `46ca246` (b11364), the libllama in wllama 3.8.1 (`training/scripts/setup.sh`) |
| Python env on the training Mac | `uv sync` in the Kev clone (Python 3.13; torch >=2.6,<2.9, transformers >=5.17,<6) |

## Files

| File | Where it runs | What it does |
|---|---|---|
| `dump-catalog.ts` | eval Mac | Writes Kev's option catalog: every global op with its spec description and `OP_DESCRIPTIONS` override. |
| `data/catalog.json` | | The frozen catalog, sha256 `b257573b…5b70`. `dump-catalog.ts` at this commit reproduces it byte for byte. The eval rig reads this copy. |
| `to_kev_jsonl.py` | eval Mac | Teacher rows → Kev records (`train.jsonl`, `calibration.jsonl`) plus `provenance.json` (input and output sha256s, counts). |
| `node/decide.mjs` | eval Mac | The Kev decider: prompt wording (W1–W3), option text (`--variant name|desc|short`) and the `/v1/systemone` client. Frozen, sha256 `feed74fe…6004`. The eval rig runs it with `--runtime server --variant desc --wording W3`. |
| `constantine-recipe.sh` | training Mac | `setup`, `probe` (20 steps), `train` (foreground), `calibrate`. |
| `launch-kev-ft.sh`, `watchdog-kev.sh` | training Mac | The detached training run (screen + caffeinate + MPS caps) and its memory watchdog. They were `~/x4/launch-kev-ft.sh` and `~/x4/watchdog-kev.sh`. |
| `kev-ft-calibrate.sh` | eval Mac → ssh | `kev.benchmark` on the calibration split, then `calibrate_checkpoint.py --allow-in-distribution` (T into `head.pt`). |
| `kev-ft-export.sh` | eval Mac | rsync back, sha256 check, `convert_hf_to_gguf.py` → BF16, `llama-quantize` → Q4_K_M. |
| `convert-kev-base.sh` | eval Mac | The released Kev-0.8B → GGUF, for zero-shot Kev arms (X4's `convert-kev08.sh`). |

The `kev06` runtime of `decide.mjs` (Kev-0.6B ONNX) also needs `@huggingface/transformers@^4.3.1` and
`open-jev@^0.1.2`. They are not installed in this repo. The server runtime, which is the only one the rig and C use,
needs only Node built-ins.

`native-llm.mts` and `lora-native.mts` (X2) are not here. Nothing in the Kev path or the eval rig uses them: the rig's
native client is `training/eval-rig/lib/lib.ts`.

## Procedure

Run from the repo root on the eval Mac unless noted. `P=training/.venv/bin/python`.

```bash
# 1. Option catalog (only if OP_DESCRIPTIONS or the catalog changed; otherwise use data/catalog.json)
npx --no-install tsx training/kev/dump-catalog.ts training/artifacts/kev-data/catalog.json

# 2. Data (rows = the Round's post-dedup rows; val = the Round 10 val split, the calibration set)
$P training/kev/to_kev_jsonl.py training/artifacts/round10/final/rows-kept.jsonl \
    training/artifacts/round10/split/val.jsonl training/kev/data/catalog.json training/artifacts/kev-data

# 3. On the training Mac: push the code and data, check sha256 on both sides
ssh trainbox 'mkdir -p ~/x4'
rsync -a training/kev/launch-kev-ft.sh training/kev/watchdog-kev.sh training/kev/constantine-recipe.sh \
    training/artifacts/kev-data/train.jsonl training/artifacts/kev-data/calibration.jsonl trainbox:x4/
ssh trainbox 'shasum -a 256 ~/x4/*.jsonl'; shasum -a 256 training/artifacts/kev-data/*.jsonl
ssh trainbox '~/x4/constantine-recipe.sh setup && ~/x4/constantine-recipe.sh probe'   # once; then the timing probe
ssh trainbox 'sudo pmset -c sleep 0'                                                    # the box sleeps on AC otherwise
ssh trainbox '~/x4/launch-kev-ft.sh'                                                    # about 11.4 h for 4,382 records
ssh trainbox 'tail -3 ~/x4/kev-ft.log'                                                  # poll; ends with "EXIT 0"

# 4. Calibrate, then export
training/kev/kev-ft-calibrate.sh
training/kev/kev-ft-export.sh Kev-0.8B-vault-ft2-<yyyymmdd>

# 5. Dev evaluation: training/eval-rig/README.md
```

Every script reads its paths from environment variables with repo-relative or home-relative defaults. The header of
each script lists them.

## Data provenance

The shipped Kev-FT data is `train.jsonl` with sha256 `ed3d9aac475781498f5a6bf002edd9f07d16ce1e43e5f0a175e8608aaf486e65`
(4,382 records) and `calibration.jsonl` with sha256 `6abffad7e469c5c74c5fd2d73cf0440aa99d18dc4338d3ca5c14669a98e25248`
(228). The same shas are on the training Mac in `~/x4/`.

**It was built from the pre-dedup file `round10/final-in/rows.jsonl`**, not from `round10/final/rows-kept.jsonl`.
The training guide (§5) inferred this from the counts (4,382 + 228 = 4,610). It has now been checked by regeneration
on 2026-10-27:

| Input rows | Rows | → train / calibration | train.jsonl sha256 |
|---|---|---|---|
| `round10/final-in/rows.jsonl` (`bbc782d6…1589`) | 4,610 | 4,382 / 228 | `ed3d9aac…6e65`, **identical to the shipped file** |
| `round10/final/rows-kept.jsonl` (`550eea7a…877c`) | 4,609 | 4,381 / 228 | `029d8798…`, differs |

The one extra row is `gen-knowledge-note--UPDATE_LINK_TYPE-4-0`, which `dedup.py` dropped in the final render. It went
into Kev's training split. Calibration is identical either way. Inputs: `round10/split/val.jsonl` (`1aa6b1c5…2e39`) and
`data/catalog.json` (`b257573b…5b70`).

**For the next run, build from the post-dedup rows** (`final/rows-kept.jsonl` or the equivalent of the new round) and
keep the `provenance.json` that `to_kev_jsonl.py` now writes next to the data.

To regenerate the shipped data exactly:

```bash
$P training/kev/to_kev_jsonl.py training/artifacts/round10/final-in/rows.jsonl \
    training/artifacts/round10/split/val.jsonl training/kev/data/catalog.json training/artifacts/kev-data-shipped
# -> provenance.json outputs: train.jsonl ed3d9aac…, calibration.jsonl 6abffad7…
```

`training/artifacts/round10/` comes from the Round 10 commands in `training/docs/TRAINING-GUIDE.md` §3a–§3b. It is
gitignored and is not committed.

## Observed run (X8)

1,096 steps, from 2026-10-23 16:09 to 10-24 03:36 (about 11.4 h, about 4.7–4.8 s per record), with a footprint of about
15 GB. Calibration took 14 min and fitted T = 2.7007. It is in-distribution: on human wording the rig's dev fit gives
T_K = 4.0, and that is what C freezes. Conversion took 12 s and quantisation 3 s. The Q4_K_M is 529,595,072 B, sha256
`30b5796e4fac6765d5df8f4867857280dd46ec9f8397d39095a914a02f627b23`.
