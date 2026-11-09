// The styled confirm: the one question dialog every page and module asks with, in place of the browser's own window.confirm.
// confirmDialog({ title, message, action, cancel, kind, typed }) returns a promise that resolves true (the action) or false (Cancel,
// Escape, a click on the backdrop) and rejects when it is asked badly (no title) or cannot be drawn. It never rejects for a "no".
//
//   title    the question, short: "Delete the Paris trip?"
//   message  one or two plain lines of what happens (optional); a blank line starts a new paragraph. Text only.
//   action   the button's word ("Delete", "Turn off"); default "OK".
//   cancel   default "Cancel".
//   kind     'plain' (easy to take back: the Primary button, focus on it), 'destructive' (soft Danger, focus on Cancel so Enter
//            does not delete) or 'final' (cannot be undone: solid Danger, focus on Cancel). Default 'plain'.
//   typed    final only: a name the person types before the action turns on.
//   list     optional, a page's own: [[icon, text], ...] drawn under the message, one line each with its Font Awesome icon (the Vault's
//            question before a change takes sight of a file from people). Never from a module: host.ui.confirm passes cleanConfirm's fields only.
//   solid    optional, a page's own: the action is the solid Danger button even when the kind is 'destructive' (focus still on Cancel).
//   run      optional function (a page's own, never a module's): the action runs it while the dialog stays open; if it throws,
//            the dialog stays and shows the error's message under the question (so a refusal is read where it was asked), and
//            the action can be pressed again; if it returns, the dialog closes and the promise resolves true.
//
// The look is the Dialogs family (documentation/designsystem), the confirm block of /sdk/system.css. A module in a frame asks through
// host.ui.confirm, which the page answers with this (module-host.js, 'ui.confirm').

const KINDS = ['plain', 'destructive', 'final'];
let uid = 0;

export function cleanConfirm(o) {
  const t = o && typeof o === 'object' ? o : {};
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const title = text(t.title, 200);
  if (!title) throw Object.assign(new Error('say what is being asked (title)'), { status: 400 });
  const kind = t.kind === undefined ? 'plain' : t.kind;
  if (!KINDS.includes(kind)) throw Object.assign(new Error(`kind is one of ${KINDS.join(', ')}`), { status: 400 });
  const typed = text(t.typed, 80);
  return { title, message: text(t.message, 1000), action: text(t.action, 40) || 'OK', cancel: text(t.cancel, 40) || 'Cancel', kind, typed: kind === 'final' ? typed : '' };
}

export function confirmDialog(options, doc = document) {
  return new Promise((resolve, reject) => {
    let o;
    try { o = cleanConfirm(options); } catch (err) { reject(err); return; }
    if (!doc || !doc.body || typeof doc.createElement !== 'function') { reject(new Error('there is no page to ask on')); return; }
    const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const id = `sdk-confirm-${++uid}`;
    const opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;

    const dlg = make('dialog', 'sdk-dialog sdk-dialog-confirm');
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', `${id}-t`);
    dlg.dataset.kind = o.kind;
    const head = make('div', 'sdk-dialog-head');
    const title = make('h2', 'sdk-dialog-title', o.title);
    title.id = `${id}-t`;
    const close = make('button', 'sdk-icon-btn btn-quiet btn-small sdk-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.dataset.close = '';
    close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    head.append(title, close);
    const body = make('div', 'sdk-dialog-body');
    const paras = o.message ? o.message.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
    for (const p of paras) body.appendChild(make('p', '', p));
    if (paras.length) { body.id = `${id}-d`; dlg.setAttribute('aria-describedby', body.id); }
    let input = null;
    if (o.typed) {
      const label = make('label', 'sdk-field');
      label.appendChild(make('span', 'sdk-label', `Type ${o.typed} to confirm`));
      input = make('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.placeholder = o.typed;
      label.appendChild(input);
      body.appendChild(label);
    }
    const rows = Array.isArray(options.list) ? options.list.filter((r) => Array.isArray(r) && typeof r[1] === 'string').slice(0, 8) : [];
    if (rows.length) {
      const ul = make('ul', 'sdk-confirm-effects');
      for (const [icon, text] of rows) {
        const li = make('li');
        const i = make('i', `fa-solid fa-${/^[a-z0-9-]{1,40}$/.test(icon) ? icon : 'circle-info'} fa-fw`);
        i.setAttribute('aria-hidden', 'true');
        li.append(i, make('span', '', text));
        ul.appendChild(li);
      }
      body.appendChild(ul);
      if (!paras.length) { body.id = `${id}-d`; dlg.setAttribute('aria-describedby', body.id); }
    }
    if (!paras.length && !rows.length && !input) body.hidden = true;
    const foot = make('div', 'sdk-dialog-foot');
    const cancel = make('button', 'btn', o.cancel);
    cancel.type = 'button';
    cancel.dataset.close = '';
    const ok = make('button', `btn ${o.kind === 'plain' ? 'btn-primary' : o.kind === 'final' || options.solid === true ? 'btn-danger solid' : 'btn-danger'}`, o.action);
    ok.type = 'button';
    ok.dataset.ok = '';
    if (input) ok.disabled = true;
    foot.append(cancel, ok);
    dlg.append(head, body, foot);

    const root = doc.documentElement;
    const was = root.style.overflow;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      dlg.dataset.result = value ? 'ok' : 'cancel';
      if (typeof dlg.close === 'function' && dlg.open) dlg.close(value ? 'ok' : 'cancel');
      root.style.overflow = was;
      dlg.remove();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      resolve(value);
    };
    // The action: straight away, or through `run`, which may refuse.
    const run = typeof options.run === 'function' ? options.run : null;
    let running = false;
    let problem = null;
    const accept = async () => {
      if (!run) { done(true); return; }
      if (running) return;
      running = true;
      ok.disabled = true;
      dlg.setAttribute('aria-busy', 'true');
      try {
        await run();
        done(true);
      } catch (err) {
        if (!problem) {
          problem = make('p', 'sdk-error');
          problem.setAttribute('role', 'alert');
          problem.dataset.error = '';
          body.appendChild(problem);
          body.hidden = false;
        }
        problem.textContent = (err && err.message) || 'It could not be done.';
        ok.disabled = Boolean(input) && input.value.trim() !== o.typed;
        ok.focus();
      } finally {
        running = false;
        dlg.removeAttribute('aria-busy');
      }
    };
    const focusables = () => [...dlg.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')].filter((e) => !e.disabled && !e.hidden && !e.closest('[hidden]'));

    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); }); // Escape
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); return; }
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); if (!ok.disabled) accept(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(doc.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) { done(false); return; } // the backdrop
      if (e.target.closest('[data-close]')) { done(false); return; }
      if (e.target.closest('[data-ok]') && !ok.disabled) accept();
    });
    if (input) input.addEventListener('input', () => { ok.disabled = input.value.trim() !== o.typed; });

    doc.body.appendChild(dlg);
    root.style.overflow = 'hidden';
    try { dlg.showModal(); } catch (err) { root.style.overflow = was; dlg.remove(); reject(err); return; }
    // Focus: Cancel for anything that removes (so Enter does not delete), the action for a plain question, the name field for a typed one.
    (input || (o.kind === 'plain' ? ok : cancel)).focus();
  });
}
