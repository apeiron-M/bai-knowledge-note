"""Close out lead sources once their claims exist.

A source left in INBOX reads as unprocessed forever; a source marked
EXTRACTED with no claims is worse, because it reads as processed and
empty. So status is driven by what actually landed: sources with at
least one registered claim go EXTRACTED, sources with none stay INBOX
and are reported, not quietly promoted.

Stats are computed from the document's own extractedClaims array — read
back from the reactor rather than from any local tally, so the numbers
describe the vault rather than our intentions.
"""
import json, sys, time, uuid, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "drive-sync"))
from lib import gql

W = "https://light-colt-c497cfbd-switchboard.vetra.io/graphql"
R = W + "/r"
MAP = Path("scripts/lead-import/id-map.json")

Q = 'query($id:String!){ document(identifier:$id){ document { ... on PHDocument { state } } } }'
MUT = 'mutation($id:String!,$actions:[JSONObject!]!){ mutateDocument(documentIdentifier:$id, actions:$actions){ documentType } }'

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

def act(t, inp):
    return {"id": str(uuid.uuid4()), "timestampUtcMs": now(), "scope": "global", "type": t, "input": inp}

def post(q, v, ep, attempts=3):
    last = None
    for i in range(attempts):
        try:
            return gql.post(q, v, endpoint=ep, timeout=90)
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last

def main():
    ids = [v for k, v in json.loads(MAP.read_text()).items() if k != "__target__"]
    closed, empty, gone, failed = 0, [], 0, []
    t0 = time.time()
    for n, sid in enumerate(ids, 1):
        try:
            st = post(Q, {"id": sid}, R)["document"]["document"]["state"]
        except Exception as e:
            if "not found" in str(e).lower():
                gone += 1        # deduplicated or header row, deleted earlier
                continue
            failed.append((sid, str(e)[:120])); continue
        if not isinstance(st, dict):
            st = json.loads(st)
        g = st["global"]
        claims = g.get("extractedClaims") or []
        if not claims:
            empty.append((sid, g.get("title", "")[:60]))
            continue
        try:
            post(MUT, {"id": sid, "actions": [act("RECORD_EXTRACTION_STATS", {
                "claimCount": len(claims), "skippedCount": 0, "skipRate": 0.0,
                "extractedAt": now(), "extractedBy": "knowledge-agent"})]}, R)
            post(MUT, {"id": sid, "actions": [act("SET_SOURCE_STATUS", {"status": "EXTRACTED"})]}, R)
            closed += 1
        except Exception as e:
            failed.append((sid, str(e)[:120]))
        if n % 50 == 0:
            print(f"  {n}/{len(ids)}  closed={closed} empty={len(empty)} gone={gone}", flush=True)
    print(f"DONE in {int(time.time()-t0)}s: {closed} EXTRACTED, {len(empty)} left INBOX (no claims), "
          f"{gone} already deleted, {len(failed)} failed")
    for sid, title in empty[:15]:
        print(f"  INBOX (no claim extracted): {title}")
    for sid, e in failed[:10]:
        print(f"  FAIL {sid}: {e}")

if __name__ == "__main__":
    main()
