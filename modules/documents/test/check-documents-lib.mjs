#!/usr/bin/env node
/*
 * check-documents-lib.mjs -- the pure library (modules/documents/src/documents-lib-*.js): record cleaning, chunk split and join,
 * the lock rules, the reader (hand-made token lists, a fake DOM), the Markdown export, the formatting bar, and a hostile corpus
 * for the link allow-list and the sanitisers. No page, no host, no network.
 * Usage: node modules/documents/test/check-documents-lib.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/documents/src'));
const files = fs.readdirSync(src).filter((f) => /^documents-lib-[a-z]-.*\.js$/.test(f)).sort();
const code = files.map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
const NAMES = ['DL', 'dlCleanText', 'dlCleanLine', 'dlCut', 'dlCleanDoc', 'dlCleanChunk', 'dlCleanLock', 'dlNewId', 'dlSplit', 'dlJoin',
  'dlPlanChunks', 'dlDroppedChunks', 'dlLeftoverChunks', 'dlExcerpt', 'DL_LOCK', 'dlLockSeenAt', 'dlLockStale', 'dlLockTakePlan',
  'dlLockTakeResult', 'dlLockRefreshResult', 'dlLockNext', 'dlLockHear', 'dlLockEditState', 'dlSafeAddress', 'dlDescribe', 'dlBuild',
  'dlObjectLinks', 'dlExportMarkdown', 'dlExportName', 'dlCleanTrash', 'dlTrashKey', 'dlTrashExpired', 'dlBold', 'dlItalic', 'dlCode', 'dlList', 'dlNumbered', 'dlChecklist', 'dlQuote',
  'dlHeading', 'dlLink', 'dlObjectLink', 'dlGrid', 'dlFormula',
  'DL_SAVE', 'dlPlanSave', 'dlIsDirty', 'dlCommitResult', 'dlAutosaveDelay', 'dlWriteWait', 'dlSaveWord'];
const L = new Function(`${code}\nreturn { ${NAMES.join(', ')} };`)();
let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const doc = { id: 'abcd1234', type: 'doc', title: 'Plan', rev: 2, chunks: ['aaaa1111'], size: 10, excerpt: 'Hi', by: 'u1', at: '2026-11-11T10:00:00.000Z', editedBy: 'u1', editedByName: 'Ana', editedAt: '2026-11-11T10:00:00.000Z' };
const lock = { id: 'lock', type: 'lock', doc: 'abcd1234', holder: 'u1', name: 'Ana', at: '2026-11-11T10:00:00.000Z', seq: 1, by: 'u1' };

test('the library has no page, host or Documents words', () => {
  assert.ok(!/\b(host|document)\.|\b(innerHTML|insertAdjacentHTML|outerHTML)\b/.test(code.replace(/\/\/.*$/gm, '')), 'a forbidden word');
  assert.ok(!/documents?\b/i.test(code.replace(/\/\/.*$/gm, '')), 'a Documents word');
});
test('doc record: good kept, unknown dropped', () => {
  assert.deepEqual(L.dlCleanDoc({ ...doc, extra: 1 }), doc);
});
test('doc record: limits', () => {
  const bad = [null, 5, [], { ...doc, type: 'x' }, { ...doc, id: 'ABC' }, { ...doc, id: 'abc' }, { ...doc, id: 'a'.repeat(17) }, { ...doc, title: '' }, 
    { ...doc, title: 5 }, { ...doc, rev: 0 }, { ...doc, rev: 1.5 }, { ...doc, chunks: [] }, { ...doc, chunks: Array.from({ length: 7 }, (_, i) => `aaaaaaa${i}`) },
    { ...doc, chunks: ['aaaa111'] }, { ...doc, chunks: ['AAAA1111'] }, { ...doc, chunks: ['aaaa1111', 'aaaa1111'] }, { ...doc, size: 150001 }, { ...doc, size: -1 },
    { ...doc, by: 'a b' }, { ...doc, at: 'soon' }, { ...doc, editedAt: 5 }, { ...doc, excerpt: 'x'.repeat(601) }];
  for (const v of bad) assert.equal(L.dlCleanDoc(v), null, JSON.stringify(v).slice(0, 80));
  assert.equal(L.dlCleanDoc({ ...doc, title: 'a'.repeat(120) }).title.length, 120);
  assert.equal(L.dlCleanDoc({ ...doc, title: 'a'.repeat(121) }).title.length, 120);
  assert.equal(L.dlCleanDoc({ ...doc, chunks: Array.from({ length: 6 }, (_, i) => `aaaaaaa${i}`) }).chunks.length, 6);
  assert.equal(L.dlCleanDoc({ ...doc, size: 150000 }).size, 150000);
});
test('doc record: strings cleaned, excerpt and name cut', () => {
  const c = L.dlCleanDoc({ ...doc, title: '  A\u202eB\u200b\tC\n ', editedByName: 'N'.repeat(60), excerpt: 'e'.repeat(400) });
  assert.equal(c.title, 'AB C');
  assert.equal(c.editedByName.length, 40);
  assert.equal(c.excerpt.length, 300);
});
test('chunk record', () => {
  const c = { id: 'bbbb2222', doc: 'abcd1234', text: 'hello' };
  assert.deepEqual(L.dlCleanChunk({ ...c, x: 1 }), c);
  for (const v of [null, {}, { ...c, text: 5 }, { ...c, id: 'B' }, { ...c, doc: 'x' }, { ...c, text: '"'.repeat(24000) }]) assert.equal(L.dlCleanChunk(v), null);
  assert.equal(L.dlCleanChunk({ ...c, text: 'a\u200bb\u0001c\r\nd' }).text, 'abc\nd');
  assert.ok(L.dlCleanChunk({ ...c, text: 'a'.repeat(47900) }));
});
test('lock record', () => {
  assert.deepEqual(L.dlCleanLock({ ...lock, extra: 1 }), lock);
  for (const v of [null, {}, { ...lock, id: 'x' }, { ...lock, type: 'x' }, { ...lock, doc: 'x' }, { ...lock, holder: '' }, { ...lock, holder: 'a b' }]) assert.equal(L.dlCleanLock(v), null);
  const c = L.dlCleanLock({ ...lock, name: '', seq: -3, at: 'x' });
  assert.deepEqual([c.name, c.seq, c.at], ['Someone', 0, '']);
});
test('trash record', () => {
  const t = { id: 'abcd1234', type: 'trash', doc, by: 'u1', name: 'Ana', at: '2026-11-11T10:00:00.000Z' };
  assert.deepEqual(L.dlCleanTrash({ ...t, extra: 1 }), t);
  for (const v of [null, {}, { ...t, id: 'zzzzzzzz' }, { ...t, doc: { ...doc, rev: 0 } }, { ...t, by: '' }, { ...t, at: 'x' }]) assert.equal(L.dlCleanTrash(v), null);
  assert.equal(L.dlTrashKey('abcd1234'), '_trash:abcd1234');
  assert.equal(L.dlTrashExpired(t, Date.parse(t.at) + 6.9 * 86400000), false);
  assert.equal(L.dlTrashExpired(t, Date.parse(t.at) + 7 * 86400000), true);
});
test('new ids match the pattern', () => {
  let n = 0;
  const id = L.dlNewId(() => (n++ % 10) / 10);
  assert.match(id, /^[a-z0-9]{8}$/);
  assert.match(L.dlNewId(() => 1), /^[a-z0-9]{8}$/);
});

// ---- chunks
test('split: empty, short, join round trip', () => {
  assert.deepEqual(L.dlSplit(''), { ok: true, chunks: [''] });
  assert.deepEqual(L.dlSplit('abc'), { ok: true, chunks: ['abc'] });
});
test('split: cuts at a blank line, then a line break, then a character', () => {
  const para = (c) => `${c.repeat(20000)}\n\n`;
  let r = L.dlSplit(para('a') + para('b') + para('c'));
  assert.ok(r.ok && r.chunks.length === 2 && r.chunks[0].endsWith('\n\n'), 'blank line');
  const line = (c) => `${c.repeat(20000)}\n`;
  r = L.dlSplit(line('a') + line('b') + line('c'));
  assert.ok(r.ok && r.chunks[0].endsWith('\n') && !r.chunks[0].endsWith('\n\n') && r.chunks.every((c) => c.length <= 48000), 'line break');
  const big = 'x'.repeat(100000);
  r = L.dlSplit(big);
  assert.ok(r.ok && r.chunks.length === 3 && L.dlJoin(r.chunks) === big, 'character');
});
test('split: each chunk record is within 48000 JSON characters, worst case quotes', () => {
  const t = '"\n'.repeat(60000);
  const r = L.dlSplit(t.slice(0, 100000));
  assert.ok(!r.ok && r.reason === 'long' || r.ok);
  const q = '"'.repeat(70000);
  const s = L.dlSplit(q);
  assert.ok(s.ok && s.chunks.length >= 3);
  for (const c of s.chunks) assert.ok(JSON.stringify({ id: 'x'.repeat(8), doc: 'x'.repeat(16), text: c }).length <= 48000);
  assert.equal(L.dlJoin(s.chunks), q);
});
test('split: never splits a surrogate pair', () => {
  const t = '\u{1F600}'.repeat(30000);
  const r = L.dlSplit(t);
  assert.ok(r.ok && r.chunks.length > 1);
  for (const c of r.chunks) { assert.ok(!/[\ud800-\udbff]$/.test(c) && !/^[\udc00-\udfff]/.test(c)); assert.ok(JSON.stringify({ id: 'x'.repeat(8), doc: 'x'.repeat(16), text: c }).length <= 48000); }
  assert.equal(L.dlJoin(r.chunks), t);
  const odd = 'a' + '\u{1F600}'.repeat(30000);
  assert.equal(L.dlJoin(L.dlSplit(odd).chunks), odd);
});
test('split: too long is refused', () => {
  assert.equal(L.dlSplit('a'.repeat(150001)).ok, false);
  assert.equal(L.dlSplit('a'.repeat(150000)).reason, undefined);
  const r = L.dlSplit('"'.repeat(150000)); // escaped, needs more than 6 chunks
  assert.deepEqual([r.ok, r.reason], [false, 'long']);
  assert.equal(L.dlSplit(5).ok, false);
});
test('plan: unchanged chunks keep their id and are not written', () => {
  let n = 0;
  const fresh = () => `new0000${n++}`;
  const p = L.dlPlanChunks([{ id: 'old00001', text: 'a' }, { id: 'old00002', text: 'b' }], ['a', 'B', 'c'], fresh);
  assert.deepEqual(p.map((x) => [x.id, x.write]), [['old00001', false], ['new00000', true], ['new00001', true]]);
  assert.deepEqual(L.dlDroppedChunks(['old00001', 'old00002'], ['old00001', 'new00000']), ['old00002']);
  assert.deepEqual(L.dlLeftoverChunks(['a'], ['a', 'z']), ['z']);
});
test('excerpt: plain, 300 characters', () => {
  assert.equal(L.dlExcerpt('| A | B |\n|:--|--:|\n| 1 | 2 |'), 'A B 1 2');
  assert.equal(L.dlExcerpt('# Title\n\n**bold** and [a link](https://x.y) `code`\n- [ ] task'), 'Title bold and a link code task');
  assert.equal(L.dlExcerpt('a'.repeat(400)).length, 300);
});

// ---- the lock
test('lock: stale rules', () => {
  const n = 1e6;
  assert.equal(L.dlLockStale(n - 34999, n), false);
  assert.equal(L.dlLockStale(n - 35000, n), true);
  assert.equal(L.dlLockStale(NaN, n), true);
  assert.equal(L.dlLockSeenAt(n, 5000), n - 5000);
  assert.equal(n - L.dlLockSeenAt(n, 99999), 35000 - 12000);
  assert.equal(L.dlLockSeenAt(n, undefined), L.dlLockSeenAt(n, 40000));
  assert.deepEqual([L.DL_LOCK.beat, L.DL_LOCK.stale, L.DL_LOCK.wait], [10000, 35000, 12000]);
});
test('lock: take plan', () => {
  const p = (o) => L.dlLockTakePlan({ canEdit: true, me: 'u2', rec: lock, fresh: true, mine: false, ...o });
  assert.equal(p({}), 'busy');
  assert.equal(p({ canEdit: false }), 'denied');
  assert.equal(p({ me: null }), 'denied');
  assert.equal(p({ rec: null }), 'take');
  assert.equal(p({ fresh: false }), 'take');
  assert.equal(p({ me: 'u1' }), 'other-window');
  assert.equal(p({ me: 'u1', mine: true }), 'take');
  assert.equal(L.dlLockTakeResult({ status: 409 }), 'busy');
  assert.equal(L.dlLockTakeResult({ status: 500 }), 'failed');
  assert.equal(L.dlLockRefreshResult({ status: 409 }), 'lost');
  assert.equal(L.dlLockRefreshResult({ status: 429 }), 'retry');
});
test('lock: next, hear, edit state', () => {
  assert.equal(L.dlLockNext('abcd1234', 'u1', 'Ana', 't', lock).seq, 2);
  assert.equal(L.dlLockNext('abcd1234', 'u1', 'Ana', 't', null).seq, 0);
  assert.equal(L.dlLockHear({ rec: { ...lock, holder: 'u2' }, fresh: true, me: 'u1', editing: true }), 'lost');
  assert.equal(L.dlLockHear({ rec: lock, fresh: true, me: 'u1', editing: true }), 'none');
  assert.equal(L.dlLockHear({ rec: { ...lock, holder: 'u2' }, fresh: true, me: 'u1', editing: false }), 'none');
  assert.equal(L.dlLockEditState({ canEdit: true, me: 'u2', rec: lock, fresh: true }).reason, 'Ana is editing this. You can read it as it changes.');
  assert.equal(L.dlLockEditState({ canEdit: true, me: 'u1', rec: lock, fresh: true }).reason, 'You are editing this in another window.');
  assert.equal(L.dlLockEditState({ canEdit: true, me: 'u1', rec: null }).enabled, true);
});

// ---- the reader
const T = (type, o = {}) => ({ type, raw: o.raw || o.text || '', ...o });
const txt = (s) => T('text', { text: s });
const fakeDoc = () => {
  const sinks = [];
  const node = (tag) => {
    const n = { tag, attrs: {}, kids: [], className: '', _t: '' };
    n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
    n.appendChild = (c) => { n.kids.push(c); return c; };
    n.removeChild = (c) => { n.kids = n.kids.filter((k) => k !== c); };
    Object.defineProperty(n, 'firstChild', { get: () => n.kids[0] || null });
    Object.defineProperty(n, 'textContent', { get: () => n._t + n.kids.map((k) => k.textContent).join(''), set: (v) => { n.kids = []; n._t = String(v); } });
    for (const s of ['innerHTML', 'outerHTML']) Object.defineProperty(n, s, { set: (v) => sinks.push(v), get: () => '' });
    n.insertAdjacentHTML = (p, v) => sinks.push(v);
    return n;
  };
  return { sinks, createElement: node, createTextNode: (v) => ({ tag: '#text', textContent: v, kids: [] }) };
};
const all = (n, out = []) => { out.push(n); (n.kids || []).forEach((k) => all(k, out)); return out; };
const render = (tokens, hooks) => { const d = fakeDoc(); const root = L.dlBuild(L.dlDescribe('x', () => tokens), d, hooks); return { root, d, nodes: all(root) }; };
const link = (href, text = 'go') => T('link', { href, text, raw: `[${text}](${href})`, tokens: [txt(text)] });
const para = (...tokens) => T('paragraph', { raw: 'p', tokens });

test('reader: each form becomes elements', () => {
  const { root } = render([
    T('heading', { depth: 6, tokens: [txt('H')] }),
    para(T('strong', { tokens: [txt('b')] }), T('em', { tokens: [txt('i')] }), T('codespan', { text: 'c' }), T('br'), link('https://a.b/c')),
    T('blockquote', { tokens: [para(txt('q'))] }),
    T('code', { text: 'let x;' }), T('hr'),
    T('list', { ordered: true, start: 3, items: [{ task: true, checked: true, tokens: [txt('t')] }, { tokens: [txt('u')] }] }),
    T('table', { align: ['left', null], header: [{ tokens: [txt('A')] }, { tokens: [txt('B')] }], rows: [[{ tokens: [txt('1')] }, { tokens: [txt('2')] }]] }),
  ]);
  const tags = all(root).map((n) => n.tag);
  for (const t of ['h4', 'strong', 'em', 'code', 'br', 'a', 'blockquote', 'pre', 'hr', 'ol', 'li', 'input', 'table', 'thead', 'th', 'td']) assert.ok(tags.includes(t), t);
  const a = all(root).find((n) => n.tag === 'a');
  assert.deepEqual(a.attrs, { href: 'https://a.b/c', rel: 'noopener noreferrer', target: '_blank' });
  assert.equal(all(root).find((n) => n.tag === 'ol').attrs.start, '3');
  assert.equal(all(root).find((n) => n.tag === 'th').attrs.style, 'text-align:left');
  assert.equal(all(root).find((n) => n.tag === 'input').attrs.checked, '');
});
test('reader: a task box token from the lexer inside an item draws nothing of its own', () => {
  const { root } = render([T('list', { items: [{ task: true, checked: true, tokens: [T('checkbox', { checked: true }), txt('Read')] }] })]);
  assert.equal(root.textContent, 'Read');
  assert.equal(all(root).filter((n) => n.tag === 'input').length, 1);
});
test('reader: raw html, pictures and footnotes are text, never elements or HTML', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(1)</script>';
  const { root, d } = render([T('html', { raw: evil, text: evil }), para(T('image', { raw: '![a](http://x/y.png)', href: 'http://x/y.png', text: 'a' }), T('html', { raw: '<b onclick=1>', text: '<b onclick=1>' }))]);
  assert.deepEqual(d.sinks, []);
  const tags = all(root).map((n) => n.tag);
  assert.ok(!tags.includes('script') && !tags.includes('img') && !tags.includes('b'));
  assert.ok(root.textContent.includes(evil) && root.textContent.includes('![a](http://x/y.png)'));
});
test('reader: bounds', () => {
  const cell = (s) => ({ tokens: [txt(s)] });
  const big = (rows, cols) => T('table', { raw: 'RAW-TABLE', align: [], header: Array.from({ length: cols }, () => cell('h')), rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => cell('c'))) });
  assert.ok(render([big(200, 20)]).nodes.some((n) => n.tag === 'table'));
  for (const t of [big(201, 20), big(2, 21)]) { const r = render([t]); assert.ok(!r.nodes.some((n) => n.tag === 'table') && r.root.textContent === 'RAW-TABLE'); }
  const nest = (n) => (n === 0 ? txt('leaf') : T('list', { raw: `RAW${n}`, items: [{ tokens: [nest(n - 1)] }] }));
  assert.equal(render([nest(4)]).nodes.filter((n) => n.tag === 'ul').length, 4);
  const deep = render([nest(5)]);
  assert.equal(deep.nodes.filter((n) => n.tag === 'ul').length, 4);
  assert.ok(deep.root.textContent.includes('RAW1'));
  const f = (n) => T('paragraph', { raw: `$$${'x'.repeat(n)}$$`, tokens: [txt('t')] });
  assert.ok(render([f(2000)]).nodes.some((n) => n.attrs && /dl-math/.test(n.className)));
  assert.ok(!render([f(2001)]).nodes.some((n) => /dl-math/.test(n.className || '')));
  assert.ok(render([para(txt(`a $${'x'.repeat(2001)}$ b`))]).root.textContent.includes('x'.repeat(2001)));
});
test('reader: formulas, drawn by the hook, source on failure', () => {
  const t = [para(txt('a $x^2$ b and $5 or $6'))];
  assert.equal(render(t).root.textContent, 'a $x^2$ b and $5 or $6');
  let seen = null;
  const r = render(t, { math: (el, tex, display) => { seen = [tex, display]; el.textContent = 'DRAWN'; return true; } });
  assert.deepEqual(seen, ['x^2', false]);
  assert.equal(r.root.textContent, 'a DRAWN b and $5 or $6');
  const bad = render([T('paragraph', { raw: '$$\\bad$$', tokens: [] })], { math: () => { throw new Error('x'); } });
  assert.equal(bad.root.textContent, '$$\\bad$$');
  const half = render(t, { math: (el) => { el.textContent = 'partial'; return false; } });
  assert.ok(half.root.textContent.includes('$x^2$') && !half.root.textContent.includes('partial'));
});
test('reader: object links, links in the text, backlink list', () => {
  const o = link('object:whiteboard:board:b-1', 'The board');
  const r = render([para(o, txt(' and '), link('object:documents:document:abcd1234', 'Plan'), link('object:whiteboard:board:b-1', 'again'))], { object: (el, ref) => { el.attrs.hooked = ref.id; } });
  const chips = r.nodes.filter((n) => n.className === 'dl-object');
  assert.equal(chips.length, 3);
  assert.deepEqual([chips[0].textContent, chips[0].attrs.hooked, chips[0].attrs['data-module']], ['The board', 'b-1', 'whiteboard']);
  assert.ok(!r.nodes.some((n) => n.tag === 'a'));
  const desc = L.dlDescribe('x', () => [para(o, link('object:documents:document:abcd1234', 'Plan'), link('object:whiteboard:board:b-1', 'again'))]);
  assert.deepEqual(L.dlObjectLinks(desc), [{ module: 'whiteboard', kind: 'board', id: 'b-1' }, { module: 'documents', kind: 'document', id: 'abcd1234' }]);
  const inTable = L.dlDescribe('x', () => [T('table', { align: [], header: [{ tokens: [o] }], rows: [[{ tokens: [link('object:a:b:c-1')] }]] })]);
  assert.equal(L.dlObjectLinks(inTable).length, 2);
});
test('reader: a failing parser shows the text', () => {
  const d = fakeDoc();
  const root = L.dlBuild(L.dlDescribe('hello <b>', () => { throw new Error('boom'); }), d);
  assert.equal(root.textContent, 'hello <b>');
  assert.equal(L.dlDescribe('a'.repeat(150001), () => []).length, 1);
});
test('reader: direction and zero-width characters are removed from rendered text', () => {
  const r = render([para(txt('a\u202eb\u200bc\u2066d\ufeffe'))]);
  assert.equal(r.root.textContent, 'abcde');
});

// ---- the hostile corpus
const OK = ['http://a.b', 'https://a.b/c?d=e#f', 'HTTPS://A.B', 'mailto:a@b.c', 'mailto:a@b.c?subject=x', 'object:whiteboard:board:b-1', 'object:documents:document:abcd1234', 'HTTP://x.y'];
const BAD = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'java\rscript:alert(1)', ' javascript:alert(1)', '\u0001javascript:alert(1)',
  'java\u0000script:1', 'java\u200bscript:1', '\u202ejavascript:1', 'java\u00a0script:1', 'java\u2028script:1', 'java\u3000script:1', 'javascript&colon;alert(1)', 'javascript&#58;alert(1)',
  'javascript&#x3a;alert(1)', '&#106;avascript:alert(1)', '&#x6A;avascript:alert(1)', 'java&Tab;script:1', 'java&#9;script:1', 'java&newline;script:1', '&amp;#106;avascript:1', 'jav&#x09;ascript:1',
  'data:text/html,<script>alert(1)</script>', 'DATA:text/html;base64,AAAA', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://a.b', 'blob:https://a.b/x', 'about:blank', 'chrome://x', 'tel:123',
  '//evil.com', '/relative', 'relative/path', '#frag', '', '   ', 'http:', 'http://', 'https:///x', 'mailto:', 'mailto:nobody', 'object:', 'object:a', 'object:a:b', 'object:a:b:c:d', 'object:A:b:c', 'object:a:b:<x>',
  'object:a:b:c d', 'object:../x:b:c', 'https://a.b/"onmouseover="x', 'https://a.b/<script>', "https://a.b/'x", 'https://a.b/\\x', 'x'.repeat(3000), 'http\u200b:\u200b//a.b/' + '"', null, undefined, 5, {}];
test('allow-list: good addresses pass', () => { for (const a of OK) assert.ok(L.dlSafeAddress(a), a); });
test('allow-list: hostile addresses are refused', () => { for (const a of BAD) assert.equal(L.dlSafeAddress(a), null, JSON.stringify(a)); });
test('allow-list: the kept address has no noise and a scheme from the list', () => {
  const a = L.dlSafeAddress('ht\ttp s://a.b'.replace(' ', ''));
  assert.deepEqual(a, { kind: 'link', href: 'https://a.b' });
  assert.deepEqual(L.dlSafeAddress('object:whiteboard:board:b-1'), { kind: 'object', module: 'whiteboard', objectKind: 'b-1'.length ? 'board' : '', id: 'b-1' });
});
test('corpus: a hostile link never becomes an anchor; its source is text', () => {
  for (const a of BAD.filter((x) => typeof x === 'string' && x.trim())) {
    const r = render([para(link(a, 'click'))]);
    assert.ok(!r.nodes.some((n) => n.tag === 'a'), a);
    assert.equal(r.root.textContent, `[click](${a})`.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '').replace(/\r\n?/g, '\n'));
    assert.deepEqual(r.d.sinks, []);
  }
});
test('corpus: sanitisers', () => {
  assert.equal(L.dlCleanLine('a\u0000b\u001fc\u007fd\u0085e\u2028f', 50), 'a b c d e f');
  assert.equal(L.dlCleanLine('\u202e\u200b\u200f', 50), '');
  assert.equal(L.dlCleanLine(5, 50), '');
  assert.equal(L.dlCleanText('\u202ea\u2069\u061cb\u0000\u0008c\td\re'), 'abc\td\ne');
  assert.equal(L.dlCut('a\u{1F600}', 2), 'a');
  assert.equal(L.dlCut('ab\u{1F600}', 3), 'ab');
  assert.equal(L.dlCleanDoc({ ...doc, title: '<script>x</script>' }).title, '<script>x</script>'); // kept as text; drawn with textContent only
  assert.equal(L.dlCleanDoc({ ...doc, title: 'x'.repeat(2000) }), null);
});
test('corpus: stored script text in a document is inert in the build', () => {
  const evil = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', '</div><iframe src=javascript:1>'];
  const r = render([para(...evil.map((e) => txt(e))), T('code', { text: evil[0] }), T('heading', { depth: 1, tokens: [txt(evil[1])] }), T('table', { align: [], header: [{ tokens: [txt(evil[2])] }], rows: [[{ tokens: [txt(evil[3])] }]] })]);
  assert.deepEqual(r.d.sinks, []);
  assert.deepEqual([...new Set(r.nodes.map((n) => n.tag))].filter((t) => ['script', 'img', 'svg', 'iframe'].includes(t)), []);
  assert.ok(r.root.textContent.includes(evil[0]));
});
test('corpus: the source never uses an HTML sink', () => {
  assert.ok(!/(innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function)/.test(code));
});

// ---- export
test('export: object links become their text', () => {
  assert.equal(L.dlExportMarkdown('See [the plan](object:documents:document:abcd1234) and [site](https://a.b) and [**b** x](object:a:b:c).'), 'See the plan and [site](https://a.b) and **b** x.');
  assert.equal(L.dlExportMarkdown('```\n[x](object:a:b:c)\n```\n[y](object:a:b:c)'), '```\n[x](object:a:b:c)\n```\ny');
  assert.equal(L.dlExportMarkdown('$x$ and $$\na\n$$\n\ttab'), '$x$ and $$\na\n$$\n\ttab');
  assert.equal(L.dlExportMarkdown('[a](OBJECT:a:b:c) [b](<object:a:b:c>)'), 'a b');
  assert.equal(L.dlExportMarkdown(null), '');
});
test('export: file names', () => {
  assert.equal(L.dlExportName('Plan'), 'Plan.md');
  assert.equal(L.dlExportName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij.md');
  assert.equal(L.dlExportName('x\u0000y\n'), 'x y.md');
  assert.equal(L.dlExportName('x'.repeat(200)), `${'x'.repeat(80)}.md`);
  assert.equal(L.dlExportName('///'), 'Untitled.md');
  assert.equal(L.dlExportName('..secret'), 'secret.md');
  assert.equal(L.dlExportName(null), 'Untitled.md');
});

// ---- the formatting bar
const S = (value, start, end = start) => ({ value, start, end });
test('format: bold, italic, code wrap and unwrap', () => {
  assert.deepEqual(L.dlBold(S('a word b', 2, 6)), S('a **word** b', 4, 8));
  assert.deepEqual(L.dlBold(S('a **word** b', 4, 8)), S('a word b', 2, 6));
  assert.deepEqual(L.dlBold(S('a **word** b', 2, 10)), S('a word b', 2, 6));
  assert.deepEqual(L.dlBold(S('ab', 1)), S('a**bold**b', 3, 7));
  assert.deepEqual(L.dlItalic(S('x', 0, 1)), S('*x*', 1, 2));
  assert.deepEqual(L.dlCode(S('x', 0, 1)), S('`x`', 1, 2));
  assert.deepEqual(L.dlBold(S('abc', 99, 0)), S('**abc**', 2, 5));
});
test('format: heading', () => {
  assert.deepEqual(L.dlHeading(S('one\ntwo', 5), 2), S('one\n## two', 4, 10));
  assert.equal(L.dlHeading(S('## two', 3), 2).value, 'two');
  assert.equal(L.dlHeading(S('# two', 0), 3).value, '### two');
  assert.equal(L.dlHeading(S('x', 0), 9).value, '#### x');
});
test('format: lists, checklist, quote', () => {
  assert.equal(L.dlList(S('a\nb\nc', 0, 3)).value, '- a\n- b\nc');
  assert.equal(L.dlList(S('- a\n- b', 0, 7)).value, 'a\nb');
  assert.equal(L.dlNumbered(S('a\nb', 0, 3)).value, '1. a\n2. b');
  assert.equal(L.dlChecklist(S('a\n- [x] b', 0, 9)).value, '- [ ] a\n- [ ] b');
  assert.equal(L.dlChecklist(S('- [ ] a', 0)).value, 'a');
  assert.equal(L.dlList(S('- [ ] a', 0)).value, '- - [ ] a');
  assert.equal(L.dlQuote(S('a\nb', 0, 3)).value, '> a\n> b');
  assert.equal(L.dlQuote(S('> a', 0)).value, 'a');
  assert.equal(L.dlList(S('', 0)).value, '- ');
});
test('format: link, object link, grid, formula', () => {
  const l = L.dlLink(S('see here now', 4, 8));
  assert.equal(l.value, 'see [here](https://) now');
  assert.equal(l.value.slice(l.start, l.end), 'https://');
  assert.equal(L.dlLink(S('', 0)).value, '[link](https://)');
  const o = L.dlObjectLink(S('a ', 2), { module: 'whiteboard', kind: 'board', id: 'b-1', label: 'My [board]' });
  assert.equal(o.value, 'a [My board](object:whiteboard:board:b-1)');
  assert.equal(o.start, o.value.length);
  for (const bad of [null, { module: 'A', kind: 'b', id: 'c' }, { module: 'a', kind: 'b', id: 'c)' }, { module: 'a', kind: 'b', id: '' }]) assert.equal(L.dlObjectLink(S('', 0), bad), null);
  const t = L.dlGrid(S('intro', 5));
  assert.equal(t.value, 'intro\n\n| Heading 1 | Heading 2 | Heading 3 |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |');
  assert.equal(t.value.slice(t.start, t.end), 'Heading 1');
  assert.equal(L.dlGrid(S('', 0), 99, 999).value.split('\n').length, 202);
  assert.deepEqual(L.dlFormula(S('x', 0, 1)), S('$x$', 1, 2));
  assert.equal(L.dlFormula(S('$x$', 1, 2)).value, 'x');
  assert.equal(L.dlFormula(S('', 0)).value, '$x$');
  assert.equal(L.dlFormula(S('a', 1), true).value, 'a\n\n$$\nx\n$$');
  assert.equal(L.dlFormula(S('', 0), true).value, '$$\nx\n$$');
});

// ---- saving: the plan, the commit's outcome, the timing --------------------------------------------------------------------
{
  let n = 0;
  const fresh = () => `new${String(n++).padStart(5, '0')}`;
  const base = { rec: doc, me: 'u2', name: 'Bo', now: '2026-11-11T11:00:00.000Z', title: 'Plan' };
  test('save plan: only changed chunks are written, rev goes up, record is filled', () => {
    const p = L.dlPlanSave({ ...base, old: [{ id: 'aaaa1111', text: 'Hi' }], text: 'Hi', fresh });
    assert.equal(p.ok, true);
    assert.equal(p.writes.length, 0);
    assert.deepEqual(p.record.chunks, ['aaaa1111']);
    assert.equal(p.record.rev, 3);
    assert.equal(p.record.editedBy, 'u2');
    assert.equal(p.record.editedByName, 'Bo');
    assert.equal(p.record.size, 2);
    const q = L.dlPlanSave({ ...base, old: [{ id: 'aaaa1111', text: 'Hi' }], text: 'Hi there', fresh });
    assert.equal(q.writes.length, 1);
    assert.notEqual(q.writes[0].id, 'aaaa1111');
    assert.deepEqual(q.dropped, ['aaaa1111']);
    assert.ok(L.dlCleanDoc(q.record), 'the record cleans');
  });
  test('save plan: several chunks, one changed, the rest kept; a shorter text drops chunks', () => {
    const big = `${'a'.repeat(30000)}\n\n${'b'.repeat(30000)}\n\n${'c'.repeat(1000)}`;
    const first = L.dlPlanSave({ ...base, old: [{ id: 'aaaa1111', text: '' }], text: big, fresh });
    assert.ok(first.chunks.length >= 2);
    const old = first.chunks.map((c) => ({ id: c.id, text: c.text }));
    const edited = big.slice(0, -1) + 'Z';
    const next = L.dlPlanSave({ ...base, rec: { ...doc, chunks: old.map((o) => o.id) }, old, text: edited, fresh });
    assert.equal(next.writes.length, 1);
    assert.deepEqual(next.dropped, [old[old.length - 1].id]);
    const short = L.dlPlanSave({ ...base, old, text: 'x', fresh });
    assert.equal(short.chunks.length, 1);
    assert.equal(short.dropped.length, old.length);
  });
  test('save plan: refuses an empty title and a too long text before any write', () => {
    assert.deepEqual(L.dlPlanSave({ ...base, title: '  ', old: [], text: 'x', fresh }), { ok: false, reason: 'title' });
    assert.deepEqual(L.dlPlanSave({ ...base, old: [], text: 'x'.repeat(150001), fresh }), { ok: false, reason: 'long' });
  });
  test('dirty: text or title', () => {
    assert.equal(L.dlIsDirty({ text: 'a', title: 't' }, { text: 'a', title: 't' }), false);
    assert.equal(L.dlIsDirty({ text: 'a', title: 't' }, { text: 'b', title: 't' }), true);
    assert.equal(L.dlIsDirty({ text: 'a', title: 't' }, { text: 'a', title: 'u' }), true);
  });
  test('commit result: 409 is a conflict, other errors are tried again', () => {
    assert.equal(L.dlCommitResult(null), 'saved');
    assert.equal(L.dlCommitResult({ status: 409 }), 'conflict');
    assert.equal(L.dlCommitResult({ status: 429 }), 'failed');
    assert.equal(L.dlCommitResult(new Error('x')), 'failed');
  });
  test('autosave: 3 s after the last key, never within 3 s of the last save', () => {
    const d = (o) => L.dlAutosaveDelay({ now: 10000, lastKey: 9000, lastSave: -Infinity, dirty: true, force: false, ...o });
    assert.equal(d({ dirty: false }), null);
    assert.equal(d({}), 2000);
    assert.equal(d({ lastKey: 7000 }), 0);
    assert.equal(d({ lastKey: 7000, lastSave: 9000 }), 2000);
    assert.equal(d({ force: true }), 0);
    assert.equal(d({ force: true, lastSave: 9500 }), 2500);
    assert.equal(d({ lastKey: NaN }), 0);
  });
  test('write budget: a minute of writes stays under the cap', () => {
    assert.equal(L.dlWriteWait([], 100000, 7), 0);
    const log = Array.from({ length: 199 }, (_, i) => 100000 + i);
    assert.equal(L.dlWriteWait(log, 100200, 1), 0);
    assert.equal(L.dlWriteWait(log, 100200, 3), 100000 + 1 + 60000 - 100200);
    assert.equal(L.dlWriteWait([1000], 100000, 5), 0, 'old writes do not count');
  });
  test('save word', () => {
    assert.equal(L.dlSaveWord({ dirty: false, saving: false, failed: false }), 'Saved');
    assert.equal(L.dlSaveWord({ dirty: true, saving: false, failed: false }), 'Not saved yet');
    assert.equal(L.dlSaveWord({ dirty: true, saving: true, failed: false }), 'Saving');
    assert.equal(L.dlSaveWord({ dirty: true, saving: false, failed: true }), 'Not saved');
  });
}

if (fails.length) { console.error(`documents lib: ${fails.length} failed, ${passed} passed`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents lib: ${passed} tests passed`);
