"""Pre-registration mode for rig.sh (stdlib only).

  python3 prereg.py <prereg.md> [--run <name>] [--sha256 <hex>]

1. Integrity first: sha256 of the file's bytes must equal its sidecar (<file>.sha256, or <stem>.sha256 as
   x7-fusion/PREREGISTRATION.sha256; "<hex>  <basename>") and/or --sha256. No sidecar and no --sha256 -> refused.
2. Parameters: a fenced block whose info string is `rig-run [<name>]`, one `key: value` per line (# comments).
   With several blocks, --run <name> picks one. Keys (unknown keys are refused):
     lora, lora_sha256            required
     kev, kev_sha256              optional; kev_sha256 required with kev
     set                          required; dev | val | heldout5 | file:<path>
     set_sha256                   required for heldout5 and file:<path>
     blind_ok: yes                required for heldout5 (passes --blind-ok)
     args, temps, rev, out        required (temps explicit -> t_lora, and t_kev with kev)
     t_lora, t_kev, val_from, dev_from     optional
     exclude_match                <training-row-file>:<row-id>, repeatable
     expect_excluded              integer; a different count is logged as a DEVIATION (the run continues)
     verify                       "<sha256> <path>", repeatable: any further file to check (e.g. rig src/evaluate.py)
   Relative paths resolve against the prereg file's directory, then the repo, then $RIG_EXP (default: the
   gitignored session backup training/artifacts/exp-2026-10-23, so the committed PREREGISTRATION-2/3 files, whose
   paths are exp-relative, resolve as written) -- first that exists;
   `out` resolves against the prereg file's directory.
3. Every listed sha256 is checked before anything runs. Prints, NUL-separated: the prereg sha256, the run name,
   expect_excluded (or ""), then the rig.sh argument vector.
"""
import hashlib, os, re, sys

REPO = os.environ.get("RIG_REPO") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
EXP = os.environ.get("RIG_EXP") or os.path.join(REPO, "training", "artifacts", "exp-2026-10-23")
BLIND = os.environ.get("BAI_BLIND_DIR") or os.path.join(REPO, "training", "artifacts", "blind")
H5 = os.path.join(BLIND, "heldout5", "heldout5-eval.json")
REQ = ["lora", "lora_sha256", "set", "args", "temps", "rev", "out"]
OPT = ["kev", "kev_sha256", "set_sha256", "blind_ok", "t_lora", "t_kev", "val_from", "dev_from", "expect_excluded"]
REP = ["exclude_match", "verify"]
HEX = re.compile(r"^[0-9a-f]{64}$")


def die(m):
    print(f"prereg: {m}", file=sys.stderr); sys.exit(3)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()


