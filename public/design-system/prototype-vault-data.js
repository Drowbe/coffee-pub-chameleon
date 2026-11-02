// The Prototype's Vault sample (Thomas, 2026-11-02; design-process only, nothing here ships): forty-two files for a trip to Rome, made up.
// Nothing is fetched. The pictures are drawn here, small, on a canvas (thumbnails and the viewer's picture); the sound is a short tune made
// in the page; the video is a 9 KB clip; the PDF pages are drawn on a canvas. The colours in an image are the image's own (a picture is
// data, not interface), so they are not theme tokens.
export const NOW = new Date('2026-11-02T10:00:00Z');
export const PEOPLE = {
  mia: { name: 'Mia', role: 'moderator' },
  lee: { name: 'Lee', role: 'member' },
  sam: { name: 'Sam', role: 'member' },
  gone: { name: 'someone who left', role: 'member' },
};
export const MB = 1024 * 1024;
export const GB = 1024 * MB;
export const QUOTA = { space: 5 * GB, person: 2 * GB };

// The kinds the Vault takes, the word, the Font Awesome icon and the tint (a category tint token, data-tint) of each.
export const KINDS = {
  picture: { group: 'image', icon: 'file-image', tint: 'teal', word: 'Picture', plural: 'Pictures' },
  audio: { group: 'audio', icon: 'file-audio', tint: 'purple', word: 'Audio', plural: 'Audio' },
  video: { group: 'video', icon: 'file-video', tint: 'orange', word: 'Video', plural: 'Video' },
  pdf: { group: 'document', icon: 'file-pdf', tint: 'red', word: 'PDF', plural: 'Documents' },
  text: { group: 'document', icon: 'file-lines', tint: 'gold', word: 'Markdown', plural: 'Documents' },
};

