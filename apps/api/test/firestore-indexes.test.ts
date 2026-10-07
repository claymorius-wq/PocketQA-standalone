import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Plan r2 §R7: the Firestore emulator doesn't enforce composite indexes, so a query that needs one
 * passes every emulator test and then fails hosted with FAILED_PRECONDITION. This static test
 * extracts every query chain (`.where(...)` / `.orderBy(...)`) from the server source, so no query
 * can be left undeclared, and checks each one is served by single-field indexes or has a matching
 * composite index in firestore.indexes.json. It also checks every declared composite index is used
 * and the TTL policies the core repository relies on are declared.
 */

const API = join(__dirname, '..');
const ROOT = join(API, '..', '..');
const SRC = join(API, 'src');

type Where = { field: string; op: string };
type OrderBy = { field: string; direction: 'ASCENDING' | 'DESCENDING' };
type Query = { file: string; collection: string; wheres: Where[]; orderBys: OrderBy[]; text: string };
type IndexField = { fieldPath: string; order?: 'ASCENDING' | 'DESCENDING' };
type Index = { collectionGroup: string; queryScope: string; fields: IndexField[] };
type FieldOverride = { collectionGroup: string; fieldPath: string; ttl?: boolean; indexes: unknown[] };

const EQUALITY = new Set(['==', 'in', 'array-contains', 'array-contains-any']);
const RANGE = new Set(['<', '<=', '>', '>=', '!=', 'not-in']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

/** Comments removed and chains joined onto one line, so a multi-line chain is one match. */
function normalise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    .replace(/\s*\n\s*\./g, '.');
}

const ARGS = String.raw`\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)`;
// The base is never itself a where/orderBy call, so a multi-call chain is matched as one query.
const IDENT = String.raw`(?!(?:where|orderBy)\b)[A-Za-z_$][\w$]*`;
const CHAIN = new RegExp(String.raw`((?:${IDENT}\.)*${IDENT}(?:${ARGS})?)((?:\.(?:where|orderBy)${ARGS})+)`, 'g');
const CALL = new RegExp(String.raw`\.(where|orderBy)(${ARGS})`, 'g');
const STR = /'([^']*)'|"([^"]*)"/g;

/** The collection a chain's base expression refers to, or null if it can't be resolved. */
function collectionOf(base: string, src: string): string | null {
  const lit = /collection\(\s*['"]([^'"]+)['"]\s*\)$/.exec(base);
  if (lit) return lit[1]!;
  const viaConst = /collection\(\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\)$/.exec(base);
  if (viaConst) {
    // e.g. `fs.collection(C.escrowFundings)` with `const C = { escrowFundings: 'escrowFundings', ... }`.
    const m = new RegExp(String.raw`\b${viaConst[2]}\s*:\s*['"]([^'"]+)['"]`).exec(src);
    return m ? m[1]! : null;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(base)) {
    // A variable bound to a collection: `const studies = fs.collection('studies')`.
    const m = new RegExp(String.raw`\b(?:const|let)\s+${base}\s*=\s*[\w$.]*collection\(\s*['"]([^'"]+)['"]\s*\)`).exec(src);
    return m ? m[1]! : null;
  }
  return null;
}

function queriesIn(file: string): Query[] {
  const raw = readFileSync(file, 'utf8');
  if (!/firebase-admin\/firestore|firestore\/tx/.test(raw)) return [];
  const src = normalise(raw);
  const out: Query[] = [];
  for (const m of src.matchAll(CHAIN)) {
    const [text, base, calls] = m as unknown as [string, string, string];
    const wheres: Where[] = [];
    const orderBys: OrderBy[] = [];
    for (const c of calls.matchAll(CALL)) {
      const strings = [...c[2]!.matchAll(STR)].map((s) => s[1] ?? s[2]!);
      if (c[1] === 'where') wheres.push({ field: strings[0]!, op: strings[1]! });
      else orderBys.push({ field: strings[0]!, direction: strings[1] === 'desc' ? 'DESCENDING' : 'ASCENDING' });
    }
    out.push({ file: relative(API, file), collection: collectionOf(base, src) ?? `?${base}`, wheres, orderBys, text: text.slice(0, 160) });
  }
  return out;
}

