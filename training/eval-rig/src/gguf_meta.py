"""Stdlib GGUF metadata reader. python3 gguf_meta.py <gguf> [key-suffix]
Prints the value of the first key ending in key-suffix (default: decision.temperature.choice, Kev's served
choice temperature = decide.mjs --servedT), as repr(float) so f32 round-trips (2.3510959148406982)."""
import struct, sys
SCALAR = {0: "<B", 1: "<b", 2: "<H", 3: "<h", 4: "<I", 5: "<i", 6: "<f", 7: "<?", 10: "<Q", 11: "<q", 12: "<d"}
def read(path):
    f = open(path, "rb")
    assert f.read(4) == b"GGUF", "not a GGUF"
    ver, = struct.unpack("<I", f.read(4)); assert ver >= 2
    _, nkv = struct.unpack("<QQ", f.read(16))
    def s():
        n, = struct.unpack("<Q", f.read(8)); return f.read(n).decode("utf8", "replace")
    def val(t):
        if t in SCALAR:
            fmt = SCALAR[t]; return struct.unpack(fmt, f.read(struct.calcsize(fmt)))[0]
        if t == 8: return s()
        if t == 9:
            et, n = struct.unpack("<IQ", f.read(12)); return [val(et) for _ in range(n)]
        raise ValueError(f"gguf type {t}")
    kv = {}
    for _ in range(nkv):
        k = s(); t, = struct.unpack("<I", f.read(4)); kv[k] = val(t)
    return kv
if __name__ == "__main__":
    suffix = sys.argv[2] if len(sys.argv) > 2 else "decision.temperature.choice"
    kv = read(sys.argv[1])
    hit = [k for k in kv if k.endswith(suffix)]
    if not hit: sys.exit(f"no key *{suffix} in {sys.argv[1]}")
    print(repr(kv[hit[0]]))
