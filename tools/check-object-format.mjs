#!/usr/bin/env node
/*
 * check-object-format.mjs -- the objects format on its own: the Assistant's rule and the
 * published instructions ask for one fenced JSON array, the schema matches the checker, and readObjects keeps what it should.
 * The formats named by kind (plan-kind-names.md, step 1): the marker reader, the ```objects block, and every file and
 * answer from before the change (tools/fixtures/format-old/) refused with its sentence.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// A made-up product name for the server code this check loads, so a sentence that hard-codes the default
// fails here (plan-kind-names.md, The guard).
const PRODUCT = 'Testname';
process.env.PRODUCT_NAME = PRODUCT;
const {
  ICONS, KINDS, TRAVEL_KINDS, HANDOFF_KINDS, DETAILS, MAX_IMPORT_OBJECTS, MAX_IMPORT_CANDIDATES,
  cleanObject, cleanDetails, schema, readObjects, decodeBytes, FormatError,
} = require('../server/object-format.js');
const { MAX_SUMMARIES, parseSummaries } = require('../server/prompts/parse.js');
const prompts = require('../server/prompts');
const { fencedRule } = require('../server/prompts/object-rule.js');
const { productName } = require('../server/product-name.js');
// The objects rule as the paste template writes it, and the copied instructions (server/prompts/paste.js).
const objectRule = ({ fence, noun, max, kinds }) => fencedRule({ fence, noun, max, kinds });
const instructions = (noun, { kinds = TRAVEL_KINDS } = {}) => prompts.pasteText({ kinds, words: { object: noun, objects: `${noun}s`, space: 'space' } }, { product: productName() }).text;
// The in-app ask's system part, read back by prompt-then-parse (a service without structured output).
const WORDS = { object: 'object', objects: 'objects', space: 'space' };
const askSystem = (kinds = TRAVEL_KINDS) => prompts.render(prompts.template('ask'), { question: 'Why?', material: [], context: {}, history: [], kinds, words: WORDS }).messages[0].content;
const fileFormat = require('../server/file-format.js');
const themeFile = require('../server/theme-file.js');
const templateFile = require('../server/template-file.js');
const { Store } = require('../server/store.js');
const { bundledModules } = require('../server/module-build.js');
const bundled = bundledModules(new URL('../modules', import.meta.url).pathname).map((m) => m.id);

const fixtures = (name) => fs.readFileSync(new URL(`./fixtures/object-format/${name}`, import.meta.url), 'utf8');
const oldFixture = (name) => fs.readFileSync(new URL(`./fixtures/format-old/${name}`, import.meta.url), 'utf8');
// An old-format file by its kind ("theme", "template", "objects"), so no product name is written here.
const oldFixtureNames = () => fs.readdirSync(new URL('./fixtures/format-old/', import.meta.url)).sort();
const oldFiles = (kind) => oldFixtureNames().filter((f) => f.endsWith(`-${kind}.json`)).map((f) => [f, oldFixture(f)]);
const oldFile = (kind) => oldFiles(kind)[0][1];
const refusedWith = (sentence) => (e) => e instanceof FormatError && e.status === 400 && e.message === sentence;
const OLD_ANSWER = fileFormat.OLD_SENTENCES.answer;
const OLD_OBJECTS = fileFormat.OLD_SENTENCES.objects;

let n = 0;
const test = (name, fn) => { fn(); n += 1; };

test('the /ai rule asks for one array in one objects fence, each one an object', () => {
  const rule = askSystem();
  assert.match(rule, /then add the objects worth keeping from your answer, only when it contains something worth keeping/);
  assert.ok(!/Always include/.test(rule));
  assert.match(rule, /one JSON array inside a single fenced block labelled objects/);
  assert.match(rule, /exactly one block, never one per object/);
  assert.match(rule, /at most 20/);
  assert.ok(!/\bcards?\b/.test(rule), 'the rule never says card');
  assert.equal(MAX_SUMMARIES, 20);
});

test('published instructions: one objects array, icons, kinds, 50, file paragraph, no provenance', () => {
  const text = instructions('object');
  assert.ok(text.startsWith(`I keep my plans and research in ${PRODUCT}. `), 'the product from PRODUCT_NAME');
  assert.match(text, /```objects\n\[/);
  assert.match(text, /exactly one, never one per object/);
  assert.match(text, /at most 50/);
  assert.ok(text.includes('<something>.objects.json holding {"format":"objects","formatVersion":1,"objects":[...]}'));
  for (const label of fileFormat.PAST_BLOCK_LABELS) assert.ok(!text.toLowerCase().includes(`\`\`\`${label}`), label);
  assert.match(text, /Do not write a separate file or a separate fenced block/);
  assert.ok(!text.includes('one block per'));
  assert.ok(!text.includes('basis'));
  assert.ok(!text.includes('sources'));
  for (const name of ICONS) assert.ok(text.includes(name), name);
  for (const name of TRAVEL_KINDS) assert.ok(text.includes(name), name);
});

test('schema() matches the checker', () => {
  const s = schema();
  assert.ok(s.title.startsWith(`${PRODUCT} `), 'the title names the product from PRODUCT_NAME');
  assert.equal('$id' in s, false, 'no $id (plan-kind-names.md, choice 1)');
  assert.deepEqual(s.$defs.file.required, ['format', 'formatVersion', 'objects']);
  assert.deepEqual([s.$defs.file.properties.format, s.$defs.file.properties.formatVersion], [{ const: 'objects' }, { const: 1 }]);
  assert.match(s.description, /\.objects\.json file/);
  assert.deepEqual(s.$defs.object.properties.icon.enum, ICONS);
  assert.deepEqual(s.$defs.object.properties.kind.enum, KINDS);
  JSON.parse(JSON.stringify(s));
  const kept = cleanObject({
    icon: 'hotel', kind: 'hotel', title: 'Casa', content: 'Stay.', tags: ['faro'],
    place: { name: 'Faro', lat: 37.019, lng: -7.93 }, date: '2026-10-03',
    links: [{ title: 'Casa', url: 'https://example.com/casa' }],
  }, { imported: true });
  const obj = s.$defs.object;
  assert.ok(kept.title.length <= obj.properties.title.maxLength);
  assert.ok(kept.content.length <= obj.properties.content.maxLength);
  assert.ok(obj.properties.icon.enum.includes(kept.icon));
  assert.ok(obj.properties.kind.enum.includes(kept.kind));
  assert.match(kept.tags[0], new RegExp(obj.properties.tags.items.pattern));
  assert.match(kept.date, new RegExp(obj.properties.date.pattern));
  assert.match(kept.links[0].url, new RegExp(obj.properties.links.items.properties.url.pattern));
});

test('pasted answer: objects blocks, one or three', () => {
  const three = readObjects(fixtures('three-objects.txt'));
  assert.equal(three.objects.length, 3);
  assert.equal(three.objects[0].title, 'Casa do Largo');
  assert.equal(three.objects[1].title, 'Bar do Peixe');
  assert.equal(three.objects[2].title, 'Visa reminder');
  const one = readObjects(fixtures('one-object.txt'));
  assert.equal(one.objects.length, 1);
  assert.equal(one.objects[0].title, 'One object');
});

test('an objects block holding an array of two', () => {
  const out = readObjects(fixtures('objects-array.txt'));
  assert.equal(out.objects.length, 2);
  assert.equal(out.objects[0].title, 'First');
  assert.equal(out.objects[1].title, 'Second');
});

test('raw JSON: one object or an array', () => {
  const one = readObjects('{"title":"Solo","content":"One object."}');
  assert.equal(one.objects.length, 1);
  assert.equal(one.objects[0].title, 'Solo');
  const many = readObjects('[{"title":"A","content":"a"},{"title":"B","content":"b"},{"title":"C","content":"c"}]');
  assert.equal(many.objects.length, 3);
});

test('a file: format 1, refused when the version or list is wrong', () => {
  const ok = readObjects(fixtures('file-ok.json'));
  assert.equal(ok.objects.length, 2);
  assert.throws(() => readObjects('{"format":"objects","formatVersion":2,"objects":[]}'), refusedWith('that file is format 2; this server reads format 1'));
  const notAFile = refusedWith('that is not a .objects.json file');
  assert.throws(() => readObjects('{"format":"objects","formatVersion":"1","objects":[]}'), notAFile);
  assert.throws(() => readObjects('{"format":"objects","objects":[]}'), notAFile, 'no formatVersion');
  assert.throws(() => readObjects('{"format":"objects","formatVersion":1.5,"objects":[]}'), notAFile);
  assert.throws(() => readObjects('{"format":"theme","formatVersion":1,"objects":[]}'), notAFile, 'another kind with a formatVersion');
  assert.throws(() => readObjects('{"format":"objects","formatVersion":1}'), refusedWith('that file has no list of objects'));
  // A single object with a format field of its own is still an object (choice 7).
  const own = readObjects('{"title":"Slides","content":"The deck.","format":"pdf"}');
  assert.deepEqual(own.objects.map((o) => o.title), ['Slides']);
});

test('UTF-16 with a byte order mark reads the same as UTF-8', () => {
  const text = fs.readFileSync(new URL('./fixtures/object-format/utf8-sample.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const utf8 = Buffer.from(text, 'utf8');
  const le = Buffer.alloc(2 + text.length * 2);
  le[0] = 0xff; le[1] = 0xfe;
  for (let i = 0; i < text.length; i += 1) le.writeUInt16LE(text.charCodeAt(i), 2 + i * 2);
  assert.equal(decodeBytes(utf8).replace(/\r\n/g, '\n'), decodeBytes(le).replace(/\r\n/g, '\n'));
  assert.deepEqual(readObjects(decodeBytes(le)).objects, readObjects(decodeBytes(utf8)).objects);
});

test('rendered view without fences, and braces with no title', () => {
  const out = readObjects(fixtures('rendered-view.txt'));
  assert.equal(out.objects.length, 2);
  assert.equal(out.objects[0].title, 'Hotel Nova');
  assert.equal(out.objects[1].title, 'Museum hours');
  assert.throws(() => readObjects(fixtures('braces-no-title.txt')), (e) => /nothing in that could be read as objects/.test(e.message));
});

test('imported objects drop sources and set basis imported', () => {
  const out = readObjects('{"title":"T","content":"c","basis":"both","sources":[1]}');
  assert.equal(out.objects[0].basis, 'imported');
  assert.equal(out.objects[0].sources, undefined);
});

test('cleanObject without imported refuses a model basis of imported', () => {
  const a = cleanObject({ title: 'T', content: 'c', basis: 'imported' }, { count: 0 });
  assert.equal(a.basis, 'general');
  const b = cleanObject({ title: 'T', content: 'c', basis: 'imported' }, { count: 2 });
  assert.equal(b.basis, 'items');
});

test('links: http and https kept; the rest dropped', () => {
  const kept = cleanObject({
    title: 'T', content: 'c',
    links: [
      { title: 'ok', url: 'https://a.example/x' },
      { url: 'http://plain.example' },
      { url: 'javascript:1' },
      { url: 'data:text/plain,hi' },
      { url: 'ftp://files.example' },
      { url: 'https://u:p@a.example' },
      { url: 'https://example.com/' + 'x'.repeat(500) },
      { title: 'sixth', url: 'https://sixth.example' },
    ],
  }, { imported: true });
  assert.deepEqual(kept.links, [
    { title: 'ok', url: 'https://a.example/x' },
    { title: 'plain.example', url: 'http://plain.example/' },
  ]);
});

test('title and content cuts, tags stripped, dropped reasons', () => {
  const long = cleanObject({ title: 't'.repeat(200), content: 'x'.repeat(5999) }, { imported: true });
  assert.equal(long.title.length, 80);
  assert.equal(long.content.length, 5999);
  const cut = cleanObject({ title: 'T', content: 'y'.repeat(6001) }, { imported: true });
  assert.equal(cut.content.length, 6000);
  const html = cleanObject({ title: 'T', content: 'a <script>bad</script> claim' }, { imported: true });
  assert.equal(html.content, 'a bad claim');
  const miss = readObjects('[{"content":"no title"},{"title":"No content"},{"title":"Ok","content":"yes"}]');
  assert.equal(miss.objects.length, 1);
  assert.deepEqual(miss.dropped, [
    { at: 1, why: 'it has no title' },
    { at: 2, why: 'it has no content' },
  ]);
});

test('caps: 50 kept, 200 candidates read', () => {
  const sixty = Array.from({ length: 60 }, (_, i) => ({ title: `T${i}`, content: 'c' }));
  const over = readObjects(JSON.stringify(sixty));
  assert.equal(over.objects.length, 50);
  assert.equal(over.over, 10);
  assert.equal(over.found, 60);
  const many = Array.from({ length: 250 }, (_, i) => ({ title: `T${i}`, content: 'c' }));
  const capped = readObjects(JSON.stringify(many));
  assert.equal(capped.found, MAX_IMPORT_CANDIDATES);
  assert.equal(capped.objects.length, MAX_IMPORT_OBJECTS);
  assert.equal(capped.over, MAX_IMPORT_CANDIDATES - MAX_IMPORT_OBJECTS);
});

test('empty and white space is refused', () => {
  assert.throws(() => readObjects(''), (e) => e.status === 400 && e.message === 'paste an answer or choose a file first');
  assert.throws(() => readObjects('   \n\t  '), (e) => e.message === 'paste an answer or choose a file first');
});

test('a block that is not JSON is dropped; others still come through', () => {
  const text = '```objects\nnot json\n```\n```objects\n{"title":"Ok","content":"yes"}\n```';
  const out = readObjects(text);
  assert.equal(out.objects.length, 1);
  assert.equal(out.objects[0].title, 'Ok');
  assert.deepEqual(out.dropped, [{ at: 1, why: 'not valid JSON' }]);
});

test('parseSummaries reads objects, summary, json and bare blocks, and no other label', () => {
  for (const label of ['objects', 'summary', 'json', '']) {
    const out = parseSummaries(`\`\`\`${label}\n{"title":"T","content":"c"}\n\`\`\``, 0);
    assert.deepEqual([out.summaries.length, out.text], [1, '{{summary:0}}'], label || 'bare');
  }
  for (const label of ['card', ...fileFormat.PAST_BLOCK_LABELS]) {
    const text = `\`\`\`${label}\n{"title":"T","content":"c"}\n\`\`\``;
    const out = parseSummaries(text, 0);
    assert.deepEqual([out.summaries.length, out.text], [0, text], label);
  }
});

test('parseSummaries reads one fence holding an array', () => {
  const out = parseSummaries('```objects\n[{"title":"A","content":"one"},{"title":"B","content":"two"}]\n```', 0);
  assert.equal(out.summaries.length, 2);
  assert.equal(out.summaries[0].title, 'A');
  assert.equal(out.summaries[1].title, 'B');
  assert.equal(out.text, '{{summary:0}}\n{{summary:1}}');
});

test('the marker reader: stamp, ok, newer, old by shape, not', () => {
  for (const kind of ['theme', 'template', 'objects']) {
    assert.deepEqual(fileFormat.stamp(kind), { format: kind, formatVersion: 1 });
    const cap = kind[0].toUpperCase() + kind.slice(1);
    assert.equal(fileFormat.readMarker({ format: kind, formatVersion: 1 }, kind), 'ok');
    assert.equal(fileFormat.readMarker({ format: kind, formatVersion: 7 }, kind), 'newer');
    for (const label of fileFormat.PAST_BLOCK_LABELS) assert.equal(fileFormat.readMarker({ [`${label}${cap}`]: 1 }, kind), 'old', `${label}${cap}`);
    // Only a past label's exact marker is old (plan-kind-names.md, F4): another word before the kind, or a past label in
    // another case, is not.
    for (const label of fileFormat.PAST_BLOCK_LABELS) assert.equal(fileFormat.readMarker({ [`${label.toUpperCase()}${cap}`]: 1 }, kind), 'not', `${label.toUpperCase()}${cap}`);
    assert.equal(fileFormat.readMarker({ anyword: 1, [`another${cap}`]: 3 }, kind), 'not', 'another word before the kind');
    assert.equal(fileFormat.readMarker({ [`related${cap}`]: 3 }, kind), 'not', `related${cap}`);
    for (const not of [
      { format: kind }, { format: kind, formatVersion: '1' }, { format: kind, formatVersion: 1.5 }, { format: kind, formatVersion: 0 },
      { format: kind === 'theme' ? 'template' : 'theme', formatVersion: 1 }, {}, { [`some${cap}`]: '1' }, { [`Some${cap}`]: 1 },
      { format: 'other', [`some${cap}`]: 1 }, null, [], 'text',
    ]) assert.equal(fileFormat.readMarker(not, kind), 'not', JSON.stringify(not));
  }
  assert.ok(Object.isFrozen(fileFormat.PAST_BLOCK_LABELS));
  assert.equal(fileFormat.PAST_BLOCK_LABELS.length, 2, 'the list never grows');
});

test('old files are refused, each with its sentence', () => {
  const sanitize = (t) => Store.prototype.sanitizeTheme.call(null, t);
  // An old theme, template and objects file for each past label (tools/fixtures/format-old/).
  for (const kind of ['theme', 'template', 'objects']) assert.equal(oldFiles(kind).length, fileFormat.PAST_BLOCK_LABELS.length, `an old ${kind} file for each past label`);
  for (const [name, text] of oldFiles('theme')) assert.throws(() => themeFile.readThemeFile(text, sanitize), (e) => e.message === themeFile.OLD_THEME_FILE, name);
  for (const [name, text] of oldFiles('template')) assert.throws(() => templateFile.readTemplateFile(text, { bundled }), (e) => e.message === templateFile.OLD_TEMPLATE_FILE, name);
  for (const [name, text] of oldFiles('objects')) assert.throws(() => readObjects(text), refusedWith(OLD_OBJECTS), name);
  assert.equal(themeFile.OLD_THEME_FILE, 'That theme file is in an older format. Export the theme again and import the new file.');
  assert.throws(() => templateFile.readTemplateFile(oldFile('template'), { bundled }), (e) => e.message === templateFile.OLD_TEMPLATE_FILE);
  assert.equal(templateFile.OLD_TEMPLATE_FILE, 'That template file is in an older format. Export the template again and import the new file.');
  assert.throws(() => readObjects(oldFile('objects')), refusedWith(OLD_OBJECTS));
  assert.equal(OLD_OBJECTS, 'that file is in an older format: copy the instructions again and ask the AI for a new file');
  // The first past name's markers too, built from the list rather than written here.
  const [first] = fileFormat.PAST_BLOCK_LABELS;
  const theme = JSON.parse(oldFile('theme'));
  const unmark = (file, cap) => Object.fromEntries(Object.entries(file).filter(([k]) => !new RegExp(`^[a-z]+${cap}$`).test(k)));
  const themeRest = unmark(theme, 'Theme');
  assert.throws(() => themeFile.readThemeFile({ [`${first}Theme`]: 1, ...themeRest }, sanitize), (e) => e.message === themeFile.OLD_THEME_FILE);
  const template = JSON.parse(oldFile('template'));
  const templateRest = unmark(template, 'Template');
  assert.throws(() => templateFile.readTemplateFile({ [`${first}Template`]: 1, ...templateRest }, { bundled }), (e) => e.message === templateFile.OLD_TEMPLATE_FILE);
  assert.throws(() => readObjects(JSON.stringify({ [`${first}Objects`]: 1, objects: [{ title: 'T', content: 'c' }] })), refusedWith(OLD_OBJECTS));
  // The same files with the new marker are read.
  assert.equal(themeFile.readThemeFile({ ...fileFormat.stamp('theme'), ...themeRest }, sanitize).name, 'Harbour');
  assert.equal(templateFile.readTemplateFile({ ...fileFormat.stamp('template'), ...templateRest }, { bundled }).raw.id, 'travel');
  assert.equal(readObjects(JSON.stringify({ ...fileFormat.stamp('objects'), objects: [{ title: 'T', content: 'c' }] })).objects.length, 1);
  // An unknown key ending in the kind is not an old marker: the file gets its "not a ... file" sentence.
  assert.throws(() => themeFile.readThemeFile({ someTheme: 1, ...themeRest }, sanitize), (e) => e.message === themeFile.NOT_A_THEME_FILE);
  assert.throws(() => templateFile.readTemplateFile({ someTemplate: 1, ...templateRest }, { bundled }), (e) => e.message === templateFile.NOT_A_TEMPLATE_FILE);
  assert.throws(() => readObjects(JSON.stringify({ formatVersion: 1, someObjects: 1, objects: [] })), refusedWith('that is not a .objects.json file'));
});

test('a single object with a key that ends in the kind is read as an object, not refused as an old file', () => {
  const related = readObjects(fixtures('related-key.json'));
  assert.deepEqual([related.objects.length, related.objects[0].title], [1, 'Related']);
  const bare = readObjects('{"title":"A","relatedObjects":3}');
  assert.deepEqual([bare.found, bare.dropped.map((d) => d.why)], [1, ['it has no content']], 'found as one object; dropped only by the object rule');
  assert.equal(readObjects('{"title":"A","content":"c","someObjects":1}').objects.length, 1);
});

test('an answer with a past block label is refused whole: valid or not, closed or not, any case, mixed', () => {
  const answers = oldFixtureNames().filter((f) => f.startsWith('answer-'));
  for (const name of ['answer-first-label.txt', 'answer-second-label.txt', 'answer-capitals-unclosed.txt', 'answer-mixed.txt', 'answer-words-after.txt', 'answer-dash-list.txt', 'answer-star-list.txt', 'answer-numbered-list.txt', 'answer-quote.txt', 'answer-nested-quote.txt', 'answer-indented-crlf.txt']) assert.ok(answers.includes(name), name);
  for (const name of answers) assert.throws(() => readObjects(oldFixture(name)), refusedWith(OLD_ANSWER), name);
  assert.ok(oldFixture('answer-indented-crlf.txt').includes('\r\n'), 'the CRLF fixture keeps its CRLF');
  // A label that only starts with a past label is not an old-named block: read (here by the loose reading).
  assert.deepEqual(readObjects(oldFixture('near-miss-longer-label.txt')).objects.map((o) => o.title), ['Near miss']);
  assert.equal(OLD_ANSWER, 'that answer is in an older format: copy the instructions again and ask the AI for a new answer');
  for (const label of fileFormat.PAST_BLOCK_LABELS) {
    const good = '[{"title":"T","content":"c"}]';
    for (const shown of [label, label.toUpperCase(), label[0].toUpperCase() + label.slice(1)]) {
      assert.throws(() => readObjects(`Intro.\n\`\`\`${shown}\n${good}\n\`\`\``), refusedWith(OLD_ANSWER), `${shown}, valid`);
      assert.throws(() => readObjects(`\`\`\`${shown} \t\nnot json\n\`\`\``), refusedWith(OLD_ANSWER), `${shown}, not JSON`);
      assert.throws(() => readObjects(`\`\`\`${shown}\n${good}`), refusedWith(OLD_ANSWER), `${shown}, unclosed`);
      assert.throws(() => readObjects(`Intro.\r\n\`\`\`${shown}\r\n${good}\r\n\`\`\`\r\n`), refusedWith(OLD_ANSWER), `${shown}, CRLF`);
      assert.throws(() => readObjects(`- one\n  \`\`\`${shown}\n  ${good}\n  \`\`\``), refusedWith(OLD_ANSWER), `${shown}, indented in a list`);
      // Widened after QA (F4): words after the label; inside a -, *, + or numbered list, a quote, a nested quote, and
      // their mixes; indented with CRLF; more backticks.
      for (const fence of [
        `\`\`\`${shown} json`, `\`\`\` ${shown}\ttext`, `\`\`\`${shown}.json`, `- \`\`\`${shown}`, `* \`\`\`${shown}`, `+ \`\`\`${shown}`, `1. \`\`\`${shown}`, `12) \`\`\`${shown}`,
        `> \`\`\`${shown}`, `>\`\`\`${shown}`, `> > \`\`\`${shown}`, `>> \`\`\`${shown}`, `  - > \`\`\`${shown} json`, `> 1. \`\`\`${shown}`, `\t\`\`\`${shown}`, `\`\`\`\`${shown}`,
      ]) {
        assert.throws(() => readObjects(`Intro.\n${fence}\n${good}\n\`\`\``), refusedWith(OLD_ANSWER), JSON.stringify(fence));
        assert.throws(() => readObjects(`Intro.\r\n    ${fence}\r\n${good}\r\n\`\`\`\r\n`), refusedWith(OLD_ANSWER), `${JSON.stringify(fence)}, indented, CRLF`);
      }
    }
    // Not a list or quote marker before the fence, so not a fence: text before it on the line.
    assert.equal(readObjects(`Say \`\`\`${label} and\n{"title":"T","content":"c"}`).objects.length, 1, 'text before the backticks');
    for (const near of [`${label}s`, `${label}-notes`, `${label}_x`, `${label}2`]) {
      assert.equal(readObjects(`\`\`\`${near}\n{"title":"T","content":"c"}\n\`\`\``).objects.length, 1, `${near} is not a past label`);
      assert.equal(readObjects(`- \`\`\`${near} json\n  {"title":"T","content":"c"}\n  \`\`\``).objects.length, 1, `${near} in a list is not a past label`);
    }
    // A word that only starts with a past label is not one.
    assert.equal(readObjects(`\`\`\`${label}x\n{"title":"T","content":"c"}\n\`\`\``).objects.length, 1, `${label}x is not a past label`);
  }
});

test('the objects block and a paste without fences are read; a card block only by the loose reading', () => {
  const noFences = readObjects(fixtures('no-fences.txt'));
  assert.deepEqual(noFences.objects.map((o) => o.title), ['Casa do Largo', 'Bar do Peixe']);
  const card = readObjects(fixtures('card-block.txt'));
  assert.deepEqual(card.objects.map((o) => o.title), ['Loose one', 'Loose two']);
  // Not read as a block: a card block that isn't JSON is not a dropped "not valid JSON" candidate, and a card block
  // beside an objects block adds nothing.
  assert.throws(() => readObjects('```card\nnot json\n```'), (e) => /nothing in that could be read as objects: paste the whole answer, with its objects blocks$/.test(e.message));
  const both = readObjects('```objects\n{"title":"Kept","content":"k"}\n```\n```card\n{"title":"Ignored","content":"i"}\n```');
  assert.deepEqual(both.objects.map((o) => o.title), ['Kept']);
});

// ---- Kinds and their details (plan-object-handoff.md, step 1) ----

const SW = { airline: 'Southwest', number: '1234', from: { code: 'MDW', name: 'Chicago Midway' }, to: { code: 'SJC', name: 'San Jose' }, departs: '2026-11-14T12:50', arrives: '2026-11-14T15:25', reference: 'ABC123' };
// One good value per value type, and what it is kept as.
const GOOD = {
  when: ['2026-11-14T12:50', '2026-11-14T12:50'],
  point: [{ code: 'mdw', name: 'Chicago **Midway**' }, { code: 'MDW', name: 'Chicago Midway' }],
  text: ['**Bold** words', 'Bold words'],
  count: [2, 2],
  minutes: [155, 155],
  flag: [true, true],
  options: [['Yes', 'No', 'Yes', ' ', 3], ['Yes', 'No']],
  upload: ['0123456789abcdef01234567', '0123456789abcdef01234567'],
};
// Values of the wrong type or out of range, per value type: each dropped on its own.
const BAD = {
  when: ['2026-02-30', '2026-11-14T24:00', '2026-11-14T12:60', '12:50pm', 'tomorrow', 1763120000000, '2026-11-14T', ''],
  point: [5, ['MDW'], {}, { code: 'TOOLONGCODE' }, '', '   '],
  text: [12.5, Number.NaN, 2 ** 60, true, ['x'], { a: 1 }, null, '', '<b></b>'],
  count: [0, -1, 1.5, '2', 1000, null],
  minutes: [0, 10081, 2.5, '90'],
  flag: ['true', 1, null],
  options: ['Yes, No', ['Only one'], [1, 2], []],
  upload: ['../etc/passwd', 'ABCDEF0123456789ABCDEF01', '0123', 7],
};

test('the catalogue: 19 kinds, image for handoffs only, every field typed', () => {
  assert.deepEqual(TRAVEL_KINDS, ['flight', 'train', 'bus', 'ferry', 'car', 'hotel', 'restaurant', 'cafe', 'bar', 'sight', 'museum', 'attraction', 'tour', 'show']);
  assert.deepEqual(KINDS, [...TRAVEL_KINDS, 'event', 'task', 'poll', 'note', 'link']);
  assert.deepEqual(HANDOFF_KINDS, ['image']);
  assert.deepEqual(Object.keys(DETAILS), [...KINDS, ...HANDOFF_KINDS]);
  const stop = 'starts ends minutes address';
  const want = {
    flight: 'airline number from to departs arrives minutes terminal gate seat class reference',
    train: 'operator number from to departs arrives minutes platform carriage seat class reference',
    bus: 'operator number from to departs arrives minutes seat reference',
    ferry: 'operator number from to departs arrives minutes cabin seat reference',
    car: 'company from to departs arrives class reference',
    hotel: 'address checkIn checkOut roomType guests reference',
    restaurant: `${stop} partySize name reference`, cafe: `${stop} partySize name reference`, bar: `${stop} partySize name reference`,
    sight: `${stop} tickets reference`, museum: `${stop} tickets reference`, attraction: `${stop} tickets reference`, tour: `${stop} tickets reference`, show: `${stop} tickets reference`,
    event: 'starts ends allDay address', task: 'due', poll: 'options closes multiple', note: '', link: '', image: 'upload name',
  };
  for (const [kind, fields] of Object.entries(want)) assert.deepEqual(Object.keys(DETAILS[kind]), fields.split(' ').filter(Boolean), kind);
  for (const fields of Object.values(DETAILS)) for (const type of Object.values(fields)) assert.match(type, /^(when|point|text:\d+|count:\d+|minutes|flag|options|upload)$/, type);
  assert.equal(DETAILS.flight.reference, 'text:60');
  assert.equal(DETAILS.hotel.guests, 'count:99');
  assert.equal(DETAILS.show.tickets, 'count:999');
  assert.ok(Object.isFrozen(DETAILS) && Object.isFrozen(DETAILS.flight) && Object.isFrozen(TRAVEL_KINDS));
});

test('every kind keeps each of its fields, and drops each bad value and unknown field on its own', () => {
  for (const kind of [...KINDS, ...HANDOFF_KINDS]) {
    const fields = Object.entries(DETAILS[kind]);
    const raw = { unknown: 'x', toString: 'y', __proto__: { inherited: 'z' } };
    const kept = {};
    for (const [name, type] of fields) { raw[name] = GOOD[type.split(':')[0]][0]; kept[name] = GOOD[type.split(':')[0]][1]; }
    assert.deepEqual(cleanDetails(kind, raw), fields.length ? kept : null, kind);
    for (const [name, type] of fields) {
      for (const bad of BAD[type.split(':')[0]]) {
        const out = cleanDetails(kind, { ...kept, [name]: bad });
        const rest = { ...kept }; delete rest[name];
        assert.deepEqual(out, Object.keys(rest).length ? rest : null, `${kind}.${name} = ${JSON.stringify(bad)}`);
      }
    }
  }
  for (const raw of [null, 'x', 5, ['a'], undefined]) assert.equal(cleanDetails('flight', raw), null, JSON.stringify(raw));
  for (const kind of ['nonsense', '', undefined, 'toString', '__proto__']) assert.equal(cleanDetails(kind, { airline: 'X' }), null, String(kind));
});

test('text fields: Markdown and HTML removed, one line, cut at the field length', () => {
  const d = (v, kind = 'flight', field = 'airline') => (cleanDetails(kind, { [field]: v }) || {})[field];
  assert.equal(d('**South**west'), 'Southwest');
  assert.equal(d('_Wanna_ *Get* `Away`'), 'Wanna Get Away');
  assert.equal(d('[Southwest](https://sw.example)'), 'Southwest (https://sw.example)');
  assert.equal(d('# Southwest\n- Airlines'), 'Southwest Airlines');
  assert.equal(d('<i>South</i>west'), 'South west');
  assert.equal(d('snake_case_name'), 'snake_case_name', 'underscores inside a word are kept');
  assert.equal(d('2 * 3 * 4'), '2 * 3 * 4', 'spaced stars are not emphasis');
  assert.equal(d('x'.repeat(100)).length, 60);
  assert.equal(d('y'.repeat(300), 'hotel', 'address').length, 200);
  assert.equal(d('z'.repeat(50), 'flight', 'number').length, 20);
  assert.equal(d('n'.repeat(200), 'image', 'name').length, 120);
  // A whole number is read as its digits; other non-strings are dropped.
  assert.equal(d(1234, 'flight', 'number'), '1234');
  assert.equal(d(0, 'flight', 'gate'), '0');
  assert.equal(d(9007199254740991, 'flight', 'number'), '9007199254740991');
  assert.equal(d(123456789012345678901, 'flight', 'number'), undefined, 'not a safe whole number');
  for (const bad of [12.5, -0.5, Infinity, true, null, ['1234']]) assert.equal(d(bad, 'flight', 'number'), undefined, String(bad));
  assert.deepEqual(cleanObject({ kind: 'flight', title: 'SW 1234', details: { airline: 'Southwest', number: 1234 } }).details, { airline: 'Southwest', number: '1234' });
});

test('when: three shapes, zone and seconds dropped keeping the clock time, impossible ones dropped', () => {
  const w = (v) => (cleanDetails('event', { starts: v }) || {}).starts;
  assert.equal(w('2026-11-14T12:50'), '2026-11-14T12:50');
  assert.equal(w('2026-11-14'), '2026-11-14');
  assert.equal(w('12:50'), '12:50');
  assert.equal(w('9:05'), '09:05');
  assert.equal(w('2026-11-14 12:50'), '2026-11-14T12:50', 'a space for the T');
  assert.equal(w(' 2026-11-14T12:50 '), '2026-11-14T12:50');
  assert.equal(w('2026-11-14T12:50:30'), '2026-11-14T12:50', 'seconds dropped');
  assert.equal(w('2026-11-14T12:50:30.123Z'), '2026-11-14T12:50');
  assert.equal(w('2026-11-14T12:50Z'), '2026-11-14T12:50', 'a Z dropped, the clock time kept');
  assert.equal(w('2026-11-14T12:50-05:00'), '2026-11-14T12:50', 'an offset dropped, the clock time kept');
  assert.equal(w('2026-11-14T23:50+0530'), '2026-11-14T23:50');
  assert.equal(w('2026-11-14t00:00z'), '2026-11-14T00:00');
  assert.equal(w('15:25+01:00'), '15:25');
  assert.equal(w('2024-02-29'), '2024-02-29');
  for (const bad of ['2025-02-29', '2026-13-01', '2026-11-31T10:00', '2026-11-14T24:00', '25:00', '12:5', '12h50', '2026-11-14T12:50 PST', '2026-11-14Z', 'T12:50', '2026/11/14']) assert.equal(w(bad), undefined, bad);
});

test('point: from a string or an object', () => {
  const p = (v) => (cleanDetails('train', { from: v }) || {}).from;
  assert.deepEqual(p('MDW'), { code: 'MDW' });
  assert.deepEqual(p(' SJC '), { code: 'SJC' });
  assert.deepEqual(p('mdw'), { name: 'mdw' }, 'only three capitals are a code');
  assert.deepEqual(p('MDWX'), { name: 'MDWX' });
  assert.deepEqual(p('Lisboa Santa Apolónia'), { name: 'Lisboa Santa Apolónia' });
  assert.deepEqual(p({ code: 'lis', name: 'Lisbon' }), { code: 'LIS', name: 'Lisbon' });
  assert.deepEqual(p({ code: 'K', name: 'Lisbon' }), { name: 'Lisbon' }, 'a bad code dropped, the name kept');
  assert.deepEqual(p({ code: 'EGLL1', extra: 1 }), { code: 'EGLL1' });
  assert.equal(p({ code: 'K' }), undefined);
  assert.equal(p('n'.repeat(200)).name.length, 120);
});

test('details on an object: kept with a kind; dropped without one; image only in a handoff', () => {
  const sw = cleanObject({ icon: 'plane', kind: 'flight', title: 'Southwest 1234', content: 'Window seat.', date: '2026-11-14', details: SW }, { imported: true });
  assert.deepEqual(sw.details, SW);
  assert.equal(sw.content, 'Window seat.');
  const noKind = cleanObject({ title: 'T', content: 'c', details: SW }, { imported: true });
  assert.equal('details' in noKind, false, 'details without a kind dropped');
  const badKind = cleanObject({ title: 'T', content: 'c', kind: 'spaceship', details: SW }, { imported: true });
  assert.deepEqual([badKind.kind, 'details' in badKind], [undefined, false]);
  const wrongKind = cleanObject({ title: 'T', content: 'c', kind: 'task', details: SW }, { imported: true });
  assert.equal('details' in wrongKind, false, 'another kind\'s fields dropped');
  for (const kind of ['event', 'task', 'poll', 'note', 'link']) assert.equal(cleanObject({ title: 'T', content: 'c', kind }).kind, kind);
  const pic = { kind: 'image', title: 'Beach', details: { upload: '0123456789abcdef01234567', name: 'beach.jpg' } };
  assert.equal(cleanObject(pic, { imported: true }), null, 'imported: no kind, so no details and no content');
  assert.equal(cleanObject(pic), null, 'an AI answer never keeps image');
  assert.deepEqual(cleanObject({ ...pic, content: 'c' }, { imported: true }).kind, undefined);
  assert.deepEqual(cleanObject(pic, { handoff: true }), { icon: 'note', title: 'Beach', basis: 'general', kind: 'image', details: { upload: '0123456789abcdef01234567', name: 'beach.jpg' } });
  assert.deepEqual(cleanObject({ title: 'T', content: 'c', kind: 'image' }, { handoff: true }).kind, 'image');
});

test('content may be left out when details keep a field; title stays required', () => {
  const only = cleanObject({ kind: 'flight', title: 'Southwest 1234', details: SW }, { imported: true });
  assert.deepEqual(only, { icon: 'note', title: 'Southwest 1234', basis: 'imported', kind: 'flight', details: SW });
  assert.equal('content' in only, false);
  assert.equal(cleanObject({ kind: 'flight', title: 'X', details: { seat: true, bogus: 'y' } }, { imported: true }), null, 'details that keep nothing');
  assert.equal(cleanObject({ kind: 'note', title: 'X', details: { a: 1 } }, { imported: true }), null, 'a note has no details');
  assert.equal(cleanObject({ kind: 'flight', details: SW }, { imported: true }), null, 'no title');
  const out = readObjects(JSON.stringify([
    { kind: 'flight', title: 'Out', details: SW },
    { kind: 'flight', title: 'No details' },
    { title: 'No kind', details: SW },
    { kind: 'image', title: 'Picture', details: { upload: '0123456789abcdef01234567' } },
    { kind: 'flight', details: SW },
    { kind: 'poll', title: 'Where to eat?', details: { options: ['Tasca', 'Marisqueira'], closes: '2026-11-13T18:00', multiple: false } },
  ]));
  assert.deepEqual(out.objects.map((o) => o.title), ['Out', 'Where to eat?']);
  assert.deepEqual(out.dropped, [
    { at: 2, why: 'it has no content' }, { at: 3, why: 'it has no content' }, { at: 4, why: 'it is a picture' }, { at: 5, why: 'it has no title' },
  ]);
  // A picture with words of its own is kept as an object with no kind.
  assert.deepEqual(readObjects('{"kind":"image","title":"Beach","content":"Sunset."}').objects.map((o) => [o.title, o.kind]), [['Beach', undefined]]);
  assert.deepEqual(out.objects[1].details, { options: ['Tasca', 'Marisqueira'], closes: '2026-11-13T18:00', multiple: false });
});

test('Thomas\'s Southwest flight (#182) in an objects block, and as a file, keeps its details', () => {
  const obj = { icon: 'plane', kind: 'flight', title: 'Southwest 1234, Chicago to San Jose', date: '2026-11-14', details: { ...SW, departs: '2026-11-14T12:50:00', arrives: '3:25 PM' } };
  const block = readObjects(`Your flight:\n\`\`\`objects\n${JSON.stringify([obj])}\n\`\`\``);
  const want = { ...SW }; delete want.arrives;
  assert.deepEqual(block.objects[0].details, want, '3:25 PM is not a when; the rest kept');
  const file = readObjects(JSON.stringify({ format: 'objects', formatVersion: 1, objects: [obj] }));
  assert.deepEqual(file.objects, block.objects);
});

test('/ai answers keep details; an object kept twice is the same', () => {
  const out = parseSummaries('```objects\n' + JSON.stringify([{ kind: 'flight', title: 'SW 1234', details: SW, sources: [1] }, { kind: 'task', title: 'Check in', content: 'Online.', details: { due: '2026-11-13T12:50' } }]) + '\n```', 1);
  assert.equal(out.summaries.length, 2);
  assert.deepEqual(out.summaries[0], { icon: 'note', title: 'SW 1234', basis: 'items', kind: 'flight', details: SW, sources: [1] });
  assert.deepEqual(out.summaries[1].details, { due: '2026-11-13T12:50' });
  for (const s of out.summaries) assert.equal(JSON.stringify(cleanObject(s, { count: 1 })), JSON.stringify(s));
});

test('the schema\'s details match the catalogue', () => {
  const s = schema();
  const obj = s.$defs.object;
  assert.deepEqual(obj.required, ['title']);
  assert.deepEqual(obj.anyOf, [{ required: ['content'] }, { required: ['kind', 'details'] }]);
  assert.equal(obj.properties.details.type, 'object');
  assert.ok(!obj.properties.kind.enum.includes('image'), 'image is never asked of an AI');
  assert.deepEqual(obj.allOf.map((r) => r.if.properties.kind.const), KINDS);
  // The schema refuses details the reader would drop whole: empty, only unknown fields, or on a kind with none.
  assert.equal(obj.properties.details.minProperties, 1);
  for (const kind of KINDS) {
    const rule = obj.allOf.find((r) => r.if.properties.kind.const === kind);
    assert.equal(rule.then.properties.details.$ref, `#/$defs/details-${kind}`);
    const def = s.$defs[`details-${kind}`];
    if (!Object.keys(DETAILS[kind]).length) { assert.equal(def, false, `${kind} takes no details`); continue; }
    assert.deepEqual(def.anyOf, Object.keys(DETAILS[kind]).map((name) => ({ required: [name] })), `${kind}: at least one of its fields`);
    assert.deepEqual(Object.keys(def.properties), Object.keys(DETAILS[kind]), kind);
    for (const [name, type] of Object.entries(DETAILS[kind])) {
      const p = def.properties[name];
      const [base, arg] = type.split(':');
      if (base === 'text') assert.deepEqual(p, { type: 'string', minLength: 1, maxLength: +arg }, `${kind}.${name}`);
      if (base === 'count') assert.deepEqual([p.type, p.minimum, p.maximum], ['integer', 1, +arg], `${kind}.${name}`);
      if (base === 'minutes') assert.deepEqual([p.type, p.minimum, p.maximum], ['integer', 1, 10080]);
      if (base === 'flag') assert.equal(p.type, 'boolean');
      if (base === 'options') assert.deepEqual([p.minItems, p.maxItems, p.items.maxLength], [2, 10, 80]);
      if (base === 'when') {
        for (const v of ['2026-11-14T12:50', '2026-11-14', '12:50', '23:59', '2026-12-31T00:00']) assert.match(v, new RegExp(p.pattern), v);
        for (const v of ['2026-13-01', '2026-11-32', '24:00', '12:60', '2026-11-14T12:50Z', '9:05']) assert.doesNotMatch(v, new RegExp(p.pattern), v);
      }
      if (base === 'point') {
        assert.deepEqual(p.oneOf.map((o) => o.type), ['string', 'object']);
        assert.deepEqual(p.oneOf[1].anyOf, [{ required: ['code'] }, { required: ['name'] }]);
      }
    }
  }
  assert.equal(s.$defs['details-image'], undefined);
  // What the checker keeps fits the schema.
  const kept = cleanObject({ kind: 'flight', title: 'SW', details: SW });
  for (const [name, v] of Object.entries(kept.details)) {
    const p = s.$defs['details-flight'].properties[name];
    if (p.pattern) assert.match(v, new RegExp(p.pattern), name);
    if (p.maxLength) assert.ok(v.length <= p.maxLength, name);
    if (p.oneOf) assert.match(v.code, new RegExp(p.oneOf[1].properties.code.pattern), name);
  }
});

test('old files, pastes and stored AI answers read exactly as before details', () => {
  const before = JSON.parse(fixtures('before-details.json'));
  const run = (fn) => { try { return { out: fn() }; } catch (e) { return { error: [e.status, e.message] }; } };
  const named = fs.readdirSync(new URL('./fixtures/object-format/', import.meta.url)).filter((f) => f !== 'before-details.json').sort();
  assert.deepEqual(before.cases.filter((c) => c.file).map((c) => c.file), named, 'every fixture file was recorded');
  for (const c of before.cases) {
    const got = run(() => readObjects(c.file ? fixtures(c.file) : c.text));
    assert.equal(JSON.stringify(got), JSON.stringify(c.expect), c.name);
  }
  for (const a of before.answers) {
    const got = parseSummaries(a.text, a.count);
    assert.equal(JSON.stringify(got), JSON.stringify(a.expect), a.name);
    // A stored summary (chat.json, chat-private.json, ai-threads.json) is the same when cleaned again.
    for (const s of a.expect.summaries) assert.equal(JSON.stringify(cleanObject(s, { count: a.count })), JSON.stringify(s), a.name);
  }
  // The copied instructions as built from the modules' `takes` (plan step 3): with no `takes` declared (the travel kinds, as
  // before) and with every kind taken (the plan's text). paste@1 is that text word for word; the in-app prompts have their
  // own golden files (tools/check-prompts.mjs).
  assert.equal(instructions('object'), before.prompts.instructions);
  assert.equal(instructions('object', { kinds: KINDS }), before.prompts.instructionsEveryKind);
});

test('a booking keeps its travel kind rather than "event" when both are listed', () => {
  const sentence = (kinds) => `For a booking or a stop on a trip, use its own kind (${kinds}) rather than "event", even when it happens at a set time; use "event" only for anything else on a day, such as an appointment or a party.`;
  const rule = (kinds) => objectRule({ fence: 'objects', noun: 'object', max: 50, kinds });
  // Every kind: all 14 travel kinds, in KINDS order, right after the kind line, in both prompts.
  const every = rule(KINDS);
  const all = sentence('flight, train, bus, ferry, car, hotel, restaurant, cafe, bar, sight, museum, attraction, tour or show');
  assert.ok(every.includes(`Leave it out only when none fits.\n${all}\n`), 'directly after the kind line');
  assert.ok(instructions('object', { kinds: KINDS }).includes(all));
  assert.ok(askSystem(KINDS).includes(all));
  // Only the travel kinds listed, joined as the kind line joins them, whatever order they are given in.
  assert.ok(rule(['event', 'tour', 'hotel', 'task']).includes(sentence('hotel or tour')));
  assert.ok(rule(['museum', 'event']).includes(sentence('museum')));
  assert.ok(rule(['flight', 'train', 'event']).includes(sentence('flight or train')));
  // Absent with no event, or no travel kind.
  for (const kinds of [TRAVEL_KINDS, ['flight', 'task'], ['event', 'task', 'note'], ['event'], [], KINDS.filter((k) => k !== 'event')]) {
    assert.ok(!rule(kinds).includes('For a booking or a stop on a trip'), kinds.join(','));
  }
  assert.ok(!instructions('object').includes('For a booking or a stop on a trip'), 'the default, travel kinds only');
  assert.ok(!askSystem().includes('For a booking or a stop on a trip'));
});

test('crafted text cannot stall a read: 120 KB in any field reads in under 100 ms', () => {
  const big = 120000;
  const crafted = {
    'brackets': '['.repeat(big / 2) + ']('.repeat(big / 4),
    'picture marks': '!['.repeat(big / 2),
    'tags never closed': '<'.repeat(big),
    'emphasis never closed': '**a'.repeat(big / 3) + '__',
    'stars': '*a '.repeat(big / 3),
    'quote marks': '> '.repeat(big / 2) + 'x',
  };
  for (const [name, text] of Object.entries(crafted)) {
    const objects = {
      'hotel address': { kind: 'hotel', title: 'T', details: { address: text } },
      'point names': { kind: 'train', title: 'T', details: { from: { name: text }, to: text } },
      'poll options': { kind: 'poll', title: 'T', details: { options: [text, `${text}x`] } },
      'content': { title: 'T', content: text },
      'title': { title: text, content: 'c' },
    };
    for (const [where, obj] of Object.entries(objects)) {
      const file = JSON.stringify([obj]);
      const t = process.hrtime.bigint();
      readObjects(file);
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      assert.ok(ms < 100, `${name} in ${where}: ${ms.toFixed(0)} ms`);
    }
  }
  // The link pattern still reads ordinary links, but never across a "[".
  assert.equal(cleanDetails('hotel', { address: '[Casa](https://casa.example) [x [Rua](https://r.example)' }).address, 'Casa (https://casa.example) [x Rua (https://r.example)');
});

console.log(`check-object-format: OK (${n} checks)`);
