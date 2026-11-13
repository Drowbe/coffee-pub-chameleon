// A module's own full-width page (/modules/<id>): the shell that hosts its
// sandboxed frame. The module itself is public/module-host.js's business.
//
// Two ways in:
//   /modules/<id>                          the module's server page
//   /modules/<id>?space=<space>&popout=1   a module on a space's canvas, in a window of its own (?moduleRoom= redirects here)
//                                          (add &guest=<token> for a guest)
// (A module page opened over a call also carries from=space&spaceName=<the space's name>, for its Back link.)
import { loadBranding, api, wireOverlayBack, renderTopbar, markModuleRead, word } from '/brand.js';
import { mountModule, openClearMenu, clearWithUndo, followClearable, askCanvasToOpen, sameSiteOpener } from '/module-host.js';
import { moduleTint } from '/module-tint.js';
import { compositesOn, compositesToAsk } from '/composites.js';
import { createModuleFrame } from '/module-frame.js';

const $ = (id) => document.getElementById(id);
const id = decodeURIComponent(location.pathname.split('/')[2] || '');
const params = new URLSearchParams(location.search);
const spaceId = params.get('space');
const guestToken = params.get('guest');
const popout = params.get('popout') === '1';

async function start() {
  if (popout) document.body.classList.add('module-popout'); // no header: the window is the module
  renderTopbar({ location: '' });
  await loadBranding();
  wireOverlayBack();
  if (!guestToken) {
    let me;
    try {
      me = (await api('GET', '/api/me')).user;
    } catch {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = `/img/${encodeURIComponent(me.key)}/profile`;
    $('whoami-img').hidden = false;
  }

  // Which module, and how it is shown: its own page (the environment's scope), or on a space's canvas.
  let mod;
  let scope = 'environment';
  let entry;
  if (spaceId) {
    scope = 'space';
    const q = new URLSearchParams({ space: spaceId });
    if (guestToken) q.set('guest', guestToken);
    const list = (await api('GET', `/api/modules/for-space?${q}`)).modules;
    const found = list.find((m) => m.id === id);
    // A part of a composite that is on in this space (the Calendar and the To-do while the Calendar is on; the Map
    // while the space's Map is shown; composites.js, plan-calendar-todo.md and plan-map-places.md step 3) has no
    // page of its own there: its pop-out is the destination's page for the space, the same the Workspace's composite
    // holds, the pointer in the address (#ref=) kept. A composite that asks (the Map needs a map file) is on only where
    // its destination answers for the space, as the canvas asks; refused, the part keeps its own page here.
    const ids = list.map((m) => m.id);
    const shown = [];
    for (const c of compositesToAsk(ids)) {
      if (!c.parts.includes(id)) continue;
      try { await api('GET', `/api/destinations/${encodeURIComponent(c.dest)}?${q}`); shown.push(c.dest); } catch { /* not shown here */ }
    }
    const composite = compositesOn(ids, shown).find((c) => c.parts.includes(id));
    if (composite) {
      q.delete('popout');
      location.replace(`${composite.path}?${q}${location.hash}`);
      return;
    }
    if (found) {
      mod = { ...found, entry: found.canvas.entry };
      entry = found.canvas.entry;
    }
  } else {
    const found = (await api('GET', '/api/modules/nav')).modules.find((m) => m.id === id);
    if (found) {
      mod = { ...found, entry: found.page };
      entry = found.page;
    }
  }
  if (!mod) {
    $('module-missing').hidden = false;
    return;
  }
  document.title = `${document.title.split(' - ')[0]} - ${mod.name}`;
  if (!guestToken) markModuleRead(mod.id);
  let frame = $('module-frame');
  // A module that runs in the page gets an element of its own where the frame would be.
  const inPage = mod.runMode === 'page';
  if (inPage) {
    const holder = document.createElement('div');
    holder.className = 'module-holder module-root';
    holder.id = 'module-frame';
    frame.replaceWith(holder);
    frame = holder;
  }
  frame.hidden = false;
  // The module frame (public/module-frame.js) fills the page under the header: its title bar names the module (its colour
  // on the icon, as on the canvas: the server's, else a stable pick from the id, module-tint.js) and holds the module's
  // "+" and icons; its toolbar row, the module, its status bar. Popped out, the title bar is the window's: Close, and in
  // the menu the way back into the space (as a docked column or floating, while the space page that opened it is still
  // there) and Clear, last; on its own page in a space, Clear.
  let mounted = null;
  const chrome = createModuleFrame({
    title: mod.name,
    icon: mod.icon,
    tint: moduleTint(mod.id, mod.color || null),
    variant: 'page',
    titlebar: popout
      ? { close: true, standard: () => popoutStandard(mod), onAction: (e) => pageAction(mod, e, mounted) }
      : { standard: () => (spaceId ? { ...NONE, clear: mod.clear === true } : NONE), onAction: (e) => pageAction(mod, e, mounted) },
    flush: true,
    content: frame,
    onAction: (e) => { if (mounted) mounted.bandEvent(e); },
  });
  $('module-main').prepend(chrome.el);
  // Showing an item in the module that owns it, from a module's own page: go to that module's page,
  // which is given the pointer in the address (#ref=...) and passes it to the module.
  const refHash = (ref) => `#ref=${encodeURIComponent(JSON.stringify(ref))}`;
  // Popped out of a space's canvas: the canvas that opened this window shows it there, if it answers (askCanvasToOpen),
  // rather than this window becoming another module's page.
  const openRef = async (ref) => {
    if (ref.module === mod.id) {
      mounted.deliver('objectopen', { ref });
      return true;
    }
    const opener = popout ? sameSiteOpener() : null;
    if (opener && (await askCanvasToOpen(opener, ref)) === true) return true;
    const q = new URLSearchParams(location.search);
    q.delete('popout');
    q.delete('space');
    if (ref.scope === 'space') q.set('space', ref.space);
    location.href = `/modules/${encodeURIComponent(ref.module)}${q.toString() ? '?' + q : ''}${refHash(ref)}`;
    return true;
  };
  mounted = mountModule({
    onOpenRef: openRef,
    module: { id: mod.id, version: mod.version, scope: mod.scope, budget: mod.budget === true, tags: mod.tags === true, content: mod.content },
    ...(inPage ? { container: frame } : { frame }),
    // A window of its own is the module: its frame fills the window, so an editor window needs no lift (editor.lift).
    lift: !popout,
    // The data changed (cleared, or put back): whether Clear is offered, and for how long Undo lasts, are asked again.
    onChanges: followClearable(mod.id, { spaceId, guestToken }, (entry) => { mod.clear = entry.clear === true; mod.undoSeconds = entry.undoSeconds; chrome.setTitlebar({}); }, () => mod.clear === true),
    chrome,
    scope,
    spaceId,
    guestToken,
    entry,
    onTitle: (title) => {
      document.title = `${title || mod.name}`;
      chrome.setTitle(title || mod.name);
    },
  });
  // Opened by another module's link: hand the pointer on, and again if the address changes.
  const first = refFromHash();
  if (first) mounted.deliver('objectopen', { ref: first });
  const place = placeFromHash();
  if (place) mounted.deliver('pagehash', { hash: place });
  window.addEventListener('hashchange', () => {
    const ref = refFromHash();
    if (ref) mounted.deliver('objectopen', { ref });
    const at = placeFromHash();
    if (at) mounted.deliver('pagehash', { hash: at });
  });
}

// A place in the module's own page left in the address by a widget ("#day=2026-09-24"; see host.page.open).
function placeFromHash() {
  const m = /^#([A-Za-z0-9=&_.:,-]{1,80})$/.exec(location.hash);
  return m && !m[1].startsWith('ref=') ? m[1] : null;
}

// A pointer left in the address by another module's "open this" (see host.objects.open).
function refFromHash() {
  try {
    const m = /^#ref=(.+)$/.exec(location.hash);
    return m ? JSON.parse(decodeURIComponent(m[1])) : null;
  } catch {
    return null;
  }
}

// Everything this module holds in the scope this window is open in.
// (start()'s `scope` is not reachable here; it follows from ?space= the same way.)
async function clearModuleData() {
  const q = new URLSearchParams({ scope: spaceId ? 'space' : 'environment' });
  if (spaceId) q.set('space', spaceId);
  if (guestToken) q.set('guest', guestToken);
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) q.set('tz', tz);
  } catch { /* the server falls back */ }
  return clearWithUndo(id, q.toString());
}