let n = 0;
// f(name, size in MB, by, days ago, extras): the kind comes from the extension.
const kindOf = (name) => {
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'picture';
  if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'text';
};
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', pdf: 'application/pdf', md: 'text/markdown' };
function f(name, mb, by, daysAgo, extra = {}) {
  n += 1;
  const kind = kindOf(name);
  const at = new Date(NOW.getTime() - daysAgo * 86400000 - (n * 7919 % 36000) * 1000);
  return {
    id: `f${String(n).padStart(2, '0')}`, name, kind, group: KINDS[kind].group, type: MIME[name.split('.').pop().toLowerCase()],
    size: Math.round(mb * MB), by, at: at.toISOString(), uses: 0, shared: false, seed: n, ...extra,
  };
}
export const FILES = [
  f('Colosseum at dusk.jpg', 24.6, 'mia', 14, { w: 6000, h: 4000, taken: '2026-10-19T17:42:00Z', camera: 'Sony A7 IV', scene: 'dusk', hue: 24, large: true }),
  f('Trevi fountain.jpg', 3.8, 'lee', 13, { w: 4032, h: 3024, taken: '2026-10-19T21:05:00Z', camera: 'iPhone 15', scene: 'night', hue: 210 }),
  f('IMG_4821.jpg', 4.1, 'sam', 12, { w: 4032, h: 3024, taken: '2026-10-20T09:14:00Z', camera: 'iPhone 14', scene: 'street', hue: 32 }),
  f('IMG_4822.jpg', 3.9, 'sam', 12, { w: 4032, h: 3024, taken: '2026-10-20T09:15:00Z', camera: 'iPhone 14', scene: 'street', hue: 340 }),
  f('Gelato stop.webp', 0.9, 'lee', 11, { w: 1600, h: 1200, scene: 'food', hue: 330 }),
  f('Map of the old town.png', 1.8, 'mia', 20, { w: 2400, h: 1800, scene: 'map', hue: 150, uses: 1 }),
  f('Hotel room view.jpg', 2.7, 'lee', 18, { w: 3024, h: 4032, taken: '2026-10-18T07:30:00Z', camera: 'iPhone 15', scene: 'roofs', hue: 200 }),
  f('Train platform, Termini.jpg', 3.3, 'sam', 10, { w: 4032, h: 3024, taken: '2026-10-21T08:02:00Z', camera: 'iPhone 14', scene: 'platform', hue: 215 }),
  f('Group photo on the steps.jpg', 5.2, 'mia', 9, { w: 5184, h: 3456, taken: '2026-10-22T12:20:00Z', camera: 'Sony A7 IV', scene: 'steps', hue: 40, shared: true }),
  f('Pasta lunch.jpg', 2.4, 'lee', 9, { w: 3024, h: 3024, taken: '2026-10-22T13:40:00Z', camera: 'iPhone 15', scene: 'food', hue: 12 }),
  f('Vatican queue.gif', 6.8, 'sam', 8, { w: 480, h: 270, scene: 'street', hue: 270 }),
  f('Sunset from the roof.jpg', 4.6, 'mia', 7, { w: 5184, h: 3456, taken: '2026-10-24T18:11:00Z', camera: 'Sony A7 IV', scene: 'dusk', hue: 8, shared: true }),
  f('Receipt, dinner on Friday.png', 0.4, 'lee', 6, { w: 900, h: 1600, scene: 'receipt', hue: 50, uses: 1 }),
  f('Pantheon ceiling.jpg', 3.1, 'mia', 6, { w: 4032, h: 3024, taken: '2026-10-25T10:55:00Z', camera: 'iPhone 13', scene: 'dome', hue: 35 }),
  f('Street art.jpg', 2.9, 'sam', 5, { w: 3024, h: 4032, taken: '2026-10-26T15:03:00Z', camera: 'iPhone 14', scene: 'wall', hue: 300 }),
  f('Market stalls.jpg', 3.6, 'lee', 5, { w: 4032, h: 3024, taken: '2026-10-26T10:30:00Z', camera: 'iPhone 15', scene: 'market', hue: 100 }),
  f('Bridge over the Tiber.jpg', 4.0, 'mia', 4, { w: 5184, h: 3456, taken: '2026-10-27T17:00:00Z', camera: 'Sony A7 IV', scene: 'bridge', hue: 190 }),
  f('Walking tour, the Forum.m4a', 22.8, 'mia', 13, { dur: 1447, hue: 270 }),
  f('Street musician.mp3', 3.1, 'sam', 12, { dur: 196, hue: 20 }),
  f('Guide audio, Colosseum.ogg', 12.6, 'mia', 14, { dur: 804, hue: 200 }),
  f('Market ambience.wav', 8.4, 'lee', 5, { dur: 95, hue: 140 }),
  f('Dinner toast.m4a', 2.2, 'sam', 7, { dur: 41, hue: 330 }),
  f('Walking the Forum.webm', 188, 'mia', 13, { dur: 5, w: 1920, h: 1080, scene: 'dusk', hue: 45, real: true }),
  f('Fountain at night.mov', 412, 'lee', 13, { dur: 62, w: 3840, h: 2160, scene: 'night', hue: 230, codec: 'HEVC' }),
  f('Train window.mp4', 96, 'sam', 10, { dur: 118, w: 1920, h: 1080, scene: 'platform', hue: 160 }),
  f('Cooking class.mp4', 330, 'mia', 8, { dur: 311, w: 1920, h: 1080, scene: 'food', hue: 20 }),
  f('Birthday toast.mp4', 54, 'lee', 7, { dur: 47, w: 1280, h: 720, scene: 'steps', hue: 310 }),
  f('Vespa ride.mp4', 38, 'sam', 3, { dur: 29, w: 1920, h: 1080, scene: 'street', hue: 90 }),
  f('Flight confirmation, FCO.pdf', 0.2, 'mia', 30, { pages: 2, uses: 2 }),
  f('Hotel Roma booking.pdf', 0.3, 'lee', 30, { pages: 3, uses: 2 }),
  f('Colosseum tickets.pdf', 0.5, 'mia', 21, { pages: 2, uses: 1 }),
  f('Travel insurance policy.pdf', 3.4, 'lee', 28, { pages: 14, viewable: false }),
  f('Passport scan, Mia.pdf', 1.1, 'mia', 29, { pages: 1, missing: true }),
  f('Train tickets, Rome to Florence.pdf', 0.3, 'sam', 17, { pages: 2, uses: 1 }),
  f('Museum pass.pdf', 0.6, 'lee', 16, { pages: 1 }),
  f('Restaurant booking, Friday.pdf', 0.1, 'sam', 15, { pages: 1 }),
  f('Rental agreement.pdf', 2.2, 'mia', 27, { pages: 6, shared: true }),
  f('City map, printable.pdf', 5.9, 'mia', 26, { pages: 4, shared: true }),
  f('Packing notes.md', 0.003, 'lee', 19, { md: 'packing' }),
  f('Phrasebook.md', 0.012, 'sam', 18, { md: 'phrases' }),
  f('Who pays for what.md', 0.002, 'mia', 11, { md: 'pays' }),
  f('Notes from the guide.md', 0.005, 'gone', 22, { md: 'guide' }),
];
export const byId = (id) => FILES.find((x) => x.id === id);
export const TOTAL_BYTES = FILES.reduce((a, x) => a + x.size, 0);

