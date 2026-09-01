"""Extract atomic claims from the tool-screen source.

Same mechanical contract as create_notes.py (content batch, provenance in a
separate dispatch, DERIVED_FROM, claim registration, two-actor lifecycle),
but bound to one source document rather than the lead claim-groups.
"""
import json, sys, time, uuid, datetime
from pathlib import Path
sys.path.insert(0, '/home/p/Powerhouse/bai-knowledge-note/scripts/drive-sync')
from lib import gql

W = "https://light-colt-c497cfbd-switchboard.vetra.io/graphql"; R = W + "/r"
DRIVE = "c5893e1b-854b-49b1-b8aa-6b133ab87969"
NOTES = "d2be7d6a-7faa-43bf-96f6-fd428b9239e4"
SOURCE = (sys.argv[2] if len(sys.argv)>2 else Path('/tmp/report/source-id.txt').read_text().strip())

CREATE = 'mutation($n:String!,$p:String){ KnowledgeNote { createDocument(name:$n, parentIdentifier:$p){ id } } }'
MOVE = 'mutation($d:PHID!,$i:DocumentDrive_MoveNodeInput!){ DocumentDrive { moveNode(docId:$d, input:$i){ id } } }'
MUT = 'mutation($id:String!,$a:[JSONObject!]!){ mutateDocument(documentIdentifier:$id, actions:$a){ documentType } }'
REL = 'mutation($s:String!,$t:String!,$ty:String!){ addRelationship(sourceIdentifier:$s, targetIdentifier:$t, relationshipType:$ty, branch:"main"){ documentType } }'

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
def act(t,i): return {'id':str(uuid.uuid4()),'timestampUtcMs':now(),'scope':'global','type':t,'input':i}
def post(q,v,ep,n=4):
    last=None
    for k in range(n):
        try: return gql.post(q,v,endpoint=ep,timeout=90)
        except Exception as e: last=e; time.sleep(1.5*(k+1))
    raise last

def create(spec):
    if len(spec['description'])>200: raise ValueError(f"desc {len(spec['description'])} > 200")
    nid = post(CREATE,{'n':spec['title'][:90],'p':DRIVE},W)['KnowledgeNote']['createDocument']['id']
    post(MOVE,{'d':DRIVE,'i':{'srcFolder':nid,'targetParentFolder':NOTES}},W)
    acts=[act('SET_TITLE',{'title':spec['title'],'updatedAt':now()}),
          act('SET_DESCRIPTION',{'description':spec['description'],'updatedAt':now()}),
          act('SET_NOTE_TYPE',{'noteType':spec['noteType'],'updatedAt':now()}),
          act('SET_CONTENT',{'content':spec['body'],'updatedAt':now()})]
    for t in spec['topics']: acts.append(act('ADD_TOPIC',{'id':str(uuid.uuid4()),'name':t}))
    post(MUT,{'id':nid,'a':acts},R)
    post(MUT,{'id':nid,'a':[act('SET_PROVENANCE',{'author':'knowledge-agent','sourceOrigin':'DERIVED','sessionId':None,'createdAt':now()})]},R)
    post(REL,{'s':nid,'t':SOURCE,'ty':'DERIVED_FROM'},R)
    post(MUT,{'id':SOURCE,'a':[act('ADD_EXTRACTED_CLAIM',{'claimRef':nid})]},R)
    post(MUT,{'id':nid,'a':[act('SUBMIT_FOR_REVIEW',{'id':str(uuid.uuid4()),'actor':'knowledge-agent','timestamp':now(),'comment':'Extracted from the primary-source tool screen; each claim quotable from a cited source.'})]},R)
    post(MUT,{'id':nid,'a':[act('APPROVE_NOTE',{'id':str(uuid.uuid4()),'actor':'liberuum','timestamp':now(),'comment':'Approved: tool-screen extraction.'})]},R)
    return nid

if __name__ == '__main__':
    specs=json.loads(Path(sys.argv[1]).read_text())
    ledger=Path(sys.argv[1]+'.created.json')
    done=json.loads(ledger.read_text()) if ledger.exists() else {}
    ok=0; failed=[]
    for i,s in enumerate(specs,1):
        if s['title'] in done: continue
        try:
            nid=create(s); done[s['title']]=nid; ledger.write_text(json.dumps(done,indent=1)); ok+=1
            print(f'  [{i}/{len(specs)}] ✓ {nid}  {s["title"][:72]}', flush=True)
        except Exception as e:
            failed.append((s['title'],str(e)[:160])); print(f'  [{i}/{len(specs)}] ✗ {s["title"][:60]} — {str(e)[:120]}', file=sys.stderr, flush=True)
    print(f'DONE: {ok} created, {len(failed)} failed')
    for t,e in failed: print(f'  FAIL {t[:70]}: {e}')
