// Who can see which Vault file, the parts drawn in the page (documentation/plans/plan-vault-privacy.md, slice 3; the design is the
// Prototype's "Vault privacy" section). One piece of code for the two places that ask: the Vault's Add files (through
// host.library.pickPeople, answered by module-host.js) and a file window's Info (public/file-viewer.js). Both draw in the page's
// document, because a module's frame cannot draw over the page.
//
//   loadMembers(spaceId)                         the people of the space: [{ key, name, owner }]
//   choosePeople({ doc, members, chosen, adder, you, subject, save, returnFocus })
//                                                the people picker. Resolves the chosen keys, or null when it is cancelled. With `save`
//                                                (an async function given the keys) Done runs it while the dialog stays open: it
//                                                returns true (done), false (stay, nothing said) or throws (the dialog shows the
//                                                failure and stays, so Done can be pressed again).
//   whoBlock(file, ctx)                          the file window's "Who can see this" control and its notices; see below
//   askNarrowing(ctx)                            the question before a change takes sight from people who have it
//
// The page never decides who sees what. It shows what the server returns (`visibility`, and `people` only for the adder and owners)
// and asks the server to change it; the server's refusals are shown as they come.
import { api, word } from '/brand.js';
import { openHostMenu } from '/host-menu.js';
import { confirmDialog } from '/confirm.js';
import { h, fa, btn } from '/file-viewer-views.js';

export const LIMIT = 200;
const SHOWN = 30; // people listed at a time in the picker; a search finds the rest
const enc = encodeURIComponent;
export const peopleWord = (n) => (n === 1 ? '1 person' : `${n} people`);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// The stylesheet, once for each document.
const styled = new WeakMap();
export function styles(doc) {
  if (styled.has(doc)) return styled.get(doc);
  const done = new Promise((resolve) => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/vault-privacy.css';
    link.addEventListener('load', resolve);
    link.addEventListener('error', resolve);
    doc.head.append(link);
    setTimeout(resolve, 1500);
  });
  styled.set(doc, done);
  return done;
}

// ---- the people of a space ---------------------------------------------------------------------------------------------------------
export async function loadMembers(spaceId) {
  const { users = [], spaces = [] } = await api('GET', '/api/presence');
  const here = spaces.find((r) => r.id === spaceId);
  const keys = new Set(here ? here.members : []);
  return users.filter((u) => keys.has(u.key)).map((u) => ({ key: u.key, name: u.displayName, owner: Boolean(u.isOwner) }));
}

function avatar(name, px = 20) {
  const a = h('span', `sdk-avatar sdk-avatar-${px}`);
  a.append(h('span', 'sdk-avatar-ini', (name || '?').trim().charAt(0).toUpperCase() || '?'));
  a.setAttribute('aria-hidden', 'true');
  return a;
}

