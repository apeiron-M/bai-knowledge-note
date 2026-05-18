# dev.248 atomic-storage backend writes ~5 GB per `createDocument` and runs ~40× slower than dev.246

**Affected package:** `@powerhousedao/reactor`
**Observed version:** `6.0.0-dev.248`
**Last known-good version:** `6.0.0-dev.246` (same workload completed in ~3–4 min with no crashes)
**Environment:** local `ph vetra --watch` on WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2), ext4
**Suspected cause:** the dev.247/.248 commits

```
refactor: switch everything from nodefs to atomic storage
feat(pglite-fs): implemented a fs-backed pglite backend with in-memory WAL
chore: adding pglite package to build and test scripts
```

---

## Summary

`createDocument` is **~40× slower** on dev.248 than on dev.246, and the per-doc write traffic is in the **gigabyte range** for an operation that should write tens of kilobytes. The import flow we relied on (407 docs created in 3–4 min on dev.246) is currently **unusable** on dev.248: extrapolating from the 38-doc/187-GB snapshot, completing the full 407-doc upload would write ~2 TB to disk and take an estimated 1–2 hours.

Key measurement: `/proc/<vetra-pid>/io` reports `write_bytes ≈ 187 GB` after ~38 successful `createDocument` calls — roughly **5 GB written to disk per document**. dev.246 fit the same workload in tens of MB total.

The same script and same vault data (no application code changed; only the `@powerhousedao/*` deps were bumped) was producing ~500 ms `createDocument` calls on dev.246. On dev.248 it is consistently ~15–20 s per call.

## Repro

1. `ph use dev` (lands on dev.248 today)
2. `rm -rf .ph && ph vetra --watch` (fresh storage)
3. Run any bulk-upload script that issues serial `createDocument` mutations. We use [`scripts/drive-sync/upload.py`](../../scripts/drive-sync/upload.py) which posts the namespaced `KnowledgeNote { createDocument(name, parentIdentifier) }` mutation 407 times.
4. Observe each `createDocument` taking ~15–20 s instead of the prior ~500 ms.
5. Watch `/proc/<vetra-pid>/io` over time — `write_bytes` grows on the order of GB per `createDocument`.

## Smoking gun — vetra's I/O counters

After ~38 successful `createDocument` calls early in a fresh run:

```
$ cat /proc/$(pgrep -f 'node.*vetra' | head -1)/io
rchar:                256032856              ≈ 244 MB read
wchar:                187874665442           ≈ 175 GB written (userspace)
syscr:                12579024
syscw:                12569379               ≈ 12.5 M write syscalls
read_bytes:           0
write_bytes:          187779846144           ≈ 175 GB actually flushed to disk
cancelled_write_bytes: 8192
```

**~5 GB written to disk per `createDocument`.** With ~7 sync points per create on the reactor path (CREATE op → UPGRADE op → state row → indexer row → operation index → outbox state → drive `nodes[]` mutation), each individual sync is averaging **~700 MB of write traffic**. That's not appending an op — that's rewriting the entire backing file.

## Root cause (confirmed in source)

The new storage backend lives in `@powerhousedao/pglite-fs@6.0.0-dev.248`. Its own class docstring is the admission:

```js
// node_modules/@powerhousedao/pglite-fs/dist/index.js
/**
 * PGLite Filesystem that holds the working data dir in Emscripten MEMFS and
 * atomically swaps a single-file on-disk snapshot on every `syncToFs`. A SIGKILL
 * mid-write leaves the previous snapshot intact, so the next startup loads
 * cleanly rather than aborting on torn WAL.
 *
 * Intended for local dev use — full-tree snapshots per non-transactional
 * query are fine at dev volume but won't scale to production write rates.
 */
var AtomicNodeFs = class extends MemoryFS {
  async syncToFs(relaxedDurability) {
    const bytes = serializeMemfs(memFs, PGDATA);   // serialises ENTIRE FS tree
    const fh = await promises.open(tmpPath, "w");
    await fh.write(bytes);                          // full snapshot to temp
    if (!relaxedDurability) await fh.sync();        // fsync temp
    await fh.close();
    await promises.rename(tmpPath, snapPath);       // atomic rename
    // + directory fsync
  }
};
```

Every call to `syncToFs()` walks the full MEMFS tree, serializes it into one blob, writes it to `snapshot.bin.tmp`, `fsync`s, atomically renames over `snapshot.bin`, and `fsync`s the directory. The reactor's commit lifecycle calls `syncToFs()` multiple times per `createDocument` (CREATE op → UPGRADE op → state row → indexer rows → outbox state → drive `nodes[]` mutation → etc.), and each one rewrites the entire snapshot from scratch.

The author flagged the limitation explicitly in the docstring ("Intended for local dev use … won't scale to production write rates"). The `refactor: switch everything from nodefs to atomic storage` commit nonetheless made this the default backend, so every dev.248 instance pays this cost.

