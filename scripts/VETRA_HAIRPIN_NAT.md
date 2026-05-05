# Bug: switchboard pods can't reach their own package CDN (hairpin NAT)

## Summary

A switchboard pod running in a vetra deployment cannot resolve and connect
to assets served from `registry.dev.vetra.io` (or the same-cluster
switchboard / connect hostnames) because the hostnames resolve to the
cluster's *external* load-balancer IP, and Hetzner's networking does not
hairpin packets back to the same node. Any package that fetches its own
shipped assets at runtime via `https://registry.dev.vetra.io/-/cdn/...`
will eventually fail.

## Environment

- Cluster: `eager-hen-55-12679321` (Hetzner-based k3s, autoscaled)
- Switchboard image: `cr.vetra.io/powerhouse-inc-powerhouse/switchboard:v6.0.0-dev.213`
- Affected package: `@powerhousedao/knowledge-note@1.0.25` (likely any package
  that loads runtime assets from the same-origin CDN)

## Symptom

GraphQL resolver returns `INTERNAL_SERVER_ERROR` with:
```
connect ETIMEDOUT 138.199.129.93:443
```
Where `138.199.129.93` resolves to:
- `registry.dev.vetra.io`
- `switchboard.eager-hen-55.vetra.io`
- `connect.eager-hen-55.vetra.io`

i.e. the timeout target *is* the same external IP that fronts the cluster
the pod is running in.

## Trigger

For our package specifically, search resolvers (`knowledgeGraphSemanticSearch`,
`knowledgeGraphHybridSearch`) call `generateEmbedding(args.query)`, which
on first call fetches the embedding model files and `onnxruntime-web`'s
WASM helper from the package's own CDN URL space. If the embedder is
already in memory (e.g. immediately after pod boot when init succeeded),
search works. After a SIGTERM / pod restart wipes process memory, the
fresh init has to re-fetch — and that's when ETIMEDOUT surfaces.

In our logs we observed:

1. Pod 1 starts, embedder init succeeds → reindex of 375 docs completes successfully.
2. Pod 1 receives SIGTERM (rolling deploy / readiness flip / k8s eviction).
3. Pod 2 starts, registers subgraph + processor.
4. First search request to Pod 2 → embedder tries to fetch model files
   from `registry.dev.vetra.io` → ETIMEDOUT.

Pod-to-public-CDN traffic for *external* hosts works fine — only the loop
back to the cluster's own external IP is broken.

## Reproduction (one command, from inside any switchboard pod)

```bash
kubectl exec -n eager-hen-55-12679321 \
  deploy/powerhouse-eager-hen-55-12679321-switchboard -- \
  curl -v --max-time 10 \
  https://registry.dev.vetra.io/-/cdn/@powerhousedao/knowledge-note@1.0.25/node/models/Supabase/gte-small/config.json
```

Expected on broken cluster: `curl: (28) Connection timed out after 10000 milliseconds`.

For comparison, an external host should succeed from the same pod:
```bash
kubectl exec -n eager-hen-55-12679321 \
  deploy/powerhouse-eager-hen-55-12679321-switchboard -- \
  curl -v --max-time 10 https://huggingface.co/
```

If the first fails and the second succeeds, the diagnosis is confirmed.

## Why this matters beyond this one package

Any reactor package that uses the standard pattern of *shipping runtime
assets in dist/ and letting code resolve them via `import.meta.url`* will
eventually trip this. Examples:

- ML packages bundling models / WASM runtimes (this package, future
  semantic search / OCR / NLP packages)
- Packages with `wasm-bindgen` artifacts
- Packages using PGlite extensions (every `.tar.gz` extension load goes
  through `new URL("../ext.tar.gz", import.meta.url)`)

The pattern is correct — assets sitting next to the JS chunks is the
canonical way to ship runtime resources in npm packages. The bug is
that the cluster's network policy makes "next to the JS chunks" mean
"on a host you can't reach from inside."

## Suggested fixes (vetra side, pick one)

### Option A: hostAliases on the switchboard Deployment

Add a `hostAliases` entry that maps `registry.dev.vetra.io` (and any
other `*.vetra.io` hostnames the pod might reach) to the cluster's
internal load-balancer / ingress controller IP:

```yaml
spec:
  template:
    spec:
      hostAliases:
        - ip: "<internal-ingress-cluster-ip>"
          hostnames:
            - "registry.dev.vetra.io"
            - "switchboard.eager-hen-55.vetra.io"
            - "connect.eager-hen-55.vetra.io"
```

Pros: surgical, no cluster-wide DNS change.
Cons: needs to be applied per env / per cluster.

### Option B: CoreDNS rewrite / NodeLocal DNS override

In CoreDNS / NodeLocal DNS config for the cluster, add a rewrite so that
queries for `*.vetra.io` from inside the cluster return the internal
ingress IP instead of the public LB IP:

```
rewrite name regex (.*)\.vetra\.io $1.vetra.io.cluster.local
```

(or a `hosts` plugin entry pinning the names to the internal IP).

Pros: applies cluster-wide; any future package hits the right IP automatically.
Cons: cluster-wide DNS changes need careful testing.

### Option C: Enable hairpin NAT at the Hetzner LB

If the LB / kube-proxy supports it, enable hairpin mode so traffic from a
pod to the cluster's external IP gets routed back to the right backend
instead of black-holing.

This may not be configurable on Hetzner-managed LBs — depends on whether
you're using their L4 LB or an in-cluster ingress (nginx / Traefik with
`externalTrafficPolicy: Cluster`).

## Workaround on the package side (already in place, partial)

We've already pushed everything we reasonably can into the package's
`dist/` and configured runtime to fetch from same-origin URLs computed
from `import.meta.url`. Once the cluster-side fix is in, the existing
package shape will Just Work — no further code changes needed on our
side.

The only package-side mitigation that would help today is to pre-warm
the embedder synchronously at pod startup so the in-memory cache is
populated before a search ever lands. That doesn't fix anything; it
just shifts which request is the one that times out (every restart
becomes an opportunity for a 30 s blocked startup that may still fail).

We'd rather not ship that workaround — it's strictly worse than fixing
the underlying networking.
