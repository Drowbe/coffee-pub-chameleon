// The forms for the settings modules declare (module.json `settings`): one card per module that has settings of
// a scope, one control per setting, a Save on each card. Used on the Modules tab (the server's), a space's page (the
// space's), the page a space's moderators use (module-settings.html) and the profile page (a person's own); and,
// without the cards' Saves (`draft: true`), in the Set up panel's modules tab, whose own Save sends them. The
// server decides who may change what; this only draws what it is given.
import { api, escapeHtml, word, accessKeyHeaders } from '/brand.js';
import { confirmDialog } from '/confirm.js';
import { upgradeColourInputs } from '/colour-pick.js';

// A list of things with a label, an icon and a colour each (Planner's marker types): rows to change, reorder, remove and add. The rows the
// module says are fixed (def.fixed: ids) are always there; their label, icon and colour can change but they cannot be removed.
// Icons are picked from a small set of Font Awesome names that suit a plan; the colour is a hex value.
const ICONS = ['flag', 'flag-checkered', 'plane-departure', 'plane-arrival', 'plane', 'train', 'car', 'ship', 'bus', 'bed', 'utensils', 'mug-hot', 'martini-glass', 'camera', 'mountain', 'umbrella-beach', 'person-walking', 'person-hiking', 'ticket', 'bell', 'clock', 'hourglass-half', 'moon', 'sun', 'face-smile', 'heart', 'star', 'users', 'shopping-bag', 'landmark', 'music', 'circle-exclamation', 'triangle-exclamation', 'location-dot', 'suitcase', 'gift', 'wine-glass', 'spa', 'bolt', 'note-sticky', 'city', 'dungeon', 'chess-rook', 'beer-mug-empty', 'skull', 'dragon', 'hat-wizard', 'compass', 'map', 'campground', 'church', 'house', 'store', 'tree', 'water', 'book', 'gem', 'shield-halved', 'fire', 'horse', 'anchor', 'monument', 'building', 'coins', 'scroll', 'khanda', 'tents'];
// The colours a new row starts with, one after another, so rows added in a run do not all look alike.
const NEW_COLORS = ['#4f8fdd', '#e0883a', '#4caf7a', '#b268d8', '#d9534f', '#2fb5b5', '#c9a227', '#7f8fa6'];
const ICON_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX = /^#[0-9a-f]{6}$/i;
function listRow(def, r) {
  const fixed = (def.fixed || []).includes(r.id);
  const color = HEX.test(r.color || '') ? r.color : '#888888';
  const icon = ICONS.includes(r.icon) || ICON_RE.test(r.icon || '') ? r.icon : ICONS[0]; // a saved icon outside the picker stays as it is
  return `<li class="sdk-row list-row" data-id="${escapeHtml(r.id || '')}" data-icon="${escapeHtml(icon)}">
    <input type="color" data-f="color" value="${escapeHtml(color)}" aria-label="Colour">
    <details class="icon-pick"><summary aria-label="Icon" title="Icon"><i class="fa-solid fa-${escapeHtml(icon)} fa-fw" aria-hidden="true"></i></summary><div class="icon-grid">${ICONS.map((n) => `<button type="button" data-icon-choice="${n}" data-tip="${n.replace(/-/g, ' ')}" aria-label="${n.replace(/-/g, ' ')}"><i class="fa-solid fa-${n} fa-fw" aria-hidden="true"></i></button>`).join('')}</div></details>
    <input type="text" data-f="label" value="${escapeHtml(r.label || '')}" maxlength="${def.maxLength || 30}" placeholder="Label" aria-label="Label">
    <span class="list-tools"><button type="button" class="btn btn-small" data-list="up" data-tip="Move up" aria-label="Move up"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button><button type="button" class="btn btn-small" data-list="down" data-tip="Move down" aria-label="Move down"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>${fixed ? '<span class="sdk-status">Built in</span>' : '<button type="button" class="btn btn-small btn-danger" data-list="remove" data-tip="Remove" aria-label="Remove"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>'}</span>
  </li>`;
}
function listControl(def) {
  const rows = Array.isArray(def.value) ? def.value : [];
  return `<div class="list-setting" data-key="${escapeHtml(def.key)}" data-list-setting><div class="hint">${escapeHtml(def.label)}</div><ul class="list-rows">${rows.map((r) => listRow(def, r)).join('')}</ul><button type="button" class="btn btn-small" data-list="add"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add</button></div>`;
}
// What the rows say now: [{ id, label, icon, color }] (a new row has no id: the server makes one from its label).
function readList(el) {
  return [...el.querySelectorAll('.list-row')].map((li) => ({ id: li.dataset.id || '', label: li.querySelector('[data-f="label"]').value.trim(), icon: li.dataset.icon, color: li.querySelector('[data-f="color"]').value }));
}
function wireList(el, def) {
  el.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-icon-choice]');
    const li = event.target.closest('.list-row');
    if (choice && li) {
      li.dataset.icon = choice.dataset.iconChoice;
      li.querySelector('summary i').className = `fa-solid fa-${choice.dataset.iconChoice} fa-fw`;
      li.querySelector('details').open = false;
      return;
    }
    const b = event.target.closest('[data-list]');
    if (!b) return;
    const list = el.querySelector('.list-rows');
    if (b.dataset.list === 'add') {
      list.insertAdjacentHTML('beforeend', listRow(def, { id: '', label: '', icon: 'flag', color: NEW_COLORS[list.children.length % NEW_COLORS.length] }));
      upgradeColourInputs(list.lastElementChild);
      list.lastElementChild.querySelector('[data-f="label"]').focus();
    } else if (li && b.dataset.list === 'remove') li.remove();
    else if (li && b.dataset.list === 'up' && li.previousElementSibling) li.previousElementSibling.before(li);
    else if (li && b.dataset.list === 'down' && li.nextElementSibling) li.nextElementSibling.after(li);
  });
}