// Where files are linked from (host.objects.linksTo): the summaries a person may see, and how many they may not.
export const USES = {
  f06: { list: [{ module: 'Research', kind: 'Note', title: 'Where to eat in Trastevere' }], hidden: 0 },
  f13: { list: [{ module: 'Budget', kind: 'Expense', title: 'Dinner on Friday' }], hidden: 0 },
  f29: { list: [{ module: 'Itinerary', kind: 'Flight', title: 'Home to Rome' }, { module: 'Itinerary', kind: 'Flight', title: 'Rome to home' }], hidden: 0 },
  f30: { list: [{ module: 'Itinerary', kind: 'Stay', title: 'Hotel Roma' }, { module: 'Research', kind: 'Note', title: 'Hotels near Termini' }], hidden: 1 },
  f31: { list: [{ module: 'Itinerary', kind: 'Activity', title: 'Colosseum, 10:00' }], hidden: 0 },
  f34: { list: [{ module: 'Itinerary', kind: 'Train', title: 'Rome to Florence' }], hidden: 0 },
};

// Share links (the Vault's space data; the token is never kept, only its hash).
export const SHARES = [
  { id: 's1', name: 'Rome, October', files: ['f09', 'f12', 'f01', 'f17', 'f23'], by: 'mia', at: '2026-10-29T16:20:00Z', ends: '2026-11-28T16:20:00Z', download: true, password: true, opened: 14 },
  { id: 's2', name: 'Rental agreement for the owner', files: ['f37'], by: 'mia', at: '2026-10-30T09:00:00Z', ends: '2026-11-06T09:00:00Z', download: false, password: false, opened: 2 },
  { id: 's3', name: 'Printable map', files: ['f38'], by: 'lee', at: '2026-10-08T12:00:00Z', ends: '2026-10-29T12:00:00Z', download: true, password: false, opened: 5, ended: true },
];

export const MARKDOWN = {
  packing: `# Packing notes

What goes in the carry-on, so nobody checks a bag.

## Documents
- **Passports** (check the date: six months left)
- Printed hotel booking and the [train timetable](https://www.trenitalia.com/)
- Travel insurance number: *in the policy PDF*

## Clothes
1. Walking shoes (the cobbles are rough)
2. A light rain jacket
3. One smart outfit for Friday

> Churches ask for covered shoulders and knees.

A line of planted markup, shown as text and never run:

\`<img src=x onerror=alert(1)>\` and <script>alert("hello")</script>

Wi-Fi at the hotel: \`romaguest\`.`,
  phrases: `# Phrasebook

## Eating
- **Il conto, per favore.** The bill, please.
- **Un tavolo per quattro.** A table for four.
- **Senza glutine?** Is it gluten free?

## Getting around
- **Dov'e la stazione?** Where is the station?
- **Un biglietto per Firenze.** One ticket to Florence.

See also [a longer list](https://example.org/italian-phrases).`,
  pays: `# Who pays for what

- Hotel: Mia, split four ways
- Train tickets: Sam
- Dinner on Friday: Lee

Settle up on the way home.`,
  guide: `# Notes from the guide

The Forum opens at nine. Go early and the queue is short.

- Start at the Arch of Titus
- End on the Palatine Hill for the view`,
};
export const MD_LINES = Object.fromEntries(Object.entries(MARKDOWN).map(([k, v]) => [k, v.split('\n').length]));

