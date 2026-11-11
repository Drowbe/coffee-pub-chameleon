# Third-party code in the Documents module

**Audience:** whoever redistributes or audits the Documents module.

Everything here is free for commercial use and redistribution. Nothing is loaded from outside.

| Piece | Where | Licence | Source |
|---|---|---|---|
| marked 18.2.0 (Markdown lexer only; its HTML output is never used) | `src/documents-lib-0-marked.js` (the package's `lib/marked.umd.js` with its `sourceMappingURL` comment line removed; its licence header is kept at the top). SHA-256 of the package file: `392f4df89533b50f1dadff3f6dc0952350bd39c9f17def50a0374ef47d6147ef` | MIT (`vendor/LICENSE.marked`, copied from the package) | https://github.com/markedjs/marked, npm `marked@18.2.0` |

| Name | Version | SPDX | File | SHA-256 | Licence file | Source |
|---|---|---|---|---|---|---|
| marked | 18.2.0 | MIT | `src/documents-lib-0-marked.js` | `14a9dd96ae1179e626a9a1df1837b8dccf865333cb8e2fe09355f80fc2410590` | `vendor/LICENSE.marked` | https://github.com/markedjs/marked, npm `marked@18.2.0` |

The pinned hash is not enforced by a check yet. A hash check and the licence and outside-URL checks are tools work (`tools/`), named in `documentation/plans/plan-documents.md`.