// ---- the people picker -------------------------------------------------------------------------------------------------------------
let uid = 0;
export async function choosePeople({ doc = document, members, chosen = [], adder = '', you = true, subject = 'it', max = LIMIT, returnFocus, save } = {}) {
  await styles(doc);
  const nameOf = new Map(members.map((m) => [m.key, m.name]));
  const adderName = nameOf.get(adder) || 'You';
  const choosable = members.filter((m) => m.key !== adder);
  const st = { chosen: new Set(chosen.filter((k) => k !== adder && nameOf.has(k))), q: '' };
  const space = word('space');
  const owners = word('owner', { many: true });

  return new Promise((resolve) => {
    const id = `vp-pick-${++uid}`;
    const dlg = h('dialog', 'sdk-dialog sdk-dialog-confirm vp-sheet');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', `${id}-t`);
    const head = h('div', 'sdk-dialog-head');
    const title = h('h2', 'sdk-dialog-title', 'Who can see this');
    title.id = `${id}-t`;
    const closeBtn = h('button', 'sdk-icon-btn btn-quiet btn-small sdk-dialog-close');
    closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close'); closeBtn.dataset.close = '';
    closeBtn.append(fa('xmark'));
    head.append(title, closeBtn);
    const body = h('div', 'sdk-dialog-body vp-pickbody');
    const foot = h('div', 'sdk-dialog-foot');
    const cancel = h('button', 'btn', 'Cancel'); cancel.type = 'button'; cancel.dataset.close = '';
    const done = h('button', 'btn btn-primary', 'Done'); done.type = 'button'; done.dataset.ok = '';
    foot.append(cancel, done);
    dlg.append(head, body, foot);

    const fail = h('div', 'sdk-banner vp-error');
    fail.dataset.kind = 'danger'; fail.setAttribute('role', 'alert'); fail.hidden = true;
    const failIcon = h('span', 'sdk-banner-icon'); failIcon.append(fa('circle-exclamation'));
    fail.append(failIcon, h('span', 'sdk-banner-text', "We couldn't save who can see this. Nothing changed. Try again."));
    const search = h('label', 'sdk-search');
    const input = h('input'); input.type = 'search'; input.placeholder = 'Search people'; input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Search people');
    search.append(fa('magnifying-glass'), input);
    const chosenHead = h('div', 'vp-chosen-head');
    const count = h('span', 'vp-count'); count.setAttribute('role', 'status');
    chosenHead.append(h('span', 'sdk-label', 'Chosen'), count);
    const chips = h('div', 'vp-chosen');
    chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Chosen people');
    const limit = h('div', 'sdk-banner vp-limit');
    limit.dataset.kind = 'warn'; limit.setAttribute('role', 'status');
    const limitIcon = h('span', 'sdk-banner-icon'); limitIcon.append(fa('triangle-exclamation'));
    limit.append(limitIcon, h('span', 'sdk-banner-text', `You can choose up to ${max} people. Take someone off to add another.`));
    const list = h('div', 'vp-people');
    list.setAttribute('role', 'group'); list.setAttribute('aria-label', `People in this ${space}`);
    body.append(fail, search, chosenHead, chips, limit, list);

    const boxes = new Map(); // key -> checkbox, for the rows drawn now
    const full = () => st.chosen.size >= max;
    function drawChips() {
      chips.textContent = '';
      const mine = h('span', 'sdk-chip-tag vp-you');
      mine.append(avatar(adderName), you ? `${adderName} (you)` : `${adderName} (added it)`);
      chips.append(mine);
      for (const k of st.chosen) {
        const c = h('span', 'sdk-chip-removable vp-chip');
        const x = h('button', 'sdk-chip-x'); x.type = 'button'; x.dataset.key = k;
        x.setAttribute('aria-label', `Take off ${nameOf.get(k) || 'someone who left'}`);
        x.append(fa('xmark'));
        c.append(avatar(nameOf.get(k)), h('span', 'sdk-chip-label', nameOf.get(k) || 'someone who left'), x);
        chips.append(c);
      }
    }
    function sync() {
      count.textContent = `${st.chosen.size} of ${max} chosen`;
      limit.hidden = !full();
      for (const [k, box] of boxes) { box.checked = st.chosen.has(k); box.disabled = full() && !box.checked; }
    }
    function drawList() {
      list.textContent = '';
      boxes.clear();
      const q = st.q.trim().toLowerCase();
      const shown = choosable.filter((m) => !q || m.name.toLowerCase().includes(q));
      for (const m of shown.slice(0, SHOWN)) {
        if (m.owner) { // an owner always can: shown, not choosable
          const r = h('div', 'sdk-choice-row vp-person vp-locked');
          r.append(avatar(m.name, 24), h('span', 'sdk-choice-label', m.name), h('span', 'vp-role', 'Always can'));
          list.append(r);
          continue;
        }
        const r = h('label', 'sdk-choice-row vp-person');
        const box = h('input'); box.type = 'checkbox'; box.dataset.key = m.key;
        box.addEventListener('change', () => { if (box.checked) st.chosen.add(m.key); else st.chosen.delete(m.key); drawChips(); sync(); });
        boxes.set(m.key, box);
        r.append(box, avatar(m.name, 24), h('span', 'sdk-choice-label', m.name));
        list.append(r);
      }
      if (!choosable.some((m) => !m.owner)) list.append(h('p', 'vp-none', `No one else is in this ${space} yet. Only you and the ${owners} can see ${subject}.`));
      if (choosable.some((m) => !m.owner) && !shown.length) list.append(h('p', 'vp-none', `No one matches "${st.q.trim()}".`));
      else if (shown.length > SHOWN) list.append(h('p', 'vp-none', `${shown.length - SHOWN} more. Search to find them.`));
      sync();
    }
    input.addEventListener('input', () => { st.q = input.value; drawList(); });
    chips.addEventListener('click', (e) => {
      const x = e.target.closest('.sdk-chip-x');
      if (!x) return;
      const all = [...chips.querySelectorAll('.sdk-chip-x')];
      const at = all.indexOf(x);
      st.chosen.delete(x.dataset.key);
      drawChips(); sync();
      const left = [...chips.querySelectorAll('.sdk-chip-x')];
      (left[Math.min(at, left.length - 1)] || input).focus({ preventScroll: true });
    });

    const opener = returnFocus ? null : (doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null);
    const root = doc.documentElement;
    const was = root.style.overflow;
    let ended = false;
    let busy = false;
    const end = (value) => {
      if (ended) return;
      ended = true;
      if (dlg.open) dlg.close();
      root.style.overflow = was;
      dlg.remove();
      const back = returnFocus ? returnFocus() : opener;
      if (back && back.isConnected !== false && typeof back.focus === 'function') back.focus({ preventScroll: true });
      resolve(value);
    };
    async function accept() {
      if (busy) return;
      const keys = [...st.chosen];
      if (!save) { end(keys); return; }
      busy = true; done.disabled = true; dlg.setAttribute('aria-busy', 'true'); fail.hidden = true;
      try {
        const out = await save(keys);
        if (out === false) return;
        end(keys);
      } catch {
        fail.hidden = false;
        body.scrollTop = 0;
      } finally {
        busy = false; done.disabled = false; dlg.removeAttribute('aria-busy');
        if (!ended) done.focus({ preventScroll: true });
      }
    }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!busy) end(null); });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) return; // a click outside does not close it: a long choice is not lost by a slip
      if (e.target.closest('[data-close]') && !busy) end(null);
      else if (e.target.closest('[data-ok]')) accept();
    });
    drawChips(); drawList();
    doc.body.append(dlg);
    root.style.overflow = 'hidden';
    dlg.showModal();
    input.focus({ preventScroll: true });
  });
}

