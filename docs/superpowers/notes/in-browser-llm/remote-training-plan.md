# Remote LoRA training on the second laptop: plan

Status: exploration only. No other machine was contacted, and the repo was not changed.
Date: 2026-10-22. This machine: M4 Max, 36 GB, `Benjamins-MacBook-Pro-2.local`, 192.168.2.222 on en0.

## 1. Discovery (read-only, this machine)

| Check | Result |
|---|---|
| `dns-sd -B _ssh._tcp local.` | **`L231087`** on en0 -> `L231087.local.:22`, which resolves to **192.168.2.197**. TXT is empty. |
| `dns-sd -B _sftp-ssh._tcp local.` | **`L231087`** as well. `_ssh` and `_sftp-ssh` together are what macOS Remote Login advertises, so **L231087 is very likely a Mac with Remote Login already on**. |
| `dns-sd -B _smb._tcp` | `Benjamin's MacBook Pro (2)` (this machine) and an EPSON printer. |
| `_device-info._tcp` lookup of L231087 | Nothing came back, so the model and chip are unknown. |
| `arp -a` | About 15 hosts on 192.168.2.0/24, including .197. No names are attached. |
| `~/.ssh/config` | Only `Host github.com`. There is no LAN host entry. |
| `known_hosts` | One LAN address, **192.168.2.169**, plus github.com, snakes.run and EC2 hosts. Either .169 is an older DHCP address of the other laptop or it is another machine. |
| Key pair | `~/.ssh/id_ed25519(.pub)` exists. `ssh-add -l` shows one ED25519 key loaded (`benjamin@thegoldenmule.com`), so non-interactive SSH should work once the public key is installed on the remote. |
| Local tools | `/usr/bin/rsync` (openrsync, protocol 29), `/usr/bin/ssh-copy-id`, `/usr/bin/screen`, `caffeinate`. tmux is not installed. |

`L231087` looks like an IT asset tag, which suggests a **managed (MDM) laptop**. MDM can block Remote Login, `ssh-copy-id`, or sleep settings. The user must confirm that this is their other laptop.

## 2. What a run actually needs: split the pipeline, don't move it

| Stage | Where | Why |
|---|---|---|
| Teacher, dedup, validate, `render-prompts.ts` (node/tsx), `render_template.py` (llama-server parity), `split.py` | **Here** | The output `train.jsonl` / `train-split.jsonl` holds pre-tokenized `input_ids` and `completion_mask`. `train_lora.py` never re-templates, so the remote needs no node, tsx, chat core or llama.cpp. |
| `train_lora.py` | **Remote** | This is the only heavy stage. Round 8 is 7,895 seqs × 3 epochs / effective batch 32 = 741 steps. |
| `merge.py` (4 s, 2.5 GB), `export-gguf.sh` (8 s, 1 GB), `smoke_infer.py` / llama.cpp eval | **Here** | These are cheap, and they need the b11364 llama.cpp build that already exists here. `setup.sh` and `export-gguf.sh` also use BSD-only commands (`stat -f`, `/usr/bin/time -l`, `clang++`), which would break on Linux. |

So the remote does **not** run `setup.sh`. It needs only: Python 3.13 through `uv`, `requirements.txt` (without the gguf editable, which only `setup.sh` adds), and the base HF weights.

**Ship to the remote** (keep the repo layout so `REPO = Path(__file__).parents[2]` and the default `--base` resolve):
- `training/py/` (the working-tree copy of `train_lora.py`, including the uncommitted `pad_to_multiple_of` / `empty_cache` diff another agent is making. rsync sends it as-is. Do not commit it from here.)
- `training/requirements.txt`, `training/requirements.lock`
- `training/models/LFM2.5-350M/` (681 MB over the LAN; this avoids a Hugging Face download there)
- `training/artifacts/round8/split/train-split.jsonl` (28 MB) and `val.jsonl` (1.5 MB)

**Bring back:** `run/adapter/` (about 24 MB: rank 16, 6.0M params), `run/train-stats.json`, `run/train-log.json`, `train.log`. Merge, GGUF and eval then run here exactly as in the README.

## 3. Options