// A secret setting (a key): a write-only box. It is always empty when drawn; the server never sends the value, only whether one
// is set. "Replace" opens the box, "Clear" takes the key away now. Only an owner is ever given this form (the settings route is
// the owner's), so nobody else sees the control.
function secretControl(def, id) {
  const set = Boolean(def.value && def.value.set);
  const state = set ? 'Set' : def.value && def.value.unreadable ? 'Not set: the saved key cannot be read, enter it again' : 'Not set';
  return `<div class="secret-setting" data-key="${escapeHtml(def.key)}" data-secret-setting>
    <div class="hint" id="${id}-label">${escapeHtml(def.label)} <span class="sdk-status" data-secret-state role="status">${escapeHtml(state)}</span></div>
    <div class="row"><input id="${id}" type="password" data-secret-input autocomplete="new-password" autocapitalize="off" spellcheck="false" value="" maxlength="${Number(def.maxLength) || 200}" aria-labelledby="${id}-label" ${set ? 'hidden' : ''}>
    <button type="button" class="btn btn-small" data-secret-replace ${set ? '' : 'hidden'}>Replace</button>
    <button type="button" class="btn btn-small btn-danger" data-secret-clear ${set ? '' : 'hidden'}>Clear</button></div>
  </div>`;
}
function showSecretState(box, value) {
  const set = Boolean(value && value.set);
  const input = box.querySelector('[data-secret-input]');
  input.value = '';
  input.hidden = set;
  box.querySelector('[data-secret-replace]').hidden = !set;
  box.querySelector('[data-secret-clear]').hidden = !set;
  box.querySelector('[data-secret-state]').textContent = set ? 'Set' : value && value.unreadable ? 'Not set: the saved key cannot be read, enter it again' : 'Not set';
}