/** The composite index a query needs (equality fields in query order, then range, then orderBy), or null. */
function requiredIndex(q: Query): IndexField[] | null {
  const fields = new Set([...q.wheres.map((w) => w.field), ...q.orderBys.map((o) => o.field)]);
  if (fields.size <= 1) return null; // single-field index (automatic)
  const equalityOnly = q.orderBys.length === 0 && q.wheres.every((w) => w.op === '==');
  if (equalityOnly) return null; // Firestore merges single-field indexes for equality-only queries
  const eq = [...new Set(q.wheres.filter((w) => EQUALITY.has(w.op)).map((w) => w.field))];
  const range = [...new Set(q.wheres.filter((w) => RANGE.has(w.op)).map((w) => w.field))];
  const order: IndexField[] = [];
  for (const r of range) {
    const o = q.orderBys.find((x) => x.field === r);
    order.push({ fieldPath: r, order: o?.direction ?? 'ASCENDING' });
  }
  for (const o of q.orderBys) if (!range.includes(o.field) && !eq.includes(o.field)) order.push({ fieldPath: o.field, order: o.direction });
  return [...eq.map((f) => ({ fieldPath: f, order: 'ASCENDING' as const })), ...order];
}

/** Equality fields may come in any order in the index; range and orderBy fields must follow, in order. */
function serves(index: Index, collection: string, need: IndexField[], eqCount: number): boolean {
  if (index.collectionGroup !== collection || index.queryScope !== 'COLLECTION' || index.fields.length !== need.length) return false;
  const eqNeed = new Set(need.slice(0, eqCount).map((f) => f.fieldPath));
  const eqHave = index.fields.slice(0, eqCount);
  if (!eqHave.every((f) => eqNeed.has(f.fieldPath) && (f.order ?? 'ASCENDING') === 'ASCENDING')) return false;
  return need.slice(eqCount).every((f, i) => index.fields[eqCount + i]!.fieldPath === f.fieldPath && index.fields[eqCount + i]!.order === f.order);
}

const config = JSON.parse(readFileSync(join(ROOT, 'firestore.indexes.json'), 'utf8')) as { indexes: Index[]; fieldOverrides: FieldOverride[] };
const queries = sourceFiles(SRC).flatMap(queriesIn);
const eqCountOf = (q: Query) => new Set(q.wheres.filter((w) => EQUALITY.has(w.op)).map((w) => w.field)).size;

describe('Firestore index coverage (plan r2 §R7)', () => {
  it('finds the queries of every Firestore domain repository', () => {
    const files = new Set(queries.map((q) => q.file));
    for (const domain of ['core', 'studies', 'evidence', 'escrow']) expect(files).toContain(`src/repo/${domain}/firestore.ts`);
    expect(queries.length).toBeGreaterThan(20);
  });

  it('every query resolves to a collection', () => {
    expect(queries.filter((q) => q.collection.startsWith('?')).map((q) => `${q.file}: ${q.text}`)).toEqual([]);
  });

  it('every query is single-field, equality-only, or has a matching composite index', () => {
    const missing = queries.flatMap((q) => {
      const need = requiredIndex(q);
      if (!need || config.indexes.some((i) => serves(i, q.collection, need, eqCountOf(q)))) return [];
      return [`${q.file}: ${q.collection} needs (${need.map((f) => `${f.fieldPath} ${f.order}`).join(', ')}) for ${q.text}`];
    });
    expect(missing).toEqual([]);
  });

  it('every declared composite index serves at least one query (no unused write cost)', () => {
    const unused = config.indexes.filter(
      (i) => !queries.some((q) => {
        const need = requiredIndex(q);
        return need !== null && serves(i, q.collection, need, eqCountOf(q));
      }),
    );
    expect(unused).toEqual([]);
  });

  it('the TTL policies the core repository relies on are declared (expired records removed by Firestore)', () => {
    const core = readFileSync(join(SRC, 'repo', 'core', 'firestore.ts'), 'utf8');
    for (const collection of ['idempotency', 'rateLimits']) {
      expect(core).toContain(`collection('${collection}')`);
      const o = config.fieldOverrides.find((f) => f.collectionGroup === collection && f.fieldPath === 'expireAt');
      expect(o, `${collection}.expireAt TTL override`).toMatchObject({ ttl: true });
    }
    // TTL needs a Timestamp field (a number is never expired by Firestore).
    expect(core.match(/expireAt: Timestamp\.fromMillis\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
