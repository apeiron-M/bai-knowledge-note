import json,glob,re
from pathlib import Path
src=Path('editors/knowledge-vault/chat/core/ref-candidates.ts').read_text()
block=src[src.index('REF_EXTRACTORS'):src.index('/** Labeled candidates')]
refx={}
for m in re.finditer(r'"([\w-]+:[A-Z_]+)":\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}',block):
    paths=re.findall(r'(\w+):\s*(\w+|\()',m.group(2))
    refx[m.group(1)]={p:f for p,f in paths if p not in ('id_','label')}
# simpler: parse lines
refx={}
for line in re.findall(r'"([\w-]+:[A-Z_]+)":\s*\{(.*?)\},?\n',block,re.S):
    pass
keys=re.findall(r'"([\w-]+:[A-Z_]+)":',block)
print('REF_EXTRACTORS ops',len(set(keys)))
tot=dict(ops=0,emptydesc=0,examples=0,errors=0,reffields=0)
derived=0; derived_ops=set(); reffield_ops=set(); phid_ops=set()
enum_inputs=0; string_inputs=0
for f in sorted(glob.glob('document-models/*/*.json')):
    d=json.load(open(f)); model=d['id'].split('/')[-1]
    s=d['specifications'][-1]; st=s['state']['global']['schema']
    for mod in s['modules']:
        for op in mod['operations']:
            if op.get('scope','global')!='global': continue
            tot['ops']+=1
            if not (op.get('description') or '').strip(): tot['emptydesc']+=1
            tot['examples']+=len(op.get('examples') or []); tot['errors']+=len(op.get('errors') or [])
            sch=op['schema'] or ''; red=op['reducer'] or ''
            for fm in re.finditer(r'^\s*(\w+)\s*:\s*\[?(\w+)',sch,re.M):
                name,t=fm.groups()
                if t in ('OID','PHID') or name.endswith('Id') or name.endswith('Ref'):
                    if name=='id' and re.match(r'(ADD|CREATE)_',op['name']): continue
                    reffield_ops.add(f"{model}:{op['name']}")
                    if t=='PHID' or name.endswith('Ref'): phid_ops.add(f"{model}:{op['name']}")
                    if re.search(r'state\.[\w.]+\.(find|findIndex|filter|some|indexOf|includes)\([^;]*action\.input\.'+name+r'\b',red) or re.search(r'action\.input\.'+name+r'[^;]*state\.[\w.]+\.(find|findIndex|filter|some)',red):
                        derived_ops.add(f"{model}:{op['name']}")
                if t.endswith('Status') or t.endswith('Kind') or t.endswith('Type'): enum_inputs+=1
                if t=='String': string_inputs+=1
print(tot)
print('ops with ref-like field',len(reffield_ops),'phid/ref-named',len(phid_ops))
print('ops where reducer does state.X.find(...input.field)',len(derived_ops))
alias={'wbs':'work-breakdown-structure'}
rx=set(keys)
print('REF_EXTRACTORS covered by reducer-derivation',len(rx&derived_ops),'of',len(rx))
print('REF_EXTRACTORS among ref-like', len(rx&reffield_ops))
print('not derivable:',sorted(rx-derived_ops))
print('enum-ish inputs',enum_inputs,'String inputs',string_inputs)
