#!/usr/bin/env node
/*
 * check-vendored-hashes.mjs -- a vendored library is exactly the file that was read and licensed
 * (plan-documents.md "Server half", step 5; the pattern of check-vault.mjs part 0, which pins pdf.js).
 *
 * Where the pins live: the SHA-256 column of the table in the module's THIRD-PARTY.md (tools/vendored-lib.mjs says why it is
 * there and not in a JSON beside it). Unlike check-vault.mjs, whose pins sit in the check, a module's pins sit with the module's
 * name, version and licence, so replacing a library is one reviewed change to one document and the file.
 * For each module in tools/vendored-scope.json "covered": every table row has a 64-hex SHA-256 and the file's hash equals it. A
 * changed file, a missing hash, a malformed hash and a missing file fail.
 *
 * NAMED EXEMPTIONS from safety rule 1 (plan-documents.md: nothing reaches innerHTML). A vendored bundle may contain an innerHTML
 * line that was read and judged safe (the first: ProseMirror's clipboard reader). THIRD-PARTY.md holds them in a fenced block:
 *
 *     ```innerhtml-exemptions
 *     [ { "file": "src/x.js", "sha256": "<of that exact file>", "line": "<the exact line text>", "reason": "<why it is safe>" } ]
 *     ```
 *
 * An exemption is valid only while the file's hash equals the pinned hash AND the exemption's sha256, and the line is still a
 * line of the file. Otherwise this check fails and says the exemption needs re-reading. The hook for
 * tools/check-documents-safety.mjs (when it exists) is isExemptFromInnerHtml(root, moduleId, file, lineText) in
 * tools/vendored-lib.mjs, true only for a valid exemption. There are no real exemptions yet; the EXAMPLE below is a fixture.
 * The check then proves itself on hostile fixtures in a temporary folder.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadScope, checkHashes, isExemptFromInnerHtml, readThirdParty, sha256 } from './vendored-lib.mjs';

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('FAIL ' + m); } else console.log('ok   ' + m); };

const scope = loadScope();
ok(scope.problems.length === 0, `every module is covered or listed as not covered${scope.problems.map((p) => '\n     ' + p).join('')}`);
const real = checkHashes(ROOT, scope.covered);
ok(real.length === 0, `vendored files in ${scope.covered.join(', ')} match their pinned SHA-256${real.map((p) => '\n     ' + p).join('')}`);
for (const id of scope.covered) {
  const n = readThirdParty(ROOT, id).exemptions.length;
  ok(true, `modules/${id}: ${readThirdParty(ROOT, id).entries.length} pinned file(s), ${n} innerHTML exemption(s)`);
}

// --- hostile fixtures -------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-hashes-'));
let n = 0;
const BUNDLE = 'var a = 1;\nfunction paste(html, el) {\n  el.innerHTML = html; // EXAMPLE: the clipboard line of a future editor bundle\n}\n';
const LINE = '  el.innerHTML = html; // EXAMPLE: the clipboard line of a future editor bundle';
// o.body: the file; o.pin: the pinned hash (default the real one); o.exempt: the exemption list (default none).
function fixture(o = {}) {
  const root = path.join(tmp, 'r' + n++);
  const m = path.join(root, 'modules', 'm');
  fs.mkdirSync(path.join(m, 'src'), { recursive: true });
  const body = o.body ?? BUNDLE;
  fs.writeFileSync(path.join(m, 'src', 'lib.js'), body);
  const pin = o.pin === undefined ? sha256(Buffer.from(BUNDLE)) : o.pin;
  const ex = o.exempt ? `\n\`\`\`innerhtml-exemptions\n${typeof o.exempt === 'string' ? o.exempt : JSON.stringify(o.exempt, null, 2)}\n\`\`\`\n` : '';
  fs.writeFileSync(path.join(m, 'THIRD-PARTY.md'),
    `# Third-party\n\n| Name | Version | SPDX | File | SHA-256 | Licence file | Source |\n|---|---|---|---|---|---|---|\n| lib | 1.0.0 | MIT | \`src/lib.js\` | ${pin} | vendor/LICENSE.lib | https://example.test |\n${ex}`);
  return root;
}
const good = { file: 'src/lib.js', sha256: sha256(Buffer.from(BUNDLE)), line: LINE, reason: 'EXAMPLE: the HTML is parsed into a detached document and only the allowed nodes are copied' };
const run = (root) => checkHashes(root, ['m']);
const fails = (name, root, re) => { const p = run(root); ok(p.length > 0 && p.some((x) => re.test(x)), `${name} fails (${p[0] ? p[0].slice(0, 120) : 'no problem found'})`); };

ok(run(fixture()).length === 0, 'fixture: a file with its pinned hash passes');
fails('a changed file', fixture({ body: BUNDLE + '// one more line\n' }), /not the pinned file/);
fails('a changed file by one byte', fixture({ body: BUNDLE.replace('var a = 1', 'var a = 2') }), /not the pinned file/);
fails('a missing hash', fixture({ pin: '' }), /no SHA-256 is pinned/);
fails('a malformed hash', fixture({ pin: 'abc123' }), /not 64 hex digits/);
fails('an upper-case wrong hash', fixture({ pin: 'F'.repeat(64) }), /not the pinned file/);
{ const r = fixture(); fs.rmSync(path.join(r, 'modules', 'm', 'src', 'lib.js')); fails('a missing file', r, /does not exist/); }
{ const r = fixture(); fs.rmSync(path.join(r, 'modules', 'm', 'THIRD-PARTY.md')); fails('a missing THIRD-PARTY.md', r, /THIRD-PARTY\.md is missing/); }

// exemptions
{
  const r = fixture({ exempt: [good] });
  ok(run(r).length === 0, 'fixture (EXAMPLE exemption): a valid exemption passes the check');
  ok(isExemptFromInnerHtml(r, 'm', 'src/lib.js', LINE) === true, 'fixture (EXAMPLE exemption): the hook says the named line is exempt');
  ok(isExemptFromInnerHtml(r, 'm', 'src/lib.js', '  other.innerHTML = x;') === false, 'fixture: the hook says another innerHTML line is not exempt');
  ok(isExemptFromInnerHtml(r, 'm', 'src/other.js', LINE) === false, 'fixture: the hook says the same text in another file is not exempt');
}
{
  const changed = BUNDLE + 'var more = 2;\n'; // a re-built bundle; the exemption and the pin are the old ones
  const r = fixture({ body: changed, exempt: [good] });
  fails('an exemption whose bundle changed (pin and exemption both old)', r, /needs re-reading/);
  ok(isExemptFromInnerHtml(r, 'm', 'src/lib.js', LINE) === false, 'fixture: the hook stops exempting a changed bundle');
  const r2 = fixture({ body: changed, pin: sha256(Buffer.from(changed)), exempt: [good] });
  fails('a bundle re-pinned without re-reading the exemption', r2, /needs re-reading/);
  ok(isExemptFromInnerHtml(r2, 'm', 'src/lib.js', LINE) === false, 'fixture: the hook says no when only the pin was updated');
  const r3 = fixture({ body: changed, pin: sha256(Buffer.from(changed)), exempt: [{ ...good, sha256: sha256(Buffer.from(changed)) }] });
  ok(run(r3).length === 0, 'fixture: pin and exemption updated together (the line re-read) passes');
}
fails('an exemption whose line is not in the file', fixture({ exempt: [{ ...good, line: '  el.innerHTML = other;' }] }), /not a line of src\/lib\.js/);
fails('an exemption with no reason', fixture({ exempt: [{ ...good, reason: '' }] }), /"reason" is missing/);
fails('an exemption with no line', fixture({ exempt: [{ file: good.file, sha256: good.sha256, reason: 'x' }] }), /"line" is missing/);
fails('an exemption for a file not in the table', fixture({ exempt: [{ ...good, file: 'src/other.js' }] }), /not a vendored file in the table/);
fails('an exemption with a wrong hash', fixture({ exempt: [{ ...good, sha256: 'a'.repeat(64) }] }), /needs re-reading/);
fails('an exemptions block that is not JSON', fixture({ exempt: '[ {oops' }), /not a JSON array/);
fails('an exemptions block that is an object', fixture({ exempt: '{"file":"x"}' }), /not a JSON array/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\ncheck-vendored-hashes: all passed');
process.exit(failed ? 1 : 0);
