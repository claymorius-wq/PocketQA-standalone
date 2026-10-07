#!/usr/bin/env python3
"""Merges parts/*.json into results.json and checklist.md (python3 docs/reviews/full-e2e/assemble.py)."""
import glob, json, os, collections
H = os.path.dirname(os.path.abspath(__file__))
rows = []
for f in sorted(glob.glob(os.path.join(H, 'parts', '*.json'))):
    owner = os.path.basename(f)[:-5]
    for r in json.load(open(f)):
        r['owner'] = owner
        rows.append(r)
ids = collections.Counter(r['id'] for r in rows)
assert not [i for i, n in ids.items() if n > 1], 'duplicate ids'
ok = {'PASS', 'FAIL', 'BLOCKED', 'NOT OFFERED', 'NOT RUN', 'NOTE'}  # NOTE = informational, never a result
assert all(r['status'] in ok for r in rows), 'bad status'
assert all(r.get('environment') for r in rows), 'missing environment'
json.dump({'generated_from': 'parts/*.json', 'rows': rows}, open(os.path.join(H, 'results.json'), 'w'), indent=1, ensure_ascii=False)
by = collections.Counter(r['status'] for r in rows)
env = collections.Counter(r['environment'] for r in rows)
out = ['# Full E2E acceptance: checklist', '', 'Generated from `parts/*.json` by `assemble.py`; `results.json` holds every field. Status counts: ' + ', '.join(f'{k} {v}' for k, v in sorted(by.items())) + '. By environment: ' + ', '.join(f'{k} {v}' for k, v in sorted(env.items())) + '.', 'Original-FAIL convention: H-33 and P-13 keep their FAIL status as the historical observation, with the fix/verification in the row and the superseding row (H-34; P-13 pending device re-verification); E-24, E-25, E-27, E-08, C-07 and L-16 read "Was FAIL -> fixed" in their observed text with the fix evidence. Statuses: PASS / FAIL / BLOCKED / NOT OFFERED / NOT RUN; NOTE = informational, never a result.', '']
for area in sorted({r['area'] for r in rows}):
    out += [f'## {area}', '', '| id | status | env | title | observed | evidence |', '|---|---|---|---|---|---|']
    for r in [x for x in rows if x['area'] == area]:
        cell = lambda s: str(s).replace('|', '\\|').replace('\n', ' ')
        out.append(f"| {r['id']} | **{r['status']}** | {r['environment']} | {cell(r['title'])} | {cell(r['observed'])[:600]} | {cell(', '.join(r.get('evidence') or []))[:300]} |")
    out.append('')
open(os.path.join(H, 'checklist.md'), 'w').write('\n'.join(out))
print(len(rows), dict(by))