def main():
    a = sys.argv[1:]
    if not a: die("usage: prereg.py <file> [--run name] [--sha256 hex]")
    path = os.path.abspath(a[0]); opt = lambda k: a[a.index(k) + 1] if k in a else None
    want_run, want_sha = opt("--run"), opt("--sha256")
    if not os.path.isfile(path): die(f"no file {path}")
    got = sha(path); base = os.path.dirname(path)
    sides = [path + ".sha256", os.path.splitext(path)[0] + ".sha256"]
    side = next((s for s in sides if os.path.isfile(s)), None)
    if side:
        recs = [l.split() for l in open(side) if l.strip()]
        recs = [r for r in recs if len(r) == 1 or os.path.basename(r[-1].lstrip("*")) == os.path.basename(path)]
        if len(recs) != 1 or not HEX.match(recs[0][0]): die(f"sidecar {side} has no single sha256 line for {os.path.basename(path)}")
        if recs[0][0] != got: die(f"sha256 MISMATCH: {os.path.basename(path)} is {got}, sidecar {side} says {recs[0][0]}")
    if want_sha and want_sha != got: die(f"sha256 MISMATCH: {os.path.basename(path)} is {got}, --prereg-sha256 says {want_sha}")
    if not side and not want_sha: die(f"no sidecar ({' or '.join(sides)}) and no --prereg-sha256: the file is not frozen")
    print(f"prereg: {os.path.basename(path)} sha256 {got} verified" + (f" against {os.path.basename(side)}" if side else ""), file=sys.stderr)

    blocks, cur = [], None
    for ln, line in enumerate(open(path).read().splitlines(), 1):
        s = line.strip()
        if cur is None:
            m = re.match(r"^```+\s*rig-run(?:\s+(\S+))?\s*$", s)
            if m: cur = {"name": m.group(1) or "", "kv": {}, "line": ln}
            continue
        if s.startswith("```"): blocks.append(cur); cur = None; continue
        if not s or s.startswith("#"): continue
        m = re.match(r"^([a-z_0-9]+)\s*:\s*(.*?)\s*$", s)
        if not m: die(f"line {ln}: not `key: value`")
        k, v = m.groups()
        if k in REP: cur["kv"].setdefault(k, []).append(v)
        elif k in REQ + OPT:
            if k in cur["kv"]: die(f"line {ln}: duplicate key {k}")
            cur["kv"][k] = v
        else: die(f"line {ln}: unknown key {k}")
    if cur is not None: die("unterminated rig-run block")
    if not blocks: die("no ```rig-run block")
    if want_run is not None: blocks = [b for b in blocks if b["name"] == want_run]
    elif len(blocks) > 1: die("several rig-run blocks (" + ", ".join(b["name"] for b in blocks) + "): pass --prereg-run <name>")
    if len(blocks) != 1: die(f"no single rig-run block named {want_run!r}")
    b = blocks[0]; kv = b["kv"]
    for k in REQ:
        if not kv.get(k): die(f"missing required key {k}")

    def res(p):
        p = os.path.expanduser(p)
        if os.path.isabs(p): return p if os.path.exists(p) else die(f"no such path {p}")
        for root in (base, REPO, EXP):
            q = os.path.normpath(os.path.join(root, p))
            if os.path.exists(q): return q
        die(f"path {p} not found under the prereg dir, the repo or exp/")

    def check(p, h, what):
        if not HEX.match(h or ""): die(f"{what}: bad sha256 {h!r}")
        g = sha(p)
        if g != h: die(f"{what} sha256 MISMATCH: {p} is {g}, prereg says {h}")
        print(f"prereg: {what} sha256 ok ({os.path.basename(p)})", file=sys.stderr)

    argv = []
    lora = res(kv["lora"]); check(lora, kv["lora_sha256"], "lora"); argv += ["--lora", lora]
    if kv.get("kev"):
        kev = res(kv["kev"]); check(kev, kv.get("kev_sha256"), "kev"); argv += ["--kev", kev]
    elif kv.get("kev_sha256") or kv.get("t_kev"): die("kev_sha256 / t_kev without kev")
    st = kv["set"]
    if st == "heldout5":
        if kv.get("blind_ok") != "yes": die("set heldout5 needs `blind_ok: yes`")
        check(H5, kv.get("set_sha256"), "set heldout5"); argv += ["--set", st, "--blind-ok"]
    elif st.startswith("file:"):
        p = res(st[5:]); check(p, kv.get("set_sha256"), "set file"); argv += ["--set", "file:" + p]
    elif st in ("dev", "val"):
        if kv.get("blind_ok"): die("blind_ok only with set heldout5")
        argv += ["--set", st]
    else: die(f"bad set {st}")
    argv += ["--args", kv["args"], "--temps", kv["temps"], "--rev", kv["rev"]]
    if kv["temps"] == "explicit" and (not kv.get("t_lora") or (kv.get("kev") and not kv.get("t_kev"))):
        die("temps explicit needs t_lora (and t_kev with kev)")
    for k, f in (("t_lora", "--t-lora"), ("t_kev", "--t-kev")):
        if kv.get(k):
            try: float(kv[k])
            except ValueError: die(f"{k} not a number")
            argv += [f, kv[k]]
    for k, f in (("val_from", "--val-from"), ("dev_from", "--dev-from")):
        if kv.get(k): argv += [f, res(kv[k])]
    for spec in kv.get("exclude_match", []):
        p, sep, rid = spec.rpartition(":")
        if not sep: die(f"exclude_match {spec!r}: want <file>:<row-id>")
        argv += ["--exclude-match", res(p) + ":" + rid]
    for v in kv.get("verify", []):
        parts = v.split(None, 1)
        if len(parts) != 2: die(f"verify {v!r}: want '<sha256> <path>'")
        check(res(parts[1]), parts[0], f"verify {parts[1]}")
    ee = kv.get("expect_excluded", "")
    if ee and not ee.isdigit(): die("expect_excluded must be an integer")
    out = os.path.expanduser(kv["out"]); out = out if os.path.isabs(out) else os.path.normpath(os.path.join(base, out))
    argv += ["--out", out]
    sys.stdout.write("\0".join([got, b["name"], ee] + argv) + "\0")


if __name__ == "__main__":
    main()
