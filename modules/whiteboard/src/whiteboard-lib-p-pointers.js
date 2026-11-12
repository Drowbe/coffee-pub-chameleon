  // ---- whiteboard-lib-p-pointers.js: other people's pointers, live ------------------------------------------------------
  //
  // While a person's pointer moves over the board, where it is goes to everyone else on this board as a live message
  // (host.live, topic 'pointer'): { x, y, tool } in board units (so each person's own pan and zoom don't matter), at most
  // one every WB_LIVE.gap milliseconds with the last place always sent, nothing while it rests, and one { gone: true } when
  // it leaves the board. Each person's page draws everyone else's pointer: an arrow in their colour and their name. Live
  // messages are not stored: nothing here touches the board's data or the history. The work is plain functions and two
  // small objects with the clock handed in; whiteboard.js has the events and the drawing.
  const WB_LIVE = Object.freeze({
    topic: 'pointer', // the start of a board's topic: `pointer.<board id>` (wbLiveTopic); the host allows a-z 0-9 . _ - up to 40
    gap: 50, // milliseconds between two messages: 20 a second at most (the host's limit for a module)
    fade: 5000, // milliseconds without a word from a person before their pointer is dimmed
    drop: 20000, // ... and before it is taken away
    cap: 50, // the most pointers drawn; past it the one heard from longest ago goes
    range: 1e6, // a place further out than this, either way, is held to it
    name: 24, // the most characters of a name shown (a longer one ends in …)
    key: 'whiteboard-pointers', // this browser's choice: '0' hides other people's pointers
    // The tools a pointer may say it is using: the board's own tool ids, nothing else.
    tools: Object.freeze(['select', 'hand', 'pen', 'marker', 'brush', 'highlight', 'fill', 'eraser', 'note', 'text', 'rect', 'ellipse',
      'line', 'arrow', 'rounded', 'diamond', 'pill', 'parallelogram', 'connector', 'frame', 'table']),
    tints: Object.freeze(['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red']),
  });
  // The live topic of one board's pointers: `pointer.<board id>` (a board id is 'main' or 8 lowercase letters and digits, so this is
  // always inside the host's rule: 1 to 40 of a-z, 0-9, dot, underscore, dash). null for anything that is not a board id.
  const wbLiveTopic = (boardId) => (typeof boardId === 'string' && /^[a-z0-9]{1,24}$/.test(boardId) ? `${WB_LIVE.topic}.${boardId}` : null);

  // Which board's pointers this page hears and sends: one topic at a time. use(boardId) closes the old subscription, drops
  // what was shown (clear()), and opens the new topic; a message that arrives on a topic that is no longer the open one is ignored
  // (a hard guard), and publish(data, topic) sends only when that topic is still the open one. live: host.live.
  function createWbLiveFollow({ live, handle, clear = () => {} }) {
    let topic = null;
    let off = null;
    const close = () => { const o = off; off = null; topic = null; if (typeof o === 'function') { try { o(); } catch { /* closed anyway */ } } };
    return {
      use(boardId) {
        close();
        clear();
        const t = wbLiveTopic(boardId);
        if (!t) return null;
        topic = t;
        off = live.subscribe(t, (data, from) => { if (topic === t) handle(data, from); });
        return t;
      },
      close,
      publish(data, forTopic) { if (!topic || (forTopic !== undefined && forTopic !== topic)) return undefined; return live.publish(topic, data); },
      get topic() { return topic; },
    };
  }
  const WB_LIVE_GONE = Object.freeze({ gone: true });
  const wbLiveTool = (t) => (typeof t === 'string' && t.length <= 20 && WB_LIVE.tools.includes(t) ? t : null);
  const wbLiveNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(WB_LIVE.range, Math.max(-WB_LIVE.range, v)) : null);
  const wbLiveOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // What is sent for a place on the board: { x, y } in whole board units (held to the range), and the tool when it is one
  // of the board's own. null for a place that is not a number.
  function wbLivePayload(p, tool) {
    const x = p ? wbLiveNum(p.x) : null;
    const y = p ? wbLiveNum(p.y) : null;
    if (x === null || y === null) return null;
    const out = { x: Math.round(x), y: Math.round(y) };
    const t = wbLiveTool(tool);
    if (t) out.tool = t;
    return out;
  }

  // Whether this page sends its pointer now: the live messages open, the page in sight, not presenting (a person's own
  // read-through), and the pointer over the board itself (not its find bar, a menu, the toolbar).
  const wbLiveMaySend = ({ state, hidden, presenting, over }) => state === 'open' && !hidden && !presenting && Boolean(over);

  // The sender: move(payload) for each place (or a function answering it, asked only when it goes), leave() when the
  // pointer goes. send(data) is the page's publish; whatever it
  // does (a refusal, a throw, a rejected promise) is dropped quietly and never tried again. The first move after a quiet
  // spell goes at once; the next ones wait for the gap, and only the newest waits (so the last place always goes). With
  // nothing to send there is no timer at all. leave() sends { gone: true } once, and only after a place was sent.
  function createWbLiveSender({ send, now = () => Date.now(), later = (fn, ms) => setTimeout(fn, ms), gap = WB_LIVE.gap }) {
    let last = -Infinity; // when the last message went
    let waiting = null; // the newest message waiting for the gap
    let timer = null;
    let shown = false; // a place went since the last leave: the others draw this pointer
    const go = (data) => {
      last = now();
      try {
        const d = typeof data === 'function' ? data() : data; // a place worked out only when it goes
        if (!d) return;
        const r = send(d);
        if (r && typeof r.then === 'function') r.then(null, () => {});
      } catch { /* refused: dropped */ }
    };
    const flush = () => {
      timer = null;
      const data = waiting;
      waiting = null;
      if (data) go(data);
    };
    const queue = (data) => {
      const wait = last + gap - now();
      if (wait <= 0 && timer === null) { go(data); return; }
      waiting = data;
      if (timer === null) timer = later(flush, Math.max(0, wait));
    };
    return {
      move(data) {
        if (!data) return;
        shown = true;
        queue(data);
      },
      leave() {
        if (!shown) return; // nothing shown, or its leave already waiting
        shown = false;
        queue(WB_LIVE_GONE); // in place of any place still waiting
      },
      get busy() { return timer !== null; },
      get shown() { return shown; },
    };
  }

  // A message as heard, checked: { key, name, guest, tint, gone: true } or { key, name, guest, tint, x, y, tool }, or null
  // to ignore it (this person's own, a sender or data that isn't what a pointer sends). Only the fields known here are
  // read, each checked; nothing of the message is kept as it came. tint(key) is the host's colour for a key; a name that
  // is not one of the eight is null (the page draws a neutral colour).
  function wbLiveRead(data, from, { me = '', tint = null } = {}) {
    if (!from || typeof from !== 'object' || Array.isArray(from)) return null;
    const key = from.key;
    if (typeof key !== 'string' || !key || key.length > 64 || key === me) return null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const guest = from.guest === true;
    const chars = typeof from.name === 'string' ? Array.from(from.name.replace(/\s+/g, ' ').trim()) : [];
    let name = chars.length > WB_LIVE.name ? `${chars.slice(0, WB_LIVE.name - 1).join('').trim()}…` : chars.join('');
    if (!name && !guest) name = 'Someone'; // a nameless guest is named by their role (wbLiveLabel)
    let colour = null;
    try { colour = tint ? tint(key) : null; } catch { colour = null; }
    if (!WB_LIVE.tints.includes(colour)) colour = null;
    const who = { key, name, guest, tint: colour };
    if (wbLiveOwn(data, 'gone') && data.gone === true) return { ...who, gone: true };
    const x = wbLiveOwn(data, 'x') ? wbLiveNum(data.x) : null;
    const y = wbLiveOwn(data, 'y') ? wbLiveNum(data.y) : null;
    if (x === null || y === null) return null;
    return { ...who, x, y, tool: wbLiveOwn(data, 'tool') ? wbLiveTool(data.tool) : null };
  }

  // The words on a pointer's tag: the name, and the guest role's word after a guest's (as the environment says it:
  // roleWord is host.util.word for that role), or that word alone for a guest with no name.
  // A guest's name from the server already ends in the role's word in brackets ("Gil (Guest)"); it is then shown as it is.
  const wbLiveLabel = (p, roleWord) => {
    if (!p.guest) return p.name;
    if (!p.name) return String(roleWord);
    const marked = String(p.name).toLowerCase().endsWith(`(${String(roleWord).toLowerCase()})`);
    return marked ? p.name : `${p.name} (${roleWord})`;
  };

  // The pointers heard, by person: a Map keyed by the sender's key, in the order last heard (the oldest first). put() a
  // checked message (lib's wbLiveRead) at a time; a gone one takes the pointer away. Past the cap the oldest goes.
  // sweep(now) takes away those quiet past WB_LIVE.drop and answers whether any changed; faded(p, now) tells a quiet one.
  function createWbLiveStore({ cap = WB_LIVE.cap, fade = WB_LIVE.fade, drop = WB_LIVE.drop } = {}) {
    const all = new Map();
    return {
      put(msg, now) {
        if (!msg) return null;
        if (msg.gone) { all.delete(msg.key); return null; }
        all.delete(msg.key); // to the end: heard last
        const p = { key: msg.key, name: msg.name, guest: msg.guest, tint: msg.tint, x: msg.x, y: msg.y, tool: msg.tool, at: now };
        all.set(msg.key, p);
        while (all.size > cap) all.delete(all.keys().next().value);
        return p;
      },
      remove(key) { return all.delete(key); },
      clear() { const had = all.size > 0; all.clear(); return had; },
      sweep(now) {
        let changed = false;
        for (const [k, p] of all) if (now - p.at >= drop) { all.delete(k); changed = true; }
        return changed;
      },
      faded: (p, now) => now - p.at >= fade,
      get: (key) => all.get(key),
      list: () => [...all.values()],
      get size() { return all.size; },
    };
  }

  // Whether other people's pointers are drawn: shown here, and the live messages open.
  const wbLiveDrawn = ({ on, state }) => Boolean(on) && state === 'open';

  // This browser's choice (store() -> localStorage; it may throw, or there may be none): shown unless it says '0'.
  // Saving answers whether it was kept.
  function wbLiveLoad(store) {
    try { const s = store(); return !s || s.getItem(WB_LIVE.key) !== '0'; } catch { return true; }
  }
  function wbLiveSave(store, on) {
    try { const s = store(); if (!s) return false; s.setItem(WB_LIVE.key, on ? '1' : '0'); return true; } catch { return false; }
  }