// The module's own page has no ways to show it (it is not on a canvas, and it is the page); in a space it has Clear.
const NONE = { dock: false, window: false, popout: false, clear: false };

// The space page that opened this window, while it is still there (window.hostModules, set by the canvas).
function openerCanvas() {
  try {
    return window.opener && !window.opener.closed ? window.opener.hostModules : null;
  } catch {
    return null;
  }
}

// Popped out: the way back into the space as a docked column or floating, where the canvas that opened it can, and Clear.
function popoutStandard(mod) {
  const host = openerCanvas();
  return {
    ...NONE,
    dock: Boolean(host && host.supportsMode(mod.id, 'dock')) && { label: 'Dock beside the call' },
    window: Boolean(host && host.supportsMode(mod.id, 'float')) && { label: 'Float over the call', tip: 'Float over the call' },
    clear: mod.clear === true,
  };
}
function pageAction(mod, e, mounted) {
  if (e.id === 'close') { window.close(); return; }
  if (!e.standard) { if (mounted) mounted.bandEvent(e); return; }
  if (e.id === 'clear' && e.el) { openClearMenu(e.el, () => clearModuleData(), { armed: true, name: mod.name || '', undoSeconds: mod.undoSeconds }); return; }
  const host = openerCanvas();
  if (!host || (e.id !== 'dock' && e.id !== 'window')) return;
  host.open(mod.id, e.id === 'dock' ? 'dock' : 'float');
  window.close();
}

// Whatever goes wrong, say so on the page instead of leaving it blank.
start().catch((err) => {
  const note = $('module-missing');
  note.textContent = `This ${word('module')} could not start: ${err.message}`;
  note.hidden = false;
});
