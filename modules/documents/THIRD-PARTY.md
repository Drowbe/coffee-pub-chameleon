# Third-party code in the Documents module

**Audience:** whoever redistributes or audits the Documents module.

Everything here is free for commercial use and redistribution. Nothing is loaded from outside.

| Piece | Where | Licence | Source |
|---|---|---|---|
| marked 18.2.0 (Markdown lexer only; its HTML output is never used) | `src/documents-lib-0-marked.js` (the package's `lib/marked.umd.js` with its `sourceMappingURL` comment line removed; its licence header is kept at the top). SHA-256 of the package file: `392f4df89533b50f1dadff3f6dc0952350bd39c9f17def50a0374ef47d6147ef` | MIT (`vendor/LICENSE.marked`, copied from the package) | https://github.com/markedjs/marked, npm `marked@18.2.0` |
| ProseMirror (the rich editor's document model, editing and Markdown writer): 16 packages in one file. Used by the opt-in Rich text editor | `src/documents-lib-0-prosemirror.js` (built once with esbuild from the npm packages; the recipe is below). 282,661 bytes, 90,386 gzipped. Its header holds each package's copyright line and the MIT text | MIT, each package (`vendor/LICENSE.<package>`, each copied from its package) | npm, the versions in the table below |

| Name | Version | SPDX | File | SHA-256 | Licence file | Source |
|---|---|---|---|---|---|---|
| marked | 18.2.0 | MIT | `src/documents-lib-0-marked.js` | `14a9dd96ae1179e626a9a1df1837b8dccf865333cb8e2fe09355f80fc2410590` | `vendor/LICENSE.marked` | https://github.com/markedjs/marked, npm `marked@18.2.0` |
| prosemirror-model | 1.25.13 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-model` | npm `prosemirror-model@1.25.13` |
| prosemirror-transform | 1.12.5 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-transform` | npm `prosemirror-transform@1.12.5` |
| prosemirror-state | 1.4.4 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-state` | npm `prosemirror-state@1.4.4` |
| prosemirror-view | 1.42.9 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-view` | npm `prosemirror-view@1.42.9` |
| prosemirror-commands | 1.7.2 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-commands` | npm `prosemirror-commands@1.7.2` |
| prosemirror-keymap | 1.2.3 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-keymap` | npm `prosemirror-keymap@1.2.3` |
| prosemirror-history | 1.5.1 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-history` | npm `prosemirror-history@1.5.1` |
| prosemirror-inputrules | 1.5.1 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-inputrules` | npm `prosemirror-inputrules@1.5.1` |
| prosemirror-schema-list | 1.6.0 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-schema-list` | npm `prosemirror-schema-list@1.6.0` |
| prosemirror-tables | 1.8.5 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-tables` | npm `prosemirror-tables@1.8.5` |
| prosemirror-dropcursor | 1.8.4 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-dropcursor` | npm `prosemirror-dropcursor@1.8.4` |
| prosemirror-gapcursor | 1.4.1 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-gapcursor` | npm `prosemirror-gapcursor@1.4.1` |
| prosemirror-markdown (its `src/to_markdown.ts` only) | 1.13.9 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.prosemirror-markdown` | npm `prosemirror-markdown@1.13.9` |
| orderedmap | 2.1.1 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.orderedmap` | npm `orderedmap@2.1.1` |
| rope-sequence | 1.3.4 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.rope-sequence` | npm `rope-sequence@1.3.4` |
| w3c-keyname | 2.2.8 | MIT | `src/documents-lib-0-prosemirror.js` | `e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131` | `vendor/LICENSE.w3c-keyname` | npm `w3c-keyname@2.2.8` |

The hash in the table is enforced by `tools/check-vendored-hashes.mjs`. For marked it pins the file in this repository (the package's `lib/marked.umd.js` with its `sourceMappingURL` line removed), not the npm package file; the package file's own hash is the one in the first table. For ProseMirror every row pins the one built file: one row for each package, so each package has its version and its own LICENSE file checked by `tools/check-third-party-licences.mjs`.

On any marked or ProseMirror upgrade, re-run the corpus tests (`modules/documents/test/check-documents-lib.mjs`, `modules/documents/test/check-documents-rich.mjs`, also with `--fuzz=4000`, and `modules/documents/test/check-documents-rich-write.mjs`, also with `--report`), and update the pinned hash in the table when a file changes.

## The ProseMirror file: what is in it, and how to build it again

**In it:** everything these twelve packages export (prosemirror-model, -transform, -state, -view, -commands, -keymap, -history, -inputrules, -schema-list, -tables, -dropcursor, -gapcursor), the three small packages they need (orderedmap, rope-sequence, w3c-keyname), and `MarkdownSerializer` and `MarkdownSerializerState` from the one source file `src/to_markdown.ts` of prosemirror-markdown. **Not in it:** the rest of prosemirror-markdown (its Markdown reader), and so no `markdown-it` and none of its dependencies (`argparse` carries the Python Software Foundation licence, which is not allowed). The file is one plain script that makes one object, `DlPM`. It touches no page when it loads, so the tests run it in Node.

**The recipe.** Built with esbuild 0.28.2 on Node 22. npm packages are data here: nothing is installed and no package script runs. The same inputs gave the same file, byte for byte, in two different folders.

1. In a new, empty folder, fetch the 16 package files with `npm pack <name>@<version> --ignore-scripts` (the names and versions in the table). Their SHA-256:
   - `prosemirror-model-1.25.13.tgz` `d7cb62718cc012c2eeda679512d3f409220ab15a782fe8a61bd08c010e015a0f`
   - `prosemirror-transform-1.12.5.tgz` `0b9b224a05fb67f8e44386f6daecbea46552dda075f4fd74a6daaa076d48e695`
   - `prosemirror-state-1.4.4.tgz` `ad3eb60bd6db8e74b2576dc0b7c2800d6def362e0e990c9fb108fc4b724ee651`
   - `prosemirror-view-1.42.9.tgz` `d92a5d70b1c9d20ffa582c710ba62f86a58cb8a7ec5c58b9abe402c8e9e5d403`
   - `prosemirror-commands-1.7.2.tgz` `7cca5b9379ff9f83d6bb54d69373e79715cad1f33d8b73d5cb604bc5e73e90d0`
   - `prosemirror-keymap-1.2.3.tgz` `3131823ce73eaf3487cada22c85b76349da02c114dee3de696f4c1c3c645ca8c`
   - `prosemirror-history-1.5.1.tgz` `ba3f0ac27eb586925b42e3acb840b7440ab6aaf9a368053874d9ece266df31b0`
   - `prosemirror-inputrules-1.5.1.tgz` `785502d7e5ce0b9617d1aa6c0ef2aa2a0a6b06a5d8efb8942eb7c1b2d3b155aa`
   - `prosemirror-schema-list-1.6.0.tgz` `2b4dd60e8c76fefa6cf96bacef79fdd5f81dd1beaec57c6b9ec10892cac2483c`
   - `prosemirror-tables-1.8.5.tgz` `589a633cd06d12c0ab2a210846ea208d3be9dd37f5b068be19f437733f22089b`
   - `prosemirror-dropcursor-1.8.4.tgz` `9edb239ccca1818663e6049c728bf37c2e0e39a847f452c7b700e3e83bdee4ea`
   - `prosemirror-gapcursor-1.4.1.tgz` `961e88b82ce7f434cc781ba644a82810461cf9ba3993834f654384c493998eba`
   - `prosemirror-markdown-1.13.9.tgz` `475e13880818920e2a35a2e204a826027ad168878af6b04d3ae0c2ecf3bad8e7`
   - `orderedmap-2.1.1.tgz` `9ad98abe6ac4156daef2232d7c1d2c8b3681545604c54f7f3754e791f12c168d`
   - `rope-sequence-1.3.4.tgz` `2a483ee02e5a21b59b63a29bca162e6aa2cd8fafb474261040c3d8538a1f067c`
   - `w3c-keyname-2.2.8.tgz` `05d21484026d1f2dd842c843181e391e66d60f1d5dff292d562c3f40302dab36`
2. In a second new folder (the build folder), unpack each into `node_modules/<name>/`: `tar -xzf <file> --strip-components=1 -C node_modules/<name>`.
3. In the build folder, write `entry.js`:

```js
// Everything the twelve ProseMirror packages export, plus the Markdown serialiser from its one source file
// (never the prosemirror-markdown package entry, which imports markdown-it).
export * from 'prosemirror-model';
export * from 'prosemirror-transform';
export * from 'prosemirror-state';
export * from 'prosemirror-view';
export * from 'prosemirror-commands';
export * from 'prosemirror-keymap';
export * from 'prosemirror-history';
export * from 'prosemirror-inputrules';
export * from 'prosemirror-schema-list';
export * from 'prosemirror-tables';
export * from 'prosemirror-dropcursor';
export * from 'prosemirror-gapcursor';
export { MarkdownSerializer, MarkdownSerializerState } from './node_modules/prosemirror-markdown/src/to_markdown.ts';
```

4. In the build folder, write `banner.txt`: the comment at the top of `src/documents-lib-0-prosemirror.js`, from its first line `/*` to the line ` */` (34 lines).
5. In a third folder, install the build tool only: `npm install --ignore-scripts esbuild@0.28.2`. Then, in the build folder, run its `node_modules/.bin/esbuild`:

```
esbuild entry.js --bundle --format=iife --global-name=DlPM --minify --line-limit=200 --target=es2020 --legal-comments=none --charset=ascii --tsconfig-raw='{}' --banner:js="$(cat banner.txt)" --outfile=documents-lib-0-prosemirror.js
```

6. `sha256sum documents-lib-0-prosemirror.js` must give the hash in the table.

`--line-limit=200` keeps the lines short (the longest is 449 characters), so that an exemption below can name one exact line. `--charset=ascii` writes every character outside ASCII as an escape, so the file holds nothing that cannot be seen.

## The innerHTML lines in the ProseMirror file

Safety rule 1 of the Documents plan: nothing a person wrote reaches `innerHTML`, `insertAdjacentHTML` or `outerHTML`. The ProseMirror file has no `insertAdjacentHTML`, `outerHTML`, `document.write`, `eval` or `new Function`, and `innerHTML` in exactly four lines, all in its clipboard code: one writes, three read. Each was read in the source (prosemirror-view 1.42.9, `dist/index.js`) and is named here. `tools/check-vendored-hashes.mjs` checks each: it holds only while the file has the pinned hash and the line is still a line of the file. A new build means reading them again.

```innerhtml-exemptions
[
  {
    "file": "src/documents-lib-0-prosemirror.js",
    "sha256": "e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131",
    "line": "toLowerCase()])&&(n=o.map(s=>\"<\"+s+\">\").join(\"\")+n+o.map(s=>\"</\"+s+\">\").reverse().join(\"\")),r.innerHTML=Sc(n),o)for(let s=0;s<o.length;s++)r=r.querySelector(o[s])||r;for(let s=0;s<t.styleSheets.length;s++){",
    "reason": "The one write (prosemirror-view, readHTML, the clipboard reader). The HTML string from a paste or a drop is set on the body of a detached document made with document.implementation.createHTMLDocument: that document is never put in the page, runs no script, fires no event handler and loads nothing. ProseMirror then reads that tree only through the schema's own rules, which can make only the schema's nodes and marks with checked values. The Documents module is to take paste and drop before the library does (plan-documents-rich-editor.md, Paste), so this line is not meant to be reached at all."
  },
  {
    "file": "src/documents-lib-0-prosemirror.js",
    "sha256": "e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131",
    "line": "i=t.type==\"cut\";if(r.empty)return;let o=Kt?null:t.clipboardData,s=r.content(),{dom:l,text:a}=zr(n,s);o?(t.preventDefault(),o.clearData(),o.setData(\"text/html\",l.innerHTML),o.setData(\"text/plain\",a)):Lc(",
    "reason": "A read (prosemirror-view, the copy and cut handler). ProseMirror draws the selection into a detached element from the schema's own drawing rules and reads that element's HTML to put it on the clipboard. Nothing is written into the page."
  },
  {
    "file": "src/documents-lib-0-prosemirror.js",
    "sha256": "e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131",
    "line": "null,i,e):Ht(n,r.textContent,r.innerHTML,i,e)},50)}function Ht(n,e,t,r,i){let o=Pr(n,e,t,r,n.state.selection.$from);if(n.someProp(\"handlePaste\",a=>a(n,i,o||x.empty)))return!0;if(!o)return!1;let s=$c(o),",
    "reason": "A read (prosemirror-view, capturePaste, the fallback for a browser with no clipboard data on the paste event). It reads the HTML of a temporary element the browser pasted into and hands the string to the same reader as the first exemption; this line sets no HTML itself."
  },
  {
    "file": "src/documents-lib-0-prosemirror.js",
    "sha256": "e7afbab9b506287346bc4c46dc3d40eb1e05db1dc880e30bf97b9e9f2859b131",
    "line": "dataTransfer.clearData(),t.dataTransfer.setData(Kt?\"Text\":\"text/html\",a.innerHTML),t.dataTransfer.effectAllowed=\"copyMove\",Kt||t.dataTransfer.setData(\"text/plain\",c),n.dragging=new Cn(f,gs(n,t),s)};G.",
    "reason": "A read (prosemirror-view, the drag start handler). As for copy: the dragged selection is drawn into a detached element from the schema's own drawing rules and its HTML is put on the drag's data. Nothing is written into the page."
  }
]
```

Also in that code, and not an `innerHTML` line: where the browser enforces Trusted Types, ProseMirror makes a policy named `ProseMirrorClipboard` that passes the string through, for the first line above. And one address appears in the file, in the text of an error message; it is listed in `tools/check-no-outside-urls-allow.json` and is never fetched.