// ---- pictures: small procedural scenes on a canvas (cached) ----
function rng(seed) { let s = (seed * 2654435761) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const hsl = (h, s, l, a = 1) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}% / ${a})`;
function scene(ctx, w, h, f) {
  const r = rng(f.seed * 31 + 7);
  const hue = f.hue ?? 30;
  const kind = f.scene || 'street';
  if (kind === 'map') {
    ctx.fillStyle = hsl(hue, 25, 90); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hsl(hue + 40, 35, 78);
    for (let i = 0; i < 18; i += 1) ctx.fillRect(r() * w * 0.9, r() * h * 0.9, w * (0.06 + r() * 0.12), h * (0.05 + r() * 0.1));
    ctx.strokeStyle = hsl(hue, 10, 100); ctx.lineWidth = Math.max(2, w / 90);
    for (let i = 0; i < 9; i += 1) { ctx.beginPath(); ctx.moveTo(r() * w, 0); ctx.lineTo(r() * w, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, r() * h); ctx.lineTo(w, r() * h); ctx.stroke(); }
    ctx.strokeStyle = hsl(210, 60, 62); ctx.lineWidth = w / 40; ctx.beginPath(); ctx.moveTo(0, h * 0.7); ctx.bezierCurveTo(w * 0.3, h * 0.4, w * 0.6, h * 0.9, w, h * 0.5); ctx.stroke();
    return;
  }
  if (kind === 'receipt') {
    ctx.fillStyle = hsl(40, 15, 40); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hsl(45, 30, 95); ctx.fillRect(w * 0.12, h * 0.04, w * 0.76, h * 0.92);
    ctx.fillStyle = hsl(0, 0, 25);
    for (let i = 0; i < 22; i += 1) { const y = h * (0.1 + i * 0.037); ctx.fillRect(w * 0.18, y, w * (0.2 + r() * 0.35), h * 0.012); ctx.fillRect(w * 0.7, y, w * 0.12, h * 0.012); }
    return;
  }
  const night = kind === 'night';
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, hsl(night ? hue : hue + 200, 55, night ? 14 : 45));
  sky.addColorStop(0.6, hsl(night ? hue + 20 : hue, 70, night ? 26 : 62));
  sky.addColorStop(1, hsl(hue, 60, night ? 18 : 78));
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = hsl(hue + 15, 90, night ? 82 : 88, 0.9); ctx.beginPath(); ctx.arc(w * (0.2 + r() * 0.6), h * (0.2 + r() * 0.2), w * 0.07, 0, 7); ctx.fill();
  for (let layer = 0; layer < 3; layer += 1) {
    ctx.fillStyle = hsl(hue + layer * 8, 30 + layer * 8, (night ? 12 : 30) - layer * 6 + (kind === 'food' ? 28 : 0));
    const base = h * (0.55 + layer * 0.14);
    let x = -w * 0.05;
    while (x < w) {
      const bw = w * (0.06 + r() * 0.1), bh = h * (0.08 + r() * (kind === 'dome' ? 0.22 : 0.3)) - layer * h * 0.02;
      if (kind === 'dome' && r() > 0.7) { ctx.beginPath(); ctx.arc(x + bw / 2, base, bw, Math.PI, 0); ctx.fill(); } else ctx.fillRect(x, base - bh, bw, h - base + bh);
      if (night && layer === 0) { ctx.fillStyle = hsl(50, 90, 70, 0.8); for (let k = 0; k < 3; k += 1) ctx.fillRect(x + bw * 0.2, base - bh + bh * (0.15 + k * 0.25), bw * 0.14, bh * 0.08); ctx.fillStyle = hsl(hue, 30, 12); }
      x += bw * 1.05;
    }
  }
  if (kind === 'dusk' || kind === 'bridge') {
    ctx.strokeStyle = hsl(hue, 40, 10, 0.85); ctx.lineWidth = w / 60;
    for (let i = 0; i < 5; i += 1) { ctx.beginPath(); ctx.arc(w * (0.18 + i * 0.16), h * 0.78, w * 0.07, Math.PI, 0); ctx.stroke(); }
  }
}
const imgCache = new Map();
export function art(file, w = 192, h = w) {
  const key = `${file.id}:${w}x${h}`;
  if (imgCache.has(key)) return imgCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  scene(ctx, w, h, file);
  const url = c.toDataURL('image/jpeg', 0.72);
  imgCache.set(key, url);
  return url;
}
// The viewer's picture in the file's own shape (at most 1280 wide).
export function artFull(file) {
  const ratio = (file.w || 4) / (file.h || 3);
  const w = ratio >= 1 ? 1280 : Math.round(960 * ratio);
  return { url: art(file, w, Math.round(w / ratio)), w, h: Math.round(w / ratio) };
}

// ---- sound: a short tune, 8-bit mono, made in the page ----
let wavUrl = '';
export function sampleAudio() {
  if (wavUrl) return wavUrl;
  const rate = 8000, secs = 12, len = rate * secs;
  const buf = new Uint8Array(44 + len);
  const dv = new DataView(buf.buffer);
  const put = (o, s) => { for (let i = 0; i < s.length; i += 1) buf[o + i] = s.charCodeAt(i); };
  put(0, 'RIFF'); dv.setUint32(4, 36 + len, true); put(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); put(36, 'data'); dv.setUint32(40, len, true);
  const notes = [262, 330, 392, 330, 294, 349, 440, 349];
  for (let i = 0; i < len; i += 1) {
    const t = i / rate, idx = Math.floor(t / 0.75) % notes.length, local = t % 0.75;
    const env = Math.min(1, local * 30) * Math.exp(-local * 3);
    buf[44 + i] = 128 + Math.round(70 * env * Math.sin(2 * Math.PI * notes[idx] * t));
  }
  wavUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return wavUrl;
}

// ---- video: a 5 second, 256 by 144 clip of soft moving colour (VP8, 10 KB, prototype-vault-clip.webm beside this file) ----
let videoUrl = '';
export async function sampleVideo() {
  if (videoUrl) return videoUrl;
  try {
    const r = await fetch(new URL('prototype-vault-clip.webm', import.meta.url));
    if (r.ok) videoUrl = URL.createObjectURL(await r.blob());
  } catch { /* no clip: the player shows its own error */ }
  return videoUrl;
}