## On-disk evidence

The entire reactor state lives in **two binary snapshot files**:

```
$ du -sh .ph/*/snapshot.bin
32M     .ph/reactor-storage/snapshot.bin
29M     .ph/read-storage/snapshot.bin
```

There is **no append-only log, no WAL on disk** — just two `snapshot.bin` files that hold everything (op log + state + indexer projection + outbox state). That means every commit rewrites at least one of these files from scratch via the standard **write-temp + fsync + rename** atomic-replace pattern.

Per-`createDocument` cost is therefore proportional to **current snapshot size**, not delta size:

| After N docs | Snapshot size | Per-doc cost (~5 commits per doc) | Cumulative writes |
|---|---|---|---|
| 10  | ~800 KB | ~4 MB    | ~40 MB |
| 50  | ~4 MB   | ~20 MB   | ~500 MB |
| 100 | ~8 MB   | ~40 MB   | ~2 GB |
| 200 | ~16 MB  | ~80 MB   | ~8 GB |
| 400 | ~32 MB  | ~160 MB  | ~32 GB |

This is **O(N²)** write traffic. The 187 GB we observed at N=38 is even higher than this model predicts, which suggests:
- More than 5 sync points per `createDocument` (probably 7–10 — CREATE op, UPGRADE op, doc state, indexer node row, operation_index row, outbox state, drive `nodes[]` mutation, etc.)
- Filesystem journaling roughly doubling the actual disk write traffic on top of userspace writes
- Possibly the write-temp file itself being a full copy of the snapshot before rename

dev.246's `nodefs` backend almost certainly used **append-only writes** (standard SQLite WAL approach) — each commit appends one op and fsyncs only the new bytes. That's O(N), and matches the ~3-min wall-clock we measured then for the same 407-doc workload.

On Linux/WSL2 with a slow underlying filesystem, the O(N²) traffic manifests as 15–20 s per `createDocument`. On Linux with NVMe, the slowdown is still O(N²) but the constant factor is small enough to be tolerable up to a few hundred docs. On macOS the situation is similar to WSL2 (HFS+/APFS atomic-rename has comparable overhead).

## What's NOT the cause (ruled out)

- ✗ Not our import-script code — `gql.py` is unchanged from dev.246, where it ran fine.
- ✗ Not concurrency from us — the upload is strictly serial (one createDocument outstanding at a time).
- ✗ Not contention from another tool — we verified switchboard-cli wasn't running for the run that produced 187 GB.
- ✗ Not the WSL2 disk in general — `dd if=/dev/zero of=/home/p/test bs=1M count=1000 oflag=sync` runs at ~400 MB/s, and dev.246 on the same WSL2 box completes the same upload in ~3–4 min.
- ✗ Not GraphQL parsing or HTTP overhead — vetra's `__typename` ping returns in ~70 ms throughout.
- ✗ Not first-call PGlite cold-start — the slowness is constant per createDocument, not front-loaded.

## Suggested investigation paths

1. **Profile a single `createDocument` against the new backend.** How many `fsync` syscalls? How many bytes per sync? Compare to dev.246.
2. **If the backend is doing full-file snapshots on commit**, switch to append-only journaling — the standard SQLite WAL pattern is `append + fsync` on commit, with periodic checkpointing.
3. **Test on a non-WSL2 Linux box.** WSL2's fsync is notoriously slow (5–50× of native ext4). If the 5 GB/doc number reproduces there too, the issue is purely in the storage layer. If it doesn't, the issue is fsync amplification × WSL2.
4. **Add a vetra startup flag to opt back into the dev.246 nodefs backend** until the atomic-storage backend is tuned. This would unblock testers without forcing a downgrade of the full reactor stack.

## Impact on `bai-knowledge-note`

We can't run a full local upload on dev.248 — it would take an estimated 1–2 hours (assuming no crash) and write ~2 TB to disk for 407 docs. Practical work continues on dev.246 until this is fixed.

Two pending pieces of work that depend on a working local reactor:
- Validating an upload-script rewrite (concurrent dispatch + aliased-mutation batching) we're currently designing — no benchmark possible while the underlying reactor is 40× slower.
- Reproducing the upstream sync-envelope bug ([reactor-dev244-split-envelope-fix-incomplete.md](./reactor-dev244-split-envelope-fix-incomplete.md)).

## Environment

- OS: Linux 6.6.87.2-microsoft-standard-WSL2
- Filesystem: ext4 on a virtio-blk disk (WSL2 backing VHDX)
- Node: 24.15.0
- Reactor / Switchboard / Connect: all on `6.0.0-dev.248`
- ph-cli / ph-cmd: `6.0.0-dev.248`
- bun: 1.3.14