function control(def, draft = false) {
  if (def.type === 'list') return listControl(def);
  if (def.type === 'secret') return secretControl(def, `ms-${def.key}`);
  const id = `ms-${def.key}`;
  if (def.type === 'boolean') return `<label class="sdk-choice-row"><input type="checkbox" data-key="${escapeHtml(def.key)}" ${def.value ? 'checked' : ''}><span class="sdk-choice-text">${escapeHtml(def.label)}</span></label>`;
  // A note has no control and no value: a label (its help under it), for a module to say where something is set up.
  if (def.type === 'note') return `<span class="field-label">${escapeHtml(def.label)}</span>`; // its help follows, as every setting's does
  const head = `<label>${escapeHtml(def.label)}`;
  if (def.type === 'choice') return `${head}<select data-key="${escapeHtml(def.key)}">${def.options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === def.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>${def.options.some((o) => o.help) ? '<div class="option-help" data-option-help></div>' : ''}`;
  // A setting the host keeps for every environment (a shared folder, or the address regions are cut from): shown, never set here.
  if (def.shared === true) { // true only when the host really keeps it: the listing also carries the manifest's own "host" flag on a single install
    const files = def.type === 'files' ? (def.available || []) : [];
    const list = files.length ? `<ul class="shared-files">${files.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : def.type === 'files' ? '<p class="hint">The host has no files here yet.</p>' : '';
    return `<div data-shared><div class="hint">${escapeHtml(def.label)} <span class="sdk-status">Provided by the host</span></div>${list}${def.type !== 'files' && def.value ? `<p class="hint">${escapeHtml(String(def.value))}</p>` : ''}</div>`;
  }
  if (def.type === 'files') {
    const chosen = new Set(Array.isArray(def.value) ? def.value : def.value ? [def.value] : []);
    const size = (n) => { const b = (def.sizes || {})[n]; return b === undefined ? '' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`; };
    // How detailed a map file is (street-level or not), read from its own PMTiles header -- blank for anything else.
    const zoom = (n) => { const z = (def.zooms || {})[n]; return z ? (z.minZoom === z.maxZoom ? `${z.maxZoom}` : `${z.minZoom}–${z.maxZoom}`) : ''; };
    const hasZooms = Object.keys(def.zooms || {}).length > 0;
    // What a PMTiles file holds, read from its own header: "Picture" (picture tiles) or "Map data"; blank when it says nothing.
    const kind = (n) => KIND_WORDS[(def.kinds || {})[n]] || '';
    const hasKinds = Object.keys(def.kinds || {}).length > 0;
    const rows = (def.available || []).map((n) => `<tr><td class="sdk-table-check"><input type="checkbox" value="${escapeHtml(n)}" ${chosen.has(n) ? 'checked' : ''} aria-label="Use ${escapeHtml(n)}"></td><th scope="row">${escapeHtml(n)}</th>${hasKinds ? `<td class="sdk-table-dim">${kind(n)}</td>` : ''}${hasZooms ? `<td class="sdk-table-dim">${zoom(n)}</td>` : ''}<td class="num sdk-table-dim">${size(n)}</td><td><button type="button" class="btn btn-small btn-danger" data-delete-file="${escapeHtml(n)}" data-tip="Delete ${escapeHtml(n)}" aria-label="Delete ${escapeHtml(n)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></td></tr>`).join('');
    return `<div data-key="${escapeHtml(def.key)}" data-files data-folder="${escapeHtml(folderName(def))}"><div class="hint">${escapeHtml(def.label)}</div>${rows ? `<div class="sdk-table-wrap"><table class="sdk-table" aria-label="${escapeHtml(def.label)}"><thead><tr><th scope="col" class="sdk-table-check">Use</th><th scope="col">File</th>${hasKinds ? '<th scope="col">Type</th>' : ''}${hasZooms ? '<th scope="col">Zoom</th>' : ''}<th scope="col" class="num">Size</th><th scope="col"><span class="visually-hidden">Delete</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}${(def.available || []).length && !(def.skipped || []).length ? '' : `<p class="hint">${escapeHtml(fileHint(def))}</p>`}</div>`;
  }
  if (def.type === 'file') return `${head}<select data-key="${escapeHtml(def.key)}"><option value="">None</option>${(def.available || []).map((n) => `<option value="${escapeHtml(n)}" ${n === def.value ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>${(def.available || []).length && !(def.skipped || []).length ? '' : `<p class="hint">${escapeHtml(fileHint(def))}</p>`}${def.upload && !draft ? uploadRow(def) : ''}`;
  if (def.type === 'url') return `${head}<input id="${id}" type="url" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" maxlength="500" placeholder="https://"></label>`;
  if (def.type === 'number') return `${head}<input id="${id}" type="number" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" ${def.min !== undefined ? `min="${def.min}"` : ''} ${def.max !== undefined ? `max="${def.max}"` : ''} step="any"></label>`;
  if (def.type === 'color') return `${head}<input id="${id}" type="color" data-key="${escapeHtml(def.key)}" value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(def.value) ? def.value : '#000000')}"></label>`;
  return `${head}<input id="${id}" type="text" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" maxlength="${def.maxLength || 100}"></label>`;
}

// A `file` setting that takes an upload (module.json `upload`): choose a file to put it here, or Clear to take it away. Both
// act at once and do not wait for Save; the line under the buttons says how it went.
const KIND_WORDS = { picture: 'Picture', vector: 'Map data' };
// The settings listing's `folder` is the folder's path on the server (the scan's answer replaces the manifest's name); the
// routes want the folder's own name, its last part.
const folderName = (def) => String(def.folder || '').split(/[\\/]/).filter(Boolean).pop() || '';
function uploadRow(def) {
  const key = escapeHtml(def.key);
  return `<div class="upload-row" data-upload="${key}" data-folder="${escapeHtml(folderName(def))}">
    <label class="upload-pick">Upload a .pmtiles file <input type="file" accept=".pmtiles" data-upload-input aria-describedby="up-${key}-hint"></label>
    <button type="button" class="btn btn-small btn-danger" data-clear-file="${key}" ${def.value ? '' : 'disabled'}>Clear</button> <span class="status" data-upload-status role="status" aria-live="polite"></span>
    <p class="hint" id="up-${key}-hint">Choosing a file uploads it now, and Clear removes it now. Neither waits for Save.</p>
  </div>`;
}
// Send a file to PUT /api/modules/<id>/files/<folder>?name=<name>. XHR, because fetch cannot report progress. `onLine(text,
// error)` gets the progress line and the end. Resolves with the server's answer; rejects with an Error holding its sentence.
function sendFile(moduleId, folder, file, onLine) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/modules/${encodeURIComponent(moduleId)}/files/${encodeURIComponent(folder)}?name=${encodeURIComponent(file.name)}`);
    for (const [k, v] of Object.entries(accessKeyHeaders())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onLine(`Uploading... ${Math.min(100, Math.floor((e.loaded / e.total) * 100))}%`); };
    xhr.upload.onload = () => onLine('Checking the file...');
    xhr.onerror = () => reject(new Error('The upload was cut off. Check the connection and try again.'));
    xhr.onabort = xhr.onerror;
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      reject(new Error(typeof data.error === 'string' && data.error ? data.error : `The server answered ${xhr.status}.`));
    };
    xhr.send(file);
  });
}

// Why the list of files is empty, from what the server found in the folder.
function fileHint(def) {
  const where = def.path ? `Looking in ${def.path}` : `Looking in the ${word('module')}'s folder in the data folder`;
  if (def.exists === false) return `${where}, which does not exist yet. Create it and copy the file in.`;
  const skipped = def.skipped || [];
  if ((def.available || []).length) return `The server ignored ${skipped.length} other file${skipped.length === 1 ? '' : 's'} in ${def.path || 'the folder'}: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`;
  if (skipped.length) return `${where}, which has ${skipped.length} file${skipped.length === 1 ? '' : 's'} The server ignored: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`;
  return `${where}, which is empty. Copy the file in.`;
}

