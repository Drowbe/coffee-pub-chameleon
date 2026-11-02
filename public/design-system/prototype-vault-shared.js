// The public /shared/<token> page (Thomas, 2026-11-02; design-process only): what a person outside sees. A plain page in the environment's theme:
// the share's name, "Shared by Mia · Ends 28 November", and the files in a grid with the same viewers as the Vault. No space name, no people,
// no chat, no modules, no sign-in prompt, no other link. Download shows only when the link allows it. A gone or ended link, and a wrong
// token, read the same. It is drawn in a window frame with the address, interactive: a card opens the viewer, Back returns.
import { byId } from './prototype-vault-data.js';
import { h, fa, btn, iconBtn, size, thumb } from './prototype-vault-ui.js';
import { pictureStage, audioStage, videoStage, markdownStage, pdfStage, stageState } from './prototype-vault-viewers.js';

export const SHARED_STATES = [
  ['grid', 'Opened, download allowed'],
  ['view', 'Opened, view only'],
  ['password', 'Needs a password'],
  ['wrong', 'Wrong password'],
  ['tries', 'Too many tries'],
  ['removed', 'A file in it was removed'],
  ['ended', 'Ended'],
];
const FILES = ['f09', 'f12', 'f01', 'f17', 'f23', 'f37', 'f32', 'f39'];

export function sharedPage(kind = 'grid', { w = 1280, open = null, info = '' } = {}) {
  const download = kind !== 'view';
  const url = kind === 'ended' ? 'https://rome.example.org/shared/z4Kq…' : 'https://rome.example.org/shared/q8Zt2mRk4vLw…';
  const win = h('div', 'vt-browser');
  win.dataset.w = String(w);
  const bar = h('div', 'vt-browser-bar');
  bar.append(fa('lock'), h('span', 'vt-browser-url', url));
  const page = h('div', 'vt-shared');
  win.append(bar, page);
  let at = open;
  const files = FILES.map((id) => (kind === 'removed' && id === 'f12' ? { ...byId(id), gone: true } : byId(id)));

  const draw = () => {
    page.textContent = '';
    if (kind === 'ended') {
      const g = h('div', 'vt-shared-gate');
      const e = h('div', 'sdk-empty');
      e.append(fa('link-slash'), h('p', 'sdk-empty-title', 'This link has ended.'), h('p', 'sdk-empty-text', 'Ask the person who sent it to make a new one.'));
      g.append(e);
      page.append(g);
      return;
    }
    if (kind === 'password' || kind === 'wrong' || kind === 'tries') {
      const g = h('form', 'vt-shared-gate sdk-form');
      g.onsubmit = (e) => e.preventDefault();
      g.append(h('h1', 'vt-shared-title', 'This link has a password'));
      const f = h('label', 'sdk-field');
      f.append(h('span', 'sdk-label', 'Password'));
      const input = h('input'); input.type = 'password'; input.autocomplete = 'off';
      if (kind === 'wrong') input.setAttribute('aria-invalid', 'true');
      f.append(input);
      if (kind === 'wrong') f.append(h('span', 'sdk-error', 'That is not the password.'));
      if (kind === 'tries') f.append(h('span', 'sdk-error', 'Too many tries. Wait a few minutes.'));
      g.append(f);
      const go = btn('btn btn-primary', { label: 'Open' });
      go.type = 'submit';
      if (kind === 'tries') go.disabled = true;
      g.append(go);
      page.append(g);
      return;
    }
    if (at) { page.append(viewer(files.find((x) => x.id === at))); return; }
    const head = h('div', 'vt-shared-head');
    head.append(h('h1', 'vt-shared-title', 'Rome, October'), h('p', 'vt-shared-by', 'Shared by Mia · Ends 28 November'));
    page.append(head);
    const g = h('div', 'vt-grid');
    g.setAttribute('role', 'list');
    for (const f of files) {
      const c = h('article', `sdk-card vt-card vt-card-thumb${f.gone ? ' is-gone' : ''}`);
      c.setAttribute('role', 'listitem');
      c.dataset.tint = f.gone ? '' : 'blue';
      const t = f.gone ? (() => { const x = h('span', 'vt-thumb vt-tile'); x.append(fa('file-circle-xmark')); return x; })() : thumb(f, 192);
      const meta = h('div', 'vt-card-meta');
      const name = h('button', 'sdk-open vt-card-name', f.gone ? 'File removed' : f.name);
      name.type = 'button';
      if (f.gone) name.disabled = true;
      else name.addEventListener('click', () => { at = f.id; draw(); });
      meta.append(name, h('span', 'sdk-card-sub', f.gone ? 'It is no longer in this link.' : size(f.size)));
      c.append(t, meta);
      g.append(c);
    }
    page.append(g);
    if (!download) page.append(h('p', 'vt-shared-foot', 'These files are for looking at. The person who shared them has not allowed downloads.'));
  };
  const stage = (f) => {
    const api = { can: () => download, downloadButton: () => btn('btn btn-small btn-primary', { label: 'Download', icon: 'download' }), trial: { pdfSearch: false }, info: () => {} };
    if (f.kind === 'picture') return pictureStage(f, api);
    if (f.kind === 'audio') return audioStage(f, api);
    if (f.kind === 'video') return videoStage(f, api);
    if (f.kind === 'text') return markdownStage(f, api);
    if (f.viewable === false) return stageState({ icon: 'file-circle-exclamation', tone: 'warn', title: "This PDF can't be opened here. Download it.", actions: download ? [api.downloadButton(f)] : [], text: download ? '' : 'The person who shared it has not allowed downloads.' });
    return pdfStage(f, api);
  };
  const viewer = (f) => {
    const wrap = h('div', 'vt-shared-viewer vt-viewer');
    const list = files.filter((x) => !x.gone);
    const i = list.findIndex((x) => x.id === f.id);
    const top = h('div', 'vt-vbar');
    const back = btn('btn btn-small', { label: 'Back', icon: 'arrow-left' });
    back.addEventListener('click', () => { at = null; draw(); });
    const prev = iconBtn('chevron-left', 'Previous file'), next = iconBtn('chevron-right', 'Next file');
    prev.disabled = i <= 0; next.disabled = i >= list.length - 1;
    prev.addEventListener('click', () => { at = list[i - 1].id; draw(); });
    next.addEventListener('click', () => { at = list[i + 1].id; draw(); });
    top.append(back, h('h2', 'vt-vname', f.name), h('span', 'vt-vpos', `${i + 1} of ${list.length}`), prev, next);
    if (download) top.append(btn('btn btn-small', { label: 'Download', icon: 'download' }));
    const body = h('div', 'vt-vbody');
    body.append(stage(f));
    wrap.append(top, body);
    return wrap;
  };
  draw();
  return win;
}
