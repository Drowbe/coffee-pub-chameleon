// The object picker: the window host.objects.pick opens, drawn by the page over everything (module-host.js, 'objects.pick').
// pickObjects({ title, multiple, modules, kinds }, { search, kinds }) resolves with a pointer (a ref), a list of them (multiple), or
// null (Close, Cancel, Escape, a click on the backdrop). It rejects only when it is asked badly or cannot be drawn.
//
//   search(text)  -> Promise<summary[]>   the person's own search (module-host's 'objects.search'); summaries as the server gives them
//   kinds         -> [{ module, kind, icon, name }]   what the kinds look like (module-host's 'objects.kinds'), for the icon of a row
//   modules, kinds (in the options)   keep only those modules' objects / those kinds ("kind" or "module:kind")
//
// A search box (focus starts there), rows (the shared .sdk-row: the kind's icon, the title, the subtitle, the module), a status line
// that says what is going on (searching, nothing found, could not search). The ARIA combobox-with-listbox pattern: Down and Up move
// the highlighted row, Enter chooses it, Escape closes. On a phone the window is a full-height sheet. Look: the Dialogs family
// (documentation/designsystem), the "objectpick" block of /sdk/system.css.

let uid = 0;
const ICON = /^[a-z0-9-]{1,40}$/;

export function cleanPick(o) {
  const t = o && typeof o === 'object' ? o : {};
  const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(0, 20) : []);
  return { title: typeof t.title === 'string' ? t.title.trim().slice(0, 120) : '', multiple: t.multiple === true, modules: names(t.modules), kinds: names(t.kinds) };
}

// Whether a summary is one the options ask for.
export function pickFits(summary, o) {
  if (!summary || summary.error || !summary.ref || typeof summary.ref !== 'object') return false;
  const mod = (summary.module && summary.module.id) || summary.ref.module;
  if (o.modules.length && !o.modules.includes(mod)) return false;
  if (o.kinds.length && !o.kinds.some((k) => k === summary.ref.kind || k === `${mod}:${summary.ref.kind}`)) return false;
  return true;
}

