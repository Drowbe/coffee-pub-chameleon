// The app's own PDF viewer (documentation/plans/plan-attachments-vault.md, decision 18 and section 10, step 3): its
// document, GET /viewer/pdf, and the vendored pdf.js it loads from /sdk/pdfjs/ (public/sdk/pdfjs/, pinned by hash in
// tools/check-vault.mjs). The page that shows a PDF frames /viewer/pdf in an <iframe sandbox="allow-scripts"> (no
// allow-same-origin), fetches the PDF's bytes itself with the person's session (host.library.blob), and hands them to
// the frame by postMessage; the protocol is written at the top of public/sdk/pdf-viewer.mjs.
//
// The document's own headers make it a null-origin sandbox even if it is opened some other way (the `sandbox` directive),
// with no network at all (connect-src 'none'), no frames, no workers, no forms, no plugins, no media, and only this
// site's own scripts and styles. Settled conservatively for the plan's open questions 2 and 3 (2026-11-03):
// - pdf.js parses on the frame's own thread, not in a worker: a worker started from a null-origin document needs
//   `worker-src blob:` and a module import from inside the worker, and a parse on the frame's thread needs nothing more
//   than script-src 'self'. pdf.js does this when its worker module has been imported first (globalThis.pdfjsWorker).
// - The vendored files are served from this site (/sdk/pdfjs/...), not inlined; module scripts from a null-origin
//   document are cross-origin requests, so those files (and the viewer's own script and styles) carry
//   Access-Control-Allow-Origin: * and Cross-Origin-Resource-Policy: cross-origin, as a module's own files and the
//   fonts do. They are public files the image ships; no credentials go with them.
// - A null-origin sandboxed frame, as the plan writes, not a second host name: a single-environment install has no
//   second name to give it.
// - img-src blob: data: and font-src data: are what pdf.js may need to draw a page's pictures and its embedded fonts,
//   all from the bytes it was handed; none of them reaches the network.
'use strict';

const VIEWER_PATH = '/viewer/pdf';
const VIEWER_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src blob: data:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts";

const VIEWER_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': VIEWER_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'private, no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
};

// No inline script or style: the CSP allows neither. The words a person may read come from the page that frames it.
const VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF</title>
<link rel="stylesheet" href="/sdk/pdf-viewer.css">
<script type="module" src="/sdk/pdf-viewer.mjs"></script>
</head>
<body>
<main id="pages"></main>
</body>
</html>
`;

// The headers of the files the viewer frame loads (public/sdk/pdfjs/*, public/sdk/pdf-viewer.mjs and .css).
const VIEWER_FILE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-cache',
};

module.exports = { VIEWER_PATH, VIEWER_CSP, VIEWER_HEADERS, VIEWER_HTML, VIEWER_FILE_HEADERS };
