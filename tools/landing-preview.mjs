// A self-contained preview of the product pages (public/landing.html and each use page: travel.html, games.html, projects.html), to look at or publish privately without a server:
//   OUT=/tmp/landing-preview node tools/landing-preview.mjs      (or: node tools/landing-preview.mjs /tmp/landing-preview)
// It writes one folder: index.html (the front page), <use>.html for each use page (same name as in public/, and the
// links between the pages follow), landing.css, preview.js, img/ (the screenshots and the mark). The product's name is
// filled in from PREVIEW_PRODUCT_NAME, else PRODUCT_NAME, else the placeholder "Product" (the real page reads PRODUCT_NAME from the host), the walkthrough works, and the
// sign-in and sign-up forms are switched off with a note saying so. No request leaves the folder. It stays under 6 MB.
// Not part of `npm run check`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.env.OUT || process.argv[2] || path.join(root, 'tools', '.landing-preview'));
const NAME = process.env.PREVIEW_PRODUCT_NAME || process.env.PRODUCT_NAME || 'Product';
const IMAGES = path.join(root, 'public', 'assets', 'images', 'brand', 'landing');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'img'), { recursive: true });

// Every product page: landing.html is the front page (index.html); a use page keeps its name.
const USE_PAGES = ['travel.html', 'games.html', 'projects.html'];
const pageFiles = fs.readdirSync(path.join(root, 'public')).filter((f) => f === 'landing.html' || USE_PAGES.includes(f));
for (const file of pageFiles) {
  const target = file === 'landing.html' ? 'index.html' : file;
  let html = fs.readFileSync(path.join(root, 'public', file), 'utf8');
  html = html
    .replace(/<link rel="icon"[^>]*>\n?/, '')
    .replace('href="/landing.css"', 'href="landing.css"')
    .replace('<script src="/landing.js">', '<script src="preview.js">')
    .replaceAll('/assets/images/brand/landing/', 'img/')
    .replaceAll('/assets/images/brand/', 'img/')
    .replace(/href="\/(\?[^"#]*)?(#[^"]*)?"/g, (_m, _q, hash) => `href="index.html${hash || ''}"`)
    .replace(/href="\/([a-z]+)(#[^"]*)?"/g, (m, name, hash) => (pageFiles.includes(`${name}.html`) ? `href="${name}.html${hash || ''}"` : m))
    .replace(/(<[^>]*\bdata-product\b[^>]*>)[^<]*(<)/g, `$1${NAME}$2`)
    .replace(/<title data-product[^>]*>[^<]*<\/title>/, `<title>${NAME}</title>`)
    .replace(/<span data-version><\/span>/, '<span>preview</span>');
  fs.writeFileSync(path.join(out, target), html);
}
fs.writeFileSync(path.join(out, 'landing.css'), fs.readFileSync(path.join(root, 'public', 'landing.css'), 'utf8').replaceAll('url(/fonts/', 'url(fonts/'));
fs.cpSync(path.join(root, 'public', 'fonts'), path.join(out, 'fonts'), { recursive: true });
for (const f of fs.readdirSync(IMAGES)) fs.copyFileSync(path.join(IMAGES, f), path.join(out, 'img', f));
for (const f of ['mark.svg', 'mark-dark.svg']) fs.copyFileSync(path.join(IMAGES, '..', f), path.join(out, 'img', f)); // the bar's mark, light and dark

// landing.js down to its host line: light or dark before the first paint, the Light / Dark switch and the walkthrough's
// controls. The rest of that file talks to the host, which a preview has none of.
const src = fs.readFileSync(path.join(root, 'public', 'landing.js'), 'utf8');
const end = src.indexOf('// --- The host line');
if (end < 0 || !src.includes('function pageParts()')) throw new Error('landing-preview: cannot find the host line or pageParts in public/landing.js');
const preview = `// Preview only: the theme, the switch and the walkthrough from landing.js, and the forms switched off.
${src.slice(0, end)}
document.addEventListener('DOMContentLoaded', () => {
pageParts();
for (const el of document.querySelectorAll('[data-example-host]')) el.textContent = 'yourname.example.com';
for (const el of document.querySelectorAll('[data-signup-domain], [data-signin-domain]')) el.textContent = '.example.com';
// the use cards link to the use pages this folder has, as the real page does for the pages the host offers
for (const card of document.querySelectorAll('.aud[data-page]')) {
  const file = ${JSON.stringify(pageFiles.filter((f) => f !== 'landing.html'))}.find((f) => '/' + f.replace('.html', '') === card.dataset.page);
  if (!file) continue;
  const go = document.createElement('a');
  go.className = 'aud-go';
  go.href = file;
  go.textContent = 'More about ' + card.querySelector('h3').textContent.toLowerCase();
  card.append(go);
}
const signup = document.getElementById('signup-form');
if (signup) {
signup.hidden = false;
const options = document.getElementById('signup-template-options');
document.getElementById('signup-template').hidden = false;
options.innerHTML = '<label class="template-option"><input type="radio" name="template" checked><span><strong>None</strong><span class="hint">Start plain: the usual words and settings.</span></span></label><label class="template-option"><input type="radio" name="template"><span><strong>Travel</strong><span class="hint">Plan trips together: the itinerary, places, maps, research and a calendar.</span></span></label>';
}
for (const form of [signup, document.getElementById('signin-form')].filter(Boolean)) {
  for (const el of form.querySelectorAll('input, select, button')) el.disabled = true;
  form.addEventListener('submit', (e) => e.preventDefault());
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = 'This is a preview. The form does nothing here.';
  form.after(note);
}
for (const a of document.querySelectorAll('[data-contact-link]')) a.href = '#start';
});
`;
fs.writeFileSync(path.join(out, 'preview.js'), preview);

let bytes = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } };
walk(out);
if (bytes > 6 * 1024 * 1024) throw new Error(`landing-preview: ${bytes} bytes is over 6 MB`);
console.log(`landing-preview: ${out} (${Math.round(bytes / 1024)} KB)`);
