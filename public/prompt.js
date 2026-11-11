// The styled prompt: the one-line question dialog a module asks with (host.ui.prompt), in place of the browser's own window.prompt.
// promptDialog({ title, label, value, action, placeholder, maxLength, error }) resolves the text the person typed (a string) or null
// (Cancel, Escape, a click on the backdrop, or another prompt already open). It rejects only when it is asked badly (no title) or cannot
// be drawn. It is drawn like the confirm (the same .sdk-dialog-confirm look, the confirm block of /sdk/system.css) with one text field.
//
// Text only, everywhere: every string from a module goes in through textContent, .value, .placeholder or setAttribute, never as HTML
// (tools/check-prompt.mjs fails on innerHTML, insertAdjacentHTML or outerHTML in this file). One prompt at a time: a second call while
// one is open resolves null at once (it does not stack, and it does not queue).

const CAPS = { title: 200, label: 200, value: 2000, action: 40, placeholder: 200, error: 200 };
export const PROMPT_MAX_DEFAULT = 200;
export const PROMPT_MAX_LIMIT = 2000;
let uid = 0;
let open = false;

export function cleanPrompt(o) {
  const t = o && typeof o === 'object' ? o : {};
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const title = text(t.title, CAPS.title);
  if (!title) throw Object.assign(new Error('say what is being asked (title)'), { status: 400 });
  let maxLength = Number.isFinite(t.maxLength) ? Math.floor(t.maxLength) : PROMPT_MAX_DEFAULT;
  maxLength = Math.min(Math.max(maxLength, 1), PROMPT_MAX_LIMIT);
  return {
    title,
    label: text(t.label, CAPS.label),
    value: typeof t.value === 'string' ? t.value.slice(0, Math.min(CAPS.value, maxLength)) : '',
    action: text(t.action, CAPS.action) || 'OK',
    placeholder: text(t.placeholder, CAPS.placeholder),
    maxLength,
    error: text(t.error, CAPS.error),
  };
}

export function promptDialog(options, doc = document) {
  return new Promise((resolve, reject) => {
    let o;
    try { o = cleanPrompt(options); } catch (err) { reject(err); return; }
    if (!doc || !doc.body || typeof doc.createElement !== 'function') { reject(new Error('there is no page to ask on')); return; }
    if (open) { resolve(null); return; }
    const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const id = `sdk-prompt-${++uid}`;
    const opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;

    const dlg = make('dialog', 'sdk-dialog sdk-dialog-confirm sdk-dialog-prompt');
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', `${id}-t`);
    dlg.dataset.kind = 'plain';
    const head = make('div', 'sdk-dialog-head');
    const title = make('h2', 'sdk-dialog-title', o.title);
    title.id = `${id}-t`;
    const close = make('button', 'sdk-icon-btn btn-quiet btn-small sdk-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.dataset.close = '';
    const icon = make('i', 'fa-solid fa-xmark');
    icon.setAttribute('aria-hidden', 'true');
    close.appendChild(icon);
    head.append(title, close);
    const body = make('div', 'sdk-dialog-body');
    const field = make('label', 'sdk-field');
    if (o.label) field.appendChild(make('span', 'sdk-label', o.label));
    const input = make('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.maxLength = o.maxLength;
    input.value = o.value;
    if (o.placeholder) input.placeholder = o.placeholder;
    if (!o.label) input.setAttribute('aria-labelledby', title.id);
    field.appendChild(input);
    body.appendChild(field);
    const problem = make('p', 'sdk-error', o.error);
    problem.setAttribute('role', 'alert');
    problem.dataset.error = '';
    if (o.error) input.setAttribute('aria-invalid', 'true');
    body.appendChild(problem);
    const foot = make('div', 'sdk-dialog-foot');
    const cancel = make('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.dataset.close = '';
    const ok = make('button', 'btn btn-primary', o.action);
    ok.type = 'button';
    ok.dataset.ok = '';
    foot.append(cancel, ok);
    dlg.append(head, body, foot);

    const root = doc.documentElement;
    const was = root.style.overflow;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      open = false;
      dlg.dataset.result = value === null ? 'cancel' : 'ok';
      if (typeof dlg.close === 'function' && dlg.open) dlg.close(value === null ? 'cancel' : 'ok');
      root.style.overflow = was;
      dlg.remove();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      resolve(value);
    };
    const focusables = () => [...dlg.querySelectorAll('button, input')].filter((e) => !e.disabled && !e.hidden);

    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); }); // Escape
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); return; }
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); done(input.value); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(doc.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) { done(null); return; } // the backdrop
      if (e.target.closest('[data-close]')) { done(null); return; }
      if (e.target.closest('[data-ok]')) done(input.value);
    });

    doc.body.appendChild(dlg);
    root.style.overflow = 'hidden';
    open = true;
    try { dlg.showModal(); } catch (err) { open = false; root.style.overflow = was; dlg.remove(); reject(err); return; }
    input.focus();
    input.select();
  });
}
