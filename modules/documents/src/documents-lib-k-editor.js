  // ---- the editor adapter: the one small object the editing text sits behind --------------------------------------------------
  // The contract (every editor implements exactly this):
  //   getText()        the whole text. Costly for a rich editor, so it is called ONLY at save, Done, Copy, Source and when the
  //                    lock is lost, never per key.
  //   setText(text)    replaces the text (when editing starts). Counts as a change of revision.
  //   setReadOnly(on)  stops or allows typing.
  //   focus()          puts the caret in the editor.
  //   onChange(fn)     calls fn after every change a person makes or an action makes.
  //   run(action)      applies a formatting action by name to the editor's own selection: bold, italic, code, h1..h4, list,
  //                    numbered, checklist, quote, link, grid, formula.
  //   destroy()        lets go of the editor and its listeners.
  // Plus revision(): a cheap counter the adapter bumps on every change. "Is it changed" is asked with the counter, never with the
  // text. The counter cannot tell "typed, then deleted back to the same text" from a change, so dirty means "the counter moved";
  // the save then reads the text once and, if it equals the saved text (and the title and paper are unchanged), writes nothing.
  const DL_ACTIONS = ['bold', 'italic', 'code', 'h1', 'h2', 'h3', 'h4', 'list', 'numbered', 'checklist', 'quote', 'link', 'grid', 'formula'];
  const dlActionFn = (action) => {
    const m = /^h([1-4])$/.exec(action);
    if (m) return (s) => dlHeading(s, Number(m[1]));
    return { bold: dlBold, italic: dlItalic, code: dlCode, list: dlList, numbered: dlNumbered, checklist: dlChecklist, quote: dlQuote,
      link: (s) => dlLink(s), grid: (s) => dlGrid(s), formula: (s) => dlFormula(s) }[action] || null;
  };

  // The plain text box. `ta` is the textarea, `doc` the page's document (for execCommand, which keeps the browser's undo).
  function dlTextareaEditor(ta, doc) {
    let rev = 0;
    const fns = [];
    const bump = () => { rev += 1; for (const fn of fns) fn(); };
    ta.addEventListener('input', bump);
    return {
      getText: () => ta.value,
      setText: (text) => { ta.value = text; rev += 1; },
      setReadOnly: (on) => { ta.readOnly = Boolean(on); },
      focus: () => ta.focus(),
      onChange: (fn) => { fns.push(fn); },
      revision: () => rev,
      run(action) {
        const fn = dlActionFn(action);
        if (!fn) return;
        const out = fn({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
        ta.focus();
        if (out.value !== ta.value) {
          ta.setSelectionRange(0, ta.value.length);
          if (!doc.execCommand || !doc.execCommand('insertText', false, out.value)) { ta.value = out.value; bump(); }
          if (ta.value !== out.value) { ta.value = out.value; bump(); }
        }
        ta.setSelectionRange(out.start, out.end);
      },
      // Copy's fallback for a browser without the clipboard: select what is there.
      selectAll: () => { ta.focus(); ta.select(); },
      destroy: () => { ta.removeEventListener('input', bump); fns.length = 0; },
    };
  }

  // A counting stand-in with the same contract, for tests: it holds a string and counts every getText.
  function dlStubEditor(text) {
    let value = text || '';
    let rev = 0;
    const fns = [];
    const calls = { getText: 0 };
    const change = (v) => { value = v; rev += 1; for (const fn of fns) fn(); };
    return {
      calls,
      getText: () => { calls.getText += 1; return value; },
      setText: (t) => { value = t; rev += 1; },
      setReadOnly: () => {},
      focus: () => {},
      onChange: (fn) => { fns.push(fn); },
      revision: () => rev,
      run: (action) => { if (dlActionFn(action)) change(`${value}[${action}]`); },
      destroy: () => { fns.length = 0; },
      type: (v) => change(v),
    };
  }

  // Dirty without reading the text: the title or paper differs, or the editor's counter moved since the last save.
  const dlEditorDirty = (editor, savedRev, saved, title, paper) => editor.revision() !== savedRev || saved.title !== title || saved.paper !== paper;
  // The one read at save time: the text (read once), whether anything really differs from what is saved, and the counter to
  // remember. If nothing differs, the save writes nothing and the counter is simply taken as saved.
  function dlEditorSnapshot(editor, saved, title, paper) {
    const rev = editor.revision();
    const text = editor.getText();
    return { text, title, paper, rev, changed: dlIsDirty(saved, { text, title, paper }) };
  }