### A. SSH + rsync, driven from here (recommended)
- One-time setup: Remote Login on, plus one password-based `ssh-copy-id` by the user. After that an agent here can do everything with `ssh -o BatchMode=yes`: push, bootstrap, launch, tail, pull.
- Reliability: deterministic and scriptable. A detached process (`nohup` or `screen`) survives a dropped SSH connection.
- Fit: rsync is already here. Remote Login appears to be already advertised by L231087.

What changes by remote platform:

| Remote | Device | Notes |
|---|---|---|
| **Apple Silicon Mac** | MPS | Same stack as here. The same MPS memory fixes are needed (section 6). Expect about 7 s/step at batch 8 × accum 4, so about 1.5 h for 741 steps if memory stays flat. It needs at least 16 GB unified memory; 24 GB or more is comfortable. |
| **Linux + NVIDIA** | CUDA | Best option. The PyPI `torch==2.11.0` wheel for Linux bundles CUDA. Optionally `uv pip install causal-conv1d` for the fast LFM2 conv kernel; the log currently warns about the slow reference fallback. There is no allocator-cache problem. Use `tmux` if present. |
| **Intel Mac** | CPU | Not recommended: probably 10× slower or more than MPS. |
| **Windows** | WSL2 (CUDA if NVIDIA) | Needs an OpenSSH server inside WSL2 (or Windows OpenSSH with `wsl` as the shell) and port forwarding. This is the most setup of any option. |

### B. Claude Code session on the other laptop (optional, on top of A)
- `claude --help` (v2.1.280) shows `claude remote-control` / `--remote-control [name]`, which lets you control a local session from claude.ai/code or the phone app. There are also `--bg`, `attach`, `logs` and `agents` for background sessions.
- The SendMessage tool here documents cross-session delivery to sessions "on this machine, on another machine, or in the cloud" that `ListAgents` shows. So the coordinator **can** text a Remote Control session on the other laptop. The limits:
  - Messages are text only. The 28 MB split and the 681 MB weights still need a file channel (rsync/SSH, AirDrop, or a shared folder).
  - There is no delivery or read notice for Remote Control targets, so silence means nothing.
  - Messages are held for the user's approval when the permission modes differ.
  - A subagent's send goes out under the parent session's address.
  - The remote session has its own permissions, and it must not be asked to do anything blocked here.
- Verdict: use B only if Remote Login is blocked (for example by MDM). In that case the user starts `claude --remote-control bai-train` in a clone there, and files go over AirDrop or a shared folder. Otherwise B is a convenience for watching from the phone, not the backbone.

### C. Shared folder plus a watcher
Not better. It needs the same one-time sharing setup as A, has no process control or log tail, and SMB file locking with a live writer is fragile. Skip it.

## 4. One-time setup (option A)

### The user does this on the other laptop (macOS)
1. **System Settings → General → Sharing → Remote Login: on.** Click (i) and set "Allow access for" to your user only (or All users). Leave "Allow full disk access for remote users" off; it is not needed.
2. The same pane shows the address, for example `ssh <user>@L231087.local`. Note the **user name** (the short name, `whoami` in Terminal) and the **hostname**.
3. Get the IP as a fallback: `ipconfig getifaddr en0`.
4. Get the chip and RAM: Apple menu → About This Mac, or `sysctl -n machdep.cpu.brand_string hw.memsize`.
5. During runs: plug it into power, keep the lid open, and leave it on the same Wi-Fi. `caffeinate` (below) prevents idle sleep but not lid-close sleep on battery.
6. If MDM blocks Remote Login (the toggle is greyed out), say so; that means falling back to option B.

### The user runs this once on THIS machine (interactive: asks for the remote login password once)
```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub <user>@L231087.local    # or <user>@192.168.2.197
```
This also adds the host key to `known_hosts` after you confirm the fingerprint. An agent must not do this step: it involves your password and the trust decision.

Optional: add a host alias to `~/.ssh/config` (an agent can do this if you approve):
```
Host trainbox
  HostName L231087.local
  User <user>
  IdentityFile ~/.ssh/id_ed25519
  ServerAliveInterval 30
```

