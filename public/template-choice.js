// A space's own template (documentation/plans/plan-space-templates.md, step 3): the choice in Set up's Space tab and in
// Add <space>. The templates are the ones this environment offers (GET /api/environment/template's `choices`; the hidden
// ones are not in it), and the first choice, "Same as the <environment>", clears the space's own (template: null).
// The choice is hidden everywhere while the owner has the switch off (branding.spaceTemplates).
//
// The pure parts (sameLabel, optionList, changeQuestion) touch no document, so tools/check-nav.mjs can run them in node.
// A select's value is '' for "Same as the <environment>", else the template's id.

export const SAME = '';

// "Same as the campaign (Fantasy)": the environment's word, then the template it reads, when it has one.
export const sameLabel = (word, environment = null) => `Same as the ${word('environment')}${environment ? ` (${environment.name || environment.id})` : ''}`;

// The select's options: "Same as ..." first, then each template offered, then the template the space already has when this
// server no longer offers it (hidden or gone), so the choice always says what is in use. [{ value, label, description }].
export function optionList({ choices = [], environment = null } = {}, current = SAME, word = (w) => w) {
  const list = [{ value: SAME, label: sameLabel(word, environment), description: environment ? environment.description || '' : '' }];
  for (const c of choices) list.push({ value: c.id, label: c.name || c.id, description: c.description || '' });
  if (current && !list.some((o) => o.value === current)) list.push({ value: current, label: current, description: '' });
  return list;
}

// The question before a change: what changes and what does not.
export const changeQuestion = (name, word) => ({
  title: name ? `Change this ${word('space')} to ${name}?` : `Change this ${word('space')} to the ${word('environment')}'s template?`,
  message: `Its words, phases and ${word('module')} names change now. Nothing is removed.`,
  action: 'Change',
});

// What this environment offers: { choices, environment: { id, name, description } | null }, or null when it cannot be read.
export async function loadTemplateChoices(api) {
  try {
    const answer = await api('GET', '/api/environment/template');
    const own = answer.template || null;
    const found = own && (answer.choices || []).find((c) => c.id === own.id);
    return { choices: answer.choices || [], environment: own ? { id: own.id, name: own.name || own.id, description: found ? found.description || '' : '' } : null };
  } catch (err) {
    return null;
  }
}

// Whether a space may read a template of its own here (the owner's switch; absent means on).
export async function spaceTemplatesOn(api) {
  try {
    const branding = await api('GET', '/api/branding');
    return branding.spaceTemplates !== false;
  } catch (err) {
    return false;
  }
}

// Fill a select with the options; `current` is the chosen value.
export function fillSelect(select, loaded, current, word) {
  const options = optionList(loaded, current, word);
  select.replaceChildren(...options.map((o) => {
    const e = select.ownerDocument.createElement('option');
    e.value = o.value;
    e.textContent = o.label;
    return e;
  }));
  select.value = options.some((o) => o.value === current) ? current : SAME;
  return options;
}

// Add <space>: with the choice on and templates to choose from, a small dialog (Template, Add, Cancel); `run({ template })` is
// the request that makes the space, and a refusal is shown in the dialog with the server's sentence. With the choice off, or
// nothing to choose, it just runs. Answers true once run, false when cancelled. Without the dialog, run's error goes to the caller.
export async function addSpaceFlow({ api, word, run, doc = document }) {
  const [on, loaded] = await Promise.all([spaceTemplatesOn(api), loadTemplateChoices(api)]);
  if (!on || !loaded || !loaded.choices.length) { await run({}); return true; }
  return new Promise((resolve) => {
    const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const dlg = make('dialog', 'sdk-dialog sdk-dialog-confirm sdk-dialog-prompt template-add');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'template-add-title');
    const head = make('div', 'sdk-dialog-head');
    const title = make('h2', 'sdk-dialog-title', `Add ${word('space', { cap: true })}`);
    title.id = 'template-add-title';
    const close = make('button', 'sdk-icon-btn btn-quiet btn-small sdk-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.dataset.close = '';
    close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    head.append(title, close);
    const body = make('div', 'sdk-dialog-body');
    const field = make('label', 'sdk-field');
    field.append(make('span', 'sdk-label', 'Template'));
    const select = make('select');
    select.id = 'template-add-select';
    field.append(select);
    const about = make('p', 'hint');
    about.id = 'template-add-about';
    const problem = make('p', 'sdk-error');
    problem.setAttribute('role', 'alert');
    problem.dataset.error = '';
    body.append(field, about, problem);
    const foot = make('div', 'sdk-dialog-foot');
    const cancel = make('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.dataset.close = '';
    const ok = make('button', 'btn btn-primary', 'Add');
    ok.type = 'button';
    ok.dataset.ok = '';
    foot.append(cancel, ok);
    dlg.append(head, body, foot);
    const options = fillSelect(select, loaded, SAME, word);
    const showAbout = () => { about.textContent = (options.find((o) => o.value === select.value) || {}).description || ''; about.hidden = !about.textContent; };
    select.addEventListener('change', showAbout);
    showAbout();

    const root = doc.documentElement;
    const was = root.style.overflow;
    const opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    let settled = false;
    let running = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      if (typeof dlg.close === 'function' && dlg.open) dlg.close();
      root.style.overflow = was;
      dlg.remove();
      if (value === false && opener && opener.isConnected) opener.focus();
      resolve(value);
    };
    const accept = async () => {
      if (running) return;
      running = true;
      ok.disabled = true;
      problem.textContent = '';
      try {
        await run(select.value ? { template: select.value } : {});
        done(true);
      } catch (err) {
        problem.textContent = (err && err.message) || 'It could not be added.';
        ok.disabled = false;
        ok.focus();
      } finally {
        running = false;
      }
    };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!running) done(false); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...dlg.querySelectorAll('button, select')].filter((x) => !x.disabled && !x.hidden);
      if (!f.length) return;
      const i = f.indexOf(doc.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) { if (!running) done(false); return; }
      if (e.target.closest('[data-ok]') && !ok.disabled) accept();
    });
    doc.body.appendChild(dlg);
    root.style.overflow = 'hidden';
    try { dlg.showModal(); } catch (err) { root.style.overflow = was; dlg.remove(); resolve(false); return; }
    select.focus();
  });
}