// What a card's controls say now, by key, as the server takes them (a list's rows, the files ticked, a switch, a number).
function readCard(card, module) {
  const values = {};
  for (const el of card.querySelectorAll('[data-key]')) {
    const def = module.settings.find((d) => d.key === el.dataset.key);
    if (!def) continue;
    if (def.type === 'secret') { // sent only when something was typed: an empty box leaves the saved key as it is
      const typed = el.querySelector('[data-secret-input]').value;
      if (typed) values[def.key] = typed;
      continue;
    }
    values[def.key] = def.type === 'list' ? readList(el) : def.type === 'files' ? [...el.querySelectorAll('input:checked')].map((i) => i.value) : def.type === 'boolean' ? el.checked : def.type === 'number' ? Number(el.value) : el.value;
  }
  return values;
}

// Fill `container` with the settings of one scope ('environment', 'space' with { space }, or 'person'). The container is
// left hidden when there is nothing to set. Two modes:
//   - each card with its own Save (the default: Manage's Modules tab, Profile, the old space pages), which sends its
//     values as it is pressed;
//   - `draft: true` (the Set up panel, plan-setup-panel.md, step 5): no Save on the cards; nothing is sent from here
//     but deleting a file (an action, at once). The answer reports the values and what changed, so the surface's own
//     Save sends them: { modules, changes(), saved(id), sectionOf(id) }. `changes()` is [{ id, name, values }] for each
//     module whose values differ from what was drawn; `saved(id)` makes the values now shown the ones to compare with;
//     `sectionOf(id)` is the module's section (its element). `onChange()` is told after any edit (and after a file is deleted).
// The answer is null when there is nothing to set (or the person may not set it).
export async function renderModuleSettings(container, { scope, space = null, only = '', heading = true, draft = false, onChange = null }) {
  container.hidden = true;
  let modules;
  try {
    const q = space ? `?space=${encodeURIComponent(space)}` : '';
    modules = (await api('GET', `/api/module-settings/${scope}${q}`)).modules;
  } catch {
    return null; // not something this person may set here
  }
  if (only) modules = modules.filter((m) => m.id === only);
  if (!modules.length) return null;
  container.hidden = false;
  const headingHtml = (m) => (draft
    ? `<h4 class="module-settings-name" id="module-settings-name-${escapeHtml(m.id)}"><i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i> ${escapeHtml(m.name)}</h4>`
    : `<h3><i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i> ${escapeHtml(m.name)}</h3>`);
  container.innerHTML = modules.map((m) => `
    <div class="module-settings-card${draft ? ' module-settings-draft' : ''}" data-module="${escapeHtml(m.id)}"${draft ? ` role="group" aria-labelledby="module-settings-name-${escapeHtml(m.id)}"` : ''}>
      ${heading ? headingHtml(m) : ''}
      <div class="module-settings-fields">${m.settings.map((d) => `<div class="module-setting"${d.showWhen ? ` data-when-key="${escapeHtml(d.showWhen.key)}" ${d.showWhen.not !== undefined ? `data-when-not="${escapeHtml(d.showWhen.not)}"` : `data-when-value="${escapeHtml(d.showWhen.value)}"`}` : ''}>${control(d, draft)}${d.help ? `<p class="hint">${escapeHtml(d.help)}</p>` : ''}</div>`).join('')}</div>
      ${draft ? '' : '<div class="row"><button class="btn btn-primary btn-small" data-save type="button">Save</button><span class="status" data-status></span></div>'}
    </div>`).join('');
  // What the chosen option says (its own help, more than a line can hold), and the settings that only apply to a choice.
  const linkify = (text) => escapeHtml(text).replace(/https:\/\/[^\s<)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  const refresh = (card) => {
    const module = modules.find((m) => m.id === card.dataset.module);
    const value = (key) => { const el = card.querySelector(`[data-key="${key}"]`); return el ? (el.type === 'checkbox' ? String(el.checked) : el.value) : ''; };
    for (const sel of card.querySelectorAll('select[data-key]')) {
      const def = module.settings.find((d) => d.key === sel.dataset.key);
      const box = sel.closest('.module-setting').querySelector('[data-option-help]');
      const option = def && def.options && def.options.find((o) => o.value === sel.value);
      if (box) box.innerHTML = option && option.help ? option.help.split(/\n+/).map((p) => `<p class="hint">${linkify(p)}</p>`).join('') : '';
    }
    for (const row of card.querySelectorAll('[data-when-key]')) row.hidden = row.dataset.whenNot !== undefined ? value(row.dataset.whenKey) === row.dataset.whenNot : value(row.dataset.whenKey) !== row.dataset.whenValue;
  };
  upgradeColourInputs(container); // the colour settings and the list rows' colours: the colour picker over the native input
  for (const box of container.querySelectorAll('[data-list-setting]')) wireList(box, modules.find((m) => m.id === box.closest('.module-settings-card').dataset.module).settings.find((d) => d.key === box.dataset.key));
  for (const card of container.querySelectorAll('.module-settings-card')) {
    refresh(card);
    card.addEventListener('change', () => refresh(card));
  }
  const cardOf = (id) => [...container.querySelectorAll('.module-settings-card')].find((c) => c.dataset.module === id) || null;
  // The draft mode's baseline: what each card said when it was drawn (or last saved).
  const baseline = new Map();
  const remember = (id) => { const card = cardOf(id); const module = modules.find((m) => m.id === id); if (card && module) baseline.set(id, JSON.stringify(readCard(card, module))); };
  if (draft) for (const m of modules) remember(m.id);
  const told = () => { if (typeof onChange === 'function') onChange(); };
  container.onclick = async (event) => {
    const delBtn = event.target.closest('[data-delete-file]');
    if (delBtn) {
      const card = delBtn.closest('.module-settings-card');
      const module = modules.find((m) => m.id === card.dataset.module);
      const name = delBtn.dataset.deleteFile;
      const folder = delBtn.closest('[data-files]')?.dataset.folder || '';
      if (!await confirmDialog({ title: `Delete ${name}?`, message: "This can't be undone.", action: 'Delete', kind: 'final' })) return;
      delBtn.disabled = true;
      try {
        await api('DELETE', `/api/modules/${encodeURIComponent(module.id)}/files/${encodeURIComponent(name)}${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`);
        if (!draft) {
          await renderModuleSettings(container, { scope, space, only, heading });
          return;
        }
        // In the draft mode the other edits stay: the file's row goes, and the baseline forgets it too, so a file that
        // was ticked does not read as a change.
        const row = delBtn.closest('tr');
        const box = delBtn.closest('[data-files]');
        if (row) row.remove();
        if (box && !box.querySelector('tbody tr')) box.querySelector('.sdk-table-wrap')?.remove();
        const was = JSON.parse(baseline.get(module.id) || '{}');
        if (box && Array.isArray(was[box.dataset.key])) was[box.dataset.key] = was[box.dataset.key].filter((n) => n !== name);
        baseline.set(module.id, JSON.stringify(was));
        told();
      } catch (err) {
        delBtn.disabled = false;
        window.alert(err.message);
      }
      return;
    }
    const clearBtn = event.target.closest('[data-clear-file]');
    if (clearBtn) {
      const row = clearBtn.closest('[data-upload]');
      const module = modules.find((m) => m.id === clearBtn.closest('.module-settings-card').dataset.module);
      const def = module.settings.find((d) => d.key === row.dataset.upload);
      const name = def && def.value;
      if (!name || !await confirmDialog({ title: `Clear ${name}?`, message: "The file is deleted now. This can't be undone.", action: 'Clear', kind: 'final' })) return;
      clearBtn.disabled = true;
      const line = row.querySelector('[data-upload-status]');
      try {
        await api('DELETE', `/api/modules/${encodeURIComponent(module.id)}/files/${encodeURIComponent(name)}?folder=${encodeURIComponent(row.dataset.folder)}`);
        await renderModuleSettings(container, { scope, space, only, heading });
        sayUpload(container, row.dataset.upload, `${name} cleared.`);
      } catch (err) {
        clearBtn.disabled = false;
        line.textContent = err.message;
        line.classList.add('error');
      }
      return;
    }
    const replaceBtn = event.target.closest('[data-secret-replace]');
    if (replaceBtn) {
      const box = replaceBtn.closest('[data-secret-setting]');
      const input = box.querySelector('[data-secret-input]');
      input.hidden = false;
      replaceBtn.hidden = true;
      input.focus();
      return;
    }
    const clearSecret = event.target.closest('[data-secret-clear]');
    if (clearSecret) {
      const box = clearSecret.closest('[data-secret-setting]');
      const card = box.closest('.module-settings-card');
      const module = modules.find((m) => m.id === card.dataset.module);
      const def = module.settings.find((d) => d.key === box.dataset.key);
      if (!await confirmDialog({ title: `Clear ${def.label}?`, message: 'The saved key is deleted now. This can\'t be undone.', action: 'Clear', kind: 'final' })) return;
      clearSecret.disabled = true;
      try {
        const answer = await api('PUT', `/api/modules/${encodeURIComponent(module.id)}/settings/${scope}`, { values: { [def.key]: '' }, ...(space ? { space } : {}) });
        showSecretState(box, (answer.settings.find((d) => d.key === def.key) || {}).value);
      } catch (err) {
        window.alert(err.message);
      }
      clearSecret.disabled = false;
      return;
    }
    if (draft) { if (event.target.closest('[data-list], [data-icon-choice]')) told(); return; }
    const button = event.target.closest('[data-save]');
    if (!button) return;
    const card = button.closest('.module-settings-card');
    const status = card.querySelector('[data-status]');
    const module = modules.find((m) => m.id === card.dataset.module);
    const values = readCard(card, module);
    status.classList.remove('error');
    status.textContent = 'saving...';
    try {
      const answer = await api('PUT', `/api/modules/${encodeURIComponent(module.id)}/settings/${scope}`, { values, ...(space ? { space } : {}) });
      for (const box of card.querySelectorAll('[data-secret-setting]')) showSecretState(box, ((answer.settings || []).find((d) => d.key === box.dataset.key) || {}).value); // the box empties; only Set or Not set shows
      status.textContent = 'saved';
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    }
  };
  // A file chosen in an upload row goes up at once (see uploadRow).
  if (container._uploadChange) container.removeEventListener('change', container._uploadChange); // drawn again: one listener only
  container._uploadChange = async (event) => {
    const input = event.target.closest('[data-upload-input]');
    if (!input || !input.files || !input.files[0]) return;
    const file = input.files[0];
    const row = input.closest('[data-upload]');
    const module = modules.find((m) => m.id === row.closest('.module-settings-card').dataset.module);
    const line = row.querySelector('[data-upload-status]');
    const clear = row.querySelector('[data-clear-file]');
    const was = clear.disabled;
    line.classList.remove('error');
    line.textContent = 'Uploading... 0%';
    input.disabled = true;
    clear.disabled = true;
    try {
      await sendFile(module.id, row.dataset.folder, file, (text) => { line.textContent = text; });
      await renderModuleSettings(container, { scope, space, only, heading });
      sayUpload(container, row.dataset.upload, `${file.name} uploaded.`);
    } catch (err) {
      input.disabled = false;
      input.value = '';
      clear.disabled = was;
      line.textContent = err.message;
      line.classList.add('error');
    }
  };
  container.addEventListener('change', container._uploadChange);
  if (draft) {
    container.oninput = () => told();
    container.onchange = () => told();
  }
  return {
    modules,
    sectionOf: cardOf,
    changes: () => modules.filter((m) => cardOf(m.id) && JSON.stringify(readCard(cardOf(m.id), m)) !== baseline.get(m.id)).map((m) => ({ id: m.id, name: m.name, values: readCard(cardOf(m.id), m) })),
    saved: (id) => remember(id),
  };
}

// The line under an upload row after the card was drawn again (the new file is in the list and chosen).
function sayUpload(container, key, text) {
  const line = container.querySelector(`[data-upload="${key}"] [data-upload-status]`);
  if (line) line.textContent = text;
}
