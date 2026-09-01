"""Create one bai/source per lead row, preserving every CSV field verbatim.

A lead is a RECORD, not a claim, so it lands as a source: the model is
built for exactly this (raw material + extractedClaims + extractionStats +
provenance). Atomic claims are extracted from it in a second pass, so the
notes stay connectable while no lead detail is lost.

Sources are left in INBOX. Phase 2 sets EXTRACTED once claims exist —
a source that reads EXTRACTED with no claims is indistinguishable from
one that was never processed.

Resumable: id-map.json records row -> source id, stamped with the target
so it can never be replayed against a different reactor.
"""
import csv, hashlib, json, sys, time, uuid, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "drive-sync"))
from lib import gql

CSV = Path("Leads, tools and demos 3c01f4740a7f80e199d3f6f63373dbfe_all.csv")
W = "https://light-colt-c497cfbd-switchboard.vetra.io/graphql"
R = W + "/r"
DRIVE = "c5893e1b-854b-49b1-b8aa-6b133ab87969"
SOURCES_FOLDER = "b41d7ff0-a67d-4abf-86f6-a2fe75bb5b9c"
MAP = Path("scripts/lead-import/id-map.json")
TARGET = f"{W}#{DRIVE}"

FIELD_ORDER = ["company", "tool", "priority", "geo", "principal", "email", "website",
               "tool_url", "impressum_url", "contact_verified", "headcount", "hq",
               "owner_parent", "tech_partners", "federation", "posture", "tier",
               "verdict", "flag", "source", "powerhouse_fit", "demo_scenario"]

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

def load_rows():
    with open(CSV, newline="", encoding="utf-8-sig") as fh:
        return [{k: (v or "").strip() for k, v in r.items()} for r in csv.DictReader(fh)]

def file_hash():
    return hashlib.sha256(CSV.read_bytes()).hexdigest()

def render(row):
    """Every field, in a stable order, empties shown as em-dash.

    Rendering absent fields explicitly rather than omitting them keeps
    "we did not record this" distinguishable from "this field did not
    exist", which matters when the sparse fields (email 12%, principal
    13%) are exactly the ones a reader will look for.
    """
    lines = [f"# {row['company']} — {row['tool'] or 'no tool recorded'}", ""]
    lines.append("## Lead record")
    for k in FIELD_ORDER:
        v = row.get(k, "")
        lines.append(f"- **{k}**: {v if v else '—'}")
    extra = [k for k in row if k not in FIELD_ORDER]
    for k in extra:
        lines.append(f"- **{k}**: {row[k] if row[k] else '—'}")
    return "\n".join(lines)

def describe(row):
    bits = [f"Lead: {row['company']}"]
    if row["geo"]:
        bits.append(f"({row['geo']})")
    if row["tool"]:
        bits.append(f"on {row['tool']}")
    d = " ".join(bits)
    if row["priority"]:
        d += f"; priority {row['priority']}"
    return d[:200]

class Map:
    def __init__(self, path, target):
        self.path = Path(path)
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {}
        stored = self.data.pop("__target__", None)
        if stored and stored != target:
            raise SystemExit(f"{path} was built against {stored}, not {target}")
        self.target = target
    def get(self, k): return self.data.get(k)
    def set(self, k, v):
        self.data[k] = v
        payload = dict(self.data); payload["__target__"] = self.target
        self.path.write_text(json.dumps(payload, indent=2))

def post(query, variables, endpoint, attempts=4):
    last = None
    for i in range(attempts):
        try:
            return gql.post(query, variables, endpoint=endpoint, timeout=90)
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last

CREATE = 'mutation($name:String!,$parent:String){ Source { createDocument(name:$name, parentIdentifier:$parent){ id } } }'
MOVE = 'mutation($docId:PHID!,$input:DocumentDrive_MoveNodeInput!){ DocumentDrive { moveNode(docId:$docId, input:$input){ id } } }'
MUT = 'mutation($id:String!,$actions:[JSONObject!]!){ mutateDocument(documentIdentifier:$id, actions:$actions){ documentType } }'

def main():
    rows = load_rows()
    fh = file_hash()
    m = Map(MAP, TARGET)
    print(f"leads: {len(rows)} | csv sha256: {fh[:16]} | already imported: {len(m.data)}", flush=True)
    ok, failed = 0, []
    t0 = time.time()
    for i, row in enumerate(rows):
        key = str(i)
        if m.get(key):
            continue
        title = f"{row['company']} — {row['tool']}" if row["tool"] else row["company"]
        name = title[:90]
        try:
            new_id = post(CREATE, {"name": name, "parent": DRIVE}, W)["Source"]["createDocument"]["id"]
            post(MOVE, {"docId": DRIVE, "input": {"srcFolder": new_id,
                        "targetParentFolder": SOURCES_FOLDER}}, W)
            action = {"id": str(uuid.uuid4()), "timestampUtcMs": now_iso(), "scope": "global",
                      "type": "INGEST_SOURCE",
                      "input": {"title": title, "content": render(row),
                                "sourceType": "MANUAL_ENTRY",
                                "description": describe(row),
                                "url": row["website"] or row["tool_url"] or None,
                                "author": row["principal"] or None,
                                "method": f"csv row {i + 1}/{len(rows)} sha256:{fh[:16]}",
                                "tool": "lead-import",
                                "createdAt": now_iso(),
                                "createdBy": "knowledge-agent"}}
            post(MUT, {"id": new_id, "actions": [action]}, R)
            m.set(key, new_id)
            ok += 1
        except Exception as e:
            failed.append((i, row["company"], str(e)[:150]))
        if (i + 1) % 25 == 0:
            print(f"  {i+1}/{len(rows)}  ok={ok} failed={len(failed)}  {int(time.time()-t0)}s", flush=True)
    print(f"DONE: {ok} created, {len(failed)} failed in {int(time.time()-t0)}s")
    for i, c, e in failed[:10]:
        print(f"  FAIL row {i+1} {c}: {e}")

if __name__ == "__main__":
    main()