export function pickObjects(options, deps, doc = document) {
  return new Promise((resolve, reject) => {
    const o = cleanPick(options);
    const { search, kinds = [] } = deps || {};
    if (typeof search !== 'function') { reject(new Error('there is nothing to search')); return; }
    if (!doc || !doc.body || typeof doc.createElement !== 'function') { reject(new Error('there is no page to ask on')); return; }
    const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const id = `sdk-pick-${++uid}`;
    const opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    const kindIcon = new Map((Array.isArray(kinds) ? kinds : []).map((k) => [`${k.module}:${k.kind}`, k.icon]));

    const dlg = make('dialog', 'sdk-dialog-pick');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', `${id}-t`);
    const head = make('div', 'sdk-dialog-head');
    const title = make('h2', 'sdk-dialog-title', o.title || 'Pick');
    title.id = `${id}-t`;
    const close = make('button', 'sdk-icon-btn btn-quiet btn-small sdk-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.dataset.close = '';
    close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    head.append(title, close);

    const body = make('div', 'sdk-dialog-body');
    const searchBox = make('div', 'sdk-search');
    searchBox.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';
    const input = make('input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Search';
    input.setAttribute('aria-label', 'Search');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', `${id}-l`);
    input.setAttribute('aria-autocomplete', 'list');
    searchBox.appendChild(input);
    const status = make('p', 'sdk-pick-status');
    status.setAttribute('role', 'status');
    const list = make('div', 'sdk-pick-list');
    list.id = `${id}-l`;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', `${id}-t`);
    if (o.multiple) list.setAttribute('aria-multiselectable', 'true');
    body.append(searchBox, status, list);

    const foot = make('div', 'sdk-dialog-foot');
    const cancel = make('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.dataset.close = '';
    foot.appendChild(cancel);
    let ok = null;
    if (o.multiple) {
      ok = make('button', 'btn btn-primary', 'Pick');
      ok.type = 'button';
      ok.disabled = true;
      foot.appendChild(ok);
    }
    dlg.append(head, body, foot);

    const root = doc.documentElement;
    const was = root.style.overflow;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof dlg.close === 'function' && dlg.open) dlg.close(value ? 'ok' : 'cancel');
      root.style.overflow = was;
      dlg.remove();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      resolve(value);
    };

    // The rows. `shown` is what is drawn, in order; `chosen` the ticked ones (multiple), by key.
    let shown = [];
    let active = -1;
    const chosen = new Map();
    const keyOf = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
    const setActive = (i, scroll = true) => {
      const rows = [...list.children];
      active = rows.length ? Math.max(0, Math.min(rows.length - 1, i)) : -1;
      rows.forEach((r, n) => { r.classList.toggle('active', n === active); r.removeAttribute('aria-current'); });
      if (active >= 0) {
        rows[active].setAttribute('aria-current', 'true');
        input.setAttribute('aria-activedescendant', rows[active].id);
        if (scroll && typeof rows[active].scrollIntoView === 'function') rows[active].scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    };
    const refreshOk = () => { if (ok) { ok.disabled = chosen.size === 0; ok.textContent = chosen.size > 1 ? `Pick ${chosen.size}` : 'Pick'; } };
    const choose = (i) => {
      const s = shown[i];
      if (!s) return;
      if (!o.multiple) { done(s.ref); return; }
      const k = keyOf(s.ref);
      if (chosen.has(k)) chosen.delete(k); else chosen.set(k, s.ref);
      const row = list.children[i];
      row.setAttribute('aria-selected', String(chosen.has(k)));
      refreshOk();
    };
    const draw = (summaries) => {
      shown = summaries;
      list.replaceChildren();
      summaries.forEach((s, i) => {
        const row = make('div', 'sdk-row sdk-pick-row');
        row.id = `${id}-o${i}`;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(chosen.has(keyOf(s.ref))));
        const mod = (s.module && s.module.id) || s.ref.module;
        const icon = [s.icon, kindIcon.get(`${mod}:${s.ref.kind}`), s.module && s.module.icon].find((n) => typeof n === 'string' && ICON.test(n)) || 'circle';
        const chip = make('span', 'sdk-card-icon');
        chip.innerHTML = `<i class="fa-solid fa-${icon}" aria-hidden="true"></i>`;
        if (typeof s.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.color)) chip.style.setProperty('--kind-color', s.color);
        const main = make('span', 'sdk-row-main');
        main.append(make('span', 'sdk-row-title', s.title || 'Untitled'));
        if (s.subtitle) main.append(make('span', 'sdk-row-sub', s.subtitle));
        row.append(chip, main);
        const where = s.kindName || (s.module && s.module.name) || '';
        if (where) row.append(make('span', 'sdk-row-meta', where));
        if (o.multiple) { const tick = make('i', 'fa-solid fa-check sdk-pick-tick'); tick.setAttribute('aria-hidden', 'true'); row.append(tick); }
        row.addEventListener('pointerdown', (e) => e.preventDefault()); // the search box keeps focus
        row.addEventListener('click', () => { setActive(i, false); choose(i); });
        list.appendChild(row);
      });
      setActive(summaries.length ? 0 : -1);
    };

    // The search: after a short pause, newest answer only.
    let timer = 0;
    let asked = 0;
    const run = async () => {
      const n = ++asked;
      const q = input.value.trim();
      status.textContent = 'Searching...';
      let found;
      try {
        found = await search(q);
      } catch (err) {
        if (n !== asked || settled) return;
        draw([]);
        status.textContent = 'Could not search just now.';
        return;
      }
      if (n !== asked || settled) return;
      const fits = (Array.isArray(found) ? found : []).filter((s) => pickFits(s, o));
      draw(fits);
      status.textContent = fits.length ? `${fits.length} found` : q ? 'Nothing found.' : 'Nothing here yet.';
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });

    const focusables = () => [...dlg.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')].filter((e) => !e.disabled && !e.hidden && !e.closest('[hidden]'));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); }); // Escape
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); return; }
      if (e.target === input) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); return; }
        if (e.key === 'Home' && !input.value) { e.preventDefault(); setActive(0); return; }
        if (e.key === 'End' && !input.value) { e.preventDefault(); setActive(shown.length - 1); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (o.multiple && e.shiftKey === false && chosen.size && active < 0) { done([...chosen.values()]); return; }
          choose(active);
          return;
        }
        if (e.key === ' ' && o.multiple && active >= 0 && !input.value.trim()) { e.preventDefault(); choose(active); return; }
      }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(doc.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) { done(null); return; } // the backdrop
      if (e.target.closest('[data-close]')) { done(null); return; }
      if (ok && e.target.closest('.btn-primary') === ok && !ok.disabled) done([...chosen.values()]);
    });

    doc.body.appendChild(dlg);
    root.style.overflow = 'hidden';
    try { dlg.showModal(); } catch (err) { root.style.overflow = was; dlg.remove(); reject(err); return; }
    input.focus();
    run();
  });
}