// ---- the question before a change takes sight from people ------------------------------------------------------------------
// Who has sight under a visibility, from what the page was told: everyone (the space's people), the adder only, or the chosen people.
// Owners and the adder are left out of the people who lose sight: they keep it whatever is chosen.
const audience = (vis, people, members) => {
  if (vis === 'everyone') return new Set(members.map((m) => m.key));
  if (vis === 'people') return new Set((people || []).filter((k) => members.some((m) => m.key === k)));
  return new Set();
};
const listNames = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const shortName = (name) => (name.length > 60 ? `${name.slice(0, 59)}…` : name);

// What the page can read to work out what a change takes away. The server has no preview of a change, so this is the page's own
// count: the people in the old audience and not in the new one (less the adder and the owners), the links from objects the person
// may see (GET .../uses), and the share links made by someone who would lose sight (GET .../library/shares, for those who may
// make share links). A moderator who holds See every file keeps sight whatever is chosen, and the page cannot tell, so such a
// person may be counted among those who lose it.
//   ctx: { doc, place: { module, space }, file, next: { visibility, people }, members, me, mayShare, names }
// Resolves true to go on (nothing is taken from anyone with links to lose, or the person said yes), false to stop.
export async function askNarrowing({ doc = document, place, file, next, members, me, mayShare, names }) {
  const keep = new Set([file.by, ...members.filter((m) => m.owner).map((m) => m.key)]);
  const before = audience(file.visibility || 'everyone', file.people, members);
  const after = audience(next.visibility, next.people, members);
  const lose = [...before].filter((k) => !after.has(k) && !keep.has(k));
  if (!lose.length) return true;
  const nameOf = (k) => names.get(k) || 'someone who left';
  const losers = lose.map(nameOf).sort((a, b) => a.localeCompare(b));
  const few = losers.length <= 4;
  const who = few ? listNames(losers) : `those ${losers.length} people`;

  let uses = null;
  let unknownUses = false;
  if (file.uses > 0) {
    try { uses = await api('GET', `/api/modules/${enc(place.module)}/library/${enc(file.id)}/uses?space=${enc(place.space)}`); } catch { unknownUses = true; }
  }
  let ending = [];
  if (mayShare && file.shared !== false) {
    try {
      const all = (await api('GET', `/api/modules/${enc(place.module)}/library/shares?space=${enc(place.space)}`)).shares || [];
      const loser = new Set(lose);
      ending = all.filter((s) => Array.isArray(s.files) && s.files.includes(file.id) && Date.parse(s.ends) > Date.now() && loser.has(s.by));
    } catch { /* the page can't read the share links: the question says nothing of them */ }
  }
  const links = uses ? uses.uses.length + uses.hidden : 0;
  if (!links && !unknownUses && !ending.length) return true;

  const rows = [['users', `${few ? listNames(losers) : peopleWord(losers.length)} can no longer see the file.`]];
  if (links || unknownUses) {
    let text;
    if (unknownUses) text = `It is linked from other tools. For ${who} the links show hidden.`;
    else {
      const named = uses.uses.map((x) => `${x.title} in ${(x.module && x.module.name) || x.moduleName || 'another tool'}`);
      if (uses.hidden) named.push(`${uses.hidden} you can't see`);
      text = `Linked from ${links === 1 ? '1 place' : `${links} places`}: ${listNames(named)}. For ${who} the ${links === 1 ? 'link shows' : 'links show'} hidden.`;
    }
    rows.push(['link', text]);
  }
  if (ending.length) {
    const nm = (s) => `"${s.name}", made by ${nameOf(s.by)}`;
    const makers = [...new Set(ending.map((s) => nameOf(s.by)))];
    rows.push(['share-nodes', ending.length === 1
      ? `In 1 share link, ${nm(ending[0])}. It ends, because ${makers[0]} can no longer see the file.`
      : `In ${ending.length} share links: ${listNames(ending.map(nm))}. They end, because their makers can no longer see the file.`]);
  }
  const mine = file.by === me;
  const lead = next.visibility === 'only-me'
    ? `${shortName(file.name)} will be seen only by ${mine ? 'you' : nameOf(file.by)} and the ${word('owner', { many: true })}.`
    : (() => {
      const kept = [...after].filter((k) => k !== file.by && !members.find((m) => m.key === k)?.owner).map(nameOf).sort((a, b) => a.localeCompare(b));
      const tail = kept.length <= 3 ? listNames(kept) : `${peopleWord(kept.length)}`;
      return `${shortName(file.name)} will be seen by ${mine ? 'you' : nameOf(file.by)}, the ${word('owner', { many: true })}${kept.length ? ` and ${tail}` : ''}.`;
    })();
  return confirmDialog({ title: 'Change who can see this file?', message: lead, list: rows, action: next.visibility === 'only-me' ? 'Make it only me' : 'Remove those people', kind: 'destructive', solid: true }, doc);
}

