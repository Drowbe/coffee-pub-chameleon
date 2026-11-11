  // ---- documents-lib-e-export.js: the Markdown file (no page, no host) ------------------------------------------------------
  //
  // The text exactly as stored, except that each link with an object: address becomes its text alone (the address means nothing
  // outside the app). Fenced code is left alone. The file is <title>.md.
  const DL_OBJECT_LINK = /\[((?:[^\[\]\\\n]|\\.)*)\]\(\s*<?\s*object:[^)\n]*\)/gi;
  function dlExportMarkdown(text) {
    let fence = null;
    return String(text == null ? '' : text).split('\n').map((line) => {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (!fence) fence = f[1][0];
        else if (f[1][0] === fence) fence = null;
        return line;
      }
      return fence ? line : line.replace(DL_OBJECT_LINK, (m, label) => label);
    }).join('\n');
  }
  // A file name: / \ : * ? " < > | and control characters dropped, cut to 80 characters, never empty, .md added.
  function dlExportName(title, fallback = 'Untitled') {
    const base = dlCut(dlCleanLine(String(title == null ? '' : title), 400).replace(/[\/\\:*?"<>|]/g, ''), 80).trim().replace(/^\.+/, '');
    return `${base || fallback}.md`;
  }