### An agent can do the rest
- Check access: `ssh -o BatchMode=yes trainbox 'uname -m; sw_vers 2>/dev/null || cat /etc/os-release; sysctl -n hw.memsize 2>/dev/null'`
- Run everything in section 5.

## 5. The remote run (commands in order)

Remote working dir: `~/bai-train/` holds a mirror of the repo's `training/` subtree (`~/bai-train/training/...`).

```bash
H=trainbox; R=bai-train; L=/Users/benjaminjordan/projects/powerhouse/bai-knowledge-note

# 1. Push code, weights, data (rsync is incremental; re-running it is cheap)
ssh $H "mkdir -p ~/$R/training/artifacts/round8/split"
rsync -a --delete --exclude __pycache__ $L/training/py/ $H:$R/training/py/
rsync -a $L/training/requirements.txt $L/training/requirements.lock $H:$R/training/
rsync -a $L/training/models/LFM2.5-350M/ $H:$R/training/models/LFM2.5-350M/
rsync -a $L/training/artifacts/round8/split/{train-split.jsonl,val.jsonl} $H:$R/training/artifacts/round8/split/

# 2. Bootstrap (once): uv + Python 3.13 venv + pinned deps
ssh $H 'command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh'
ssh $H "cd ~/$R/training && ~/.local/bin/uv venv .venv --python 3.13 && ~/.local/bin/uv pip install -q --python .venv/bin/python -r requirements.txt"
ssh $H "cd ~/$R/training && .venv/bin/python -c 'import torch;print(torch.__version__, torch.backends.mps.is_available(), torch.cuda.is_available())'"

# 3. Short memory test first (about 60 steps), detached, macOS remote
ssh $H "cd ~/$R && PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.6 nohup caffeinate -is training/.venv/bin/python \
  training/py/train_lora.py training/artifacts/round8/split/train-split.jsonl --out training/artifacts/round8/memtest \
  --max-steps 60 --batch 8 --grad-accum 4 > training/artifacts/round8/memtest.log 2>&1 < /dev/null & echo \$! > training/artifacts/round8/memtest.pid"

# 4. Full run (same shape; add --val for val loss every 25 steps)
ssh $H "cd ~/$R && PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.6 nohup caffeinate -is training/.venv/bin/python \
  training/py/train_lora.py training/artifacts/round8/split/train-split.jsonl --val training/artifacts/round8/split/val.jsonl \
  --out training/artifacts/round8/run --batch 8 --grad-accum 4 > training/artifacts/round8/train.log 2>&1 < /dev/null & echo \$! > training/artifacts/round8/train.pid"
```
Notes on these commands:
- `< /dev/null` keeps a held stdin from making `ssh "... &"` hang on return.
- The saved PID belongs to `caffeinate`, which exits with its child. That makes it a valid liveness check, so leave it as is.
- `train_lora.py` ships as whatever the working tree holds at push time. Record `shasum training/py/train_lora.py` next to the run (for example `ssh $H "shasum ~/$R/training/py/*.py" > run-remote/code.sha`), so the other agent's in-flight edits cannot make the run untraceable.

On Linux + CUDA, drop `caffeinate` and the MPS variable, and use `tmux new -d -s train '...'` or `nohup`.

**Check progress** (an agent can poll this):
```bash
ssh $H "tail -c 600 ~/$R/training/artifacts/round8/train.log | tr '\r' '\n' | tail -3"   # tqdm step + s/it
ssh $H "kill -0 \$(cat ~/$R/training/artifacts/round8/train.pid) && echo running || echo stopped"
ssh $H "top -l 1 -o mem -n 3 | tail -4"      # macOS: memory of the top processes
```
Watch the s/it figure. In attempt 1 here it went from 7.8 to 45 s/it as the cache grew. A steady s/it means memory is flat.

**Pull artifacts back, then finish locally:**
```bash
rsync -a --exclude checkpoints $H:$R/training/artifacts/round8/run/ $L/training/artifacts/round8/run-remote/   # separate dir: round8/run is the other agent's
rsync -a $H:$R/training/artifacts/round8/train.log $L/training/artifacts/round8/train-remote.log
# then locally, as in the README:
training/.venv/bin/python training/py/merge.py training/artifacts/round8/run-remote/adapter --out training/artifacts/round8/run-remote/merged --check training/artifacts/round8/split/train-split.jsonl --check-rows 8
training/scripts/export-gguf.sh training/artifacts/round8/run-remote/merged training/artifacts/round8/gguf/r8
```

