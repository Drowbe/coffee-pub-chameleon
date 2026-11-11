#!/usr/bin/env node
/*
 * check-third-party-licences.mjs -- every vendored library is free for commercial use, and says so in its own LICENSE file
 * (plan-documents.md decision 8; plan-documents-rich-editor.md "Vendoring").
 *
 * For each module in tools/vendored-scope.json "covered": every row of its THIRD-PARTY.md table (tools/vendored-lib.mjs) needs
 * a name, version, SPDX id and source; the vendored file must exist; its LICENSE file must be kept in the module's vendor/
 * folder (or beside the file); the LICENSE text, found by well-known wording and not by trusting the entry, must be one of
 * MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, and the entry's SPDX id must be one the text really is. GPL, AGPL,
 * LGPL, PSF, source-available text, an unknown text, a missing LICENSE, an entry with none, a file in vendor/ no entry names
 * and an entry for a file that is not there all fail.
 * The check then proves itself on hostile fixtures in a temporary folder.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadScope, checkLicences, detectLicences } from './vendored-lib.mjs';

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('FAIL ' + m); } else console.log('ok   ' + m); };

// --- the repository ---------------------------------------------------------------------------------------------------
const scope = loadScope();
ok(scope.problems.length === 0, `every module is covered or listed as not covered${scope.problems.map((p) => '\n     ' + p).join('')}`);
const real = checkLicences(ROOT, scope.covered);
ok(real.length === 0, `vendored licences in ${scope.covered.join(', ')}${real.map((p) => '\n     ' + p).join('')}`);

// --- the licence texts it must know (and the ones it must not) ---------------------------------------------------------
const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in the Software without restriction.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n';
const GPL = 'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n\nEveryone is permitted to copy and distribute verbatim copies of this license document.\n';
const LGPL = 'GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n';
const AGPL = 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n';
const PSF = 'PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2\n';
const APACHE = '                                 Apache License\n                           Version 2.0, January 2004\n   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\n';
const BSD2 = 'Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n1. Redistributions of source code must retain the notice.\n2. Redistributions in binary form must reproduce the notice.\n';
const BSD3 = BSD2 + '3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products.\n';
const ISC = 'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is permitted, provided that the above notice appears.\n';
const MPL = 'Mozilla Public License Version 2.0\n1.1. "Contributor" ... Covered Software ...\n';
const is = (t, ...ids) => JSON.stringify(detectLicences(t).allowed) === JSON.stringify(ids) && detectLicences(t).forbidden.length === 0;
ok(is(MIT, 'MIT') && is(APACHE, 'Apache-2.0') && is(BSD2, 'BSD-2-Clause') && is(BSD3, 'BSD-3-Clause') && is(ISC, 'ISC') && is(MPL, 'MPL-2.0'), 'the six allowed licences are each recognised by their text');
ok(detectLicences(GPL).forbidden[0] === 'GPL' && detectLicences(LGPL).forbidden[0] === 'LGPL' && detectLicences(AGPL).forbidden[0] === 'AGPL' && detectLicences(PSF).forbidden[0] === 'PSF', 'GPL, LGPL, AGPL and PSF text are recognised as forbidden');
ok(!detectLicences('Do what you like with this.').allowed.length, 'an unknown text is not an allowed licence');

// --- hostile fixtures -------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-licences-'));
let n = 0;
// Builds modules/m/ with a library file and a THIRD-PARTY.md; `o` bends one thing.
function fixture(o = {}) {
  const root = path.join(tmp, 'r' + n++);
  const m = path.join(root, 'modules', 'm');
  fs.mkdirSync(path.join(m, 'vendor'), { recursive: true });
  fs.mkdirSync(path.join(m, 'src'));
  fs.writeFileSync(path.join(m, 'src', 'lib.js'), 'var lib = 1;\n');
  if (o.licence !== null) fs.writeFileSync(path.join(m, 'vendor', o.licenceName || 'LICENSE.lib'), o.licence ?? MIT);
  const row = ['lib', '1.0.0', o.spdx ?? 'MIT', o.file ?? 'src/lib.js', 'a'.repeat(64), o.licenceFile ?? 'vendor/LICENSE.lib', 'https://example.test/lib'];
  if (o.skip) row[o.skip] = '';
  fs.writeFileSync(path.join(m, 'THIRD-PARTY.md'), `# Third-party\n\n| Name | Version | SPDX | File | SHA-256 | Licence file | Source |\n|---|---|---|---|---|---|---|\n${o.noEntry ? '' : '| ' + row.join(' | ') + ' |'}\n`);
  if (o.extra) fs.writeFileSync(path.join(m, 'vendor', o.extra), 'x');
  return root;
}
const run = (root) => checkLicences(root, ['m']);
const fails = (name, root, re) => { const p = run(root); ok(p.length > 0 && p.some((x) => re.test(x)), `${name} fails (${p[0] || 'no problem found'})`); };
ok(run(fixture()).length === 0, 'fixture: an MIT library with its LICENSE and an entry passes');
ok(run(fixture({ licence: BSD3, spdx: 'BSD-3-Clause' })).length === 0, 'fixture: BSD-3-Clause passes');
ok(run(fixture({ licence: MIT + '\n' + BSD3 })).length === 0, 'fixture: a LICENSE holding MIT and BSD-3 text (as marked ships) passes with an MIT entry');
fails('GPL text', fixture({ licence: GPL, spdx: 'GPL-3.0' }), /not allowed/);
fails('GPL text under an MIT entry', fixture({ licence: GPL }), /GPL, which is not allowed/);
fails('LGPL text', fixture({ licence: LGPL }), /LGPL/);
fails('AGPL text', fixture({ licence: AGPL }), /AGPL/);
fails('PSF text', fixture({ licence: PSF }), /PSF/);
fails('MIT text with a GPL section added', fixture({ licence: MIT + '\n' + GPL }), /GPL/);
fails('a missing LICENSE file', fixture({ licence: null }), /licence file vendor\/LICENSE\.lib is missing/);
fails('an entry with no licence file', fixture({ skip: 5 }), /no licence file/);
fails('an entry that says MIT while the file is Apache', fixture({ licence: APACHE }), /entry says MIT but the text .* is Apache-2\.0/);
fails('an entry that says GPL-3.0', fixture({ spdx: 'GPL-3.0' }), /GPL-3\.0" is not allowed/);
fails('an entry with an unknown licence id', fixture({ spdx: 'Proprietary' }), /not allowed/);
fails('an unknown licence text', fixture({ licence: 'You may use this on Tuesdays.' }), /not a licence this check knows/);
fails('an empty LICENSE file', fixture({ licence: '' }), /not a licence this check knows/);
fails('an entry for a file that does not exist', fixture({ file: 'src/gone.js' }), /file src\/gone\.js does not exist/);
fails('an entry that points outside the module', fixture({ file: '../../escape.js' }), /not a path inside the module/);
fails('a licence file not named like one', fixture({ licenceName: 'readme.txt', licenceFile: 'vendor/readme.txt' }), /not named like a licence file/);
fails('an entry with no version', fixture({ skip: 1 }), /version is empty/);
fails('an entry with no source', fixture({ skip: 6 }), /source is empty/);
fails('a file in vendor/ with no entry', fixture({ extra: 'other.js' }), /vendor\/other\.js is vendored but has no/);
fails('vendor/ files and no entries', fixture({ noEntry: true }), /is a licence file no THIRD-PARTY\.md entry names/);
{ const r = fixture(); fs.rmSync(path.join(r, 'modules', 'm', 'THIRD-PARTY.md')); fails('a vendor/ folder with no THIRD-PARTY.md', r, /THIRD-PARTY\.md is missing/); }

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\ncheck-third-party-licences: all passed');
process.exit(failed ? 1 : 0);
