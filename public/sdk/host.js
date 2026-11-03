/*
 * the host module SDK. A module includes this from its own pages:
 *
 *   <script src="/sdk/host.js"></script>
 *
 * A module runs either in a sandboxed frame, with no access to the host's pages, cookies or network, or
 * (when the admin has chosen that for it, and for the modules that ship with this server) in the page itself,
 * in a container of its own. Either way everything it can do goes through the calls here; the page
 * hosting it (public/module-host.js) makes the real requests on its behalf and the server checks every
 * one. A module in the page is not confined: it could bypass this. See documentation/api/api-module-sdk.md.
 *
 * The API is built by createHost(env): in a frame this file boots it over postMessage; the page host
 * calls it directly for a module running in the page.
 *
 * Every call returns a promise. host.ready() resolves once the host has
 * answered, with who is looking, where the module is showing, and the theme.
 */
(function (global) {
  'use strict';
  const SDK_SCRIPT_SRC = (document.currentScript && document.currentScript.src) || ''; // where this file was loaded from; empty when the app placed it inline

  // The drag data type a pointer to a module's object travels under (see host.objects).
  const OBJECT_MIME = 'application/x-host-object';

  // The phase timeline rule, public/phases.js, as `Phases` (plan-one-bar.md, step 2): the one copy the server runs
  // too, loaded from the server this SDK came from, once per window (a frame's own, or the page that hosts modules in
  // it). host.ready() waits for it; host.util.phaseTimeline says so when it could not be loaded.
  let phaseRuleLoading = null;
  function loadPhaseRule() {
    if (global.Phases) return Promise.resolve();
    if (phaseRuleLoading) return phaseRuleLoading;
    phaseRuleLoading = new Promise((resolve) => {
      try {
        const s = document.createElement('script');
        s.src = new URL('/phases.js', global.location.href).href;
        s.onload = () => resolve();
        s.onerror = () => resolve();
        (document.head || document.documentElement).appendChild(s);
      } catch (err) {
        resolve();
      }
    });
    return phaseRuleLoading;
  }
  const phaseRule = () => {
    if (!global.Phases) throw new Error('the phase rule (phases.js) did not load');
    return global.Phases;
  };

  // A pointer checked for shape, or null. Says nothing about whether the viewer may see the object.
  function cleanRef(ref) {
    const ok = ref && typeof ref.module === 'string' && typeof ref.kind === 'string' && typeof ref.id === 'string'
      && /^[a-z][a-z0-9-]{1,31}$/.test(ref.module) && /^[a-z][a-z0-9-]{0,23}$/.test(ref.kind) && /^[A-Za-z0-9_-]{1,64}$/.test(ref.id)
      && (ref.scope === 'environment' || ref.scope === 'person' || (ref.scope === 'space' && typeof ref.space === 'string' && ref.space.length <= 64));
    return ok ? { module: ref.module, kind: ref.kind, id: ref.id, scope: ref.scope, ...(ref.scope === 'space' ? { space: ref.space } : {}) } : null;
  }

  // What a drag carries, as one shape: { ref, summary }. Takes what dropTarget hands a module, or a bare pointer.
  function normalizeDragged(dragged) {
    if (!dragged) return { ref: null, summary: null };
    if (typeof dragged.module === 'string' && typeof dragged.id === 'string') return { ref: cleanRef(dragged), summary: null };
    const ref = dragged.ref ? cleanRef(dragged.ref) : null;
    const summary = !ref && dragged.summary && typeof dragged.summary.title === 'string' ? dragged.summary : null;
    return { ref, summary };
  }

  // The drop fill rules (see plan-drop.md, "The drop context"). For each `name: type` an action takes:
  //   ref:<module>:<kind>  the dropped pointer, when it is that kind
  //   ref                  the dropped pointer; a second one, or one named `target`, the target's own object under the pointer
  //   date / datetime      the day (and time) under the pointer, else the summary's own date
  //   string  title/kind   the summary's title / kind
  //   text    notes/body/content/text   the summary's text, when the drag carried one
  //   number  lat/lng      the spot under the pointer (a map), else the summary's own place
  // Returns the input, or null: a required input could not be filled, or nothing of the dropped object was used.
  const TEXT_FIELDS = ['notes', 'body', 'content', 'text'];
  function fillFor(action, dragged, context) {
    const d = normalizeDragged(dragged);
    const ctx = context || {};
    const summary = ctx.summary || d.summary || {};
    const place = ctx.place || summary.place || null;
    const input = {};
    let used = false;
    let refsGiven = 0;
    for (const [field, type] of Object.entries((action && action.input) || {})) {
      const t = String(type);
      const optional = t.endsWith('?');
      const base = optional ? t.slice(0, -1) : t;
      let value;
      if (base.startsWith('ref:')) {
        if (d.ref && base === `ref:${d.ref.module}:${d.ref.kind}`) { value = d.ref; used = true; }
      } else if (base === 'ref') {
        if (d.ref && field !== 'target' && refsGiven === 0) { value = d.ref; used = true; refsGiven += 1; }
        else if (ctx.target) value = ctx.target;
      } else if (base === 'date') {
        if (ctx.date) value = ctx.date;
        else if (summary.date) { value = summary.date; used = true; }
      } else if (base === 'datetime') {
        if (ctx.date) value = ctx.time ? `${ctx.date}T${ctx.time}` : ctx.date;
        else if (summary.date) { value = summary.date; used = true; }
      } else if (base === 'string') {
        if (field === 'title' && summary.title) { value = String(summary.title); used = true; }
        else if (field === 'kind' && summary.kind) { value = String(summary.kind); used = true; }
      } else if (base === 'text') {
        if (TEXT_FIELDS.includes(field) && summary.text) { value = String(summary.text); used = true; }
      } else if (base === 'number') {
        if (place && field === 'lat') { value = place.lat; if (!ctx.place) used = true; }
        else if (place && field === 'lng') { value = place.lng; if (!ctx.place) used = true; }
      }
      if (value === undefined) {
        if (!optional) return null;
        continue;
      }
      input[field] = value;
    }
    return used ? input : null;
  }
  // Whether a filled input used anything from under the pointer (the target object, the day or time, the spot):
  // an action that used only the dropped object is about the object, not about here.
  function usesHere(input, ctx) {
    const t = ctx.target;
    return Object.values(input || {}).some((v) =>
      (t && v && typeof v === 'object' && v.module === t.module && v.kind === t.kind && v.id === t.id)
      || (ctx.date && typeof v === 'string' && (v === ctx.date || v.startsWith(`${ctx.date}T`)))
      || (ctx.place && (v === ctx.place.lat || v === ctx.place.lng)));
  }
  // Why fillFor said no, for the drag trace.
  function whyNot(action, dragged, context) {
    const d = normalizeDragged(dragged);
    const ctx = context || {};
    for (const [field, type] of Object.entries((action && action.input) || {})) {
      const t = String(type);
      if (t.endsWith('?')) continue;
      const one = fillFor({ input: { [field]: t + '?' } }, d, ctx);
      const filledAlone = one && field in one;
      // A required input fillFor could not fill on its own is the reason; a plain `ref` or `title` counts as "used" itself.
      if (!filledAlone && !(t === 'ref' && ctx.target) ) return `needs ${field} (${t})`;
    }
    return 'nothing of the dropped object would be used';
  }

  // Text made safe to put in HTML.
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // A small, safe subset of Markdown, to plain HTML: headings (# to ###), **bold**, *italic* or _italic_, `code`,
  // fenced ``` code blocks, unordered (-, *) and ordered (1.) lists, [text](url) links (http/https only; anything
  // else is left as plain text), paragraphs on a blank line, a single line break within one. Everything is escaped
  // first (via `esc`), so no HTML in the text itself ever reaches the page. This is the one place a module (or the
  // call page, for chat) may set innerHTML from what a person or an AI wrote, because the safety happens in here;
  // everywhere else, text still goes in with textContent. Used for an AI's replies and for chat messages, both text
  // nobody here wrote themselves.
  function markdown(text) {
    // Text direction controls and zero-width characters can disguise words; none is shown.
    text = String(text || '').replace(/[\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF]/g, '');
    // Code, links and bare addresses are set aside as placeholders while bold and italic are found, so an underscore or star
    // inside an address or an attribute (target="_blank", .../Belem_Tower) can never pair with another and become emphasis.
    const inline = (s) => {
      const kept = [];
      const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
      const html = esc(String(s).replace(/\u0000/g, ''))
        .replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${c}</code>`))
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`))
        // A bare address the text didn't wrap in [text](...) itself: linked as it stands.
        .replace(/(^|[\s(])(https?:\/\/[^\s<\u0000]+[^\s<.,;:!?)"'\u0000])/g, (_, lead, u) => lead + keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`))
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        // _italic_ only at word edges, so snake_case stays as written.
        .replace(/(^|[^\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>')
        ;
      let out = html;
      for (let i = 0; i < 3 && out.includes('\u0000'); i++) out = out.replace(/\u0000(\d+)\u0000/g, (_, n) => kept[Number(n)]);
      return out;
    };
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null; // { tag: 'ul' | 'ol', items: [] }
    let quote = null; // lines inside a > quote, raw (not yet inlined)
    let code = null; // lines inside a ``` fence, raw (not yet escaped)
    const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    const flushQuote = () => { if (quote) { out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); quote = null; } };
    for (const line of lines) {
      if (code) {
        if (/^\s*```\s*$/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; }
        else code.push(line);
        continue;
      }
      if (/^\s*```/.test(line)) { flushPara(); flushList(); flushQuote(); code = []; continue; }
      if (!line.trim()) { flushPara(); flushList(); flushQuote(); continue; }
      const q = /^\s*>\s?(.*)$/.exec(line);
      if (q) { flushPara(); flushList(); if (!quote) quote = []; quote.push(q[1]); continue; }
      flushQuote();
      const h = /^(#{1,3})\s+(.+)$/.exec(line);
      if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
      const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      const ul = !ol && /^\s*[-*]\s+(.+)$/.exec(line);
      if (ol || ul) {
        flushPara(); // the lines before a list come before it ("Links:" then its list)
        const tag = ol ? 'ol' : 'ul';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push((ol || ul)[1]);
        continue;
      }
      flushList();
      para.push(line);
    }
    flushPara();
    flushList();
    flushQuote();
    if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); // an unclosed fence: show what there was
    return out.join('');
  }

  // Markdown and HTML to plain text, for a field a module shows as plain text (a title, a form field, a description):
  // **bold**, *italic*, ~~struck~~ and `code` unmarked; [text](address) as "text (address)" and a picture as its words;
  // headings and quotes unmarked; a list's lines start "- " (a numbered list keeps its numbers); fences, rules and the
  // ruled line under a header row (|---|) dropped; HTML tags removed (a <br>, a paragraph or a list item still breaks the
  // line; <script> and <style> go with what they hold up to their closing tag, and with none only the tag goes) and its
  // entities read. A backslash keeps a mark as it is (\* stays *). Lines are kept unless `line` is true, which makes it one
  // line. Every pattern is bounded, so a long or crafted text takes linear time.
  const BLOCK_TAGS = /^(?:p|div|h[1-6]|ul|ol|tr|blockquote|pre|section|article|header|footer|hr|dl|dt|dd)$/;
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', deg: '°', times: '×' };
  function htmlToText(s) {
    if (s.indexOf('<') < 0) return s;
    let out = '';
    let i = 0;
    const unclosed = {}; // a <script> or <style> with no closing tag after it: none further on has one either
    for (;;) {
      const lt = s.indexOf('<', i);
      if (lt < 0) break;
      // Only "<" followed by a letter, "/" or "!" starts a tag; "a < b" is words.
      if (!/[A-Za-z/!]/.test(s.charAt(lt + 1))) { out += s.slice(i, lt + 1); i = lt + 1; continue; }
      const gt = s.indexOf('>', lt + 1);
      if (gt < 0) break; // no ">" left: nothing more is a tag
      out += s.slice(i, lt);
      const inner = s.slice(lt + 1, gt);
      const name = (/^\/?([A-Za-z][A-Za-z0-9]{0,15})/.exec(inner) || [])[1];
      const tag = name ? name.toLowerCase() : '';
      i = gt + 1;
      if (/^(?:https?:\/\/|mailto:)\S+$/i.test(inner)) out += inner; // an <https://...> address is the address
      else if (tag === 'br') out += '\n';
      else if (tag === 'li' && inner.charAt(0) !== '/') out += '\n- ';
      else if (BLOCK_TAGS.test(tag)) out += '\n';
      else if ((tag === 'script' || tag === 'style') && inner.charAt(0) !== '/' && !unclosed[tag]) {
        // What it holds goes with it, up to its closing tag. With none, only the tag itself goes and the words after it stay.
        const closer = new RegExp(`</${tag}`, 'gi');
        closer.lastIndex = i;
        const found = closer.exec(s);
        if (!found) unclosed[tag] = true;
        else {
          const close = s.indexOf('>', found.index);
          i = close < 0 ? s.length : close + 1;
        }
      } else if (tag === 'td' || tag === 'th') out += ' ';
    }
    return out + s.slice(i);
  }
  function entityText(s) {
    return s.replace(/&(#\d{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z]{2,8});/g, (whole, e) => {
      if (e.charAt(0) === '#') {
        const n = e.charAt(1) === 'x' || e.charAt(1) === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : whole;
    });
  }
  // A backslash-kept mark is held as a private character while the marks around it are read, then put back.
  const KEEP_BASE = 0xe000;
  function plainText(text, o) {
    let s = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/[\ue000-\ue07f]/g, '');
    s = s.replace(/\\([\\`*_{}[\]()#+\-.!>~|<])/g, (m, c) => String.fromCharCode(KEEP_BASE + c.charCodeAt(0)));
    s = htmlToText(s);
    const lines = [];
    let fenced = false;
    for (let line of s.split('\n')) {
      if (/^ {0,3}(?:```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) { lines.push(line); continue; }
      if (!line.trim()) { lines.push(''); continue; }
      // A rule (---, ***, ___) or the ruled line under a header row (|---|:--:|) says nothing in plain text.
      if (/^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)) continue;
      if (line.indexOf('-') >= 0 && line.indexOf('|') >= 0 && /^[\s|:-]+$/.test(line)) continue;
      line = line.replace(/^[ \t]{0,40}(?:>[ \t]?){1,10}/, '');
      const heading = /^[ \t]{0,3}#{1,6}[ \t]+/.exec(line);
      if (heading) {
        // "## Title ##": the closing marks go too, found from the end rather than by a pattern.
        line = line.slice(heading[0].length).trimEnd();
        let end = line.length;
        while (end > 0 && line.charAt(end - 1) === '#') end -= 1;
        if (end < line.length && (end === 0 || /[ \t]/.test(line.charAt(end - 1)))) line = line.slice(0, end).trimEnd();
      }
      line = line.replace(/^([ \t]{0,40})[-*+][ \t]+/, '$1- ');
      if (/^[ \t]{0,3}\|/.test(line)) line = line.replace(/^[ \t]{0,3}\|[ \t]?/, '').replace(/[ \t]?\|[ \t]*$/, '');
      lines.push(line
        .replace(/!\[([^[\]\n]{0,300})\]\(([^()\s]{0,600})(?:[ \t]{1,10}"[^"\n]{0,200}")?\)/g, '$1')
        .replace(/\[([^[\]\n]{1,300})\]\(([^()\s]{1,600})(?:[ \t]{1,10}"[^"\n]{0,200}")?\)/g, (m, words, address) => (words === address ? address : `${words} (${address})`))
        .replace(/`([^`\n]{1,300})`/g, '$1')
        .replace(/(\*\*|__)(?=\S)([^\n]{1,300}?)\1/g, '$2')
        .replace(/~~(?=\S)([^\n]{1,300}?)~~/g, '$1')
        .replace(/(^|[^\w*])\*(?=\S)([^*\n]{1,300}?)\*(?!\w)/g, '$1$2')
        .replace(/(^|[^\w_])_(?=\S)([^_\n]{1,300}?)_(?!\w)/g, '$1$2'));
    }
    s = entityText(lines.join('\n')).replace(/[\ue000-\ue07f]/g, (c) => String.fromCharCode(c.charCodeAt(0) - KEEP_BASE));
    s = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
    if (o && o.line) return s.replace(/\s+/g, ' ').trim();
    return s.split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // A time of day typed by a person, read as "HH:MM" (24 hours), or '' when it is not one. "1030", "10:30", "10.30", "10:30 pm", "10p",
  // "7", "22:30" all read. With no am or pm, a 24-hour clock takes the hour as given; a 12-hour clock takes 0 and 13 to 23 as given,
  // and 1 to 12 in the half of the day `prev` ("HH:MM", what the field held) was in (noon for 12, the morning for the rest, when it held nothing).
  function parseClockText(text, clock, prev) {
    const t = String(text ?? '').trim();
    const m = /^(\d{1,2})\s*(?:[:.h]\s*(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/i.exec(t) || /^(\d{1,2})(\d{2})\s*(?:([ap])\.?\s*m?\.?)?$/i.exec(t);
    if (!m) return '';
    let h = Number(m[1]);
    const min = m[2] === undefined ? 0 : Number(m[2]);
    const half = m[3] ? m[3].toLowerCase() : '';
    if (min > 59) return '';
    if (half) {
      if (h < 1 || h > 12) return '';
      h = (h % 12) + (half === 'p' ? 12 : 0);
    } else if (h > 23) {
      return '';
    } else if (clock !== '24' && h >= 1 && h <= 12) {
      const pm = /^\d{2}:/.test(prev || '') ? Number(prev.slice(0, 2)) >= 12 : h === 12;
      h = (h % 12) + (pm ? 12 : 0);
    }
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  // "HH:MM" as the field shows it: "10:30 PM" on a 12-hour clock, "22:30" on a 24-hour one; '' stays ''.
  function clockText(hhmm, clock) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return '';
    if (clock === '24') return hhmm;
    const h = Number(m[1]);
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
  }

  // A local date and time from a `when` (the objects format's: "2026-11-14T12:50", "2026-11-14", or "12:50" when the day is
  // not known; plan-object-handoff.md, "Kinds and their details"), as { date, time }: "YYYY-MM-DD" and "HH:MM", each null when
  // not given. The clock time is kept as written: seconds, and a trailing Z or offset, are dropped, never turned into another
  // zone. A space may stand for the T, and a time may be "3:25 PM". `day` is the day for a time alone (the object's own
  // date). Null when neither a day nor a time can be read; an impossible day or time is no value.
  function localWhen(when, day) {
    const pad = (n) => String(n).padStart(2, '0');
    const realDay = (y, m, d) => {
      const t = new Date(Date.UTC(+y, +m - 1, +d));
      return t.getUTCFullYear() === +y && t.getUTCMonth() === +m - 1 && t.getUTCDate() === +d ? `${y}-${m}-${d}` : null;
    };
    const clock = (h, mi, half) => {
      let hour = +h;
      if (+mi > 59) return null;
      if (half) {
        if (hour < 1 || hour > 12) return null;
        hour = (hour % 12) + (/^p/i.test(half) ? 12 : 0);
      } else if (hour > 23) return null;
      return `${pad(hour)}:${mi}`;
    };
    const s = typeof when === 'string' ? when.trim().slice(0, 40) : '';
    const TIME = '(\\d{1,2}):(\\d{2})(?::\\d{2}(?:\\.\\d{1,9})?)?[ \\t]?([ap]\\.?m\\.?)?(?:z|[+-]\\d{2}(?::?\\d{2})?)?';
    let date = null;
    let time = null;
    let m = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ]${TIME})?$`, 'i').exec(s);
    if (m) {
      date = realDay(m[1], m[2], m[3]);
      time = date && m[4] !== undefined ? clock(m[4], m[5], m[6]) : null;
      if (!date || (m[4] !== undefined && !time)) { date = null; time = null; }
    } else if ((m = new RegExp(`^${TIME}$`, 'i').exec(s))) {
      time = clock(m[1], m[2], m[3]);
    }
    if (!date && time && typeof day === 'string') {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
      date = d ? realDay(d[1], d[2], d[3]) : null;
    } else if (!date && !time && !s && typeof day === 'string') {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
      date = d ? realDay(d[1], d[2], d[3]) : null;
    }
    return date || time ? { date, time } : null;
  }

  // An object's `details` as "Label: value" lines, for the fields a module has no place of its own for (plan-object-handoff.md,
  // "Nothing is lost": "Cabin: 4B" in the notes). The words are the Planner's (travel-lib-object.js). `kind` words a car's
  // ends as its pick-up and drop-off; `skip` lists the fields the module used. A date and time reads "2026-11-14 12:50", a
  // length "2 h 30 min", a place "Chicago Midway (MDW)", a flag "yes" or "no"; a picture's file id is never shown.
  const DETAIL_WORDS = {
    airline: 'Airline', operator: 'Operator', company: 'Company', number: 'Number', from: 'From', to: 'To', departs: 'Departs',
    arrives: 'Arrives', minutes: 'Length', terminal: 'Terminal', gate: 'Gate', seat: 'Seat', class: 'Class', reference: 'Reference',
    platform: 'Platform', carriage: 'Coach', cabin: 'Cabin', address: 'Address', checkIn: 'Check in', checkOut: 'Check out',
    roomType: 'Room', guests: 'People', starts: 'Starts', ends: 'Ends', partySize: 'Party size', name: 'Booking name',
    tickets: 'Tickets', allDay: 'All day', due: 'Due', options: 'Options', closes: 'Closes', multiple: 'More than one answer',
  };
  // A car's places are where it is picked up and dropped off; its times, as the Planner's car form words them, Pick-up time.
  const CAR_DETAIL_WORDS = { from: 'Pick up', to: 'Drop off', departs: 'Pick-up time', arrives: 'Drop-off time' };
  function detailLines(details, o) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
    const skip = new Set(o && Array.isArray(o.skip) ? o.skip : []);
    const kind = o && typeof o.kind === 'string' ? o.kind : '';
    const own = (name) => Object.prototype.hasOwnProperty.call(DETAIL_WORDS, name);
    const label = (name) => {
      if (kind === 'car' && Object.prototype.hasOwnProperty.call(CAR_DETAIL_WORDS, name)) return CAR_DETAIL_WORDS[name];
      if (own(name)) return DETAIL_WORDS[name];
      const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      return words.charAt(0).toUpperCase() + words.slice(1);
    };
    const shown = (name, v) => {
      if (typeof v === 'boolean') return v ? 'yes' : 'no';
      if (name === 'minutes' && Number.isInteger(v) && v > 0) {
        const h = Math.floor(v / 60);
        const m = v % 60;
        return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
      }
      if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
      if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16).replace('T', ' ') : v;
      if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ');
      if (v && typeof v === 'object') {
        const code = typeof v.code === 'string' ? v.code : '';
        const place = typeof v.name === 'string' ? v.name : '';
        return place && code ? `${place} (${code})` : place || code;
      }
      return '';
    };
    const lines = [];
    for (const [name, v] of Object.entries(details).slice(0, 40)) {
      if (name === 'upload' || skip.has(name) || !/^[a-zA-Z]{1,24}$/.test(name)) continue;
      const text = plainText(shown(name, v), { line: true }).slice(0, 300);
      if (text) lines.push(`${label(name)}: ${text}`);
    }
    return lines;
  }

  // A currency list for a <select> (host.ui.currencySelect, and Manage's Currency, which loads this file for it): the common
  // ones, then every other by name in the viewer's language, and the current value first when it is in neither, so a stored
  // code is shown rather than lost. `currencies` is what the server takes (GET /api/currencies, or host.locale().currencies);
  // without it the browser's own list, and at the least the common ones.
  const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CNY', 'INR', 'MXN', 'BRL', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'ZAR', 'SGD', 'HKD', 'KRW', 'THB', 'TRY', 'AED'];
  let currencyNames = null;
  function currencyName(code) {
    try {
      if (!currencyNames) currencyNames = new Intl.DisplayNames(undefined, { type: 'currency' });
      return currencyNames.of(code) || code;
    } catch (err) {
      return code;
    }
  }
  // fillCurrencySelect(select, { value, currencies, empty }): `empty` is the label of a first "" choice, for a field that may
  // be left to a default. A three-letter value is matched in capitals. Returns the value selected.
  function fillCurrencySelect(select, o) {
    const options = o || {};
    const raw = typeof options.value === 'string' ? options.value.trim() : '';
    const value = /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : raw;
    let list = Array.isArray(options.currencies) && options.currencies.length ? options.currencies : null;
    if (!list && typeof Intl.supportedValuesOf === 'function') {
      try { list = Intl.supportedValuesOf('currency'); } catch (err) { list = null; }
    }
    if (!list || !list.length) list = COMMON_CURRENCIES;
    list = [...new Set(list.filter((c) => typeof c === 'string').map((c) => c.toUpperCase()))];
    const doc = select.ownerDocument || document;
    const option = (code, label) => {
      const el = doc.createElement('option');
      el.value = code;
      const name = label === undefined ? currencyName(code) : label;
      el.textContent = label !== undefined || name === code ? name : `${code} - ${name}`;
      return el;
    };
    const group = (label, codes) => {
      const g = doc.createElement('optgroup');
      g.label = label;
      g.append(...codes.map((c) => option(c)));
      return g;
    };
    const common = COMMON_CURRENCIES.filter((c) => list.includes(c));
    const others = list.filter((c) => !common.includes(c)).sort((a, b) => currencyName(a).localeCompare(currencyName(b)));
    const children = [];
    if (options.empty) children.push(option('', String(options.empty)));
    if (value && !list.includes(value)) children.push(option(value));
    if (common.length) children.push(group('Common', common));
    if (others.length) children.push(group('All currencies', others));
    select.replaceChildren(...children);
    select.value = value;
    return select.value;
  }

  // The view switch (the view-switch rules in public/style.css and public/sdk/host.css), the one implementation the
  // host's pages and the SDK share. fillChoice(button, { id, label, icon?, regular?, iconOnly?, svg? }) draws one choice:
  // its icon (a Font Awesome <i>, or with `svg` an empty .tb-tab-glyph the caller fills with host.ui.icon's SVG, which
  // it returns) and its word. fitSwitches(container) shows the switches in it as icons only while their words do not fit
  // the container (its own width, never the window's); watchSwitches(container) fits now and again whenever the
  // container changes size or the fonts arrive. In icons only, every choice keeps its word as its title and its
  // aria-label; a choice without an icon keeps its word; what is selected, the keyboard and focus do not change.
  const SWITCH_COMPACT = 'tb-tabs-compact';
  const SWITCH_ICON = /^[a-z0-9-]{1,40}$/;
  function fillChoice(button, o) {
    const doc = button.ownerDocument;
    const word = String((o && o.label) || '');
    const icon = o && SWITCH_ICON.test(o.icon || '') ? o.icon : '';
    const iconOnly = Boolean(icon && o.iconOnly);
    const name = word || String((o && o.id) || icon);
    button.textContent = '';
    button.classList.add('tb-tab');
    button.classList.toggle('tb-tab-icon', iconOnly);
    delete button.dataset.tip;
    delete button.dataset.fitTitle;
    let glyph = null;
    if (icon) {
      glyph = doc.createElement(o.svg ? 'span' : 'i');
      glyph.className = o.svg ? 'tb-tab-glyph' : `tb-tab-glyph fa-${o.regular ? 'regular' : 'solid'} fa-${icon} fa-fw`;
      glyph.setAttribute('aria-hidden', 'true');
      button.appendChild(glyph);
    }
    if (word && !iconOnly) {
      const w = doc.createElement('span');
      w.className = 'tb-tab-word';
      w.textContent = word;
      button.appendChild(w);
    }
    button.setAttribute('aria-label', name);
    if (iconOnly) button.dataset.tip = name;
    return glyph;
  }
  // A choice with an icon and a word, in or out of icons only: its word is its accessible name either way, and its
  // tooltip only while the word is hidden (a title the page set itself is left alone). A choice is a tab (.tb-tab) or a
  // part of the module frame's segmented switch (.mf-switch-btn, its word .mf-word: Chat's Discussion | Assistant).
  function labelChoice(button, compact) {
    const wordEl = button.querySelector(':scope > :is(.tb-tab-word, .mf-word)');
    if (!wordEl || !button.querySelector(':scope > :is(.tb-tab-glyph, i)')) return;
    const word = wordEl.textContent.trim();
    button.setAttribute('aria-label', word);
    if (compact && ((!button.dataset.tip && !button.title) || button.dataset.fitTitle)) {
      button.dataset.tip = word;
      button.dataset.fitTitle = '1';
    } else if (!compact && button.dataset.fitTitle) {
      delete button.dataset.tip;
      delete button.dataset.fitTitle;
    }
  }
  function fitSwitches(container) {
    if (!container || !container.isConnected) return;
    const groups = [...container.querySelectorAll('.tb-tabs, .mf-switch')];
    if (!groups.length) return;
    // Measured with every word showing; a container that is not laid out (hidden) keeps the words.
    for (const g of groups) g.classList.remove(SWITCH_COMPACT);
    const width = container.clientWidth;
    const narrow = width > 0 && (container.scrollWidth > width + 1 || groups.some((g) => g.getBoundingClientRect().width > width + 1));
    for (const g of groups) {
      g.classList.toggle(SWITCH_COMPACT, narrow);
      for (const b of g.querySelectorAll('.tb-tab, .mf-switch-btn')) labelChoice(b, narrow);
    }
  }
  const switchWatch = new WeakMap(); // container -> the view it is watched in
  function watchSwitches(container) {
    if (!container) return;
    fitSwitches(container);
    const view = container.ownerDocument && container.ownerDocument.defaultView;
    if (!view || switchWatch.get(container) === view) return;
    switchWatch.set(container, view);
    let frame = 0;
    const later = () => {
      if (frame) return;
      frame = view.requestAnimationFrame(() => { frame = 0; fitSwitches(container); });
    };
    if (typeof view.ResizeObserver === 'function') new view.ResizeObserver(later).observe(container);
    else view.addEventListener('resize', later);
    const fonts = view.document.fonts;
    if (fonts && typeof fonts.addEventListener === 'function') {
      fonts.addEventListener('loadingdone', later);
      fonts.ready.then(later, () => {});
    }
  }

  // The segmented switch's keyboard: the standard radio group. A switch is .mf-switch with role="radiogroup" and a name; its
  // parts are .mf-switch-btn buttons with role="radio" and aria-checked (the module frame's view switches, Chat's Discussion |
  // Assistant, the Prototype's switches, the Planner's "How you get there"). One Tab stop: the chosen part, else the first;
  // Tab leaves the group. Left or Up and Right or Down move to the part before or after (round the ends) and choose it; Home
  // and End the first and the last; Space and Enter choose (the button's own click). Choosing is the part's click, so the
  // page's own click handler does it; a part drawn again by that click (the module frame redraws) is found again by its
  // data-key. One listener per window on the document, reading the event's composed path, so a module in a shadow root has
  // it too. Whoever draws a switch may call roveSwitch(group); one never roved is roved when focus first comes into it.
  const SWITCH_PART = '.mf-switch > .mf-switch-btn';
  const switchParts = (g) => (g ? [...g.children].filter((b) => b.classList.contains('mf-switch-btn') && !b.disabled && !b.hidden) : []);
  function roveSwitch(g) {
    const parts = switchParts(g);
    const stop = parts.find((b) => b.getAttribute('aria-checked') === 'true') || parts[0];
    for (const b of g ? [...g.children] : []) if (b.classList.contains('mf-switch-btn')) b.tabIndex = b === stop ? 0 : -1;
  }
  function switchPartOf(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    return path.find((n) => n && n.nodeType === 1 && typeof n.matches === 'function' && n.matches(SWITCH_PART)) || null;
  }
  // The same part after a click that may have drawn the switch again.
  function switchPartAgain(b, root) {
    if (b.isConnected) return b;
    const key = b.dataset && b.dataset.key;
    if (!key || !root || typeof root.querySelector !== 'function') return null;
    return [...root.querySelectorAll('.mf-switch-btn')].find((x) => x.dataset.key === key) || null;
  }
  function switchKeydown(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const b = switchPartOf(e);
    if (!b) return;
    const parts = switchParts(b.parentElement);
    const at = parts.indexOf(b);
    if (at < 0 || !parts.length) return;
    const view = b.ownerDocument && b.ownerDocument.defaultView;
    const rtl = Boolean(view && view.getComputedStyle && view.getComputedStyle(b).direction === 'rtl');
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    let to;
    if (step) to = (at + step + parts.length) % parts.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = parts.length - 1;
    else return;
    e.preventDefault();
    const next = parts[to];
    const root = typeof next.getRootNode === 'function' ? next.getRootNode() : next.ownerDocument;
    next.focus();
    if (next.getAttribute('aria-checked') !== 'true') next.click();
    const now = switchPartAgain(next, root);
    if (!now) return;
    roveSwitch(now.parentElement);
    if (root.activeElement !== now) now.focus();
  }
  function switchClick(e) {
    const b = switchPartOf(e);
    if (!b) return;
    const root = typeof b.getRootNode === 'function' ? b.getRootNode() : b.ownerDocument;
    Promise.resolve().then(() => { const now = switchPartAgain(b, root); if (now) roveSwitch(now.parentElement); });
  }
  // Focus coming into a switch nobody roved (every part a Tab stop): rove it and put focus on the chosen part.
  function switchFocusin(e) {
    const b = switchPartOf(e);
    if (!b) return;
    const g = b.parentElement;
    if ([...g.children].some((x) => x.classList.contains('mf-switch-btn') && x.tabIndex === -1)) return;
    roveSwitch(g);
    const stop = switchParts(g).find((x) => x.tabIndex === 0);
    if (stop && stop !== b) stop.focus();
  }
  const switchDoc = global.document;
  if (switchDoc && typeof switchDoc.addEventListener === 'function' && !global.__hostSwitchKeys) {
    global.__hostSwitchKeys = true;
    switchDoc.addEventListener('keydown', switchKeydown);
    switchDoc.addEventListener('click', switchClick);
    switchDoc.addEventListener('focusin', switchFocusin);
  }

  // The editor window (host.ui.editor): a module's Add or Edit form as a modal <dialog>, drawn in the browser's top layer
  // above every module and the header, sized to the form rather than the module, a full-screen sheet on a phone. Its
  // styles are in /sdk/host.css (.sdk-editor); see documentation/plans/plan-editor-window.md. The two sizes, by name;
  // check-module-window.mjs reads them and the sentence thrown for a wrong element.
  const EDITOR_SIZES = { medium: 560, large: 880 };
  const EDITOR_NEEDS = 'host.ui.editor needs a <dialog> element';
  const EDITOR_FIELD = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  let editorSeq = 0;
  // deps: { root, rootElement, icon(name) -> Promise<svg>, opened: Map<dialog, { reopen }>, lift(open, size) } from the
  // module's host. `lift` is there only in a sandboxed frame: a <dialog>'s top layer is the frame's own, so the frame
  // itself is lifted over the canvas (the host's `editor.lift`) while an editor is open, and put back when the last closes.
  function createEditor(dialog, o, deps) {
    if (!dialog || dialog.nodeType !== 1 || String(dialog.tagName).toUpperCase() !== 'DIALOG') throw new Error(EDITOR_NEEDS);
    const options = o || {};
    const size = EDITOR_SIZES[options.size] ? options.size : 'medium';
    const doc = dialog.ownerDocument;
    dialog.classList.add('sdk-editor', `sdk-editor-${size}`);
    dialog.classList.remove(size === 'large' ? 'sdk-editor-medium' : 'sdk-editor-large');
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    let returnTo = null; // what to focus on close: an element, or a function giving one
    let before = null; // what had focus before open()
    let lastFocus = null; // the last focused element inside, for reopening after a move
    let reason = ''; // why it is closing: 'done' (close()) or 'cancel'; '' when the browser closed it by itself
    let asking = null; // the "Discard your changes?" row while it shows: { row, focus }
    const active = () => (deps.root && deps.root.activeElement) || doc.activeElement || null;
    const visible = (el) => el === dialog || el.getClientRects().length > 0;
    // In a frame: lift the frame over the canvas once the editor is shown, put it back after the last one closes. The
    // call is not waited for. When the host says it lifted the frame ({ lifted: true, phone }; a window of its own, or a
    // frame the person is not in, says false), the frame is the window, exactly the editor's size, and the dialog fills
    // it (.sdk-editor-lifted, data-lift "window" or "phone" by the page's width, not the frame's).
    let liftedNow = false; // the host said it lifted the frame for this editor
    let sizer = null; // a ResizeObserver on the dialog's content while lifted, so the frame follows the form's height
    let watcher = null; // a MutationObserver while open: the dialog taken out of the page closes the editor's lift
    // The dialog's content height, for the frame to be no taller than the form needs (the dialog scrolls past that).
    const contentHeight = () => Math.ceil([...dialog.children].reduce((h, c) => h + c.getBoundingClientRect().height, 0) + 2);
    const unlifted = () => {
      liftedNow = false;
      dialog.classList.remove('sdk-editor-lifted');
      delete dialog.dataset.lift;
      if (sizer) { sizer.disconnect(); sizer = null; }
    };
    // `retry`: asked again once, a second later, when the host refuses (it refuses for a second after putting a lift back
    // itself, and Keep editing can come inside that second).
    const lift = (open, retry) => {
      if (typeof deps.lift !== 'function') return;
      if (!open && deps.opened && [...deps.opened.keys()].some((d) => d !== dialog && d.open)) return;
      if (!open) unlifted();
      try {
        Promise.resolve(deps.lift(open, size, open ? contentHeight() : undefined)).then((r) => {
          if (!open) return;
          const did = Boolean(r && r.lifted === true) && dialog.open;
          liftedNow = did;
          dialog.classList.toggle('sdk-editor-lifted', did);
          if (did) dialog.dataset.lift = r.phone ? 'phone' : 'window'; else delete dialog.dataset.lift;
          if (did && !sizer && typeof ResizeObserver === 'function') {
            let last = contentHeight();
            sizer = new ResizeObserver(() => {
              if (!liftedNow || !dialog.open) return;
              const h = contentHeight();
              if (Math.abs(h - last) < 4) return;
              last = h;
              Promise.resolve(deps.lift(true, size, h)).catch(() => {});
            });
            for (const c of dialog.children) sizer.observe(c);
          }
          if (!did && sizer) { sizer.disconnect(); sizer = null; }
          if (!did && retry && dialog.open) setTimeout(() => { if (dialog.open && !liftedNow) lift(true); }, 1100);
        }, () => {});
      } catch (err) { /* no host to ask */ }
    };
    // The host put the lift back itself (its Close, Escape on the page, a click on the backdrop): close as Escape does,
    // which asks "Discard your changes?" when something would be lost. Keep editing lifts the frame again.
    const dismiss = () => { unlifted(); if (dialog.open) requestClose(); };
    const watch = () => {
      if (watcher || typeof MutationObserver !== 'function' || !deps.root || !deps.root.nodeType) return;
      watcher = new MutationObserver(() => {
        if (dialog.isConnected) return;
        unwatch();
        deps.opened.delete(dialog);
        lift(false);
      });
      watcher.observe(deps.root, { childList: true, subtree: true });
    };
    const unwatch = () => { if (watcher) { watcher.disconnect(); watcher = null; } };
    // The head: the form's own heading (moved here, once) and the close button, in a sticky strip, so they stay at the top
    // while the form scrolls under them. Made again when missing: a module may replace the dialog's content on each open
    // (the Planner clones a template into it), and the new form brings its heading.
    const corner = () => {
      let c = dialog.querySelector(':scope > .sdk-editor-head');
      const title = dialog.querySelector(':scope > form > :is(h1, h2, h3, h4), :scope > :is(h1, h2, h3, h4)');
      if (c) {
        if (title) { const old = c.querySelector('.sdk-editor-title'); if (old && old !== title) old.remove(); title.classList.add('sdk-editor-title'); c.prepend(title); }
        return;
      }
      c = doc.createElement('div');
      c.className = 'sdk-editor-head';
      if (title) { title.classList.add('sdk-editor-title'); c.appendChild(title); }
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'sdk-icon-btn btn-quiet btn-small sdk-editor-close';
      b.setAttribute('aria-label', 'Close');
      b.dataset.tip = 'Close';
      b.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3.05 1.64 8 6.59l4.95-4.95 1.41 1.41L9.41 8l4.95 4.95-1.41 1.41L8 9.41l-4.95 4.95-1.41-1.41L6.59 8 1.64 3.05z"/></svg>';
      deps.icon('xmark').then((svg) => { if (svg) b.innerHTML = svg; }, () => {});
      b.addEventListener('click', () => requestClose());
      c.appendChild(b);
      dialog.prepend(c);
    };
    // A screen reader's name for the dialog: its first heading, unless the module named it.
    const label = () => {
      if (dialog.hasAttribute('aria-label') || dialog.hasAttribute('aria-labelledby')) return;
      const h = dialog.querySelector('h1, h2, h3, h4');
      if (!h) return;
      if (!h.id) h.id = `sdk-editor-title-${++editorSeq}`;
      dialog.setAttribute('aria-labelledby', h.id);
    };
    const focusIn = (el) => {
      const own = (f) => !f.closest('.sdk-editor-head, .sdk-editor-discard');
      const target = el && el.nodeType === 1 && dialog.contains(el) && visible(el) ? el
        : [...dialog.querySelectorAll(EDITOR_FIELD)].find((f) => own(f) && visible(f)) || dialog;
      try { target.focus(); } catch (err) { /* not focusable */ }
    };
    const ask = () => {
      const row = doc.createElement('div');
      row.className = 'sdk-editor-discard';
      row.setAttribute('role', 'alertdialog');
      const text = doc.createElement('span');
      text.className = 'sdk-editor-discard-text';
      text.id = `sdk-editor-discard-${++editorSeq}`;
      text.textContent = 'Discard your changes?';
      row.setAttribute('aria-labelledby', text.id);
      const keep = doc.createElement('button');
      keep.type = 'button';
      keep.className = 'btn btn-quiet';
      keep.dataset.editor = 'keep';
      keep.textContent = 'Keep editing';
      keep.addEventListener('click', () => keepEditing());
      const discard = doc.createElement('button');
      discard.type = 'button';
      discard.className = 'btn btn-danger';
      discard.dataset.editor = 'discard';
      discard.textContent = 'Discard';
      discard.addEventListener('click', () => finish('cancel'));
      row.append(text, keep, discard);
      asking = { row, focus: active() };
      dialog.appendChild(row);
      keep.focus();
    };
    const keepEditing = () => {
      const a = asking;
      asking = null;
      if (!a) return;
      a.row.remove();
      if (a.focus && a.focus.isConnected && dialog.contains(a.focus)) a.focus.focus(); else focusIn();
      if (!liftedNow && dialog.open) lift(true, true);
    };
    const finish = (why) => {
      reason = why;
      if (asking) { asking.row.remove(); asking = null; }
      if (dialog.open) dialog.close();
    };
    // Escape or the close button: the question first when the module says something would be lost.
    const requestClose = () => {
      if (asking) return keepEditing();
      let dirty = false;
      try { dirty = typeof options.isDirty === 'function' && Boolean(options.isDirty()); } catch (err) { console.error(err); }
      if (dirty) ask(); else finish('cancel');
    };
    const restoreFocus = () => {
      let want = null;
      try { want = typeof returnTo === 'function' ? returnTo() : returnTo; } catch (err) { want = null; }
      const usable = (el) => el && el.nodeType === 1 && el.isConnected && typeof el.focus === 'function' && !dialog.contains(el);
      let target = usable(want) ? want : usable(before) && before !== doc.body ? before : deps.rootElement;
      if (!target) return;
      if (target === deps.rootElement && !target.hasAttribute('tabindex')) target.tabIndex = -1;
      try { target.focus(); } catch (err) { /* not focusable */ }
    };
    // Escape is handled here, on the key, rather than left to the dialog's own cancel: a browser fires cancel only while
    // the page has a fresh user activation, and Escape itself gives none, so a second Escape (Keep editing) would close
    // the dialog over the question and lose what was typed. Stopped here so neither the module's nor the page's listeners
    // see it; a list open inside (a menu, the date picker) stopped it already and closed only itself.
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      requestClose();
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      requestClose();
    });
    dialog.addEventListener('focusin', (e) => { lastFocus = e.target; });
    // A hairline shows under the head once the form has scrolled (data-scrolled, read by the Dialogs block).
    const scrolled = () => dialog.toggleAttribute('data-scrolled', dialog.scrollTop > 0);
    dialog.addEventListener('scroll', scrolled, { passive: true });
    dialog.addEventListener('close', () => {
      unwatch();
      deps.opened.delete(dialog);
      lift(false);
      if (!deps.opened.size) doc.documentElement.removeAttribute('data-dialog-open');
      if (asking) { asking.row.remove(); asking = null; }
      const why = reason === 'done' ? 'done' : 'cancel';
      reason = '';
      if (typeof options.onClose === 'function') {
        try { options.onClose(why); } catch (err) { console.error(err); }
      }
      // A microtask later: a module that redraws its list after a save queues that redraw as a microtask too, and
      // `returnTo` must look for the new row (or the opener) in the redrawn list, not the one being replaced.
      Promise.resolve().then(restoreFocus);
    });
    // After the host moved the module's box (docked to floating or back), the dialog is out of the top layer: show it
    // modal again, with the same focus.
    const reopen = () => {
      if (!dialog.hasAttribute('open') || !dialog.isConnected) return;
      const f = lastFocus;
      dialog.removeAttribute('open');
      try { dialog.showModal(); } catch (err) { console.error(err); return; }
      deps.opened.set(dialog, { reopen, dismiss });
      lift(true);
      if (f && f.isConnected && dialog.contains(f)) { try { f.focus(); } catch (err) { focusIn(); } } else focusIn();
    };
    const api = {
      open(a) {
        const arg = a || {};
        if (arg.returnTo !== undefined) returnTo = arg.returnTo;
        corner();
        dialog.removeAttribute('data-scrolled');
        label();
        if (!dialog.open) {
          before = active();
          reason = '';
          dialog.showModal(); // throws for a dialog that is not in the page: then nothing is lifted
          deps.opened.set(dialog, { reopen, dismiss });
          watch();
          lift(true);
          doc.documentElement.setAttribute('data-dialog-open', ''); // the page behind does not scroll (system.css)
        }
        focusIn(arg.focus);
      },
      close() { finish('done'); },
      // The module's own Cancel button: the same way out as Escape and the corner Close, so it asks "Discard your
      // changes?" when isDirty() says so, and closes with 'cancel' otherwise.
      cancel() { requestClose(); },
      get isOpen() { return Boolean(dialog.open); },
      element: dialog,
    };
    return api;
  }

  // The kind picker (host.ui.kindPicker): one row that names the chosen kind of thing with its icon in its colour, a list
  // of the kinds in groups when opened, typing to filter, recently chosen kinds first. The ARIA combobox pattern (an
  // editable field with a listbox). Styles in /sdk/host.css (.sdk-kind); see documentation/plans/plan-editor-window.md,
  // Part 2. These helpers are pure so tools/check-module-window.mjs can slice them out and run them.
  const KIND_RECENT_MAX = 4;
  const KIND_RECENT_KEEP = 12; // ids kept in this browser (more than shown, so a change of `max` has something to show)
  // The words a kind is found by: its label and its `words`, lower-cased, without accents ("Café" is found by "cafe").
  const kindWords = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // Every word typed must start some word of the kind's name or its `words`.
  function kindMatches(option, query) {
    const parts = kindWords(query);
    if (!parts.length) return true;
    const words = [...kindWords(option.label), ...(Array.isArray(option.words) ? option.words : []).flatMap(kindWords)];
    return parts.every((p) => words.some((w) => w.startsWith(p)));
  }
  // How well a kind matches what was typed, for the order: 0 its name is the query, 1 its name starts with it, 2 a later
  // word of its name does, 3 only its `words` do, 4 no match.
  function kindRank(option, query) {
    if (!kindMatches(option, query)) return 4;
    const q = kindWords(query).join(' ');
    const name = kindWords(option.label).join(' ');
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    const parts = kindWords(query);
    return parts.every((p) => kindWords(option.label).some((w) => w.startsWith(p))) ? 2 : 3;
  }
  // The groups the open list shows: with nothing typed, Recent first (the ids in `recent` that are in the groups, in that
  // order, up to `max`, and not repeated in their own groups below), then every group; with a query, the kinds that match
  // in their groups, the better matches first (a name that starts with the query before one found by its words; a group
  // ordered by its best match), and a group with none left goes. [] when nothing matches.
  function kindPickerGroups(groups, query, recent, max) {
    const all = (Array.isArray(groups) ? groups : []).filter((g) => g && Array.isArray(g.options));
    const q = String(query || '');
    if (kindWords(q).length) {
      return all.map((g) => {
        const ranked = g.options.filter(Boolean).map((o, i) => ({ o, r: kindRank(o, q), i })).filter((x) => x.r < 4).sort((a, b) => a.r - b.r || a.i - b.i);
        return { label: g.label, best: ranked.length ? ranked[0].r : 4, options: ranked.map((x) => x.o) };
      }).filter((g) => g.options.length).map((g, i) => ({ ...g, i })).sort((a, b) => a.best - b.best || a.i - b.i).map(({ label, options }) => ({ label, options }));
    }
    const byId = new Map();
    for (const g of all) for (const o of g.options) if (o && !byId.has(o.id)) byId.set(o.id, o);
    const top = (Array.isArray(recent) ? recent : []).filter((id, i, a) => byId.has(id) && a.indexOf(id) === i).slice(0, max || KIND_RECENT_MAX);
    if (!top.length) return all.map((g) => ({ label: g.label, options: g.options.filter(Boolean) })).filter((g) => g.options.length);
    const shown = new Set(top);
    return [{ label: 'Recent', recent: true, options: top.map((id) => byId.get(id)) }, ...all.map((g) => ({ label: g.label, options: g.options.filter((o) => o && !shown.has(o.id)) })).filter((g) => g.options.length)];
  }
  // A choice moves to the front of the recent ids, once.
  const kindRecentAdd = (ids, id) => [id, ...(Array.isArray(ids) ? ids : []).filter((x) => x !== id)].slice(0, KIND_RECENT_KEEP);
  const KIND_NEEDS = 'host.ui.kindPicker needs an element';
  let kindSeq = 0;
  // deps: { root, rootElement, icon(name) -> Promise<svg>, editorAt(el) -> dialog | null, moduleId } from the module's host.
  function createKindPicker(el, o, deps) {
    if (!el || el.nodeType !== 1) throw new Error(KIND_NEEDS);
    const options = o || {};
    const doc = el.ownerDocument;
    const memory = options.recent && options.recent.key ? `app:kind:${deps.moduleId || ''}:${String(options.recent.key).slice(0, 120)}` : '';
    const max = options.recent && Number(options.recent.max) > 0 ? Math.floor(Number(options.recent.max)) : KIND_RECENT_MAX;
    const readRecent = () => { if (!memory) return []; try { const v = JSON.parse(localStorage.getItem(memory) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch (err) { return []; } };
    const writeRecent = (id) => { if (!memory) return; try { localStorage.setItem(memory, JSON.stringify(kindRecentAdd(readRecent(), id))); } catch (err) { /* not kept */ } };
    let groups = [];
    let value = null;
    let open = false;
    let list = null; // the ul[role=listbox] while open
    let rows = []; // the options shown, in order: { id, option, el }
    let active = -1; // the active row's index
    let typed = ''; // what was typed since the list opened ('' shows every kind)
    const seq = ++kindSeq;
    const listId = `sdk-kind-list-${seq}`;
    const label = typeof options.label === 'string' && options.label ? options.label : 'Kind';
    const find = (id) => { for (const g of groups) for (const opt of g.options || []) if (opt && opt.id === id) return opt; return null; };
    // What has focus, seen from inside the module's root (a shadow root: the document only sees its host).
    const activeEl = () => (deps.root && deps.root.activeElement) || doc.activeElement || null;
    const first = () => { for (const g of groups) for (const opt of g.options || []) if (opt) return opt.id; return null; };
    // The row: the chip (the chosen kind's icon in its colour), the field, the chevron.
    el.classList.add('sdk-kind');
    el.replaceChildren();
    const field = doc.createElement('div');
    field.className = 'sdk-kind-field';
    const chip = doc.createElement('span');
    chip.className = 'sdk-kind-chip';
    chip.setAttribute('aria-hidden', 'true');
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'sdk-kind-input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-label', label);
    input.autocomplete = 'off';
    input.spellcheck = false;
    const chevron = doc.createElement('span');
    chevron.className = 'sdk-kind-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M2.3 5.3 8 11l5.7-5.7-1.4-1.4L8 8.2 3.7 3.9z"/></svg>';
    field.append(chip, input, chevron);
    const sheet = doc.createElement('div');
    sheet.className = 'sdk-kind-sheet';
    sheet.appendChild(field);
    el.appendChild(sheet);
    const drawIcon = (node, name) => {
      node.replaceChildren();
      if (!name) return;
      deps.icon(name).then((svg) => { if (svg && node.dataset.kindIcon === name) node.innerHTML = svg; }, () => {});
    };
    const colour = (node, c) => { if (c) node.style.setProperty('--kind-color', String(c)); else node.style.removeProperty('--kind-color'); };
    // The closed row shows the chosen kind: its name in the field, its icon on the chip in its colour. An id that is not in
    // the groups (a marker type an owner removed) shows an empty field saying "Unknown kind", never another kind.
    const showChosen = () => {
      const opt = find(value);
      input.value = opt ? opt.label : '';
      input.placeholder = !opt && value ? 'Unknown kind' : '';
      chip.dataset.kindIcon = (opt && opt.icon) || '';
      chip.hidden = !opt || !opt.icon;
      colour(chip, opt && opt.color);
      drawIcon(chip, opt && opt.icon);
    };
    const setActive = (i, scroll) => {
      if (rows[active]) { rows[active].el.classList.remove('active'); }
      active = i >= 0 && i < rows.length ? i : -1;
      if (active === -1) { input.removeAttribute('aria-activedescendant'); return; }
      const row = rows[active];
      row.el.classList.add('active');
      input.setAttribute('aria-activedescendant', row.el.id);
      if (scroll !== false && typeof row.el.scrollIntoView === 'function') row.el.scrollIntoView({ block: 'nearest' });
    };
    // Where the list goes: under the field (above it when it would not fit), fixed against the window. Inside an open editor
    // window (host.ui.editor) it is appended to that dialog, so it is in the top layer with it; on a phone the stylesheet
    // makes the sheet (.sdk-kind-sheet, holding the field and the list) fill the lower part of the screen instead.
    const place = () => {
      if (!list || !open) return;
      if (phone()) { list.style.top = ''; list.style.left = ''; list.style.width = ''; list.style.maxHeight = ''; return; }
      const r = field.getBoundingClientRect();
      const h = Math.min(list.scrollHeight, 360);
      const below = window.innerHeight - 4 - (r.bottom + 4);
      const above = r.top - 8;
      const up = below < Math.min(h, 160) && above > below;
      const maxH = Math.max(80, Math.min(360, up ? above : below));
      list.style.maxHeight = maxH + 'px';
      list.style.width = Math.max(0, r.width) + 'px';
      list.style.left = Math.max(4, Math.min(r.left, window.innerWidth - r.width - 4)) + 'px';
      list.style.top = (up ? Math.max(4, r.top - 4 - Math.min(h, maxH)) : r.bottom + 4) + 'px';
    };
    const phone = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;
    // The list for what is typed: the groups, each with its name and its kinds; "Nothing matches" when none do.
    const draw = () => {
      if (!list) return;
      list.replaceChildren();
      rows = [];
      const shownGroups = kindPickerGroups(groups, typed, readRecent(), max);
      if (!shownGroups.length) {
        const none = doc.createElement('li');
        none.className = 'sdk-kind-empty';
        none.setAttribute('role', 'presentation');
        none.textContent = 'Nothing matches';
        list.appendChild(none);
      }
      shownGroups.forEach((g, gi) => {
        const li = doc.createElement('li');
        li.className = 'sdk-kind-group';
        li.setAttribute('role', 'group');
        const title = doc.createElement('div');
        title.className = 'sdk-kind-group-title';
        title.id = `${listId}-g${gi}`;
        title.textContent = g.label || '';
        li.setAttribute('aria-labelledby', title.id);
        li.appendChild(title);
        for (const opt of g.options) {
          const row = doc.createElement('div');
          row.className = 'sdk-kind-option';
          row.setAttribute('role', 'option');
          row.id = `${listId}-${rows.length}`;
          row.setAttribute('aria-selected', opt.id === value ? 'true' : 'false');
          row.dataset.id = String(opt.id);
          colour(row, opt.color);
          const name = doc.createElement('span');
          name.className = 'sdk-kind-name';
          name.textContent = opt.label || String(opt.id);
          if (opt.icon) {
            const ic = doc.createElement('span');
            ic.className = 'sdk-kind-icon';
            ic.setAttribute('aria-hidden', 'true');
            ic.dataset.kindIcon = opt.icon;
            drawIcon(ic, opt.icon);
            row.append(ic, name);
          } else row.append(name);
          const index = rows.length;
          row.addEventListener('mousemove', () => { if (active !== index) setActive(index, false); });
          row.addEventListener('click', (e) => { e.preventDefault(); choose(index); });
          li.appendChild(row);
          rows.push({ id: opt.id, option: opt, el: row });
        }
        list.appendChild(li);
      });
      // The active row: the chosen kind when it is in the list, else the first match.
      const at = rows.findIndex((r) => r.id === value);
      setActive(rows.length ? (typed || at === -1 ? 0 : at) : -1, false);
      if (rows[active]) rows[active].el.scrollIntoView({ block: typed ? 'nearest' : 'center' });
      place();
    };
    const away = (e) => { if (open && !el.contains(e.target) && !(list && list.contains(e.target))) close(); };
    const key = (e) => {
      if (e.key !== 'Escape' || !open) return;
      // Escape closes only the list: stopped and prevented, so an editor window around it does not close too.
      e.preventDefault();
      e.stopPropagation();
      close();
      input.focus();
    };
    const openList = () => {
      if (open || input.disabled) return;
      open = true;
      typed = '';
      list = doc.createElement('ul');
      list.className = 'sdk-kind-list';
      list.id = listId;
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', label);
      // The list never takes focus from the field (a click on a row chooses it while the field keeps focus).
      list.addEventListener('mousedown', (e) => e.preventDefault());
      // On a phone the sheet holds the field and the list; elsewhere the list goes under the field, into an open editor
      // window when the field is in one (so it is not inert under the dialog).
      const editor = deps.editorAt(input);
      if (phone()) sheet.appendChild(list); else (editor || (deps.root === doc ? doc.body : deps.root)).appendChild(list);
      el.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', listId);
      draw();
      doc.addEventListener('keydown', key, true);
      deps.root.addEventListener('pointerdown', away, true);
      // The list follows the field when anything scrolls: the document, and the module's root (a scroll inside a shadow
      // root, an editor dialog's own scrolling, never reaches the document's listener).
      doc.addEventListener('scroll', place, true);
      if (deps.root !== doc) deps.root.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      if (phone() && activeEl() !== input) input.focus();
    };
    const close = () => {
      if (!open) return;
      open = false;
      if (list) list.remove();
      list = null;
      rows = [];
      active = -1;
      el.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      input.removeAttribute('aria-controls');
      doc.removeEventListener('keydown', key, true);
      deps.root.removeEventListener('pointerdown', away, true);
      doc.removeEventListener('scroll', place, true);
      if (deps.root !== doc) deps.root.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      showChosen();
      if (activeEl() === input) input.select();
    };
    const choose = (i) => {
      const row = rows[i];
      if (!row) return close();
      const changed = row.id !== value;
      value = row.id;
      writeRecent(value);
      close();
      if (changed && typeof options.onChange === 'function') { try { options.onChange(value); } catch (err) { console.error(err); } }
    };
    field.addEventListener('click', (e) => {
      if (input.disabled) return;
      if (e.target === input) { if (!open) { openList(); input.select(); } return; }
      e.preventDefault();
      if (open) close(); else { openList(); input.focus(); input.select(); }
    });
    input.addEventListener('input', () => {
      if (!open) openList();
      typed = input.value;
      draw();
    });
    input.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); if (!open) openList(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) { openList(); return; }
        if (!rows.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive(active === -1 ? (step > 0 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length);
        return;
      }
      if (open && (e.key === 'Home' || e.key === 'End') && rows.length) { e.preventDefault(); setActive(e.key === 'Home' ? 0 : rows.length - 1); return; }
      if (e.key === 'Enter') {
        e.preventDefault(); // never the form's submit
        if (open) choose(active);
        return;
      }
      if (e.key === 'Tab' && open) choose(active);
    });
    // Focus arriving selects the name, so typing starts the search; focus leaving (a click elsewhere, a Tab out) closes the
    // list and puts the chosen name back.
    input.addEventListener('focus', () => { if (!open) input.select(); });
    input.addEventListener('blur', () => { setTimeout(() => { if (open && activeEl() !== input) close(); }, 0); });
    const api = {
      get value() { return value; },
      // set(): chooses without onChange; an id that is not in the groups is kept and shown as "Unknown kind" (empty).
      set(id) { value = id == null ? null : String(id); showChosen(); },
      // setGroups(): a new list. A chosen kind the new list no longer has stays the value, shown as unknown, and is
      // reported through onChange(value) so the module can show its fields again.
      setGroups(next) {
        groups = Array.isArray(next) ? next : [];
        if (value == null) value = first();
        showChosen();
        if (open) draw();
        if (value != null && !find(value) && typeof options.onChange === 'function') { try { options.onChange(value); } catch (err) { console.error(err); } }
      },
      // remember(id): put a kind at the front of the recent list without choosing it (a module records the kind an object
      // was saved with when the form opened on it already chosen).
      remember(id) { if (id != null && find(id)) writeRecent(String(id)); },
      get disabled() { return input.disabled; },
      set disabled(v) { input.disabled = Boolean(v); el.classList.toggle('disabled', Boolean(v)); if (v) close(); },
      focus() { try { input.focus(); } catch (err) { /* not focusable */ } },
      open: openList,
      close,
      element: el,
      input,
      destroy() { close(); el.classList.remove('sdk-kind', 'disabled'); el.replaceChildren(); },
    };
    groups = Array.isArray(options.groups) ? options.groups : [];
    // The start: `value`, or with `start: 'recent'` the kind chosen last time in this browser when there is one; else the first.
    const recent = options.start === 'recent' ? readRecent().find((id) => find(id)) : null;
    value = recent || (typeof options.value === 'string' && options.value ? options.value : first());
    showChosen();
    return api;
  }

  // env: { call(method, params) -> Promise, root, rootElement, elementAt({x, y}), localPoint(clientX, clientY),
  // applyTheme(theme) }.
  // Returns { host, emit }: `emit` is how the host pushes an event to the module.
  function createHost(env) {
  const listeners = new Map();
  let info = null;
  const call = env.call;
  ensureTooltips();
  // The one toolbar row: its view switches and toolbar buttons (host.ui.viewSwitch, host.ui.toolbarButton) in the order
  // they were made lead it, then the module's own items (host.toolbar.set), so a switch never moves when the module's
  // tools change. Any of them changing draws the row again; the same row twice is not sent.
  const switches = [];
  let ownToolbar = [];
  let toolbarSig = '';
  function drawToolbar() {
    const items = [...switches.map((s) => s.item()), ...ownToolbar];
    const sig = JSON.stringify(items);
    if (sig === toolbarSig) return Promise.resolve(true);
    toolbarSig = sig;
    return call('toolbar.set', { items });
  }
  const drawSwitches = () => { drawToolbar().catch(() => {}); };

  // An "open this object" from the host can arrive before the module has said what to do with one.
  let pendingOpen = null;

  // The values of an event that names keys only: ONE storage.list for the keys' common prefix, not a get for each. A key the
  // list does not hold is gone (deleted). A list that fails is asked once more; if it fails again nothing is dropped silently:
  // the person is told to reload, and null comes back (the module hears none of that event, never a part of it).
  async function readKeysOnly(changes, scope, spaceId) {
    const at = scope === 'spaces' && spaceId ? { scope, space: spaceId } : scope ? { scope } : undefined;
    const need = changes.filter((c) => !c.deleted && c.value === undefined);
    let prefix = need[0].key;
    for (const c of need) while (!c.key.startsWith(prefix)) prefix = prefix.slice(0, -1);
    let items = null;
    for (let tries = 0; tries < 2 && !items; tries += 1) {
      try { items = await call('storage.list', { prefix, ...opts(at) }); } catch (err) { items = null; }
    }
    if (!Array.isArray(items)) {
      call('ui.toast', { text: 'Some changes did not load. Reload the page to see them.' }).catch(() => {});
      return null;
    }
    const byKey = new Map(items.map((i) => [i.key, i]));
    return changes.map((c) => {
      if (c.deleted || c.value !== undefined) return c;
      const got = byKey.get(c.key);
      return got ? { ...c, value: got.value, version: got.version } : { ...c, deleted: true };
    });
  }

  function emit(event, data) {
    // The environment's facts changed (a picture map set, replaced or cleared): host.environment answers the new ones
    // before anyone listening hears it.
    if (event === 'environment' && info && data && typeof data === 'object') info.environment = { ...(info.environment || {}), pictureMap: data.pictureMap && typeof data.pictureMap === 'object' ? data.pictureMap : null };
    if (event === 'objectopen' && !(listeners.get(event) && listeners.get(event).size)) pendingOpen = data;
    // Many keys at once (a Clear, its Undo): a module listening for 'changes' hears it once, to draw once; any other
    // hears each key as its own 'change'.
    // The replay is one pass, and each 'change' of it carries `batch` ({ count, last }) so a module that draws on each one can
    // draw on the last only. An event that names keys only (a big one comes without values) has its values read first, a few
    // at a time, so a 'change' always has its value.
    if (event === 'changes' && !(listeners.get(event) && listeners.get(event).size)) {
      const { changes = [], scope, spaceId } = data || {};
      const replay = (list) => list.forEach((c, i) => emit('change', { ...c, scope, spaceId, batch: { count: list.length, last: i === list.length - 1 } }));
      if (!changes.some((c) => !c.deleted && c.value === undefined)) { replay(changes); return; }
      readKeysOnly(changes, scope, spaceId).then((full) => { if (full) replay(full); });
      return;
    }
    for (const fn of listeners.get(event) || []) {
      try {
        fn(data);
      } catch (err) {
        console.error(err);
      }
    }
  }

  // The words a person reads for each level and role, by their code names (WORD_KEYS, server/words.js's KEYS in its
  // order): each { one, many, a }, `a` the singular with its article. These are the defaults; an environment's own come
  // in host.locale().words. host.util.word applies them. `home` (the home page, the list of spaces) is the space word's
  // plural with a capital by default, "Spaces".
  const WORD_KEYS = ['host', 'environment', 'space', 'home', 'aside', 'canvas', 'module', 'object', 'admin', 'owner', 'moderator', 'member', 'guest'];
  const DEFAULT_WORDS = (() => {
    const plural = { host: 'hosts', environment: 'environments', space: 'spaces', aside: 'asides', canvas: 'canvases', module: 'modules', object: 'objects', admin: 'admins', owner: 'owners', moderator: 'moderators', member: 'members', guest: 'guests' };
    const article = (one) => `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`;
    const out = {};
    for (const key of WORD_KEYS) {
      const one = key === 'home' ? plural.space.charAt(0).toUpperCase() + plural.space.slice(1) : key;
      const many = key === 'home' ? one : plural[key];
      out[key] = { one, many, a: article(one) };
    }
    return out;
  })();
  // How the server shows language, time and money, and the words it uses (Manage > Settings): known once hello has
  // answered, the defaults before.
  const locale = () => (info && info.locale) || { language: 'en', clock: '12', currency: 'USD', words: DEFAULT_WORDS };
  // A destination's part: the page's shared state, as the hello gave it and each 'destination' event since.
  let destinationState = null;
  const readyPromise = Promise.all([call('hello'), loadPhaseRule()]).then(([result]) => {
    info = result;
    if (result && result.destinationState && typeof result.destinationState === 'object') destinationState = result.destinationState;
    if (env.applyTheme) env.applyTheme(result.theme);
    // How the content fills the host's slot (the manifest's `content`): "flush" (edge to edge, a map) or "padded".
    if (result && env.rootElement && (result.content === 'flush' || result.content === 'padded')) env.rootElement.setAttribute('data-content', result.content);
    return result;
  });

  // Scope: 'context' (the default) is wherever the module is showing, the whole
  // environment on its page and one space on a space's canvas. On a space's canvas a module may also ask
  // for 'environment'; its environment page may read across the viewer's spaces with 'spaces', and read and write
  // one of them with { space: <id> }; 'person' is the viewer's own. A module in a space reaches only that space.
  const opts = (o) => ({ scope: (o && o.scope) || 'context', ...(o && o.space ? { space: String(o.space) } : {}) });
  // Library files (host.files.resolve, link, unlink; host.ui.fileChips). What one pointer's answer says about the file.
  function fileFacts(ref, s) {
    if (!s || s.error) return { ref, state: s && s.state === 'gone' ? 'removed' : 'hidden' };
    if (s.missing) return { ref, name: String(s.title || ''), state: 'missing' };
    return { ref, name: String(s.title || ''), group: s.group || '', type: s.type || '', size: Number(s.size) || 0, icon: s.icon || 'file', ...(s.viewable === false ? { viewable: false } : {}) };
  }
  async function resolveFiles(pointers) {
    const list = (Array.isArray(pointers) ? pointers : [pointers]).map(cleanRef).filter((r) => r && r.kind === 'file');
    if (!list.length) return [];
    const got = await host.objects.resolve(list);
    return list.map((ref, i) => fileFacts(ref, got[i]));
  }
  function fileLinks(object, pointers, op) {
    const list = (Array.isArray(pointers) ? pointers : [pointers]).map(cleanRef).filter((r) => r && r.kind === 'file');
    if (!list.length) return Promise.resolve({ links: 0 });
    return host.objects.setLinks(object, list, { kind: 'file', op });
  }
  const fileSize = (bytes) => (bytes >= 1073741824 ? `${Math.round(bytes / 107374182.4) / 10} GB` : bytes >= 1048576 ? `${Math.round(bytes / 104857.6) / 10} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  // The names modules used before the product's rename, refused with the word to use instead (no module is translated).
  const OLD_WORDS = { server: 'scope "environment"', boxWidth: '{ space }', rooms: 'scope "spaces"' };
  function refuseOld(o, what) {
    if (!o) return;
    const old = o.room !== undefined ? 'room' : OLD_WORDS[o.scope] ? o.scope : null;
    if (old) throw Object.assign(new Error(`${what}: "${old}" is an old name; use ${OLD_WORDS[old]}`), { status: 400 });
  }

  // The tooltip's script (public/tooltip.js): the page has it already (brand.js); a module in a sandboxed frame asks for it once.
  // It is found beside this file (../tooltip.js from where host.js was loaded); a frame the app serves has the SDK inline and asks the app for /tooltip.js.
  // A frame that already has it (the design-system page puts it in) asks for nothing. Without it a control still has its name (aria-label); only the label on hover is missing.
  function ensureTooltips() {
    try {
      if (window.__sdkTooltip || window.__sdkTooltipAsked || !document.head) return;
      window.__sdkTooltipAsked = true;
      const t = document.createElement('script');
      t.src = SDK_SCRIPT_SRC ? new URL('../tooltip.js', SDK_SCRIPT_SRC).href : '/tooltip.js';
      document.head.appendChild(t);
    } catch (err) {
      // no label on hover; the control keeps its name
    }
  }

  // A menu's own icons, cached per module instance the same way a module drawing its own would (see
  // assistant.js and others): a menu opened often should not re-fetch the same SVG every time.
  const menuIconSvg = new Map();
  const menuIconWait = new Map();
  function menuIcon(name, style) {
    const key = `${style || 'solid'}:${name}`;
    if (menuIconSvg.has(key)) return Promise.resolve(menuIconSvg.get(key));
    if (!menuIconWait.has(key)) menuIconWait.set(key, call('icons.svg', { name, style: style || 'solid' }).then((svg) => { menuIconSvg.set(key, svg); return svg; }).catch(() => { menuIconSvg.set(key, ''); return ''; }));
    return menuIconWait.get(key);
  }

  // The editor windows (host.ui.editor) this module has open, in the order they opened: dialog -> { reopen }.
  const openEditors = new Map();
  // The open editor window a control is in (an anchor inside it), else this module's topmost open one, else null. A
  // popover opened from inside an editor goes into that dialog, so it is in the top layer with it rather than inert
  // under it, and is placed against the window rather than the module's box.
  function editorAt(el) {
    const own = el && typeof el.closest === 'function' ? el.closest('dialog.sdk-editor[open]') : null;
    if (own) return own;
    let top = null;
    for (const d of openEditors.keys()) if (d.open) top = d;
    return top;
  }
  const editorDeps = { root: env.root, rootElement: env.rootElement, icon: (name) => menuIcon(name), opened: openEditors, editorAt, lift: env.lift, get moduleId() { return (info && info.module && info.module.id) || ''; } };

  // Only one host.menu is ever open at once (per module): { id, cleanup }.
  let openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    const { cleanup } = openMenu;
    openMenu = null;
    cleanup();
  }
  // A category's entries flying out beside its row (host.menu.show's `items`): the same rules as the page's own menu,
  // public/menu-flyout.js, whose block between the markers this is a copy of (tools/check-host-menu.mjs keeps it so).
  // --- menu-flyout ---
  // A category's entries fly out beside its row, or drill in (the same menu shows them, Back first) on a phone or a narrow
  // window (640px and below). In a module's frame the frame's own width is the module's, not the window's: there it drills
  // in only on a touch screen, or when the module has no room for the menu and its flyout side by side.
  const MENU_NARROW = 640;
  function submenuStyle({ width = 0, framed = false, touch = false, boxWidth = Infinity, need = 0 } = {}) {
    if (width > MENU_NARROW) return 'flyout';
    if (!framed) return 'drill';
    return touch || boxWidth < need ? 'drill' : 'flyout';
  }

  // Where a flyout goes: beside its menu (`row`: the menu's left and right, the row's top), to the right when it fits, else
  // to the left, else on the side with more room and shifted to stay inside `view` ({ w, h }). Its first entry is level
  // with its row (both menus have 4px of padding). Answers { x, y, side }.
  function flyoutPlace({ row, size, view, gap = 2, margin = 4 }) {
    const fitsRight = row.right + gap + size.w <= view.w - margin;
    const fitsLeft = row.left - gap - size.w >= margin;
    const side = fitsRight ? 'right' : fitsLeft ? 'left' : view.w - row.right >= row.left ? 'right' : 'left';
    let x = side === 'right' ? row.right + gap : row.left - gap - size.w;
    x = Math.max(margin, Math.min(x, view.w - size.w - margin));
    const y = Math.max(margin, Math.min(row.top - 4, view.h - size.h - margin));
    return { x, y, side };
  }

  // Whether the pointer at `p` is on its way from `from` (where it left the category's row) to the open flyout (`rect`, on
  // `side` of the menu): inside the triangle from that point to the flyout's near edge. A row crossed on the way does not
  // close the flyout then.
  function inSafeZone(p, from, rect, side) {
    if (!p || !from || !rect) return false;
    const edge = side === 'left' ? rect.right : rect.left;
    const b = { x: edge, y: rect.top };
    const c = { x: edge, y: rect.bottom };
    const s = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    const d1 = s(p, from, b);
    const d2 = s(p, b, c);
    const d3 = s(p, c, from);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }

  // The row the arrow keys go to among `count` rows from `at` (-1: none has the keyboard): 1 or -1, around the ends, or
  // 'first' and 'last' (Home, End).
  function menuStep(count, at, step) {
    if (!count) return -1;
    if (step === 'first') return 0;
    if (step === 'last') return count - 1;
    if (at < 0) return step < 0 ? count - 1 : 0;
    return (at + step + count) % count;
  }

  // What a key does in a menu with categories: 'next', 'prev', 'first', 'last' (move), 'open' (a category's entries),
  // 'back' (close the flyout, or leave a drilled-in category, the keyboard back on its row), 'close' (the whole menu), or
  // null (the key is not the menu's: Enter and Space press the row itself).
  function menuKeyAction(key, { inFlyout = false, onCategory = false, drilled = false } = {}) {
    if (key === 'ArrowDown') return 'next';
    if (key === 'ArrowUp') return 'prev';
    if (key === 'Home') return 'first';
    if (key === 'End') return 'last';
    if (key === 'ArrowRight') return onCategory && !inFlyout ? 'open' : null;
    if (key === 'ArrowLeft') return inFlyout || drilled ? 'back' : null;
    if (key === 'Escape') return inFlyout ? 'back' : 'close';
    if (key === 'Tab') return 'close';
    return null;
  }
  // --- end menu-flyout ---

  // A menu row's accessible name when it is not its label: `ariaLabel`, else a `tip` that holds the label (its full
  // wording, "Add a flight" for "Flight"), so what is heard still has the word on screen. Null: the row's own words.
  function menuItemName(item) {
    const label = String(item.label || '').trim();
    if (item.ariaLabel) return String(item.ariaLabel);
    const tip = String(item.tip || '').trim();
    return tip && label && tip !== label && tip.toLowerCase().includes(label.toLowerCase()) ? tip : null;
  }

  function showMenu({ id, items, at, anchor, className, maxWidth } = {}) {
    const reopening = openMenu && openMenu.id === id;
    closeMenu();
    if (reopening) return { close: closeMenu }; // the same trigger clicked again: toggle off, do not reopen
    const list = (items || []).filter(Boolean);
    if (!list.length) return { close: closeMenu };
    const menu = document.createElement('div');
    menu.className = `sdk-menu${className ? ` ${className}` : ''}`;
    menu.setAttribute('role', 'menu');
    if (maxWidth) menu.style.maxWidth = `${maxWidth}px`;
    let rows = [];
    let sub = null; // { items, back, label } while a category is drilled into
    let fly = null; // { el, rows, row, side, exit } while a category's flyout is open
    let hoverTimer = 0;
    const entriesOf = (item) => { const e = item && (item.items || item.submenu); const l = typeof e === 'function' ? e() : e; return Array.isArray(l) ? l.filter(Boolean) : null; };
    const isCategory = (item) => Boolean(item && !item.disabled && (item.items || item.submenu));
    // Inside an open editor window (host.ui.editor) the menu goes into the dialog and is clamped to the window.
    const editor = editorAt(anchor);
    const container = editor || (env.root === document ? document.body : env.root);
    // The box the menu and its flyout stay in: the module's own root, or the window inside an editor.
    const bounds = () => {
      const modBox = env.rootElement.getBoundingClientRect();
      return {
        modBox,
        box: editor ? { left: 0, top: 0 } : modBox,
        w: editor ? window.innerWidth : env.rootElement.clientWidth || 400,
        h: editor ? window.innerHeight : env.rootElement.clientHeight || 400,
      };
    };
    let framed = false;
    try { framed = window.parent !== window && env.root === document; } catch (err) { framed = true; }
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;
    const drills = () => submenuStyle({ width: window.innerWidth, framed, touch, boxWidth: bounds().w, need: menu.offsetWidth + 180 }) === 'drill';
    // A module box of a phone's width gets the 44px rows, whatever the window is.
    const narrow = bounds().w <= 640;
    if (narrow) menu.classList.add('narrow');

    const closeFly = ({ refocus = false } = {}) => {
      clearTimeout(hoverTimer);
      if (!fly) return;
      const { el, row } = fly;
      fly = null;
      el.remove();
      row.setAttribute('aria-expanded', 'false');
      row.classList.remove('open');
      if (refocus) row.focus();
    };
    const openFly = (item, row, { focus = false } = {}) => {
      clearTimeout(hoverTimer);
      if (fly && fly.row === row) { if (focus && fly.rows[0]) fly.rows[0].focus(); return; }
      closeFly();
      const entries = entriesOf(item);
      if (!entries || !entries.length) return;
      const el = document.createElement('div');
      el.className = `sdk-menu sdk-menu-flyout${narrow ? ' narrow' : ''}${className ? ` ${className}` : ''}`;
      el.setAttribute('role', 'menu');
      el.setAttribute('aria-label', item.label || '');
      const flyRows = [];
      for (const entry of entries) addEntry(el, entry, flyRows, true);
      container.appendChild(el);
      const { box, w, h } = bounds();
      const m = menu.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const spot = flyoutPlace({ row: { left: m.left - box.left, right: m.right - box.left, top: r.top - box.top }, size: { w: el.offsetWidth, h: el.offsetHeight }, view: { w, h } });
      el.style.left = `${box.left + spot.x}px`;
      el.style.top = `${box.top + spot.y}px`;
      el.dataset.side = spot.side;
      el.addEventListener('pointerenter', () => clearTimeout(hoverTimer));
      row.setAttribute('aria-expanded', 'true');
      row.classList.add('open');
      fly = { el, rows: flyRows, row, side: spot.side, exit: null };
      if (focus && flyRows[0]) flyRows[0].focus();
    };
    const hover = (item, b, e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return; // a touch opens on the tap
      if (sub || drills()) return;
      clearTimeout(hoverTimer);
      if (fly && fly.row === b) return;
      const onWay = fly && inSafeZone({ x: e.clientX, y: e.clientY }, fly.exit, fly.el.getBoundingClientRect(), fly.side);
      hoverTimer = setTimeout(() => {
        if (!openMenu || openMenu.menu !== menu) return;
        if (isCategory(item)) openFly(item, b); else closeFly();
      }, onWay ? 320 : 120);
    };

    function addEntry(into, item, rowList, inFlyout) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'sdk-menu-sep';
        sep.setAttribute('role', 'separator');
        into.appendChild(sep);
        return;
      }
      if (item.heading) {
        const hd = document.createElement('div');
        hd.className = 'sdk-menu-heading';
        hd.setAttribute('role', 'presentation');
        hd.textContent = item.heading;
        into.appendChild(hd);
        return;
      }
      const category = !inFlyout && isCategory(item);
      // A real link (item.href) is an <a>, not a button: a menu item that just goes somewhere keeps the
      // browser's own affordances (hover preview, middle-click a new tab, copy link address) rather than
      // faking navigation from a click handler.
      const b = item.href && !category ? document.createElement('a') : document.createElement('button');
      b.className = `sdk-menu-item${item.danger ? ' danger' : ''}${category ? ' sdk-menu-category' : ''}`;
      b.setAttribute('role', 'menuitem');
      if (item.current) b.setAttribute('aria-current', 'true');
      if (category) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); }
      if (item.href && !category) {
        b.href = item.href;
        b.target = item.target || '_blank';
        b.rel = 'noopener';
      } else {
        b.type = 'button';
      }
      if (item.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      if (item.icon) {
        const ic = document.createElement('span');
        ic.className = 'sdk-menu-icon';
        if (item.iconColor) ic.style.color = item.iconColor;
        b.appendChild(ic);
        menuIcon(item.icon, item.regular ? 'regular' : 'solid').then((svg) => { if (svg) ic.innerHTML = svg; });
      }
      const label = document.createElement('span');
      label.className = 'sdk-menu-label';
      label.textContent = item.label;
      b.appendChild(label);
      // `tip`: the tooltip; and the accessible name when it is the label's full wording ("Flight" heard as "Add a
      // flight"), or `ariaLabel` when given. The same rule as the page's menu (host-menu.js).
      if (item.tip) b.title = item.tip;
      const spoken = menuItemName(item);
      if (spoken) b.setAttribute('aria-label', spoken);
      if (category) {
        const caret = document.createElement('span');
        caret.className = 'sdk-menu-caret';
        caret.setAttribute('aria-hidden', 'true');
        caret.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M5.3 1.9 11.4 8l-6.1 6.1-1.4-1.4L8.6 8 3.9 3.3z"/></svg>';
        b.appendChild(caret);
      }
      if (item.hint) {
        const hn = document.createElement('div');
        hn.className = 'sdk-menu-hint';
        hn.textContent = item.hint;
        b.appendChild(hn);
      }
      if (category) {
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // A phone or a module with no room beside the menu drills in; else the flyout, the keyboard in it when a key
          // pressed the row.
          if (drills()) { sub = { items: entriesOf(item) || [], back: rows.indexOf(b), label: item.label }; draw(1); return; }
          openFly(item, b, { focus: e.detail === 0 });
        });
      } else if (!item.disabled && (item.onClick || item.href)) {
        b.addEventListener('click', async () => {
          let result;
          if (item.onClick) {
            try {
              result = await item.onClick(item, b);
            } catch (err) {
              console.error(err);
            }
          }
          if (result !== false) closeMenu(); // exactly `false` means the item armed itself and changed its own row; anything else closes (a plain href item just closes, letting the click through to the link)
        });
      }
      if (!inFlyout) {
        b.addEventListener('pointerenter', (e) => hover(item, b, e));
        if (category) b.addEventListener('pointerleave', (e) => { if (fly && fly.row === b) fly.exit = { x: e.clientX, y: e.clientY }; });
      }
      into.appendChild(b);
      if (!item.disabled) rowList.push(b);
    }

    // The menu's entries: the list, or a drilled-in category's with Back and its name first. `focus`: the row (by its
    // place among the rows) to put the keyboard on.
    function draw(focus) {
      closeFly();
      menu.replaceChildren();
      rows = [];
      const current = sub
        ? [{ label: 'Back', icon: 'arrow-left', back: true }, { heading: sub.label }, ...sub.items]
        : list;
      for (const item of current) {
        if (item.back) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'sdk-menu-item sdk-menu-back';
          b.setAttribute('role', 'menuitem');
          const ic = document.createElement('span');
          ic.className = 'sdk-menu-icon';
          b.appendChild(ic);
          menuIcon('arrow-left').then((svg) => { if (svg) ic.innerHTML = svg; });
          const label = document.createElement('span');
          label.className = 'sdk-menu-label';
          label.textContent = 'Back';
          b.appendChild(label);
          b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const at = sub.back; sub = null; draw(at); });
          menu.appendChild(b);
          rows.push(b);
          continue;
        }
        addEntry(menu, item, rows, false);
      }
      placeMenu();
      const target = rows[Math.max(0, Math.min(rows.length - 1, focus || 0))];
      if (target) target.focus();
    }

    // Positioned like host.actions.pick's own menu and the date picker's popover: clamped inside the
    // module's own root, by a point (a drop's own coordinates) or under an element (a "..." button),
    // flipped above it when there is no room below.
    function placeMenu() {
      const { modBox, box, w, h } = bounds();
      let x = ((at && at.x) || 0) + (editor ? modBox.left : 0);
      let y = ((at && at.y) || 0) + (editor ? modBox.top : 0);
      if (anchor && anchor.getBoundingClientRect) {
        const r = anchor.getBoundingClientRect();
        x = r.left - box.left;
        y = r.bottom - box.top + 4;
        if (y + menu.offsetHeight > h) y = r.top - box.top - menu.offsetHeight - 4;
      }
      x = Math.max(4, Math.min(x, w - menu.offsetWidth - 4));
      y = Math.max(4, Math.min(y, h - menu.offsetHeight - 4));
      menu.style.left = `${box.left + x}px`;
      menu.style.top = `${box.top + y}px`;
    }

    container.appendChild(menu);
    draw(-1);
    // Keys: Up, Down, Home and End move in the menu or its flyout; Right (or Enter) opens a category, Left or Escape
    // closes just its flyout (or leaves a drilled-in category); Escape closes only the menu: stopped and prevented, so
    // an editor window around it does not close too.
    const active = () => (env.root && env.root.activeElement) || document.activeElement;
    const onKey = (e) => {
      const now = active();
      const inFlyout = Boolean(fly && fly.el.contains(now));
      const onCategory = Boolean(now && rows.includes(now) && now.classList.contains('sdk-menu-category'));
      const action = menuKeyAction(e.key, { inFlyout, onCategory, drilled: Boolean(sub) });
      if (!action) return;
      if (action === 'close') {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); } else closeMenu();
        return;
      }
      if (!now || !(menu.contains(now) || inFlyout)) return; // the keyboard is not in the menu: the keys are not its
      e.preventDefault();
      e.stopPropagation();
      if (action === 'open') { now.click(); return; }
      if (action === 'back') {
        if (inFlyout) closeFly({ refocus: true });
        else if (sub) { const back = sub.back; sub = null; draw(back); }
        return;
      }
      const set = inFlyout ? fly.rows : rows;
      const next = menuStep(set.length, set.indexOf(now), action === 'next' ? 1 : action === 'prev' ? -1 : action);
      if (set[next]) set[next].focus();
    };
    const onOutside = (e) => { if (!menu.contains(e.target) && !(fly && fly.el.contains(e.target)) && e.target !== anchor) closeMenu(); };
    document.addEventListener('keydown', onKey, true);
    env.root.addEventListener('pointerdown', onOutside, true);
    openMenu = {
      id,
      menu,
      cleanup: () => {
        closeFly();
        menu.remove();
        document.removeEventListener('keydown', onKey, true);
        env.root.removeEventListener('pointerdown', onOutside, true);
        if (anchor && anchor.focus) { try { anchor.focus(); } catch (err) { /* not focusable */ } }
      },
    };
    return { close: closeMenu };
  }

  const host = {
    // Resolves with { user, context, permissions, theme, module }. `context` is { scope: 'environment' | 'space' | 'keyed',
    // spaceId }: the module's own page, a space's canvas (with that space's id), or a keyed page.
    ready: () => readyPromise,
    // { language, clock: '12' | '24', currency, words }: the environment's settings for how these are shown. See
    // host.util.time, host.util.hour12, host.util.money and host.util.word, which apply them. `words` is every level's
    // and role's word here, by code name: { space: { one: 'space', many: 'spaces', a: 'a space' }, ... }.
    locale,

    // Where the module's page is: `root` is what to look elements up in (document.getElementById becomes
    // host.root.getElementById: in a frame it is the document, in the page it is the module's own
    // shadow root) and `rootElement` the element whose size is the module's (the frame's document element, or
    // its container). Use these rather than document, so the module runs in either place.
    root: env.root,
    rootElement: env.rootElement,

    // Small helpers more than one module needs, so each does not carry its own copy.
    util: {
      // Text made safe to put in HTML.
      esc,
      // A small, safe subset of Markdown to HTML (see the function above): headings, **bold**, *italic*, `code`,
      // fenced code, lists, [text](url) and bare https:// links, > quotes, paragraphs. The one place a module may
      // set innerHTML from text nobody here wrote, because the safety is already done inside it.
      markdown,
      // Markdown and HTML as plain text, for a field shown as plain text (see plainText above): plain('**Southwest**
      // [details](https://x.example)') is "Southwest details (https://x.example)". plain(text, { line: true }) makes it one line.
      // A field a module draws with markdown() keeps its Markdown instead.
      plain: plainText,
      // A local date and time from an object's `when` (see localWhen above): localWhen('2026-11-14T12:50') is
      // { date: '2026-11-14', time: '12:50' }; localWhen('15:25', '2026-11-14') takes the object's own date for a time alone.
      // The clock time stays as written: a zone or offset is dropped, never converted. Null when it says neither.
      localWhen,
      // An object's details as "Label: value" lines (see detailLines above), for the fields a module has no place for:
      // detailLines({ cabin: '4B', minutes: 150 }) is ['Cabin: 4B', 'Length: 2 h 30 min']. { skip: ['due'] } leaves out
      // the fields already used; { kind: 'car' } words a car's ends as Pick up and Drop off.
      detailLines,
      // A new id for something a module stores: short, and unlikely to repeat.
      id: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      // A pointer's identity as one string, for keeping and comparing them.
      objectKey: (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|'),
      // A time of day ("22:30", as modules store one) the way the server shows times: "10:30 PM" on a 12-hour clock
      // (the default, see host.locale()), "22:30" on a 24-hour one. Anything that is not HH:MM comes back as it is.
      time: (hhmm) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
        if (!m) return hhmm || '';
        if (locale().clock === '24') return `${m[1].padStart(2, '0')}:${m[2]}`;
        const h = Number(m[1]);
        return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
      },
      // Whether times are on a 12-hour clock, for toLocaleString's hour12 where a Date is shown.
      hour12: () => locale().clock !== '24',
      // The word a person reads here for a level or role, by its code name, so a module never types one:
      // word('space') "space", word('space', { many: true, cap: true }) "Spaces", word('aside', { a: true }) "an aside".
      // An environment may call its spaces trips; this says so. An unknown name throws.
      word: (key, o) => {
        const set = locale().words || {};
        const w = (set[key] && set[key].one && set[key].many ? set[key] : null) || DEFAULT_WORDS[key];
        if (!w) throw new Error(`host.util.word: there is no word called ${key}`);
        const text = o && o.a ? w.a || `${/^[aeiou]/i.test(w.one) ? 'an' : 'a'} ${w.one}` : o && o.many ? w.many : w.one;
        return o && o.cap ? text.charAt(0).toLocaleUpperCase('en') + text.slice(1) : text;
      },
      // Fill every element marked data-word="<code name>" in `root` (an element, a fragment or the module's root) with
      // its word, as the host's own pages do: data-word-form takes any of many, cap and a, space-separated.
      // <span data-word="owner" data-word-form="a cap"></span> reads "An owner". Answers `root`.
      fillWords: (root) => {
        if (!root || typeof root.querySelectorAll !== 'function') return root;
        const els = [...(typeof root.matches === 'function' && root.matches('[data-word]') ? [root] : []), ...root.querySelectorAll('[data-word]')];
        for (const el of els) {
          const form = ` ${el.dataset.wordForm || ''} `;
          el.textContent = host.util.word(el.dataset.word, { many: form.includes(' many '), cap: form.includes(' cap '), a: form.includes(' a ') });
        }
        return root;
      },
      // An amount of money in a currency (the server's unless one is given), formatted for the reader.
      money: (amount, currency) => {
        const code = currency || locale().currency;
        const n = Number(amount) || 0;
        try { return new Intl.NumberFormat([], { style: 'currency', currency: code }).format(n); } catch (err) { return `${n.toFixed(2)} ${code}`; }
      },
      // Dates as "2026-09-24" (a local day): text from a Date, and back.
      ymd: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      // The phase timeline of the space this module is in (public/phases.js timelineOf, the rule the server runs; see
      // plan-one-bar.md): one band per template phase in order, [{ id, label, main, start, end, dated, current }],
      // from host.phases() and host.space().phases, the first phase starting on the day the space was created. `o`
      // may give `dates` and `created` (another space's, on an environment page: what host.spaces() lists) and
      // `today` (a day; today by default). [] with no phases. Throws when the rule did not load.
      phaseTimeline: (o) => {
        const rule = phaseRule();
        const here = (info && info.space) || null;
        const dates = o && o.dates !== undefined ? o.dates : (here && here.phases) || {};
        const created = o && o.created !== undefined ? o.created : here ? here.createdAt : null;
        return rule.timelineOf(host.phases(), dates, { today: (o && o.today) || host.util.ymd(new Date()), created });
      },
      // The words for a timeline on a day (chipWords, the bar's chip and the Planner's phase line): "Booking · day 2
      // of 3", "Planning · 12 days to go", or the label alone. '' with no bands.
      phaseWords: (bands, today) => phaseRule().chipWords(bands, today || host.util.ymd(new Date())),
      // Pull a date and a time out of what someone typed, and leave the rest as the title:
      // "meet with bob sep 29 at 7pm" gives { title: "meet with bob", date: "2026-09-29", time: "19:00" }. Understands
      // today, tomorrow, weekdays ("fri", "next fri"), "sep 29" and "29 sep", "9/29" and "2026-09-29"; times as
      // "7pm", "7:30 pm", "19:00", "at 7". A date already passed this year means next year. Anything it does
      // not recognise stays in the title; date and time are only there when found.
      parseWhen: (text, now) => {
        const base = now || new Date();
        let t = ' ' + String(text || '').trim() + ' ';
        const out = {};
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const ymd = host.util.ymd;
        const fix = (m, d, y) => {
          let year = y || base.getFullYear();
          let date = new Date(year, m, d);
          if (date.getMonth() !== m) return null;
          const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
          if (!y && date < today) date = new Date(year + 1, m, d);
          return ymd(date);
        };
        const take = (re, fn) => { const m = re.exec(t); if (!m) return false; const v = fn(m); if (v === null || v === undefined) return false; t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); return v; };
        // time first, so "7" in "at 7" is not read as a day
        let time = null;
        take(/\s(?:at\s+)?(noon|midday|midnight)\b/i, (m) => { time = /midnight/i.test(m[1]) ? '00:00' : '12:00'; return true; })
          || take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => { let h = Number(m[1]); const mi = Number(m[2] || 0); if (h < 1 || h > 12 || mi > 59) return null; const pm = m[3].toLowerCase() === 'pm'; h = (h % 12) + (pm ? 12 : 0); time = String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); return true; })
          || take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => { time = m[1].padStart(2, '0') + ':' + m[2]; return true; })
          || take(/\sat\s+(\d{1,2})\b(?!\s*[/-])/i, (m) => { const h = Number(m[1]); if (h < 1 || h > 23) return null; time = String((h < 7 ? h + 12 : h)).padStart(2, '0') + ':00'; return true; });
        let date = null;
        const set = (v) => { date = v; return Boolean(v); };
        take(/\s(\d{4})-(\d{2})-(\d{2})\b/, (m) => set(fix(Number(m[2]) - 1, Number(m[3]), Number(m[1]))))
          || take(/\s(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/i, (m) => set(fix(months.indexOf(m[1].toLowerCase().slice(0, 3)), Number(m[2]), m[3] ? Number(m[3]) : 0)))
          || take(/\s(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i, (m) => set(fix(months.indexOf(m[2].toLowerCase().slice(0, 3)), Number(m[1]), 0)))
          || take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => set(fix(Number(m[1]) - 1, Number(m[2]), m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : 0)))
          || take(/\s(today|tonight)\b/i, () => set(ymd(base)))
          || take(/\stomorrow\b/i, () => set(ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1))))
          || take(/\s(?:on\s+|next\s+|this\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i, (m) => { const want = days.indexOf(m[1].toLowerCase().slice(0, 3)); let ahead = (want - base.getDay() + 7) % 7; if (ahead === 0 || /next\s/i.test(m[0])) ahead = ahead === 0 ? 7 : ahead + (want > base.getDay() ? 7 : 0); return set(ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + ahead))); });
        if (date) out.date = date;
        if (time) out.time = time;
        out.title = t.replace(/\s+/g, ' ').trim().replace(/\s+(on|at|by|for|from)$/i, '').replace(/^(on|at|by)\s+/i, '').trim();
        if (!out.title) out.title = String(text || '').trim();
        return out;
      },
      parseYmd: (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); },
      // Places on the earth, for the modules that have them (a place, a map): coordinates checked and read, and the link
      // that opens a spot in the person's own maps app. Pure, so a check can run it without a browser.
      geo: (() => {
        const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        const round6 = (n) => Math.round(n * 1e6) / 1e6;
        // Text on one line, without control characters, at most `max` long.
        const oneLine = (s, max) => String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
        // A latitude or longitude typed in a field (`max` is 90 or 180): a number in range, or null.
        const coord = (text, max) => {
          const t = String(text == null ? '' : text).trim().replace(',', '.');
          if (!/^[-+]?\d{1,3}(\.\d+)?$/.test(t)) return null;
          const n = Number(t);
          return Math.abs(n) <= max ? n : null;
        };
        // What was typed or pasted: a pair of coordinates ("38.7075, -9.1364"), or a map link that carries them (a geo: link,
        // ?ll= or ?q= or ?mlat=&mlon=, /@lat,lng, #map=zoom/lat/lng, !3dLAT!4dLNG). { lat, lng } or null.
        const parsePoint = (text) => {
          const t = String(text == null ? '' : text).trim();
          if (!t) return null;
          const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
          const pair = (re) => {
            const m = t.match(re);
            if (!m) return null;
            const lat = Number(m[1]);
            const lng = Number(m[2]);
            return inRange(lat, lng) ? { lat: round6(lat), lng: round6(lng) } : null;
          };
          if (/^[-+]?\d/.test(t) && !/[a-z]/i.test(t)) return pair(new RegExp(`^${NUM}\\s*[,;\\s]\\s*${NUM}$`));
          return (
            pair(new RegExp(`^geo:${NUM},${NUM}`, 'i')) ||
            pair(new RegExp(`[?&](?:ll|q|query|center|sll)=${NUM}(?:,|%2C)\\s*${NUM}`, 'i')) ||
            pair(new RegExp(`[?&]mlat=${NUM}&(?:amp;)?mlon=${NUM}`, 'i')) ||
            pair(new RegExp(`!3d${NUM}!4d${NUM}`)) ||
            pair(new RegExp(`/@${NUM},${NUM}`)) ||
            pair(new RegExp(`#map=\\d{1,2}(?:\\.\\d+)?/${NUM}/${NUM}`))
          );
        };
        const fmt = (n) => (Math.round(n * 1e5) / 1e5).toFixed(5);
        // "38.70750, -9.13640"
        const coordsText = (lat, lng) => `${fmt(lat)}, ${fmt(lng)}`;
        // The link that opens a spot in the person's own maps app: the platform's own link on Apple devices (`apple`
        // true), a geo: link on Android, which hands it to the maps app, and an ordinary web link everywhere else. A
        // desktop browser has nothing registered for geo:, so it would open nothing (Windows shows a blank page).
        // Directions are that app's business.
        const android = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
        const mapsLink = (lat, lng, name, apple) => {
          const n = oneLine(name, 80).replace(/[()]/g, ' ');
          if (apple) return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(n || 'Place')}`;
          if (android()) return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(n || 'Place')})`;
          return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
        };
        // The same for a place with only a name or an address: the maps app searches for it.
        const mapsSearch = (text, apple) => {
          const q = encodeURIComponent(oneLine(text, 160));
          if (apple) return `https://maps.apple.com/?q=${q}`;
          if (android()) return `geo:0,0?q=${q}`;
          return `https://www.openstreetmap.org/search?query=${q}`;
        };
        return { inRange, round6, oneLine, coord, parsePoint, coordsText, mapsLink, mapsSearch };
      })(),
    },

    // Interface the modules share, drawn the same everywhere and following the theme.
    ui: {
      // A Font Awesome icon ("circle-right", style "solid", "regular" or "brands") as inline SVG text, coloured by
      // the text colour, for a module that cannot load the icon font. Resolves to the SVG, or rejects if there is no such icon.
      icon: (name, style) => call('icons.svg', { name, style: style || 'solid' }),
      // The files an object links to, drawn as the shared file chips (plan-attachments-vault.md, section 5; the Prototype's "In other modules"):
      // a type icon, the name and the size; a click opens the file window over the canvas (host.objects.open with the other chips' ids as
      // `list`, so Previous and Next walk them; one chip alone has none). A file that was removed reads "File removed", one whose bytes are
      // gone "File missing", one this person may not see "Not available to you" (the last three are muted and not links).
      //   host.ui.fileChips(container, pointers, { canEdit?, unlinkable?, live?, onOpen?(pointer), onRemoveLink?(pointer) }) -> { update(pointers), destroy() }
      // `canEdit` adds Remove link beside a removed or missing file, which calls onRemoveLink(pointer) (the module unlinks it with
      // host.files.unlink, updates its own list and calls update); with `unlinkable` as well, a file that is there gets Unlink too (an editor's
      // list). The chips look again by themselves when a file is renamed or removed (the 'library' event) and when links change, until the
      // container leaves the page; `live: false` turns that off. The container is cleared; pointers are checked, and only files are drawn.
      fileChips: (container, pointers, o) => {
        const opt = o || {};
        let list = [];
        let gen = 0;
        let dead = false;
        const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
        const icon = async (name) => { const span = make('span', 'ic sdk-file-chip-ic'); span.setAttribute('aria-hidden', 'true'); try { span.innerHTML = await menuIcon(name); } catch (err) { /* no icon */ } return span; };
        async function draw() {
          const mine = ++gen;
          const facts = list.length ? await resolveFiles(list).catch(() => list.map((ref) => ({ ref, state: 'hidden' }))) : [];
          if (dead || mine !== gen) return;
          const there = facts.filter((f) => !f.state);
          const ids = there.length > 1 ? there.map((f) => f.ref.id) : null;
          const rows = [];
          for (const f of facts) {
            const wrap = make('span', 'sdk-file-chipwrap');
            const state = f.state || 'ok';
            const chip = make(state === 'ok' ? 'button' : 'span', 'sdk-chip-tag sdk-file-chip');
            chip.dataset.state = state;
            if (state === 'ok') {
              chip.type = 'button';
              chip.append(await icon(f.icon), make('span', 'sdk-file-chip-name', f.name), make('span', 'sdk-file-chip-size', fileSize(f.size)));
              chip.setAttribute('aria-label', `${f.name}, ${fileSize(f.size)}. Open the file.`);
              chip.addEventListener('click', () => { if (typeof opt.onOpen === 'function') opt.onOpen(f.ref); else host.objects.open(f.ref, ids ? { list: ids } : undefined).catch((err) => host.ui.toast(err.message)); });
            } else if (state === 'removed') {
              chip.append(await icon('file-circle-xmark'), make('span', 'sdk-file-chip-state', 'File removed'));
            } else if (state === 'missing') {
              chip.dataset.tone = 'warn';
              chip.append(await icon('triangle-exclamation'), make('span', 'sdk-file-chip-name', f.name), make('span', 'sdk-file-chip-state', 'File missing'));
            } else {
              chip.append(await icon('lock'), make('span', 'sdk-file-chip-state', 'Not available to you'));
            }
            wrap.append(chip);
            if (opt.canEdit === true && (state === 'removed' || state === 'missing' || (state === 'ok' && opt.unlinkable === true))) {
              const remove = make('button', 'btn btn-small btn-quiet sdk-file-chip-remove', state === 'ok' ? 'Unlink' : 'Remove link');
              remove.type = 'button';
              if (state === 'ok') remove.setAttribute('aria-label', `Unlink ${f.name}`);
              remove.addEventListener('click', () => { if (typeof opt.onRemoveLink === 'function') opt.onRemoveLink(f.ref); });
              wrap.append(remove);
            }
            rows.push(wrap);
          }
          if (dead || mine !== gen) return;
          container.classList.add('sdk-file-chips');
          container.replaceChildren(...rows);
        }
        const set = (next) => { list = (Array.isArray(next) ? next : []).map(cleanRef).filter((r) => r && r.kind === 'file'); return draw(); };
        const offs = [];
        const again = () => {
          if (dead) return;
          if (!container.isConnected) { dead = true; for (const off of offs) off(); return; } // the module drew something else over it
          if (list.length) draw();
        };
        if (opt.live !== false) offs.push(host.on('library', again), host.on('links', again));
        set(pointers);
        return { update: set, destroy: () => { dead = true; for (const off of offs) off(); container.replaceChildren(); } };
      },
      // A short note that appears for a few seconds and goes: for an instant confirmation ("Saved in X.") or a small refusal. Never
      // draw one inline in the module. Resolves true; the text is cut to 200 characters.
      toast: (text) => call('ui.toast', { text: String(text ?? '') }).then(() => true),
      // A question the person answers, in place of the browser's own confirm (never call window.confirm). Drawn by the page, over
      // everything, as the styled confirm: a title, a plain message, Cancel and the action. Resolves true (the action) or false
      // (Cancel, Escape, a click outside); rejects only when it is asked badly (no title, an unknown kind) or the page did not answer.
      // host.ui.confirm({ title, message?, action?, cancel?, kind?, typed? }):
      //   title    the question, short ("Delete this place?"); message: one or two plain lines of what happens ("\n\n" starts a paragraph).
      //   action   the button's word ("Delete"; default "OK"); cancel: default "Cancel".
      //   kind     'plain' (default: the main button; easy to take back), 'destructive' (soft red, focus on Cancel) or
      //            'final' (cannot be undone: solid red, focus on Cancel).
      //   typed    with kind 'final': a name the person types before the action turns on.
      // Escape cancels; focus is held in the dialog and goes back to where it was.
      confirm: (o) => {
        const t = o && typeof o === 'object' ? o : {};
        if (typeof t.title !== 'string' || !t.title.trim()) return Promise.reject(Object.assign(new Error('say what is being asked (title)'), { status: 400 }));
        return call('ui.confirm', { title: t.title, message: t.message, action: t.action, cancel: t.cancel, kind: t.kind, typed: t.typed }).then((r) => r === true);
      },
      // A date picker for a date field: a small month grid under it, weekdays across the top, so the day a date
      // falls on is visible while choosing. The typed field keeps working; a button opens the grid and the
      // weekday of what is in the field shows under it. Works on <input type="date"> and
      // <input type="datetime-local"> (which keeps its time, or takes 12:00 when it has none).
      // datePicker(input, { range: () => [from, to], clearable, list: { label, items, none } }): highlight a span of days, and offer Clear.
      // The field is a .sdk-datefield: the input with the calendar button inside its trailing edge (a small quiet icon button; the Fields block of
      // system.css). In a .sdk-form it is also a .sdk-group and the weekday is the field's .sdk-hint.
      // `list` adds a second button (in a .sdk-form only) that opens the module's own list of days: items(set) returns host.menu.show
      // entries, an entry `{ label, day: 'YYYY-MM-DD' }` sets that day, `none: 'Unscheduled'` adds a first entry that clears the field.
      // Returns { close, destroy }.
      datePicker: (input, o) => {
        const options = o || {};
        const u = host.util;
        const inForm = Boolean(input.closest('.sdk-form'));
        const wrap = document.createElement('span');
        wrap.className = inForm ? 'sdk-datefield sdk-group' : 'sdk-datefield';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const icon = (d) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
        const mkBtn = (title, d) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'sdk-icon-btn btn-small btn-quiet';
          b.dataset.tip = title;
          b.setAttribute('aria-label', title);
          b.innerHTML = icon(d);
          wrap.appendChild(b);
          return b;
        };
        const btn = mkBtn('Pick a date', 'M4 0v2H2.5A1.5 1.5 0 0 0 1 3.5v10A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 13.5 2H12V0h-1.5v2h-5V0zM2.5 5h11v8.5h-11z');
        // The weekday: in a form, the field's hint slot (a .sdk-hint after the field's group, reused when the form has one); else the old line.
        const field = inForm ? wrap.closest('.sdk-field') : null;
        let hint = field ? field.querySelector(':scope > .sdk-hint') : null;
        const ownHint = !hint;
        if (!hint) {
          hint = document.createElement('span');
          hint.className = inForm ? 'sdk-hint' : 'tv-dow-hint';
          (field || wrap.parentNode).insertBefore(hint, wrap.nextSibling);
        }
        // `list: { label, items, none }`: a second button that opens the module's own list of days under the field (the Planner's
        // days by phase, the spots between days). items(set) gives host.menu.show entries; an entry with a `day` ('YYYY-MM-DD') sets
        // that day when chosen, one with `onClick` does its own. `none` (a word, "Unscheduled") adds a first entry that clears the field.
        // A list needs a .sdk-form field; elsewhere it is ignored.
        const listBtn = inForm && options.list && typeof options.list.items === 'function'
          ? mkBtn(options.list.label || 'Pick from the list', 'M2 3h12v1.6H2zm0 4.2h12v1.6H2zm0 4.2h12V13H2z') : null;
        const dayOf = () => String(input.value || '').slice(0, 10);
        const showDow = () => { hint.textContent = dayOf() ? u.parseYmd(dayOf()).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
        input.addEventListener('input', showDow);
        input.addEventListener('change', showDow);
        showDow();
        let pop = null;
        const close = () => { if (pop) pop.remove(); pop = null; document.removeEventListener('keydown', key, true); env.root.removeEventListener('pointerdown', away, true); };
        // Escape closes only the picker: stopped and prevented, so an editor window around it does not close too.
        const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
        const away = (e) => { if (pop && !pop.contains(e.target) && !wrap.contains(e.target)) close(); };
        // A disabled field (a read-only form) has no picker: the button is disabled with it and open() does nothing.
        const syncDisabled = () => { btn.disabled = Boolean(input.disabled); if (listBtn) listBtn.disabled = Boolean(input.disabled); };
        syncDisabled();
        const open = () => {
          if (pop) return close();
          if (input.disabled) return;
          const seed = dayOf() || u.ymd(new Date());
          let month = new Date(u.parseYmd(seed).getFullYear(), u.parseYmd(seed).getMonth(), 1);
          pop = document.createElement('div');
          pop.className = 'sdk-dp';
          pop.setAttribute('role', 'dialog');
          pop.setAttribute('aria-label', 'Choose a day');
          const draw = () => {
            const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
            const [from, to] = options.range ? options.range() : [];
            const today = u.ymd(new Date());
            let cells = '';
            for (let i = 0; i < 42; i += 1) {
              const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
              const k = u.ymd(d);
              cells += `<button type="button" class="sdk-dp-day${d.getMonth() !== month.getMonth() ? ' other' : ''}${k === today ? ' today' : ''}${k === dayOf() ? ' sel' : ''}${from && to && k >= from && k <= to ? ' inrange' : ''}" data-day="${k}">${d.getDate()}</button>`;
            }
            const monthName = u.esc(month.toLocaleDateString([], { month: 'long', year: 'numeric' }));
            const chevron = (d) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
            pop.innerHTML = `<div class="sdk-dp-head"><button type="button" class="sdk-icon-btn btn-quiet btn-small" data-dp="prev" aria-label="Previous month">${chevron('M10.7 1.9 4.6 8l6.1 6.1 1.4-1.4L7.4 8l4.7-4.7z')}</button><span class="sdk-dp-title">${monthName}</span><button type="button" class="sdk-icon-btn btn-quiet btn-small" data-dp="next" aria-label="Next month">${chevron('M5.3 1.9 11.4 8l-6.1 6.1-1.4-1.4L8.6 8 3.9 3.3z')}</button></div>
              <div class="sdk-dp-grid" role="group" aria-label="${monthName}">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => `<span class="sdk-dp-dow" aria-hidden="true">${n}</span>`).join('')}${cells}</div>
              <div class="sdk-dp-foot">${options.clearable ? '<button type="button" class="btn btn-quiet btn-small" data-dp="clear">Clear</button>' : '<span></span>'}<button type="button" class="btn btn-small" data-dp="today">Today</button></div>`;
          };
          pop.addEventListener('click', (e) => {
            e.stopPropagation();
            const set = (day) => {
              input.value = !day ? '' : input.type === 'datetime-local' ? day + 'T' + ((input.value.split('T')[1]) || '12:00') : day;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              close();
            };
            const day = e.target.closest('[data-day]');
            if (day) return set(day.dataset.day);
            const nav = e.target.closest('[data-dp]');
            if (!nav) return;
            if (nav.dataset.dp === 'prev') month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
            else if (nav.dataset.dp === 'next') month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
            else if (nav.dataset.dp === 'today') return set(u.ymd(new Date()));
            else if (nav.dataset.dp === 'clear') return set('');
            draw();
          });
          draw();
          // Inside an open editor window (host.ui.editor) the popover goes into the dialog and is kept inside the window.
          const editor = editorAt(input);
          (editor || (env.root === document ? document.body : env.root)).appendChild(pop);
          // Under the field, by the page's coordinates, kept on screen.
          const r = input.getBoundingClientRect();
          const box = editor ? { left: 0, top: 0 } : env.rootElement.getBoundingClientRect();
          const w = editor ? window.innerWidth : env.rootElement.clientWidth || 400;
          let top = r.bottom + 4;
          if (editor && top + pop.offsetHeight > window.innerHeight - 4) top = Math.max(4, r.top - pop.offsetHeight - 4);
          pop.style.top = top + 'px';
          pop.style.left = box.left + Math.max(editor ? 4 : 8, Math.min(r.left - box.left, w - pop.offsetWidth - (editor ? 4 : 8))) + 'px';
          document.addEventListener('keydown', key, true);
          env.root.addEventListener('pointerdown', away, true);
        };
        btn.addEventListener('click', open);
        const setDay = (day) => {
          input.value = !day ? '' : input.type === 'datetime-local' ? day + 'T' + ((input.value.split('T')[1]) || '12:00') : day;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        if (listBtn) {
          listBtn.addEventListener('click', () => {
            if (input.disabled) return;
            close();
            const raw = options.list.items(setDay) || [];
            const entries = raw.map((e) => (e && e.day !== undefined && !e.onClick ? { ...e, onClick: () => setDay(e.day) } : e));
            if (options.list.none) entries.unshift({ id: 'none', label: String(options.list.none), icon: 'xmark', onClick: () => setDay('') });
            host.menu.show({ id: 'sdk-datelist', anchor: listBtn, items: entries });
          });
        }
        return { close, refresh: () => { close(); showDow(); syncDisabled(); }, destroy: () => { close(); if (ownHint) hint.remove(); wrap.parentNode.insertBefore(input, wrap); wrap.remove(); } };
      },
      // An editor window: the module's Add or Edit form, a <dialog> in its root, shown modal over everything (the top
      // layer: above every module and the header, never clipped by the module's box), 560 px wide ('medium', the default)
      // or 880 px ('large'), a full-screen sheet on a phone. The SDK adds a Close button in its corner; Escape or Close
      // asks "Discard your changes?" when `isDirty()` says true. A click outside does nothing. The dialog scrolls; a
      // button row marked `sdk-editor-actions` sticks to its bottom. The module's own popovers (host.menu.show, the date
      // picker, host.actions.pick) open inside it. Styles in /sdk/host.css.
      //   editor(dialog, { size, isDirty, onClose }) -> { open({ focus, returnTo }), close(), cancel(), isOpen, element }
      //   close(): after a save, at once. cancel(): the module's own Cancel button; asks "Discard your changes?" first
      //   when isDirty() says so. onClose(reason): 'cancel' (Escape, Close, Cancel, Discard) or 'done' (close()).
      //   open() a second time only moves focus.
      //   returnTo: an element, or a function giving one, focused on close (a microtask after onClose, so a list the
      //   module redraws then is the one searched; else what had focus before, else the module).
      // Anything but a <dialog> throws "host.ui.editor needs a <dialog> element".
      editor: (dialogEl, o) => createEditor(dialogEl, o, editorDeps),
      // A kind picker: one row (--bar-control-h tall) naming the chosen kind of thing with its icon in its colour on a chip,
      // a chevron at its end; a click, typing, Down or Alt+Down opens the list of kinds in their groups, each with its icon
      // and colour, recently chosen first; typing filters by name and `words` (the start of any word). The ARIA combobox
      // pattern: Up and Down move, Home and End jump, Enter or Tab chooses, Escape closes only the list. A sheet on a phone.
      // Inside an open editor window the list goes into the dialog. Styles in /sdk/host.css (.sdk-kind).
      //   kindPicker(el, { label, groups: [{ label, options: [{ id, label, icon, color, words }] }], value, recent: { key, max }, onChange })
      //   -> { value, set(id), setGroups(groups), remember(id), disabled, focus(), open(), close(), element, input, destroy() }
      //   `color` any CSS colour (set as --kind-color). `recent` keeps the choices in this browser for this module, as
      //   host.actions.pick's remember does; `start: 'recent'` starts on the kind chosen last in this browser when there
      //   is one, else on `value`. set() chooses without onChange; onChange(id) fires for a person's choice of a different kind.
      //   A `value` or set() id that is not in the groups shows an empty field saying "Unknown kind", never another kind;
      //   setGroups() dropping the chosen kind reports it as onChange(value). remember(id) records a kind as recently used.
      // Anything but an element throws "host.ui.kindPicker needs an element".
      kindPicker: (el, o) => createKindPicker(el, o, editorDeps),
      // A currency choice in a <select> the module already has: "Common" then "All currencies" by name, from the codes the
      // server takes (host.locale().currencies), with the current value kept and selected even when the server would not
      // take it now. currencySelect(select, { value, empty, onChange, currencies }): `currencies` overrides the server's list (a page that has its own); `empty` true adds a first "" choice labelled
      // "Default (<the server's currency>)", or give the label as text; onChange(code) on each change ("" for the default).
      // Call it once ready has resolved. Returns { set(value), value, destroy() }; set() refills with that value selected.
      currencySelect: (select, o) => {
        const options = o || {};
        const fill = (value) => {
          const loc = locale();
          const empty = options.empty === true ? `Default (${loc.currency || 'USD'})` : options.empty;
          return fillCurrencySelect(select, { value, currencies: options.currencies || loc.currencies, empty });
        };
        fill(options.value);
        const changed = () => { if (typeof options.onChange === 'function') options.onChange(select.value); };
        select.addEventListener('change', changed);
        // A person sees the kind picker's field and list (a styled, searchable list: the Pickers family); the select stays in the
        // form, hidden, as the value (it is what the module reads and the form sends), and a choice sets it and sends `change`.
        const doc = select.ownerDocument;
        const groupsOf = () => [...select.children].map((n) => (n.tagName === 'OPTGROUP'
          ? { label: n.label, options: [...n.children].map((x) => ({ id: x.value, label: x.textContent })) }
          : { label: '', options: [{ id: n.value, label: n.textContent }] }));
        let quiet = false; // set() chooses without telling the module, as filling the select always did
        const box = doc.createElement('div');
        select.after(box);
        select.hidden = true;
        const field = select.closest('label, .sdk-field');
        const name = ((field && field.querySelector('.sdk-label') && field.querySelector('.sdk-label').textContent) || select.getAttribute('aria-label') || 'Currency').trim();
        const picker = createKindPicker(box, {
          label: name,
          groups: groupsOf(),
          value: select.value,
          onChange: (id) => { if (quiet) return; select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); },
        }, editorDeps);
        picker.disabled = select.disabled;
        const watch = typeof MutationObserver === 'function' ? new MutationObserver(() => { picker.disabled = select.disabled; }) : null;
        if (watch) watch.observe(select, { attributes: true, attributeFilter: ['disabled'] });
        return {
          set: (value) => { quiet = true; try { fill(value); picker.setGroups(groupsOf()); picker.set(select.value); } finally { quiet = false; } },
          get value() { return select.value; },
          destroy: () => { select.removeEventListener('change', changed); if (watch) watch.disconnect(); picker.destroy(); box.remove(); select.hidden = false; },
        };
      },
      // A time field that follows the environment's clock (host.locale().clock: 12 or 24 hours) instead of the browser's own, on an
      // <input type="time"> the module already has. The input becomes a text field that shows "10:30 PM" or "22:30" and reads what is
      // typed ("1030", "10:30 pm", "7p", "22:30"); input.value stays "HH:MM" in 24 hours ('' when empty), set or read, so a module's
      // stored values and code do not change. Up and Down move by `step` minutes (5; PageUp and PageDown by an hour), Enter and leaving
      // the field accept what was typed, Escape puts back the last good time (and only then; with nothing to put back it goes on to
      // close the window around it). Text that is not a time is '' and aria-invalid; a time outside min or max is aria-invalid too.
      // `input` and `change` fire once per accepted time, never per typed letter. 44px tall and 16px on a touch screen.
      // The accessible name is the field's <label> (kept live) or `label`.
      //   timeField(input, { label?, min?, max?, step?, onChange? }) -> { value, set(hhmm), min, max, focus(), refresh(), destroy() }
      // `refresh()` redraws the shown time (call it if the clock setting changes while a form is open). Anything but an input throws
      // "host.ui.timeField needs an <input>".
      timeField: (input, o) => {
        if (!input || input.nodeType !== 1 || input.tagName !== 'INPUT') throw new Error('host.ui.timeField needs an <input>');
        const options = o || {};
        const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        const clean = (v) => { const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(v ?? '').trim()); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
        let min = clean(options.min !== undefined ? options.min : input.getAttribute('min'));
        let max = clean(options.max !== undefined ? options.max : input.getAttribute('max'));
        const step = Number.isFinite(options.step) && options.step >= 1 ? Math.min(Math.round(options.step), 720) : 5;
        let value = clean(native.get.call(input));
        let bad = false;
        let internal = false;
        const clock = () => (locale().clock === '24' ? '24' : '12');
        input.removeAttribute('min');
        input.removeAttribute('max');
        input.type = 'text';
        input.classList.add('sdk-timefield');
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('autocapitalize', 'off');
        if (options.label) input.setAttribute('aria-label', String(options.label));
        else if (!input.closest('label') && !(input.labels && input.labels.length) && !input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby')) input.setAttribute('aria-label', 'Time');
        const show = () => {
          input.placeholder = clock() === '24' ? 'HH:MM' : 'h:mm AM';
          native.set.call(input, clockText(value, clock()));
        };
        const judge = () => {
          const out = Boolean(value) && ((min && value < min) || (max && value > max));
          if (bad || out) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
          input.setCustomValidity(bad ? 'Type a time, like 10:30' : out ? 'That time is outside the allowed hours' : '');
        };
        const fire = () => {
          internal = true;
          try {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } finally { internal = false; }
          if (typeof options.onChange === 'function') options.onChange(value);
        };
        // Accept what is in the field: a time, or '' (empty is allowed; text that is not a time is '' and flagged).
        const commit = () => {
          const text = native.get.call(input).trim();
          const next = text ? parseClockText(text, clock(), value) : '';
          bad = Boolean(text) && !next;
          const changed = next !== value;
          value = next;
          if (!bad) show();
          judge();
          if (changed) fire();
        };
        const minutesOf = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
        const nudge = (by) => {
          commit();
          const from = value ? minutesOf(value) : min ? minutesOf(min) - by : 12 * 60 - by;
          const t = (((from + by) % 1440) + 1440) % 1440;
          value = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
          bad = false;
          show();
          judge();
          fire();
        };
        const onInput = (e) => { if (!internal) e.stopImmediatePropagation(); }; // typing is not a change until it is accepted
        const onChange = (e) => { if (!internal) { e.stopImmediatePropagation(); commit(); } };
        const onKey = (e) => {
          if (input.disabled || input.readOnly) return;
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); nudge((e.key === 'ArrowUp' ? 1 : -1) * step); } else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); nudge(e.key === 'PageUp' ? 60 : -60); } else if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            if (native.get.call(input) === clockText(value, clock()) && !bad) return; // nothing to put back: Escape goes on (closes the window)
            e.preventDefault();
            e.stopPropagation();
            bad = false;
            show();
            judge();
          }
        };
        const onBlur = () => commit();
        input.addEventListener('input', onInput, true);
        input.addEventListener('change', onChange, true);
        input.addEventListener('keydown', onKey);
        input.addEventListener('blur', onBlur);
        // The module sets and reads input.value as it did on a time input: "HH:MM" in, "HH:MM" out.
        Object.defineProperty(input, 'value', {
          configurable: true,
          get: () => value,
          set: (v) => { value = clean(v); bad = false; show(); judge(); },
        });
        show();
        judge();
        return {
          get value() { return value; },
          set: (v) => { input.value = v; },
          get min() { return min; },
          set min(v) { min = clean(v); judge(); },
          get max() { return max; },
          set max(v) { max = clean(v); judge(); },
          focus: () => input.focus(),
          refresh: show,
          destroy: () => {
            input.removeEventListener('input', onInput, true);
            input.removeEventListener('change', onChange, true);
            input.removeEventListener('keydown', onKey);
            input.removeEventListener('blur', onBlur);
            delete input.value;
            input.type = 'time';
            native.set.call(input, value);
            input.classList.remove('sdk-timefield');
            input.removeAttribute('aria-invalid');
            input.setCustomValidity('');
          },
        };
      },
      // A view or filter switch, drawn in the toolbar (see host.toolbar.set) -- its most common tool, so
      // this is the one built for every module rather than each writing its own diffing and event wiring.
      // { id, options: [{ id, label?, icon?, regular?, iconOnly? }], value, onChange }: an option needs a
      // label, an icon, or both (see host.toolbar.set's 'tabs' item for what each does). Draws once, then
      // only redraws when the value or the options actually change (call set() every render; it no-ops
      // when nothing did). Returns { set(value, options?), destroy() }.
      // A module may have more than one (whose items, and how they are laid out): every live switch shares the
      // toolbar, drawn in the order they were made, and any one changing redraws the row.
      // Each choice shows its icon and its word, and only its icon while the switch's row is too narrow for the words
      // (the word stays its tooltip and accessible name); a choice with no icon always shows its word.
      // The switch is always in the toolbar: the host draws that row wherever the module is drawn.
      viewSwitch: ({ id, options, value, onChange }) => {
        let current = value;
        let opts = options;
        const off = host.on('toolbar', (e) => {
          if (e.id !== id) return;
          current = e.value;
          onChange(e.value);
        });
        const mine = { item: () => ({ type: 'tabs', id, value: current, options: opts }) };
        switches.push(mine);
        drawSwitches();
        return {
          set(newValue, newOptions) {
            current = newValue;
            if (newOptions) opts = newOptions;
            drawSwitches();
          },
          destroy: () => {
            off();
            const at = switches.indexOf(mine);
            if (at >= 0) switches.splice(at, 1);
            drawSwitches();
          },
        };
      },
      // A button in the same toolbar row as the view switches (a chooser that opens a menu, say: Research's Tags),
      // drawn after the switches made before it. { id, label?, icon?, iconOnly?, on?, onClick }. onClick gets the
      // 'toolbar' event, whose `x` (when the host gives it) puts a menu under the button: host.menu.show({ at: { x, y: 4 } }).
      // Returns { set({ label?, icon?, on? }), destroy() }; set() redraws only when something changed.
      // The shared "..." button (ellipsis-vertical, icon centered): a card's menu, a day's, a poll's, a
      // place's. Pass a button you already have (its data-action and listeners stay); omit it to make one.
      // { label } is the accessible name (defaults to the button's aria-label, or "More").
      moreButton: (el, o) => {
        const btn = el && el.nodeType === 1 ? el : document.createElement('button');
        btn.type = 'button';
        btn.classList.add('sdk-icon-btn', 'btn-quiet', 'btn-small');
        const label = String((o && o.label) || btn.getAttribute('aria-label') || 'More');
        if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', label);
        if (!btn.dataset.tip) btn.dataset.tip = label;
        btn.setAttribute('aria-haspopup', 'menu');
        if (!btn.querySelector('[data-icon], .ic, i, svg')) {
          const ic = document.createElement('span');
          ic.className = 'ic';
          ic.setAttribute('aria-hidden', 'true');
          menuIcon('ellipsis-vertical').then((svg) => { if (svg) ic.innerHTML = svg; });
          btn.appendChild(ic);
        }
        return btn;
      },
      toolbarButton: ({ id, label, icon, iconOnly, on, onClick }) => {
        let state = { label, icon, iconOnly: Boolean(iconOnly), on: Boolean(on) };
        const off = host.on('toolbar', (e) => {
          if (e.id === id && typeof onClick === 'function') onClick(e);
        });
        const mine = { item: () => ({ type: 'button', id, ...(state.iconOnly && state.icon ? { label: '', title: state.label } : { label: state.label }), icon: state.icon, on: state.on }) };
        switches.push(mine);
        drawSwitches();
        return {
          set(next) {
            state = { ...state, ...(next || {}) };
            drawSwitches();
          },
          destroy: () => {
            off();
            const at = switches.indexOf(mine);
            if (at >= 0) switches.splice(at, 1);
            drawSwitches();
          },
        };
      },
    },

    // Whether the viewer has one of this module's own permissions (by its
    // short key in module.json, such as "edit").
    can: (permission) => Boolean(info && info.permissions && info.permissions[permission]),

    get user() {
      return info && info.user;
    },
    // { scope, spaceId, environment: { name }, destination? }: `environment.name` is the environment's name as its header
    // shows it ('' when unknown), for naming the environment's own list (a keyed page has none).
    get context() {
      return info && info.context;
    },

    storage: {
      get: (key, o) => call('storage.get', { key, ...opts(o) }),
      // set(key, value, { version }) -- pass the version you read to detect a
      // change made since; a conflict rejects with error.status 409 and
      // error.current holding what is stored now.
      // `tz`: the time zone the value's clock times are in (an IANA name), when it is not the person's own.
      set: (key, value, o) => call('storage.set', { key, value, version: o && o.version, ...(o && typeof o.tz === 'string' ? { tz: o.tz } : {}), ...opts(o) }),
      delete: (key, o) => call('storage.delete', { key, version: o && o.version, ...opts(o) }),
      list: (prefix, o) => call('storage.list', { prefix: prefix || '', ...opts(o) }),
    },

    // The spaces the viewer belongs to that have this module on, on a module's environment page:
    // [{ id, name, icon, svg }] (`svg` is the space's icon as inline SVG, since a module cannot
    // load the icon font). Read stored data across them with storage.list(prefix, { scope: 'spaces' }),
    // which returns each item with its `spaceId`; 'change' events for those spaces carry `spaceId` too.
    spaces: () => call('spaces'),
    // The space this module is open in: { id, name, createdAt, phases }, or null on an environment page or a keyed page.
    // `phases` is the dates set on the space's timeline, { <id>: { start?, end? } } ({} while none; the template's phases
    // themselves are host.phases(), the rule public/phases.js). Answered from the hello, so it is there once host.ready()
    // has resolved. `budget` is the space's budget target, { amount, currency? } (set by an owner in Set up; `currency`
    // absent means the module's own currency), or null while none is set (always null for a guest); kept current, and
    // host.on('space', fn) hears ({ budget }) when it changes. A module that reads it says `"budget": true` in its
    // module.json, so Set up offers the target while it is on.
    space: () => (info && info.space) || null,
    // Facts about the environment this module is in, answered from the hello, so they are there once host.ready() has
    // resolved. `pictureMap`: while the owner has set a picture map (an invented world drawn from a picture, Maps'
    // "Picture map" setting), { file, minZoom, maxZoom, tileType } -- `file` is the PMTiles file's name in the module's
    // `image-map` folder, read with host.files.url(file, { folder: 'image-map' }); else null. Every module is told, so
    // one that shows real-world things (a place search, a link to a maps app) can leave them out on an invented world.
    // An object, not a function: `host.environment.pictureMap`. { pictureMap: null } until the hello has answered. Live:
    // when the owner sets, replaces or clears the picture map, this answers the new value and host.on('environment', fn)
    // hears it ({ pictureMap }), so a module redraws what depends on it without a reload.
    get environment() { return { pictureMap: (info && info.environment && info.environment.pictureMap) || null }; },
    // The environment's template's phases, [{ id, label, main? }], or [] when it has none. Live: a template edit
    // is in the next hello. Answered from the hello, so it is there once host.ready() has resolved.
    phases: () => (info && Array.isArray(info.phases) ? info.phases : []),
    // The main phase's end moved later to cover `day` (YYYY-MM-DD), every later boundary shifted with it (POST
    // /api/spaces/:id/phases/cover; plan-one-bar.md step 2), for anyone with write in a module on in this space.
    // Resolves with the space's new phases, or null when nothing moved (the day is covered already, is before the
    // main phase, or the main phase has no start). host.space().phases is kept current.
    phasesCover: async (day) => {
      const result = await call('phases.cover', { day });
      const phases = result && result.phases && typeof result.phases === 'object' ? result.phases : null;
      if (phases && info && info.space) info.space.phases = phases;
      return phases;
    },

    // The space's budget target, for a module that reads it (`"budget": true` in its module.json). `can()` resolves true when
    // this person may change the target: the space's owner, the admin, or a moderator of this space (false for everyone
    // else, a guest included, and outside a space). `set({ amount?, currency? })` saves it and resolves with the target the
    // server kept (host.space().budget is current and 'space' is heard); `set(null)` clears it. The server replaces the
    // WHOLE target with what it is sent, so a currency sent alone drops the stored amount: send the amount with it. A refusal
    // rejects with the server's sentence.
    budget: {
      can: async () => (await call('budget.can')) === true,
      // Whether another module that reads the budget target (it says `"budget": true`) is on in this space and open to this
      // person. The Planner uses it to step its own money aside for the module that pulls its costs in. Never names a module.
      elsewhere: async () => (await call('budget.elsewhere')) === true,
      set: async (target) => {
        if (target === undefined) throw new Error('say the target, or null to clear it');
        const kept = await call('budget.set', { budget: target });
        if (info && info.space) info.space.budget = kept && typeof kept === 'object' ? kept : null;
        return kept && typeof kept === 'object' ? kept : null;
      },
    },

    // Files an admin placed for this module (a `file` setting names one). `url(name)` is the address to read it from,
    // range requests included, for a module running in the page (a frame cannot fetch).
    // `url(name, { folder })`: pass the setting's folder too when two of the module's folders could hold the same name
    // (Maps' picture map is in `image-map`, its map data in `map-tiles`).
    // `open(pointer, { list, name })` opens a library file (the Vault's, a pointer of kind `file`) in a file window over the page (the
    // app's own viewer; several can be open, at most four). `list` is the ids of the files to walk with Previous and Next, in the order
    // to walk them (the Vault's list as filtered); without it the window has no Previous and Next. It answers true when a window
    // opened or came forward, false at the cap (the person is told). It refuses (status 403) a pointer to a file in another space than this
    // module's own, and a module that is not the library itself unless its manifest consumes the file kind and an owner approved it. When the window closes, focus returns to the module's frame
    // and the module hears the event 'fileclosed' ({ id }), so it can put focus back on what opened the file.
    files: {
      url: (name, o) => call('files.url', { name, ...(o && o.folder ? { folder: o.folder } : {}) }),
      open: (pointer, o) => call('files.open', { ref: pointer, list: o && o.list, name: o && o.name }),
      // Files of the space's library (the Vault; plan-attachments-vault.md, sections 4 and 5), for a module that links its objects to
      // them. The module's manifest consumes the file kind (`"vault:file"` or `"*"`) and an owner approved it, as for any object; a
      // module that was not approved is refused (403) and finds, resolves and links nothing. Nothing here names the library module.
      //
      //   pick({ multiple?, title? }) -> pointers[]   The object picker, kept to files: search, tick, Pick. Resolves the chosen
      //                                               pointers ([] when the person cancels; at most one without `multiple`). Rejects with
      //                                               "There is no Vault in this {space}." when no library is on here for this module.
      //   link(object, pointers)   Add files to what the object points at (`object` from host.objects.make()), whatever else it points at.
      //   unlink(object, pointers) Take them out. Both go through host.objects.setLinks, so "Where it is used" (the Vault's Remove
      //                            question, host.library.uses) comes from them. The module keeps its own list of the pointers it shows.
      //   resolve(pointers) -> [{ ref, name, group, type, size, icon, viewable?, state? }]  in the same order. `state` is 'removed' (the file is
      //                            gone: its link stays and reads "File removed"), 'missing' (its bytes are gone: "File missing"),
      //                            'hidden' ("Not available to you"); without it the file is there. Only `ref` and `state` for the last two.
      //   open(pointer, { list })  (above) -- also what host.objects.open does for a file pointer.
      pick: async (o) => {
        const t = o && typeof o === 'object' ? o : {};
        const kinds = await call('objects.kinds', {});
        if (!Array.isArray(kinds) || !kinds.some((k) => k && k.kind === 'file')) throw Object.assign(new Error(`There is no Vault in this ${locale().words.space.one}.`), { status: 404 });
        const got = await host.objects.pick({ kinds: ['file'], multiple: t.multiple === true, title: t.title === undefined ? 'Add a file' : String(t.title).slice(0, 120) });
        const list = got === null || got === undefined ? [] : Array.isArray(got) ? got : [got];
        return list.map(cleanRef).filter((r) => r && r.kind === 'file');
      },
      link: (object, pointers) => fileLinks(object, pointers, 'add'),
      unlink: (object, pointers) => fileLinks(object, pointers, 'remove'),
      resolve: (pointers) => resolveFiles(pointers),
    },

    // AI, asked of the server (declare the `ai` hook; the admin approves it like the others). The admin chooses the service and
    // keeps its key on the server; a page never sees either. `available()` -> { available, why } (say why a button is hidden);
    // `ask({ task, question, objects })` where task is 'summarise', 'ask' or 'tags' and objects are pointers ({ module, kind, scope, id }),
    // read by the server as the person asking. Answers: { text, summaries, used, tags, tokens }. `text` holds the model's words with a
    // line {{summary:0}} where each summary goes; `summaries` are checked ({ icon, title, content, tags, place, date, links, sources },
    // sources as pointers). Nothing is kept by the server. The model has no tools and nothing it says is run.
    ai: {
      available: () => call('ai.available'),
      ask: (o) => {
        // The hard break (plan-names step 7): the pointers are `objects`; `items` is refused, never translated.
        if (o && o.items !== undefined) return Promise.reject(Object.assign(new Error('host.ai.ask: "items" is an old name; use objects'), { status: 400 }));
        return call('ai.ask', { task: o && o.task, question: o && o.question, objects: o && o.objects });
      },
    },

    // The person's own other calendars (declare the `external` hook; the admin approves it like the others). Each person
    // adds theirs on Profile by a private address; the server reads them and keeps the events in memory. Read only, and
    // only ever the signed-in person's own: never store them, publish them or send them anywhere.
    //   events({ from, to })  from and to as YYYY-MM-DD (or ISO times), either optional ->
    //                         { calendars: [{ id, name }], events: [{ calendar, uid, title, start, end, allDay }] }
    //                         An all-day event's start and end are YYYY-MM-DD, `end` its last day; a timed event's are ISO
    //                         times, `end` possibly null. A repeating event comes once per occurrence, with the same uid.
    //                         A guest, or the environment's switch off: both lists empty.
    // The 'external' event (host.on('external', fn)) says they changed: ask again.
    external: {
      events: (o) => call('external.events', { from: o && o.from, to: o && o.to }),
    },

    // Ask in Chat on a space's canvas: posts a private /ai question (the reply shows only to the person who asked).
    // `refs` are optional objects the answer may use, the same pointers host.ai.ask takes as `objects`. With a ref and no
    // question (`question: ''`) the server asks its own: What should I know about <the object's title>?
    //   available()  -> { available }   false off a space's canvas (a module's own page), where ask rejects: hide the button there.
    chat: {
      available: () => call('chat.available', {}),
      ask: (o) => call('chat.ask', { question: o && o.question, refs: o && o.refs }),
    },

    // Pictures people add (a module declares `uploads` in module.json). The server checks each from its own bytes and takes out
    // what rides along (text, thumbnails, maker notes); a photo's position is dropped unless `keepPosition` is true. Make the
    // picture the size you want first (about 2000 px on the long edge) and a thumbnail (about 400 px) in the page.
    //   put(blob, { name, keepPosition, scope })  -> { id, name, type, size, by, at, taken, camera, hasPosition, position, hasThumb }
    //   thumb(id, blob, { scope })                the thumbnail for a file you put
    //   list({ scope }), remove(id, { scope }), url(id, { thumb, scope })  (the address to use as an <img> source)
    // `hasPosition` says the photo carried one, so you can offer to keep it (put it again with keepPosition). Remove a file when
    // you remove the object that shows it.
    uploads: {
      put: (file, o) => call('uploads.put', { file, name: o && o.name, keepPosition: !!(o && o.keepPosition), scope: o && o.scope }),
      inspect: (file, o) => call('uploads.inspect', { head: file, scope: o && o.scope }), // -> { type, taken, camera, hasPosition, position }: read before you resize, which loses them
      thumb: (id, file, o) => call('uploads.thumb', { id, file, scope: o && o.scope }),
      list: (o) => call('uploads.list', { scope: o && o.scope }),
      remove: (id, o) => call('uploads.remove', { id, scope: o && o.scope }),
      url: (id, o) => call('uploads.url', { id, thumb: !!(o && o.thumb), scope: o && o.scope }),
    },

    // A library's files (a module that declares `library: true`, the Vault; plan-attachments-vault.md): the space's files, kept by the
    // server, each checked from its own bytes. All in the space the frame is in.
    //   list()                       -> { files: [{ id, name, type, group, size, by, at, taken?, hasThumb, uses, viewable? }], usage: { bytes, maxBytes } }
    //       `viewable: false` is only on a PDF kept as download only (the server could not check it): never open it in the
    //       app, show "This PDF can't be opened here. Download it." with download(id). Every other file has no `viewable`.
    //   add(blob, { name, keepPosition, onProgress })  -> the file. `onProgress({ loaded, total })` while it is sent; the promise has `.cancel()`.
    //       A picture keeps where it was taken only when `keepPosition` is true. Rejects with the server's sentence (a type or limit refused).
    //   rename(id, name), remove(id), uses(id) -> { uses: [summary], hidden }, thumb(id, blob) (the small picture you made, of at most 300 KB)
    //   url(id, { thumb, download }) the address; blob(id, { thumb }) -> a Blob of the file or its small picture.
    //       A PDF is never shown from its address (it is always sent as a download): blob(id) its bytes and hand them to
    //       the app's PDF viewer (GET /viewer/pdf in a sandboxed frame; its protocol is at the top of
    //       public/sdk/pdf-viewer.mjs) as { type: 'open', data: await blob.arrayBuffer() }. blob(id) of a download-only
    //       PDF rejects with status 404: check `viewable` first.
    //   download(id)                 the host saves the file (a frame cannot start a download itself); needs `download`
    //   share([id])                  opens the share sheet over the page for these files (the person needs the `share` permission);
    //       Make link shows the address once, with Copy. Resolves when the sheet is up; the module hears 'sharechanged' when a link
    //       is made, changed or turned off, and asks list() again (each file then has `shared: true|false`, for people with `share`).
    //   shares()                     opens the list of the space's share links over the page (Turn off, Edit, Choose files);
    //       the module hears 'sharechoose' when the person presses Choose files there (start choosing files).
    library: {
      list: () => call('library.list'),
      add: (file, o) => {
        const opts = o || {};
        const token = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
        const off = typeof opts.onProgress === 'function' ? host.on('libraryprogress', (e) => { if (e && e.token === token) opts.onProgress({ loaded: e.loaded, total: e.total }); }) : null;
        const out = call('library.add', { file, name: opts.name, keepPosition: Boolean(opts.keepPosition), token }).finally(() => { if (off) off(); });
        out.cancel = () => { call('library.cancel', { token }).catch(() => {}); };
        return out;
      },
      rename: (id, name) => call('library.rename', { id, name }),
      remove: (id) => call('library.remove', { id }),
      uses: (id) => call('library.uses', { id }),
      thumb: (id, blob) => call('library.thumb', { id, file: blob }),
      url: (id, o) => call('library.url', { id, thumb: Boolean(o && o.thumb), download: Boolean(o && o.download) }),
      blob: (id, o) => call('library.blob', { id, thumb: Boolean(o && o.thumb) }),
      download: (id) => call('library.download', { id }),
      share: (ids) => call('library.share', { ids }),
      shares: () => call('library.shares'),
    },

    // The module's settings, as chosen for this viewer here: { key: value }, with the module's own default for what
    // nobody has chosen. Declared in module.json (`settings`); the host draws the forms (an owner's for the environment, a
    // space's moderators' for a space, each person's own) and keeps the values. `onChange(fn)` calls fn(values) when any of
    // them changes.
    settings: {
      get: () => call('settings.get'),
      onChange: (fn) => host.on('settings', () => call('settings.get').then(fn).catch(() => {})),
    },

    // Place search, asked of the server (for a module whose manifest declares `geocoder`). `search(q, near)` answers
    // { results: [{ key, title, sub, lat, lng, from }], configured, credit }; `used(key)` marks a result as picked.
    geocode: {
      search: (q, near) => call('geocode.search', { q, lat: near && near.lat, lon: near && near.lon }),
      used: (key) => call('geocode.used', { key }),
    },

    // Lookups asked of the server (for a module whose manifest declares `"lookups": ["flight"]`):
    //   flight(number, date)        -> { flights: [{ object, line, sameWeekday, lastSeen }] }, empty when nothing is known;
    //                                  throws with the server's error ("bad number", "bad date", or the limit's sentence)
    //   airport(code)               -> { code, name, city, tz }, or null when there is no such airport
    //   available('flight')         -> true or false (false when the environment turned the suggestions off, or on any failure)
    //   remember('flight', object)  a saved flight, in the objects format, taught to the server's schedule; never throws
    lookup: {
      flight: (number, date) => call('lookup.flight', { number, date }),
      airport: (code) => call('lookup.airport', { code }),
      available: (kind) => call('lookup.available', { kind: kind || 'flight' }).then((r) => r === true, () => false),
      remember: (kind, object) => call('lookup.remember', { kind: kind || 'flight', object }).then(() => undefined, () => undefined),
    },

    // A page's title, description and image, read by the server for a link someone is adding. Answers
    // { enabled, title, description, image }. `enabled` is false until the module's link previews setting is on.
    preview: {
      link: (url) => call('preview.link', { url }),
      image: (url) => call('preview.image', { url }),
    },

    // The people of the space this module is in: [{ key, name }] (empty outside a space's canvas). For choosing a person
    // ("whose is it"): store their `key`, never the name.
    people: () => call('people'),

    // Who is online right now, everyone, for a page that follows people (a keyed page about one of them):
    // { people: [{ key, name, online, space, aside, asidePrivate, elsewhere, inCall, isOwner }], spaces: [{ id, name }],
    //   asides: [{ id, origin, private }], activeSpace, ownerOnline, reactions: [{ id, glyph }] }.
    // A person's place is as this viewer may know it: `space` is a space or aside they share with the viewer, else null;
    // `aside` is true while they are in an aside (`space` is then the aside's id, or the space it came out of), and
    // `asidePrivate` whether that aside is a private conversation (never with whom);
    // `elsewhere` is true when they are online somewhere the viewer is not told of. `activeSpace` may be null.
    // An aside's `origin` is the space it came out of.
    // `onChange(fn)` asks every 5 seconds (`{ every }` in ms to change that) and calls fn(presence) when anything
    // differs, once at the start; it returns a function that stops asking.
    presence: {
      get: () => call('presence.get'),
      onChange: (fn, o) => {
        let last = '';
        let on = true;
        const tick = async () => {
          if (!on) return;
          try {
            const p = await call('presence.get');
            const sig = JSON.stringify(p);
            if (sig !== last) {
              last = sig;
              fn(p);
            }
          } catch {
            // the next tick asks again
          }
        };
        tick();
        const timer = setInterval(tick, (o && o.every) || 5000);
        return () => { on = false; clearInterval(timer); };
      },
    },

    // One person's picture in a slot, as a blob URL to show (null when they have none there), and release it when
    // done. Slots are the profile's: profile, background, player, playerOffline, playerTalking, playerMuted, playerAside,
    // playerPrivate, character, characterOffline, talking, muted, characterAside, characterPrivate. `{ space }` asks for
    // that space's own picture set first, the way the call page shows them.
    // The profile slot always answers (an initials plate when no photo is set); `{ fallback: 'none' }` asks for the real
    // photo only, null otherwise, for a page that wants it only as a last resort behind the Participant pictures.
    images: {
      get: (key, slot, o) => { try { refuseOld(o, 'host.images.get'); } catch (err) { return Promise.reject(err); } return call('images.get', { key, slot, space: o && o.space, fallback: o && o.fallback }); },
      release: (url) => call('images.release', { url }),
    },

    // Watch one person's camera and microphone, read-only, following them from space to space (a module that runs
    // in the page only). `watch(key, { video, audio, space }, handlers)` connects as a viewer and calls
    // handlers.state({ online, cameraOn, micOn, speaking, name }), handlers.video(element or null) and
    // handlers.audio(element or null) with elements to place, handlers.reaction(id) as they react, and
    // handlers.connection({ connected, space }). It resolves to { follow(spaceId), stop() }. With `video: false` and
    // `audio: false` only the state is followed.
    media: {
      watch: (key, o, handlers) => (o && o.room !== undefined ? Promise.reject(Object.assign(new Error('host.media.watch: "room" is an old name; use { space }'), { status: 400 })) : call('media.watch', { key, video: !(o && o.video === false), audio: Boolean(o && o.audio), space: (o && o.space) || 'lobby', handlers: handlers || {} })),
    },

    // The server's access key, the one a keyed page's link carries (`/<path>/<key>?s=<access key>`): null unless the
    // viewer runs the environment (an owner, or the host admin). `regenerate()` makes a new one, so every link made with the old one stops working.
    access: {
      key: () => call('access.key'),
      regenerate: () => call('access.regenerate'),
    },

    // The module's own page. `open(hash, { newTab })` asks the host to open it at a place in it ("day=2026-09-24":
    // letters, digits and = & _ . : , - only), which a widget uses for a click that means "show me this in full" (on
    // home, where the tile's heading goes: the destination it is a part of while that shows); `newTab: true` for a click
    // that asked for a new tab (Ctrl or Cmd, the middle button);
    // `onHash(fn)` is called on the page with that place when it is opened that way (and again if it changes).
    page: {
      open: (hash, o) => call('page.open', { hash, newTab: Boolean(o && o.newTab) }),
      onHash: (fn) => host.on('pagehash', (e) => fn(e.hash)),
    },

    // Objects: pointing at another module's objects without reaching into its data. A module lists what
    // it shares (produces) and what it wants to link to (consumes) in module.json (its `refs` section); an admin approves
    // the latter. A pointer is { module, kind, id, scope: 'space' | 'environment' | 'person', space? }: store it, never
    // a copy of the object. resolve() asks the host for the object's summary (title, subtitle, when, end,
    // allDay, done, module) or an { error, status } when it is gone or the viewer may not see it, so
    // a pointer is only ever as revealing as the viewer's own access.
    objects: {
      // A pointer to one of this module's own objects, for a drag or to store.
      make: (kind, id, o) => {
        refuseOld(o, 'host.objects.make');
        const ctx = (info && info.context) || {};
        // { space } names another space's object (a module's environment page showing the spaces it belongs to).
        const otherSpace = o && o.space;
        const personal = o && o.scope === 'person';
        const environment = !personal && !otherSpace && ((o && o.scope === 'environment') || ctx.scope !== 'space');
        const ref = { module: info && info.module && info.module.id, kind, id: String(id), scope: personal ? 'person' : environment ? 'environment' : 'space' };
        if (!environment && !personal) ref.space = otherSpace || ctx.spaceId;
        return ref;
      },
      // One pointer, or a list, to summaries. A list keeps its order.
      resolve: async (pointers) => {
        const list = Array.isArray(pointers) ? pointers : [pointers];
        // the host answers up to 50 at a time.
        const summaries = [];
        for (let i = 0; i < list.length; i += 50) summaries.push(...await call('objects.resolve', { refs: list.slice(i, i + 50) }));
        return Array.isArray(pointers) ? summaries : summaries[0];
      },
      // The kinds of other modules' objects this module may link to: [{ module, moduleName, icon, kind, name, open }].
      // A module written after this one appears here with no change to this one, so use it (and the
      // summaries' own module and kind) rather than naming other modules in your code.
      kinds: () => call('objects.kinds', {}),
      // Show an object in the module that owns it (it opens on the canvas, and it is asked to show the object). The
      // summary says whether it can: summary.open. `{ newTab: true }` for a click that asked for a new tab (Ctrl or Cmd,
      // the middle button): a page that can (home) opens it in one; any other shows it as usual.
      // A pointer to a library file (kind `file`) opens the file window over the canvas instead, after the same check as host.files.open;
      // `{ list }` is the ids of the files linked on the object it was opened from, so Previous and Next walk those (else they are hidden).
      open: (ref, o) => call('objects.open', { ref, newTab: Boolean(o && o.newTab), ...(o && Array.isArray(o.list) ? { list: o.list.filter((id) => typeof id === 'string').slice(0, 2000) } : {}) }),
      // For a module that owns objects: called when someone asks to see one of them (host.objects.open from
      // another module): open it. The pointer is checked for shape and points at one of your own objects.
      onOpen: (fn) => {
        const off = host.on('objectopen', (e) => {
          const ref = e && e.ref && cleanRef(e.ref);
          if (ref) fn(ref);
        });
        if (pendingOpen) {
          const p = pendingOpen;
          pendingOpen = null;
          setTimeout(() => { const ref = p.ref && cleanRef(p.ref); if (ref) fn(ref); }, 0);
        }
        return off;
      },
      // Tell the host what one of your objects points at (`from` is a pointer to it, from make(); `to` is the
      // list of pointers it now points at, replacing the last), so the objects pointed at can ask what points
      // at them. Only pointers are kept, and only what the viewer may see is ever shown.
      // `{ space }` says the object is in that space (a module's environment page linking one of a space's objects);
      // the pointer from make() already carries it, so it is only a check.
      // `{ kind: 'file' }` changes only the links to objects of that kind and leaves the rest as they are; with it `{ op: 'add' }` or
      // `{ op: 'remove' }` adds `to` to those links or takes it out instead of replacing them (host.files.link and unlink do this).
      setLinks: (from, to, o) => call('objects.setLinks', { from, to, ...(o && o.space ? { space: String(o.space) } : {}), ...(o && o.kind ? { kind: String(o.kind) } : {}), ...(o && (o.op === 'add' || o.op === 'remove') ? { op: o.op } : {}) }),
      // What points at one of your objects (its kind must have "backlinks": true in module.json), and what
      // one points at: summaries. The 'links' event says when to ask again.
      linksTo: (ref) => call('objects.links', { ref, dir: 'to' }),
      linksFrom: (ref) => call('objects.links', { ref, dir: 'from' }),
      // What points at each of several of this module's objects, in one request: [{ ref, summaries }] (only those something points at).
      linksToAll: (refs) => call('objects.linksToAll', { refs }),
      // Other modules' objects that show on a calendar as markers (a kind marked "marker": true beside "dated" in its
      // module.json): a task due on a day, a poll's closing time. Read through the kinds this module consumes (as
      // approved), in this module's place: in a space, that space's; on the environment's page, the environment's and
      // each space the viewer belongs to. from and to are YYYY-MM-DD or ISO times, at most 92 days apart. Resolves to
      // [{ ref, kind, title, start, allDay, due, past, module: { id, name, icon, color, svg } }] (`due`: the kind is dated
      // by a due day, not a moment; `color`: the module's tint or null; `svg`: its icon as inline SVG, or null): `start`
      // is YYYY-MM-DD when allDay, else
      // milliseconds. Done objects are left out; at most 500. Never store or edit them: open one with open(ref).
      // The 'markers' event (host.on('markers', fn)) says one changed: ask again.
      markers: (o) => call('objects.markers', { from: o && o.from, to: o && o.to }),
      // A linked object changed (`updated`) or was deleted (`deleted`). Only a module that points at it is told.
      onChange: (fn) => host.on('refchange', (e) => fn({ ref: e.ref, change: e.change })),
      // Objects this module may link to (kinds it consumes), matching the text, in this place
      // or (from a space) { scope: 'environment' }. Each is a summary with its pointer in summary.ref. On a module's
      // environment page { scope: 'spaces' } asks every space the viewer belongs to at once (each pointer carries its
      // space), and { has: 'place' } keeps only summaries with a place (up to 1,000 then, rather than 50).
      // { scope: 'environment', in: <space id> } finds the environment's objects marked for that space (plan-places-library.md).
      search: (text, o) => call('objects.search', { q: text || '', ...opts(o), ...(o && o.has ? { has: String(o.has) } : {}), ...(o && o.kind ? { kind: String(o.kind) } : {}), ...(o && o.in ? { in: String(o.in) } : {}) }),
      // A window the host draws to choose another module's object: a search box (the person's own permissions, the same search as
      // search() above), the results as rows with each kind's icon, and on a phone a full-height sheet. Keyboard: type to search,
      // Up and Down move, Enter chooses, Escape or Close cancels. Resolves with the object's pointer (a ref), or with a list of
      // pointers when `multiple` is true (chosen with ticks, then the Pick button), or null when the person cancels.
      //   pick({ modules?, kinds?, scope?, space?, title?, multiple? }) -> ref | ref[] | null
      //   modules: ['places'] keeps only those modules' objects; kinds: ['place'] only those kinds ("kind" or "module:kind");
      //   scope and space are search()'s; title is the window's name (default "Pick an object", in the environment's word for it).
      // It does not store anything. Keep the ref (host.objects.setLinks if it should be linked) and resolve() it for its title.
      pick: (o) => {
        const t = o && typeof o === 'object' ? o : {};
        refuseOld(t, 'host.objects.pick');
        const list = (v, what) => {
          if (v === undefined || v === null) return [];
          if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) throw Object.assign(new Error(`host.objects.pick: ${what} is a list of names`), { status: 400 });
          return v.slice(0, 20);
        };
        try {
          return call('objects.pick', { modules: list(t.modules, 'modules'), kinds: list(t.kinds, 'kinds'), title: t.title === undefined ? '' : String(t.title).slice(0, 120), multiple: t.multiple === true, ...opts(t) });
        } catch (err) { return Promise.reject(err); }
      },
      // The costs other modules hold in this space (the summaries that carry an `amount` or a `planned` amount: title, when, amount, planned?, paidBy?,
      // sharedBy? (none: everyone), module, ref), as the person may read them: { summaries, withheld }. `withheld` is how many
      // priced objects were left out because the person may not read their module (a number, never a title or figure). Read
      // only; never copy them into storage. Open one with open(summary.ref). Empty outside a space.
      priced: () => call('objects.priced', {}),
      // The published objects format (instructions in this environment's words, and the schema).
      format: () => call('objects.format', {}),
      // Whether this person may bring objects into this place with this module.
      checkAvailable: () => call('objects.checkAvailable', {}),
      // Read objects out of a pasted answer (a string) or a file (a Blob or File). Stores nothing.
      check: (input) => {
        if (typeof input === 'string') return call('objects.check', { text: input });
        if (typeof Blob !== 'undefined' && input instanceof Blob) return call('objects.check', { file: input });
        return Promise.reject(Object.assign(new Error('paste an answer or choose a file first'), { status: 400 }));
      },
      // Start a drag carrying a pointer to one of this module's objects: call it from a dragstart handler.
      drag: (event, kind, id, o) => {
        const ref = host.objects.make(kind, id, o);
        event.dataTransfer.setData(OBJECT_MIME, JSON.stringify(ref));
        if (o && o.label) event.dataTransfer.setData('text/plain', String(o.label));
        event.dataTransfer.effectAllowed = 'copyLink';
        // Tell the host, which brokers the drop onto the other modules on the page (see dropTarget).
        call('objects.dragStart', { ref }).catch(() => {});
        event.target.addEventListener('dragend', () => call('objects.dragEnd', {}).catch(() => {}), { once: true });
        return ref;
      },
      // A line on the page's drag trace, when tracing is on (open the host with ?debug=1); does nothing otherwise.
      trace: (msg) => {
        if (info && info.debug) call('objects.trace', { msg: String(msg).slice(0, 160) }).catch(() => {});
      },
      // The element of this module under a point given by dropTarget (its own coordinates), or null.
      elementAt: (pt) => env.elementAt(pt),
      // Make objects draggable onto other modules: `root` holds them, and `resolve(target)` says what the pressed
      // element is: { kind, id, label, ...the options make() takes } for one of your objects, or, for something
      // you have not stored (an answer the AI wrote), { summary: { title, kind?, content?, place?, date? }, label? }, or null. The drag
      // is driven by the pointer (press, move a few pixels, let go), not the browser's drag and drop, which is
      // unreliable between sandboxed frames; the host shows the label at the pointer and hands the drop to
      // the module under it (see dropTarget). Mouse and pen; on a touch screen search is the way to link.
      draggable: (root, resolve) => {
        const say = (msg) => host.objects.trace(msg);
        // The pointer in the module's own coordinates (a frame's are already; in the page they are shifted).
        const local = (e) => (env.localPoint ? env.localPoint(e.clientX, e.clientY) : { x: e.clientX, y: e.clientY });
        say('draggable ready');
        let down = null;
        let dragging = false;
        let sent = 0;
        let payload = null;
        // Over this module's own frame the host has nothing to do (it hands a drag to the *other* modules): the
        // drag is delivered here directly, as dropTarget's over, leave and drop, so a module's own objects can be
        // dropped on itself (an object of a plan moved between its days) through the one dropTarget it already has.
        let insideOwn = false;
        const overOwn = (e) => {
          const r = env.rootElement && env.rootElement.getBoundingClientRect ? env.rootElement.getBoundingClientRect() : null;
          return Boolean(r) && e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
        };
        const own = (type, e) => emit('objectdrag', { type, ...(type === 'leave' ? {} : { ...local(e), ref: payload.ref || null, summary: payload.summary || null }) });
        root.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.pointerType === 'touch' || e.target.closest('input, textarea, select')) return;
          const pressed = resolve(e.target);
          say(pressed ? (pressed.summary ? 'pressed a summary' : `pressed ${pressed.kind} ${pressed.id}`) : 'pressed something that is not draggable');
          if (!pressed) return;
          down = { id: e.pointerId, x: e.clientX, y: e.clientY, pressed, el: e.target };
          // Follow the pointer from the first press, even when it leaves this module's frame at once.
          try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* it is followed while inside */ }
        });
        window.addEventListener('pointermove', (e) => {
          if (!down || e.pointerId !== down.id) return;
          if (!dragging) {
            if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
            dragging = true;
            say('moved far enough: telling the page a drag began');
            // One of this module's objects ({ kind, id, ... }), or a summary of one it has not stored ({ summary: { title, ... } }).
            const { kind, id, summary, label, ...where } = down.pressed;
            payload = summary ? { summary, label: label || summary.title } : { ref: host.objects.make(kind, id, where), label };
            insideOwn = false;
            call('objects.ptrStart', { ...payload, ...local(e) }).catch(() => {});
          }
          const now = Date.now();
          if (now - sent < 30) return;
          sent = now;
          const inside = overOwn(e);
          if (inside) own('over', e);
          else if (insideOwn) own('leave', e);
          insideOwn = inside;
          call('objects.ptrMove', local(e)).catch(() => {});
        });
        const finish = (e, dropped) => {
          if (!down || e.pointerId !== down.id) return;
          say(dragging ? (dropped ? 'released: sending the drop' : 'pointer cancelled') : 'released without dragging');
          if (dragging) {
            if (dropped && overOwn(e)) { own('drop', e); call('objects.dragEnd', {}).catch(() => {}); }
            else if (dropped) call('objects.ptrDrop', local(e)).catch(() => {});
            else call('objects.dragEnd', {}).catch(() => {});
            if (insideOwn && !(dropped && overOwn(e))) own('leave', e);
            insideOwn = false;
            // The release would otherwise count as a click on the object.
            const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
            window.addEventListener('click', stop, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 100);
          }
          down = null;
          dragging = false;
        };
        window.addEventListener('pointerup', (e) => finish(e, true));
        window.addEventListener('pointercancel', (e) => finish(e, false));
      },
      // Receive a pointer dragged from another module on the same page. over(point, ref) as it moves across
      // this module, leave() when it goes, drop(ref, point) when it is let go; the point is { x, y } in
      // this module's own page, for document.elementFromPoint. Call this rather than (or as well as)
      // listening for dragover and drop yourself: a drag between two module frames reaches only this.
      // `ref` is the pointer dragged, or null; the third argument is what was dragged in full, { ref } or
      // { summary } (a summary carried by a module with nothing stored), for dropMenu.
      dropTarget: (handlers) => host.on('objectdrag', (e) => {
        const ref = e.ref && cleanRef(e.ref);
        const dragged = { ref, summary: (!ref && e.summary && typeof e.summary.title === 'string') ? e.summary : null };
        const point = { x: e.x, y: e.y };
        if (e.type !== 'over') host.objects.trace(`drag ${e.type} received (${ref ? ref.module + ':' + ref.kind : dragged.summary ? 'a summary' : 'no valid pointer'})`);
        if (e.type === 'over') handlers.over && handlers.over(point, ref, dragged);
        else if (e.type === 'leave') handlers.leave && handlers.leave();
        else if (e.type === 'drop') {
          handlers.leave && handlers.leave();
          handlers.drop && handlers.drop(ref, point, dragged);
        }
      }),
      // The fill rules: what a drop can fill of an action's inputs, from what was dragged and what is under
      // the pointer (the drop context: { summary, target?, date?, time?, place? }). Returns the input to request
      // the action with, or null when a required input cannot be filled or nothing of the dropped object was
      // used (an action unrelated to the object is never offered just because a day was under the pointer).
      // Pure: tools/check-drop.mjs runs it against every case.
      fillFor: (action, dragged, context) => fillFor(action, dragged, context),
      // What the modules around this one can do with what was dropped: [{ id, label, hint, action, input }],
      // each ready to request. `dragged` is what dropTarget gave ({ ref } or { summary }); `context` is what
      // this module says is under the pointer. Resolves the ref into its summary unless context.summary is given.
      offersFor: async (dragged, context) => {
        const d = normalizeDragged(dragged);
        const ctx = { ...(context || {}) };
        if (!ctx.summary) {
          if (d.ref) {
            const summary = await host.objects.resolve(d.ref);
            if (!summary || summary.error) throw new Error((summary && summary.error) || `that ${host.util.word('object')} is not available`);
            ctx.summary = summary;
          } else ctx.summary = d.summary || {};
        }
        // A drop is about the object and what is here. Beyond what this module offers of its own (`own`, in dropMenu),
        // the only actions offered are the dropped object's own module's, taking it by its exact kind and doing something
        // with what is under the pointer: set this task's due date to this day, link this task to this event, put this
        // place at this spot on the map. A third module making something new of the object (an event from a note dropped
        // on a plan) is not about here; that belongs where the object lives, not in a drop between two other modules. A
        // summary the drag carried has no module of its own, so only this module's own offers apply to it.
        if (!d.ref) return [];
        let list = [];
        try { list = await host.actions.list({ accepts: `${d.ref.module}:${d.ref.kind}`, ref: d.ref }); } catch (err) { list = []; }
        const offers = [];
        const kindType = `ref:${d.ref.module}:${d.ref.kind}`;
        for (const a of list) {
          if (a.module !== d.ref.module) { host.objects.trace(`drop: ${a.action} not offered (not the object's own module's)`); continue; }
          if (!Object.values(a.input || {}).some((t) => String(t).replace(/\?$/, '') === kindType)) { host.objects.trace(`drop: ${a.action} not offered (takes the object only as any ref)`); continue; }
          // What the action says the object must have (a position, a date, text): declared as `needs` on the action.
          const lacks = (a.needs || []).find((f) => !ctx.summary[f]);
          if (lacks) { host.objects.trace(`drop: ${a.action} not offered (the object has no ${lacks})`); continue; }
          const input = fillFor(a, d, ctx);
          if (!input) { host.objects.trace(`drop: ${a.action} not offered (${whyNot(a, d, ctx)})`); continue; }
          if (!usesHere(input, ctx)) { host.objects.trace(`drop: ${a.action} not offered (nothing from under the pointer would be used)`); continue; }
          offers.push({ id: a.action, label: a.label, hint: a.moduleName, icon: a.icon, action: a, input });
        }
        return offers;
      },
      // The one decision, shared by every module: what dropping this here can do. Shows the module's own
      // offers (`own`, first: [{ id, label, hint?, run(ctx), when?(ctx) }], an offer whose `when` says no
      // for this summary is left out) and every action the modules around it can fill from the drop context,
      // lets the person choose (actions.pick, with `remember` as its key alongside the dropped kind), and
      // runs it. Resolves to the offer taken, or null if dismissed; throws when nothing can be done, or it failed.
      dropMenu: async (dragged, point, { context, own, remember, wait } = {}) => {
        const d = normalizeDragged(dragged);
        const ctx = { ...(context || {}) };
        // The summary first, once, so the module's own offers and the actions' fill see the same one.
        if (!ctx.summary) {
          if (d.ref) {
            const summary = await host.objects.resolve(d.ref);
            if (!summary || summary.error) throw new Error((summary && summary.error) || `that ${host.util.word('object')} is not available`);
            ctx.summary = summary;
          } else ctx.summary = d.summary || {};
        }
        // An own offer wears this module's icon unless it names one; the actions wear their module's.
        const mine = info && info.module && info.module.icon;
        const offers = (own || []).filter((o) => o && (!o.when || o.when(ctx))).map((o) => (o.icon || !mine ? o : { ...o, icon: mine }));
        offers.push(...await host.objects.offersFor(d, ctx));
        host.objects.trace(`drop offers: ${offers.map((o) => o.label).join(' | ') || 'none'}`);
        if (!offers.length) throw new Error('Nothing can be done with that here.');
        // A summary with nothing stored behind it keeps the key 'card' for the remembered choice, so a choice kept in a
        // browser before the rename is still offered first.
        const kind = d.ref ? `${d.ref.module}:${d.ref.kind}` : 'card';
        const chosen = await host.actions.pick(offers, point, remember ? { remember: `${kind}:${remember}` } : undefined);
        if (!chosen) return null;
        if (chosen.run) await chosen.run(ctx);
        else {
          const out = await host.actions.request(chosen.action.action, chosen.input, { wait: wait !== false });
          if (out.status === 'done' && out.result && out.result.ok === false) throw new Error(out.result.error || 'it could not be done');
        }
        return chosen;
      },
      // Whether a drag over this module carries a pointer (call preventDefault on dragover to accept it).
      accepts: (event) => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes(OBJECT_MIME),
      // The pointer dropped, checked for shape, or null. It says nothing about whether the viewer may
      // see the object: resolve() does that.
      parse: (event) => {
        try {
          return cleanRef(JSON.parse(event.dataTransfer.getData(OBJECT_MIME)));
        } catch (err) {
          return null;
        }
      },
    },

    // Events: a module says something happened, and other modules that were approved to hear it can react.
    // Neither side names the other. Declare what you publish in module.json (events.publishes: [{ name,
    // kind, label }]) and what you want to hear (events.subscribes: ["*"] or ["module:name"], approved by
    // the admin). By convention an event named `closed`, `done`, `completed` or `finished` means the item it
    // points at is finished.
    events: {
      // publish('closed', { ref, data }): `ref` (optional) is a pointer to one of your own items, `data` a small
      // plain object (under 2 KB) that means something to whoever listens.
      publish: (name, o) => call('events.publish', { name, ref: o && o.ref, data: o && o.data }),
      // Hear events: handler({ id, at, module, name, ref, data }) for each, in order, including those that
      // happened while this module was not open (from where it last got to; a module hears nothing from
      // before its first subscribe). More than one person may have the module open, so handle an event so
      // that doing it twice is harmless.
      subscribe: (handler) => {
        const CURSOR = '_cursor:events';
        let cursor = null;
        let chain = Promise.resolve();
        let waiting = 0; // events queued and not yet handled: the cursor is written once the batch is done, not after each one
        const writeCursor = async () => {
          try {
            await host.storage.set(CURSOR, { id: cursor });
          } catch (err) {
            // read-only here: the cursor is kept for this visit only
          }
        };
        const deliver = (e) => {
          waiting += 1;
          chain = chain.then(async () => {
            waiting -= 1;
            if (cursor !== null && e.id <= cursor) return;
            try {
              await handler(e);
            } catch (err) {
              console.error(err);
            }
            cursor = e.id;
            if (waiting === 0) await writeCursor();
          });
        };
        const off = host.on('bus', deliver);
        (async () => {
          let saved = null;
          try {
            // Asked as a list, not a get: a first visit has no cursor yet, and a get of a missing key is a 404 in the console.
            const item = (await host.storage.list(CURSOR)).find((i) => i.key === CURSOR);
            saved = item && item.value && item.value.id;
          } catch (err) {
            saved = null;
          }
          const r = await call('events.since', { after: saved == null ? 'now' : saved });
          if (saved == null) {
            if (cursor === null || cursor < r.latest) cursor = r.latest;
            await writeCursor();
          } else if (cursor === null || cursor < saved) {
            cursor = saved;
          }
          for (const e of r.events) deliver(e);
        })().catch((err) => console.error(err));
        return off;
      },
    },

    // Actions: one module asks another to do something, without either naming the other in the host. A module
    // lists what it can do in module.json (actions.provides: [{ name, label, input: { title: 'string',
    // due: 'date?' } }]; field types are string, text, date, datetime, boolean, number and ref, and a
    // trailing ? means optional) and what it wants to ask for (actions.uses: ["*"] or ["module:name"],
    // approved by the admin).
    actions: {
      // What this module may ask for here: [{ action, module, moduleName, icon, name, label, input }]. Offer
      // whichever you can fill in from what you have (an action that takes a `title`, say), and do not name modules.
      // { accepts: "module:kind" } keeps the ones that take a pointer to that kind of item; { self: true } also
      // lists this module's own, marked own: true.
      // { accepts, self, ref }: `ref` the object they would be about, so only the actions that can be carried out in its
      // own place are listed.
      list: (o) => call('actions.list', { accepts: o && o.accepts, self: Boolean(o && o.self), ref: o && o.ref }),
      // A small menu at a point (in your own coordinates, as a drop gives it) to let the person choose what to
      // do: pick([{ label, hint? }], point) resolves to the chosen item, or null if they dismiss it. With a single
      // item there is nothing to ask, and it resolves to it at once. With { remember: "some key" } the choice is
      // kept (in this browser, per module) and offered first, marked "last used", the next time the same key is
      // asked; give each item an `id` (its label is used if not) so the choice survives wording changes.
      pick: (items, at, o) => new Promise((resolve) => {
        let list = (items || []).filter(Boolean);
        const memory = o && o.remember ? `app:pick:${(info && info.module && info.module.id) || ''}:${String(o.remember).slice(0, 120)}` : '';
        const idOf = (it) => String(it.id || it.label);
        if (memory && list.length > 1) {
          let last = '';
          try { last = localStorage.getItem(memory) || ''; } catch (err) { last = ''; }
          const at0 = list.findIndex((it) => idOf(it) === last);
          if (at0 > 0) list = [{ ...list[at0], hint: list[at0].hint ? list[at0].hint + ' \u00b7 last used' : 'Last used' }, ...list.filter((_, i) => i !== at0)];
          else if (at0 === 0) list = [{ ...list[0], hint: list[0].hint ? list[0].hint + ' \u00b7 last used' : 'Last used' }, ...list.slice(1)];
        }
        const remember = (it) => { if (!memory || !it) return it; try { localStorage.setItem(memory, idOf(it)); } catch (err) { /* not kept */ } return it; };
        if (list.length < 2) return resolve(list[0] || null);
        // The same look as host.menu.show (its styles, an icon, the label, a hint): one menu, wherever it is asked.
        const rootEl = host.rootElement;
        const menu = document.createElement('div');
        menu.className = 'sdk-menu';
        menu.setAttribute('role', 'menu');
        // Inside this module's open editor window (host.ui.editor) when it has one: the menu goes into the dialog (see
        // below), and focus goes back to the dialog when the menu is dismissed, so it is not left on the page's body.
        const editor = editorAt(null);
        const done = (v) => { menu.remove(); document.removeEventListener('keydown', key, true); env.root.removeEventListener('pointerdown', away, true); if (editor && editor.open && !editor.contains(env.root.activeElement)) { try { editor.focus(); } catch (err) { /* not focusable */ } } resolve(remember(v)); };
        // Escape dismisses only the menu: stopped and prevented, so an editor window around it does not close too.
        const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
        const away = (e) => { if (!menu.contains(e.target)) done(null); };
        for (const item of list) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'sdk-menu-item';
          b.setAttribute('role', 'menuitem');
          if (item.icon) {
            const ic = document.createElement('span');
            ic.className = 'sdk-menu-icon';
            b.appendChild(ic);
            menuIcon(item.icon, item.regular ? 'regular' : 'solid').then((svg) => { if (svg) ic.innerHTML = svg; });
          }
          const label = document.createElement('span');
          label.className = 'sdk-menu-label';
          label.textContent = item.label;
          b.appendChild(label);
          if (item.hint) { const h = document.createElement('div'); h.className = 'sdk-menu-hint'; h.textContent = item.hint; b.appendChild(h); }
          b.addEventListener('click', () => done(item));
          menu.appendChild(b);
        }
        // Inside the module's own root (a shadow root in the page), placed by the page's coordinates; inside this
        // module's open editor window when it has one, clamped to the window.
        (editor || (env.root === document ? document.body : env.root)).appendChild(menu);
        const modBox = rootEl.getBoundingClientRect();
        const box = editor ? { left: 0, top: 0 } : modBox;
        const w = editor ? window.innerWidth : rootEl.clientWidth || 400;
        const h = editor ? window.innerHeight : rootEl.clientHeight || 400;
        const ax = ((at && at.x) || 0) + (editor ? modBox.left : 0);
        const ay = ((at && at.y) || 0) + (editor ? modBox.top : 0);
        menu.style.left = box.left + Math.max(4, Math.min(ax, w - menu.offsetWidth - 4)) + 'px';
        menu.style.top = box.top + Math.max(4, Math.min(ay, h - menu.offsetHeight - 4)) + 'px';
        document.addEventListener('keydown', key, true);
        env.root.addEventListener('pointerdown', away, true);
        const first = menu.querySelector('button');
        if (first) first.focus();
      }),
      // Ask for one. the host checks the input against what the action takes and queues it for the module
      // that owns it, which carries it out the next time a person has it open (or at once if one does).
      // With { wait: true } this waits a few seconds for the answer: { status, result: { ok, ref?, error? } }.
      // With { here: true } (a `local` action) only the provider open in this same page may carry it out, and only within
      // those few seconds: never a page in another tab, never later (the provider declares "page": "string?" and
      // "pageUntil": "number?" in its input; the host fills them). host.actions.list says `open: true` for an action whose
      // module is open in this page.
      request: async (action, input, o) => {
        const name = String(action || '');
        if (name === 'assistant:askAssistant' || name === 'askAssistant') {
          const q = String(input?.question || '').trim();
          if (!q && !input?.ref) throw new Error('Type a question.');
          await call('chat.ask', { question: q, refs: input?.ref ? [input.ref] : [] });
          return { status: 'done', id: 0, result: { ok: true } };
        }
        const queued = await call('actions.request', { action, input, ...(o && o.here ? { here: true } : {}) });
        if (queued && queued.status === 'done') return queued;
        if (!(o && o.wait)) return queued;
        for (let i = 0; i < 10; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const s = await call('actions.status', { id: queued.id });
          if (s.status === 'done') return s;
        }
        return { status: 'queued', id: queued.id };
      },
      // Carry out the actions this module provides: provide({ createTask: async (input, { from, by }) => ({ ref }) }).
      // Called for each request, once (only one page takes it), under the rules of whoever has the module open.
      provide: (handlers) => {
        let chain = Promise.resolve();
        const run = async (a) => {
          const fn = handlers[a.name];
          if (!fn) return;
          let claim;
          try {
            claim = await call('actions.claim', { id: a.id });
          } catch (err) {
            return;
          }
          if (!claim || !claim.ok) return;
          let result;
          try {
            const out = await fn(claim.action.input, { from: claim.action.from, by: claim.action.by });
            result = { ok: true, ref: out && out.ref, ...(out && out.data !== undefined ? { data: out.data } : {}) };
          } catch (err) {
            result = { ok: false, error: String((err && err.message) || err) };
          }
          try {
            await call('actions.complete', { id: a.id, result });
          } catch (err) {
            // the requester can still see it was claimed
          }
        };
        const queue = (a) => { chain = chain.then(() => run(a)); };
        host.on('action', queue);
        call('actions.pending', {}).then((list) => list.forEach(queue)).catch(() => {});
      },
    },

    // Ask the host to run something later, on your behalf. Needs "schedule" (and
    // "notify" for a notification) in the manifest's hooks. `at` is a time
    // (ms since 1970 or an ISO string); `key` names the schedule so setting it
    // again replaces it. When it fires the module is told (event "schedule")
    // if open, and `notify`, if given, is delivered. On a module's environment page, `space: <id>` sets it in that
    // space (as its storage calls take { space }), so it runs and notifies there.
    schedule: (spec) => call('schedule', spec),
    cancelSchedule: (key, o) => call('cancelSchedule', { key, ...opts(o) }),

    // { to: 'space' | 'environment' | a person's key, title, body }. Needs the "notify" hook. On a module's
    // environment page, `space: <id>` makes it that space's: `to: 'space'` is then that space's people.
    notify: (spec) => call('notify', spec),

    // A destination (a host page made of modules' parts, such as Calendar): present only on a destination's part,
    // null anywhere else. info.context.destination says which ({ id, part }: part 'main' or 'panel'), so a part can
    // draw itself for it, with no header or filter of its own. The page owns the shared state and gives it whole:
    //   onState(fn)  fn(state) now (once ready) and on each change. Returns the off. The calendar's state is
    //                { view: 'month' | 'week' | 'day', spaces: [<id>...], environment: true | false, externalOff: [<id>...],
    //                day, from, to } (`spaces`, `environment` and `externalOff`, the person's other calendars the filter
    //                has off, are the filter; `day` the selected day; `from` and `to` the period shown, YYYY-MM-DD, `to`
    //                the day after it).
    //   set(patch)   change what this part may: in the calendar only the main part, { day, from, to }; on the map
    //                either part, { selected }. The page passes it on to every part, this one included.
    get destination() {
      if (!info || !info.context || !info.context.destination) return null;
      return destinationApi;
    },

    // The old action bar, kept so a module written for it still works: use host.add (the "+") instead. Nothing is
    // drawn along the bottom of a module any more. set([{ id, label, icon, primary, disabled }]) folds the buttons into
    // the titlebar's "+" as plain entries (the primary first, the rest in order; `label` is the entry's words, `icon`
    // its icon), and a pick still arrives as the 'bar' event { id }. An item { id, type: 'quickadd', placeholder,
    // label } becomes an entry too; its 'bar' event carries { id, value: '' } (there is no field to type in), so open
    // an empty form for it. `overflow` and `iconOnly` are ignored. A module that calls host.add.set gets only that list.
    // Resolves true.
    bar: {
      set: (items) => call('bar.set', { items }),
    },

    // The "+" in the module's titlebar, after its own icons and before "...": the module's add actions.
    // set(entries), where an entry is a leaf { id, label, icon?, tint?, hint?, disabled? }, a category
    // { label, icon?, items: [leaf, ...] } (one level) or { divider: true }. Labels up to 40 characters; at most 8
    // top-level entries, 12 per category and 40 leaves (the host drops the rest); a category with one leaf is that leaf.
    // Exactly one leaf: the "+" runs it at once, its label the tooltip ("Add event"). More: the "+" ("Add") opens the
    // host's menu, a category's leaves in a flyout beside it (a drill-in on a phone). A pick arrives as the 'add' event
    // { id }. An empty list takes the "+" away: send one for a person who may not add. The host draws it wherever the
    // module is drawn (a window's titlebar, popped out too, the page bar on the module's own page and on a destination's
    // page, a composite's titlebar on a space's canvas) and resolves true; only a dashboard widget answers false.
    // Detect it with `if (host.add)`.
    add: {
      set: (entries) => call('add.set', { entries }),
    },

    // The status bar: one slim read-only line at the bottom of the module's window, for counts and what is selected.
    // set(items), up to 4 of { text, icon?, title?, quiet?, end? }: `text` up to 60 characters; `title` its tooltip (else its
    // text); `quiet` keeps it out of what a screen reader hears (a ticking time); `end` puts it at the right end (one).
    // The others are the words at the start, a dot between, cut with an ellipsis when the bar is too narrow. Nothing in it
    // is a button. The host reads the non-quiet text out politely once it has been still a moment, and draws nothing for
    // the same items again, so call it on every render. set([]) hides it. Resolves true wherever the module is drawn (a
    // window, popped out too, its own page, a destination's page, a composite's window); only a dashboard widget answers
    // false. Detect it with `if (host.status)`.
    status: {
      set: (items) => call('status.set', { items }),
    },

    // What needs this person's action in this space, shown by the host in the space's status strip as "N need action"
    // (a button whose list opens your items). The host names no module: it adds every module's count. set({ count,
    // label, items }): `count` a whole number from 0 to 99 (0 clears), `label` up to 40 characters ("polls to vote
    // in"), `items` up to 20 of { title, object? } (`title` up to 120 characters; `object` an object reference from
    // host.objects.make, which a pick opens; none, a pick opens your module). The host keeps your last report for a
    // week, per person and space, so call it when you run and after each change; calling again with the same words
    // changes nothing. clear() drops it. Both resolve true when kept, false where there is no space (a module's
    // page outside a space, a dashboard widget, a guest) or this role may not write in the module; a bad shape rejects
    // with a sentence. Detect it with `if (host.attention)`.
    attention: {
      set: (report) => call('attention.set', report || {}),
      clear: () => call('attention.clear'),
    },

    // How this space stands, shown by the host as chips in the space's status strip ("$2,340 of $4,000", "Thu ·
    // SJC → ONT"; plan-space-story-strip.md, step 5). Facts are the space's, not a person's: the host keeps your module's
    // last list for the space for a week, whoever sent it, and shows it to everyone who may read your module there.
    // set([...]): at most 6 of { id, icon, text, value?, progress?, order?, budget?, when? }: `id` a short code name
    // unique in your module (`spent`), `icon` a Font Awesome Free solid icon's name, `text` up to 40 characters (the
    // chip's words; no invisible characters), `value` up to 24 (a short extra, shown when the chip is pressed),
    // `progress` 0 to 1 (drawn as a fill in the chip), `order` 0 to 99 (lower first), `budget: true` when the fact
    // reads the space's budget target (host.space().budget), which lets Set up offer that target, `when` a day
    // (YYYY-MM-DD) the fact is about: the host puts it in words in front of yours against each viewer's own today
    // ("Today", "Tomorrow", "Fri", "Oct 21") and leaves the fact out once that day has passed, so never put a relative
    // day in `text` yourself. The strip shows up to three. Call it when you run and
    // after each change; the same list again changes nothing. set([]) or clear() drops them. Both resolve true when
    // kept, false where there is no space (a module's page outside a space, a dashboard widget, a guest) or this role
    // may not write in the module; a bad shape rejects with a sentence. Detect it with `if (host.facts)`.
    facts: {
      set: (list) => call('facts.set', { facts: Array.isArray(list) ? list : [] }),
      clear: () => call('facts.clear'),
    },

    // The module's own actions in its title bar, beside the "+" and the host's menu:
    // set([{ id, icon, title, on, regular, disabled, overflow, danger }]), where `icon` is a Font Awesome name (solid, or
    // regular with `regular: true`), `title` its words (its tooltip and name) and `on` marks the current choice. Each is an
    // icon beside the menu; `overflow: true` puts it in the title bar's menu instead (the module's own actions come first
    // there, before a line and the host's standard actions), as do the icons past five and any the title bar has no room
    // for; `danger: true` (a destructive action) is always last in that menu, in red. A click arrives as the 'header' event
    // with its id. Resolves true wherever the module is drawn (a window, its own page, a destination's page, a composite's
    // window); only a dashboard widget answers false.
    header: {
      set: (items) => call('header.set', { items }),
    },

    // The standard actions a module handles itself: Settings, Share and Print, the same in every module. The host draws each
    // one you give a handler for in the title bar's menu, after your own actions, with the host's words, icon and order
    // (Settings, Share, Print), and leaves out the rest. set({ settings, share, print }), each a function (the handler) or
    // { run, disabled?, hint?, permission? } (`run` the handler; `disabled` shows it greyed, `hint` up to 40 characters
    // says why; `permission` one of your module.json permissions: it is left out for a person without it), or null to
    // leave it out. A set replaces the last; set({}) takes them all away.
    //   settings: run() opens your settings, wherever you keep them (an editor window, a view of your own).
    //   share: run() answers what to share, { url, title?, message? } (or a promise of it): `url` an https address or a path
    //     on this server, `title` the dialog's heading (else "Share"), `message` one plain line. The host shows its one
    //     Share dialog: the link, a Copy link button and your message. Answer null to share nothing.
    //   print: run() gets your page ready (or answers false to stop); the host then prints your content area alone, with
    //     no title bar, toolbar or status bar, in the light colours, and you hear 'printed' when the page is back.
    // Resolves true wherever the module has a frame (a window, popped out, its own page); false on a destination's part
    // and a dashboard widget.
    standard: {
      set: (spec) => setStandard(spec),
    },

    // The one row under the title bar, above the content: the tools about the module's current state -- a view switch,
    // the period's title, the way through it (back, Today, forward), a search, the filters -- not window-level actions
    // (those are the title bar's) and not the module's add actions (the title bar's "+"). The host draws it wherever the
    // module is drawn (a window, popped out, its own page, a destination's page) in one fixed order: on the left the view
    // switches, then the title and notes, then the buttons; on the right, always in the same place from the edge, the
    // search and then one Filters button, which holds every `chips` item as a group in its menu (with Clear filters at
    // the top) and shows how many filters are applied. It keeps the row one line, nothing ever cut: while it is too narrow
    // the switches show only their icons, then the buttons, then the search becomes a magnifier in its place, then the
    // left side's controls go into a "More" menu one at a time; the search and Filters stay. set([item, ...]):
    //   { type: 'title', text }                                            -- the row's title ("October 2026")
    //   { type: 'text', text }                                             -- a quieter note
    //   { type: 'tabs', id, value, options: [{ id, label?, icon?, regular?, iconOnly? }] } -- a segmented switch (prefer
    //       host.ui.viewSwitch); a click arrives as the 'toolbar' event { id, value: optionId }
    //   { type: 'search', id, value?, placeholder?, label? }               -- the row's search; typing arrives as { id, value },
    //       Enter as { id, value, submit: true }, Escape clears it ({ id, value: '' }). `value` is put in the field only when
    //       it differs from the last `value` you sent, never under the person's typing
    //   { type: 'chips', id, label?, single?, value?, options: [{ id, label, icon?, tint?, note?, count?, on?, default? }] }
    //       -- a group of filters in the Filters menu, under `label`. Switches, each turned on and off: a click arrives as
    //       { id, value: optionId, on }; an option is applied while `on` is not its `default` (on unless you say
    //       `default: false`), and that is what the Filters count counts. `single: true` makes it one choice, `value` the
    //       chosen option's id, the first option meaning "nothing applied" ("All"); a pick arrives as { id, value }.
    //       `count` is a number after the option; `note` a short word after it. Draw them again with the new state
    //   { type: 'button', id, label?, title?, icon?, regular?, on?, primary?, disabled?, overflow?, placement? } (the default
    //       type) -- a click arrives as { id, x } (x: its left edge across the module, for a menu under it); an icon with no
    //       label is an icon button, `title` its tooltip and name; `on` a pressed state. `placement: 'titlebar'` draws it as
    //       an icon in the title bar instead, `placement: 'menu'` puts it in the title bar's menu; `overflow: true` keeps it
    //       in the row's "More" menu
    // Your view switches and toolbar buttons (host.ui.viewSwitch, host.ui.toolbarButton) come first, then your items;
    // call set on every render (the same row is not drawn twice). Resolves true wherever the module is drawn; only a
    // dashboard widget answers false.
    toolbar: {
      set: (items) => { ownToolbar = Array.isArray(items) ? items : []; return drawToolbar(); },
    },

    // The module's tools in the space's nav bar (the secondary nav, the row under the header on the call page), drawn by
    // the host in its own look while the module is open in that space and taken out when it closes. Not the
    // module's toolbar (host.toolbar.set, about the module's own state): these are the space's actions the module adds.
    // set([{ id, zone?, icon, label, title?, order?, group?, groupOrder?, href?, visible?, toggleable?, active?, badge? }]):
    //   id is letters, digits and hyphens, the module's own (the host namespaces it); `zone` is ignored (every module
    //   tool goes in the space bar's right zone, where it can fold); icon a Font Awesome name; label what a screen reader and the tooltip say; order and groupOrder
    //   in the module band (101-998, clamped); href a path on this server or an https address, for a real link.
    // The set replaces the last. A click arrives as the 'nav' event { id }. The host decides where a module's tools
    // go: always the space bar's right zone, never the top bar. `bar`, `system` and `zone` are ignored (a tool that sets them is placed like
    // any other). Resolves true when the host drew them, false when there is no space bar here (the module's own
    // page). setActive(id, on) and setBadge(id, n) change a tool in place; never set() again for that.
    nav: {
      set: (tools) => call('nav.set', { tools }),
      setActive: (id, on) => call('nav.setActive', { id, on }),
      setBadge: (id, n) => call('nav.setBadge', { id, n }),
    },

    // A menu of actions -- the shared shape for a row's "..." button, a right-click, a joint's +, anything
    // that is "here are some things you could do, pick one." Not for a single yes/no drop decision with
    // nothing more to say afterward (see host.actions.pick for that).
    //
    // show({ id, items, at, anchor, className, maxWidth }): items are [{ id?, label, icon?, iconColor?,
    // regular?, hint?, tip?, ariaLabel?, disabled?, danger?, separator?, href?, target?, onClick? }] (`tip` is the
    // row's tooltip and, when it holds the label ("Add a flight" for "Flight"), what a screen reader hears; `ariaLabel`
    // names the row for a screen reader outright; separator: true
    // ignores every other field and draws a divider; iconColor is a CSS color for that item's own icon,
    // for a fixed set of kinds people tell apart by color elsewhere in the module -- most menus don't need
    // it). An item that just goes somewhere gives `href` instead of `onClick` -- a real link (target
    // "_blank" unless given), not a click handler faking navigation, so hovering, copying and opening in a
    // new tab all still work. Position with `at: { x, y }` (a drop's own coordinates) or `anchor` (an element to open
    // under, like the button that opened it) -- give one, not both. `onClick(item)` runs on a click; unless
    // it returns exactly `false`, or a promise that resolves to exactly `false`, the menu closes afterward --
    // an item that needs to arm itself first ("Really delete?") returns false and changes its own label by
    // calling show() again with the same id.
    //
    // An item with `items` (or `submenu`: a list of items, or a function giving one) is a category: a caret at its
    // end, its entries in a flyout beside its row (on hover after a short wait, on a click or tap, on Right or Enter;
    // Left or Escape closes just the flyout, the keyboard back on its row; it flips or shifts to stay inside the
    // module). On a phone, or where the module has no room for both side by side, it drills in instead: the menu shows
    // Back, the category's name and its entries. One level: a category's entries are plain items. { heading } is a
    // small heading over the entries after it. Up, Down, Home and End move in either level.
    //
    // Only one of these is ever open at a time (per module): showing one closes whatever else was open
    // first. Showing the same id again while it is already open closes it instead of reopening it, so a
    // "..." button toggles rather than always opening a fresh copy. Returns { close }.
    menu: {
      show({ id, items, at, anchor, className, maxWidth } = {}) {
        return showMenu({ id, items, at, anchor, className, maxWidth });
      },
      close: () => closeMenu(),
    },

    // Layout: ask the host for a size, and set the title shown above the module.
    resize: (size) => call('resize', size),
    setTitle: (title) => call('setTitle', { title }),

    // Events: 'bar' ({ id }) when an action bar button is clicked, 'add' ({ id }) for one of the "+"'s actions, 'header' ({ id }) for a titlebar icon,
    // 'standard' ({ id }) for Settings, Share or Print (host.standard.set runs your handler for it), 'printed' once the page is back after Print,
    // 'toolbar' ({ id, value?, x? }) for a toolbar item (x: a button's left edge across the module, for a menu under it), 'nav' ({ id }) for one of the module's nav-bar tools,
    // 'change' ({ key, value, version, deleted, scope, spaceId, by })
    // whenever stored data changes, 'changes' ({ changes: [{ key, value, version, deleted, by }], cleared?, restored?, scope, spaceId, by })
    // when many keys changed at once (a Clear, its Undo; without a 'changes' listener each comes as a 'change' in one pass, with batch: { count, last }, so a module can draw on the last only), 'library' ({ op: 'added'|'renamed'|'removed'|'thumb', id, module, spaceId }) when a library file changed (to the library module itself, e.g. the Vault, and to a module approved to link to its files; host.ui.fileChips already listens), 'markers' when another module's marker objects changed (host.objects.markers), 'schedule' ({ key, payload }) when a schedule fires, 'theme' (the new theme),
    // 'moved' ({ mode }) after the host moved the module between docked and floating (the SDK reopens an open editor window itself),
    // 'environment' ({ pictureMap }) when the environment's facts changed (host.environment already answers the new ones),
    // 'phases' ({ phases, timeline }) when the dates on the space's timeline changed (a save in the sheet or Set up, or
    // someone else's): `phases` is { <id>: { start?, end? } }, `timeline` the bands host.util.phaseTimeline() returns, and
    // host.space().phases and host.util.phaseTimeline() already answer the new ones. Only in a space.
    // 'space' ({ budget }) when the space's budget target changed (an owner's Set up): host.space().budget already answers
    // the new one. Only in a space.
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
  };

  const destinationApi = {
    onState: (fn) => {
      let heard = false;
      const off = host.on('destination', (state) => { heard = true; destinationState = state; fn(state); });
      // The state as it is now, unless a change already brought a newer one.
      if (destinationState) setTimeout(() => { if (!heard) fn(destinationState); }, 0);
      return off;
    },
    set: (patch) => call('destination.set', { patch }),
  };
  // Kept current even before a part asks, so onState starts from the latest.
  host.on('destination', (state) => { destinationState = state; });
  // A move between docked and floating takes the module's box out of the page and back, which drops an open editor
  // window out of the top layer: show it modal again.
  // The space's phases changed (the host page read them again): keep host.space().phases and createdAt current, and add the
  // timeline (host.util.phaseTimeline(), tints included) to what the module hears. Registered first, so it runs before the module's.
  host.on('phases', (e) => {
    if (info && info.space && e && e.phases) {
      info.space.phases = e.phases;
      if (e.created) info.space.createdAt = e.created;
    }
    try { e.timeline = host.util.phaseTimeline(); } catch (err) { e.timeline = []; }
  });
  // The space's budget target changed: keep host.space().budget current. Registered first, so it runs before the module's.
  host.on('space', (e) => {
    if (info && info.space && e && 'budget' in e) info.space.budget = e.budget || null;
  });
  host.on('moved', () => { for (const e of openEditors.values()) e.reopen(); });
  // The standard actions (host.standard.set): the handlers stay here, the host hears which there are. A pick arrives as
  // 'standard' { id }; Share answers with what to share, Print says it is ready (its page measured at its full height in
  // a frame, which the stylesheet's .sdk-printing lets run on) and puts the page back on 'printed'.
  const STANDARD_IDS = ['settings', 'share', 'print'];
  let standardRun = {};
  function setStandard(spec) {
    return readyPromise.then(() => {
      const s = spec && typeof spec === 'object' ? spec : {};
      const run = {};
      const declared = {};
      for (const id of STANDARD_IDS) {
        const v = s[id];
        const o = typeof v === 'function' ? { run: v } : v && typeof v === 'object' && typeof v.run === 'function' ? v : null;
        if (!o || (o.permission && !host.can(o.permission))) continue;
        run[id] = o.run;
        declared[id] = { ...(o.disabled ? { disabled: true } : {}), ...(o.hint ? { hint: String(o.hint).slice(0, 40) } : {}) };
      }
      standardRun = run;
      return call('standard.set', { actions: declared });
    });
  }
  host.on('standard', async (e) => {
    const id = e && e.id;
    const fn = standardRun[id];
    if (!fn) return;
    try {
      if (id === 'settings') { await fn(); return; }
      if (id === 'share') {
        const r = await fn();
        if (r) await call('share.show', r);
        return;
      }
      if (id === 'print') {
        if ((await fn()) === false) return;
        // In a frame (env.root is the frame's document) the page runs on at its full height while it prints; a module in
        // the page (env.root a shadow root) prints with it as it is.
        const doc = env.root && env.root.documentElement ? env.root : null;
        if (doc) doc.documentElement.classList.add('sdk-printing');
        const height = doc ? doc.documentElement.scrollHeight : 0;
        const ok = await call('print.run', { height });
        if (!ok && doc) doc.documentElement.classList.remove('sdk-printing');
      }
    } catch (err) {
      console.error(err);
    }
  });
  host.on('printed', () => { if (env.root && env.root.documentElement) env.root.documentElement.classList.remove('sdk-printing'); });
  // The host put a lifted frame back itself: the topmost open editor closes as Escape does.
  host.on('editordismiss', () => { const top = [...openEditors.entries()].filter(([d]) => d.open).pop(); if (top) top[1].dismiss(); });
  // The viewport crossed the phone line while lifted: the dialog's rules follow.
  host.on('editorlift', (d) => { for (const dlg of openEditors.keys()) if (dlg.classList.contains('sdk-editor-lifted')) dlg.dataset.lift = d && d.phone ? 'phone' : 'window'; });

  // The hard break (plan-names step 7): refs became objects. A module that still reaches for the old names is told
  // which to use, instead of failing later on an undefined. Not enumerable, so nothing that walks the SDK trips on them.
  const renamed = (what, use) => ({ enumerable: false, get() { throw Object.assign(new Error(`${what} is an old name; use ${use}`), { status: 400 }); } });
  Object.defineProperty(host, 'refs', renamed('host.refs', 'host.objects'));
  Object.defineProperty(host.util, 'refKey', renamed('host.util.refKey', 'host.util.objectKey'));

  return { host, emit };
  }

  // A the host page that hosts modules includes this file with data-host-sdk, to build SDKs for modules
  // that run in the page; anywhere else, inside a frame, it boots for the module in that frame.
  const hostPage = Boolean(document.currentScript && document.currentScript.hasAttribute('data-host-sdk'));
  if (!hostPage && global.parent !== global) {
    // In a sandboxed frame: talk to the page that hosts it.
    const pending = new Map();
    let seq = 0;
    // The host puts a secret in this frame's address and in every message it sends; every call carries it back.
    const secret = new URLSearchParams(global.location.search).get('tk');
    const call = (method, params) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      global.parent.postMessage({ host: 1, tk: secret, id, method, params }, '*');
      if (method === 'ui.confirm' || method === 'objects.pick') return; // a question waits as long as the person takes
      setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error('the host did not answer'));
      }, 30000);
    });
    // The theme arrives as CSS custom properties; setting them on :root lets a module's plain CSS follow
    // the theme (var(--bg), var(--text) ...).
    const applyTheme = (theme) => {
      if (!theme) return;
      for (const [name, value] of Object.entries(theme)) document.documentElement.style.setProperty(name, value);
    };
    const built = createHost({
      call,
      root: document,
      rootElement: document.documentElement,
      elementAt: (pt) => document.elementFromPoint(pt.x, pt.y),
      applyTheme,
      // An editor window's top layer is this frame's own, so the host lifts the whole frame over the canvas while one
      // is open (plan-editor-window.md, "A module in a sandboxed frame").
      lift: (open, size, height) => call('editor.lift', { open: Boolean(open), size, height }),
    });
    global.host = built.host;
    global.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.host !== 1 || m.tk !== secret) return;
      if (m.id !== undefined) {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (m.error) {
          const err = new Error(m.error.message || 'failed');
          err.status = m.error.status;
          err.current = m.error.current;
          p.reject(err);
        } else {
          p.resolve(m.result);
        }
      } else if (m.event) {
        if (m.event === 'theme') applyTheme(m.data);
        built.emit(m.event, m.data);
      }
    });
  } else {
    // In the page: the host builds one per module running in the page.
    global.createHost = createHost;
  }

  // `esc`, `markdown`, `plain`, `localWhen` and `detailLines` need no per-module env, so the call page (which loads this file directly for the modules
  // it hosts in the page, not as a module itself) can use the very same rendering Chat and every module share,
  // rather than a second copy. See host.util.markdown above for what this covers.
  global.hostText = { esc, markdown, plain: plainText, localWhen, detailLines, parseClockText, clockText };
  // The currency list likewise, for Manage's Currency (a page, not a module): the same choices a module's currencySelect makes.
  global.hostCurrency = {
    fill: fillCurrencySelect,
    name: currencyName,
    common: COMMON_CURRENCIES.slice(),
    // The same searchable list a module's currencySelect draws, for a page that has no module: select(select, { value, currencies, onChange }).
    select: (select, o) => {
      const page = createHost({
        // `hello` is asked once as the host is made; a page has nothing to tell it (its locale is the page's own: `currencies` below), so the answer is empty.
        call: (method, params) => (method === 'hello' ? Promise.resolve({})
          : method === 'icons.svg'
          ? fetch(`/api/icons/${params.style === 'regular' || params.style === 'brands' ? params.style : 'solid'}/${encodeURIComponent(params.name)}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error('no such icon'))))
          : Promise.reject(new Error('not available on a page'))),
        root: document,
        rootElement: document.documentElement,
        elementAt: (pt) => document.elementFromPoint(pt.x, pt.y),
        applyTheme: () => {},
      });
      return page.host.ui.currencySelect(select, o);
    },
  };
  // The view switch likewise, for the host's own pages: the toolbar a module's switch is drawn in (module-host.js),
  // Chat's Discussion | Assistant (fit only) and a destination's switches draw and fit with these. rove sets the segmented
  // switch's one Tab stop (the keyboard itself is the document's listener above); keydown is that listener, for the checks.
  global.hostSwitch = { fill: fillChoice, fit: fitSwitches, watch: watchSwitches, rove: roveSwitch, keydown: switchKeydown };
})(window);