**Resume after a disconnect:**
- An SSH drop does nothing; the run is detached. Reconnect and tail the log.
- A crash, OOM kill, sleep or reboot on the remote **restarts from step 0**. `train_lora.py` uses `save_strategy="no"` and writes the adapter only at the end, so no checkpoint exists to resume from. Fixing that needs a later code change: a `--save-steps N` flag with `save_strategy="steps"`, and `trainer.train(resume_from_checkpoint=...)`. That is out of scope here. On Apple Silicon at about 1.5 h the risk is acceptable if the laptop stays plugged in with the lid open.

**Memory cap on the remote:** use the same fixes as section 6.
- `PYTORCH_MPS_HIGH_WATERMARK_RATIO` (for example 0.6 of the recommended working set) makes PyTorch raise an MPS out-of-memory error instead of swapping the machine into the ground. A failed run is better than a frozen laptop.
- macOS has no `ulimit -v` or cgroups. On Linux, `systemd-run --user -p MemoryMax=16G ...` gives a hard cap.

## 6. Why it hit 44 GB, and the local fallback

**Evidence (round 8 attempt 1, `artifacts/round8/train-attempt1.log`):**
- Rows: 7,895 sequences, lengths 75 / p50 215 / p90 454 / max 587 tokens (none above `--max-length 1024`). Batch 8 × accum 4.
- Step time: 7.8 s/it at step 1, 11.6 at step 9, about 20 by step 20, 45 s/it at step 47-48. The slowdown started **before the first eval** (step 25), which points to memory growth and then swap, not eval.
- The working-tree comment in `train_lora.py` records that the MPS cache "grew past 40 GB in round 8's first try".

**Causes:**
1. **Most likely: the MPS allocator caches a buffer per distinct tensor shape, and dynamic padding produced hundreds of shapes.** The collator pads each micro-batch to its own max length. With lengths 75-587, nearly every batch has a new shape, and the MPS caching allocator keeps those blocks. The suspect "padding to max length" is the inverse here: *dynamic* padding is the problem, and fixed padding is a fix.
2. **Ruled out: eval accumulating logits.** `transformers/trainer.py:2833` evaluates with `prediction_loss_only=True` when there are no `compute_metrics`.
3. **Ruled out: full-vocab logits (vocab 65,536).** TRL 1.16 patches a fused chunked LM head (`sft_trainer.py:~1143`, `add_fused_lm_head`), so full logits are never materialized.
4. **Ruled out: no gradient checkpointing.** `SFTConfig` defaults `gradient_checkpointing=True` (`sft_config.py:132`).
5. **Minor:** the reference `causal_conv1d` fallback (slow, extra temporaries) and batch 8 activations. Both scale linearly, not without bound.

**Config changes if it runs locally again, in order of effect:**
1. `pad_to_multiple_of=64` plus `torch.mps.empty_cache()` every step. This is **already in the uncommitted working-tree diff**, and it cuts the shapes to at most 10. **It is untested.** The memtest stopped at step 3 of 15 (7.1, 7.2 and 6.8 s/it), and `memtest/` holds no adapter and no stats. Attempt 1 looked the same through step 7, so nothing is proven yet. Before any 741-step run, local or remote, run a memtest of 60 or more steps and read `mpsDriverPeakSampledGB` from its `train-stats.json`.
2. `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.5` (or 0.6) as a hard ceiling: the run fails fast instead of freezing the machine.
3. `--batch 4 --grad-accum 8`: the same effective batch of 32 with about half the activation peak.
4. `group_by_length=True` (length-bucketed batches): less padding, and with item 1 even fewer distinct shapes. This needs a one-line `SFTConfig` addition.
5. If it still grows, use fixed padding to a single length (for example 640): one shape and a flat cache, at about 2.3× the compute (mean length is 258).
6. `--eval-steps 100`, or drop `--val` locally. Eval adds its own set of shapes.
