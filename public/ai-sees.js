// What AI may see: the owner's setting for what goes to the AI with a question (plan-ai-integration.md). One section, drawn
// for Manage's AI service tab (the environment's choice) and for a space's Set up (the space's own, or the environment's).
// It can only narrow what a person's own rights already allow. The values are the server's `sees`:
//   { attached, relevant, linked, lookup, history, chat, members: true|false, environment: 'never'|'attached'|'readable',
//     modules: 'all' | [module ids] }

export const SEES_DEFAULTS = Object.freeze({ attached: true, relevant: true, linked: true, lookup: true, history: true, chat: false, members: false, environment: 'attached', modules: 'all' });
export const SEES_SWITCHES = ['attached', 'relevant', 'linked', 'lookup', 'history', 'chat', 'members'];

const KEY_SCOPE = 'environment'; // the server's key for the choice about objects outside any space
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const up = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The rows, in this environment's words.
export function seesRows(word) {
  const objects = word('object', { many: true });
  const space = word('space');
  return [
    ['attached', `The ${objects} a person picks`, 'The ones attached to a question.'],
    ['relevant', `${up(objects)} that fit the question`, 'Found by matching its words.'],
    ['linked', `${up(objects)} linked to those`, 'The ones that point to, or are pointed to by, what is sent.'],
    ['lookup', 'Let AI look things up', `It can search and read ${objects} in the ${space} it is asked in. Only what the person asking may open.`],
    ['history', 'Earlier questions', "The person's own recent questions and answers here."],
    ['chat', `The ${space}'s chat`, 'Recent messages everyone there can read.'],
    ['members', `Who is in the ${space}`, 'Names and roles.'],
  ];
}

// The same value with every key set (what is missing takes its default), and `modules` as 'all' or a list of text.
export function fullSees(raw) {
  const out = { ...SEES_DEFAULTS };
  const r = raw && typeof raw === 'object' ? raw : {};
  for (const k of SEES_SWITCHES) if (typeof r[k] === 'boolean') out[k] = r[k];
  if (['never', 'attached', 'readable'].includes(r.environment)) out.environment = r.environment;
  if (Array.isArray(r.modules)) out.modules = r.modules.filter((x) => typeof x === 'string');
  return out;
}
export const sameSees = (a, b) => JSON.stringify(sortedSees(a)) === JSON.stringify(sortedSees(b));
function sortedSees(v) {
  const f = fullSees(v);
  return { ...f, modules: Array.isArray(f.modules) ? [...f.modules].sort() : 'all' };
}

// Draws the section's rows into `box` and answers { set, get, setModules }.
//   idPrefix  keeps the ids apart on a page that holds two;
//   onChange  called with the value after a person changes anything.
// `set(value, { locked })` shows a value; locked rows are shown but cannot be changed (a space following the environment).
export function mountSees(box, { word, idPrefix = 'sees', onChange = null } = {}) {
  let value = fullSees(null);
  let locked = false;
  let modules = []; // [{ id, name }]
  const id = (k) => `${idPrefix}-${k}`;
  const objects = word('object', { many: true });

  box.innerHTML = `<div class="sdk-choice-list ai-sees-list" role="group" aria-label="What AI may see">${seesRows(word).map(([k, label, desc]) => `
      <label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">${esc(label)}</span><span class="sdk-choice-desc">${esc(desc)}</span></span><input type="checkbox" class="sdk-switch" role="switch" id="${id(k)}" data-sees="${k}"></label>`).join('')}
    </div>
    <label class="ai-sees-field" for="${id(KEY_SCOPE)}"><span class="sdk-choice-label">${esc(up(objects))} from the ${esc(word('environment'))}, outside any ${esc(word('space'))}</span>
      <select id="${id(KEY_SCOPE)}" data-sees="${KEY_SCOPE}">
        <option value="never">Never sent</option>
        <option value="attached">Only the ones a person picks</option>
        <option value="readable">Any the person may read</option>
      </select></label>
    <fieldset class="ai-sees-modules"><legend class="sdk-choice-label">${esc(up(word('module', { many: true })))}</legend>
      <div class="sdk-choice-list">
        <label class="sdk-choice-row"><input type="radio" name="${id('modules')}" value="all" id="${id('modules-all')}"><span class="sdk-choice-text"><span class="sdk-choice-label">All of them</span></span></label>
        <label class="sdk-choice-row"><input type="radio" name="${id('modules')}" value="some" id="${id('modules-some')}"><span class="sdk-choice-text"><span class="sdk-choice-label">Only these</span></span></label>
      </div>
      <div class="sdk-choice-list ai-sees-module-list" id="${id('module-list')}" hidden></div>
    </fieldset>`;

  const q = (sel) => box.querySelector(sel);
  const paint = () => {
    for (const k of SEES_SWITCHES) q(`[data-sees="${k}"]`).checked = value[k] === true;
    q(`#${id(KEY_SCOPE)}`).value = value[KEY_SCOPE];
    const some = Array.isArray(value.modules);
    q(`#${id('modules-all')}`).checked = !some;
    q(`#${id('modules-some')}`).checked = some;
    const list = q(`#${id('module-list')}`);
    list.hidden = !some;
    list.innerHTML = (some && !value.modules.length ? '<p class="hint" role="status">Pick at least one, or choose All of them.</p>' : '') + modules.map((m) => `<label class="sdk-choice-row"><input type="checkbox" class="sdk-switch" role="switch" data-sees-module="${esc(m.id)}"${some && value.modules.includes(m.id) ? ' checked' : ''}><span class="sdk-choice-text"><span class="sdk-choice-label">${esc(m.name)}</span></span></label>`).join('') || '<p class="hint">None on yet.</p>';
    for (const el of box.querySelectorAll('input, select')) el.disabled = locked;
  };
  const read = () => {
    const out = {};
    for (const k of SEES_SWITCHES) out[k] = q(`[data-sees="${k}"]`).checked;
    out[KEY_SCOPE] = q(`#${id(KEY_SCOPE)}`).value;
    out.modules = q(`#${id('modules-some')}`).checked ? [...box.querySelectorAll('[data-sees-module]')].filter((i) => i.checked).map((i) => i.dataset.seesModule) : 'all';
    return out;
  };
  box.addEventListener('change', () => {
    if (locked) return;
    value = read();
    paint();
    if (onChange) onChange(fullSees(value));
  });

  return {
    set(v, { locked: lock = false } = {}) { value = fullSees(v); locked = lock; paint(); },
    get: () => fullSees(value),
    // A plain sentence when the choice cannot be saved: "Only these" with none ticked.
    problem: () => (Array.isArray(value.modules) && !value.modules.length ? 'Pick at least one, or choose All of them.' : ''),
    setModules(list) { modules = (list || []).map((m) => ({ id: m.id, name: m.displayName || m.name || m.id })); paint(); },
  };
}