// ---- the file window's Info -------------------------------------------------------------------------------------------------------
// The words for a setting. `mine`: the viewer added the file. `adderName`: who did.
export function visibilityWord(vis, { mine = true, adderName = '', count = 0 } = {}) {
  if (vis === 'only-me') return mine ? 'Only me' : `Only ${adderName || 'the person who added it'}`;
  if (vis === 'people') return `Chosen people${count ? ` · ${count}` : ''}`;
  return `Everyone in this ${word('space')}`;
}
const ICONS = { everyone: 'users', 'only-me': 'lock', people: 'user-group' };

// ctx: { doc, me, owner, role, names, members(), ask(file, next, members), change(next), control() }
//   `owner`: the viewer is an owner or the admin; `role`: their sign-in role ('owner' or 'admin') for the notice; `names`: key -> name;
//   `members()` loads the space's people; `ask` is the narrowing question (true to go on); `change(next)` asks the server and
//   draws the window again (it throws when the server refuses); `control()` is the control now on screen, for focus.
// Gives { top, after }: `top` goes above the facts (for the adder and owners: the control; for an owner looking at a file not shared
// with them, the notice too), `after` below them (a person it is shared with: one read-only line). Either may be null.
// `file.visibility` is the server's word and `file.people` is sent only to the adder and owners.
export function whoBlock(file, ctx) {
  const { me, owner, names } = ctx;
  const mine = file.by === me;
  const manage = mine || owner;
  const vis = file.visibility || 'everyone';
  if (!manage) {
    // Read only: a person who may not change it. No names, no count; nothing at all for a file shared with everyone.
    if (!file.visibility || file.visibility === 'everyone') return { top: null, after: null };
    const box = h('div', 'vp-who-info vp-after');
    box.append(h('p', 'vp-readonly', 'Shared with you and others.'));
    return { top: null, after: box };
  }
  const adderName = mine ? 'You' : names.get(file.by) || 'someone who left';
  const box = h('div', 'vp-who-info');
  box.append(h('h4', 'fv-info-sub', 'Who can see this'));
  const chosenNow = (file.people || []).filter((k) => names.has(k));
  const b = btn('btn btn-small vp-change', { label: visibilityWord(vis, { mine, adderName, count: chosenNow.length }), icon: ICONS[vis] || 'users' });
  b.append(fa('caret-down', 'vp-caret'));
  b.setAttribute('aria-haspopup', 'menu');
  b.dataset.change = '';
  const problem = h('p', 'sdk-error vp-save-error');
  problem.id = `vp-save-${++uid}`;
  problem.setAttribute('role', 'alert');
  problem.hidden = true;
  problem.append(fa('circle-exclamation'), ' ', "We couldn't change who can see this file. Nothing changed. Try again.");
  const clearProblem = () => { problem.hidden = true; b.removeAttribute('aria-describedby'); };
  const showProblem = () => { problem.hidden = false; b.setAttribute('aria-describedby', problem.id); };
  // Everyone or Only me. Widening is never asked; taking sight from people may be.
  async function set(next) {
    clearProblem();
    try {
      if (next.visibility !== 'everyone' && !(await ctx.ask(file, next, await ctx.members()))) return;
      await ctx.change(next);
    } catch { showProblem(); }
  }
  async function pick() {
    clearProblem();
    let members;
    try { members = await ctx.members(); } catch { showProblem(); return; }
    await choosePeople({
      doc: ctx.doc, members, chosen: file.people || [], adder: file.by, you: mine, subject: 'this file', returnFocus: () => ctx.control() || b,
      save: async (keys) => {
        const next = keys.length ? { visibility: 'people', people: keys } : { visibility: 'only-me', people: [] };
        if (!(await ctx.ask(file, next, members))) return false;
        await ctx.change(next);
        return true;
      },
    });
  }
  const items = () => [
    { heading: 'Who can see this' },
    ...[['everyone', visibilityWord('everyone')], ['only-me', visibilityWord('only-me', { mine, adderName })], ['people', 'Chosen people']].map(([key, text]) => ({
      label: text, radio: true, checked: key === vis, ...(key === vis ? { icon: 'circle-dot' } : { icon: 'circle', regular: true }),
      onPick: () => { if (key === 'people') pick(); else if (key !== vis) set({ visibility: key, people: [] }); },
    })),
  ];
  b.addEventListener('click', () => openHostMenu(b, items));
  box.append(b, problem);
  if (vis === 'people' && !chosenNow.length) box.append(h('p', 'vp-none', `No one chosen yet. Only you and the ${word('owner', { many: true })} can see it.`));
  if (vis === 'people' && chosenNow.length) {
    const ul = h('ul', 'vp-namelist');
    ul.setAttribute('aria-label', 'People who can see this file');
    for (const k of chosenNow) { const li = h('li'); li.append(avatar(names.get(k)), names.get(k)); ul.append(li); }
    box.append(ul);
  }
  const owners = word('owner', { many: true });
  box.append(h('p', 'vp-none', mine ? `You added this file, and ${owners} and the admin can always see it.` : `${adderName} added this file. ${cap(owners)} and the admin can always see it.`));
  // An owner or the admin looking at a file that was not shared with them: the window says so, so nobody is surprised.
  const notShared = !mine && vis !== 'everyone' && !(vis === 'people' && (file.people || []).includes(me));
  if (notShared) {
    const note = h('div', 'sdk-banner vp-rights');
    note.dataset.kind = 'info'; note.setAttribute('role', 'status');
    const ic = h('span', 'sdk-banner-icon'); ic.append(fa('eye'));
    const because = ctx.role === 'admin' ? 'you are the admin' : `you are ${word('owner', { a: true })}`;
    note.append(ic, h('span', 'sdk-banner-text', `This file is not shared with you. You can open it because ${because}.${vis === 'only-me' ? ` ${adderName} can see it.` : ''}`));
    box.prepend(note);
  }
  return { top: box, after: null };
}
