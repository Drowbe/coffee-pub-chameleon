  // ---- whiteboard-lib-e-block-timer.js: a countdown --------------------------------------------------------------------
  // The board's one timer is a clock over the board (not on it): { ...block, length, state, startedAt, remaining, view }, where
  // length is in whole seconds, state is 'idle' (not started; remaining is length), 'running' (startedAt is the server's
  // time it counts from, in ms: it ends at startedAt + length * 1000; remaining is what was left when it was started) or
  // 'paused' (remaining is what was left), and view is 'radial' (a ring with the time inside) or 'horizontal' (large digits
  // like an alarm clock). The block is only the shared state: it is saved and heard like any block, but it is `floating`
  // (lib-a, lib-d): never drawn on the board, never picked, copied, arranged, found, overviewed or saved as a picture. If a
  // board has several (an old one), the oldest is the timer (wbTimerPick) and the others are left alone. Every page works
  // out what is left from startedAt and its own guess of the server's clock (the page's now(), lib-c), so nothing is written
  // while it runs: Start, Pause, Reset, a new length and the view are one write each.
  //
  // The clock is each person's own: where it sits (dragged, or moved with the arrow keys) and whether it is shown are kept in
  // this browser (position(), hidden()); the time and state are shared. Its size does not change with the board's zoom or
  // pan. Clicking the time asks for a length (the page's menu: act(id, 'length', button)). At zero it pulses gently (still,
  // for someone who asks for less motion), says "Time is up" and the page sounds it. What the buttons do, the sounds and
  // the words read out are the page's, through the hooks it sets (listed at the end). The sums are the plain functions
  // below, tested on their own.
  const WB_TIMER_LENGTHS = [60, 120, 300, 600, 900, 1800]; // the length menu's choices, in seconds
  const WB_TIMER_MAX = 86400 - 1; // the longest timer: a second short of a day
  const WB_TIMER_LATE = 10000; // ms: a timer that ended longer ago than this when the page saw it is not sounded
  const wbRound1 = (n) => Math.round(n * 10) / 10;
  // Seconds left now (a number from 0 to length), `now` the server's time in ms. A running timer whose start is after now
  // (two clocks that differ) has all its length left; one that ended has none.
  function wbTimerLeft(b, now) {
    if (b.state !== 'running') return Math.max(0, Math.min(b.length, b.remaining));
    const left = b.length - (now - b.startedAt) / 1000;
    return Number.isFinite(left) ? Math.max(0, Math.min(b.length, left)) : b.length;
  }
  // The fields that Start, Pause, Reset and a new length change. Start goes on from a pause, else from the whole length
  // (also when it has ended); its startedAt is put back by the time already gone, so it ends at startedAt + length.
  function wbTimerStart(b, now) {
    let left = b.state === 'paused' ? b.remaining : b.state === 'running' ? wbTimerLeft(b, now) : b.length;
    if (!(left > 0)) left = b.length;
    return { state: 'running', startedAt: Math.round(now - (b.length - left) * 1000), remaining: wbRound1(left) };
  }
  function wbTimerPause(b, now) { return { state: 'paused', startedAt: 0, remaining: wbRound1(wbTimerLeft(b, now)) }; }
  function wbTimerReset(b) { return { state: 'idle', startedAt: 0, remaining: b.length }; }
  function wbTimerSetLength(seconds) {
    const n = Math.max(1, Math.min(WB_TIMER_MAX, Math.round(seconds)));
    return { length: n, state: 'idle', startedAt: 0, remaining: n };
  }
  // The time as the face shows it: whole seconds, rounded up (0:00 only at the end). "04:59"; "1:05:00" over an hour.
  function wbTimerText(seconds) {
    const s = Math.max(0, Math.ceil(seconds - 1e-6));
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
  }
  // The same in words: "4 minutes 30 seconds", "1 hour 5 minutes", "under a second".
  function wbTimerWords(seconds) {
    const s = Math.max(0, Math.ceil(seconds - 1e-6));
    if (!s) return 'no time';
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
    const part = (n, one) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '');
    return [part(h, 'hour'), part(m, 'minute'), part(r, 'second')].filter(Boolean).join(' ');
  }
  // The length as a menu shows it: "5 min", "1 min 30 s", "1 h 5 min".
  function wbTimerShort(seconds) {
    const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const r = seconds % 60;
    return [h ? `${h} h` : '', m ? `${m} min` : '', r ? `${r} s` : ''].filter(Boolean).join(' ') || '0 s';
  }
  // The oldest timer block is THE timer (the others are not drawn): the lowest z (it is never moved, so it keeps its place in
  // the order the blocks were made), then the earliest save, then the id. Null for none.
  function wbTimerPick(blocks) {
    let best = null;
    for (const b of blocks) {
      if (!b || b.type !== 'timer') continue;
      if (!best || b.z < best.z || (b.z === best.z && ((b.at || '') < (best.at || '') || ((b.at || '') === (best.at || '') && b.id < best.id)))) best = b;
    }
    return best;
  }
  // The font size (px) that puts `text` ("59:59", "23:59:59") inside a ring `ring` px wide without touching it: a digit is about
  // 0.62 em wide, a colon 0.32, the line 0.8 em tall, and the text's corners stay inside the circle that is left within the
  // ring's stroke (0.37 of the ring's width).
  function wbTimerFit(ring, text) {
    const k = [...String(text)].reduce((w, c) => w + (c === ':' ? 0.32 : 0.62), 0) || 1;
    const reach = ring * 0.37;
    return Math.max(10, Math.min(ring * 0.3, Math.floor(reach / Math.sqrt((k * k) / 4 + 0.16))));
  }
  // Where the clock goes: `pos` ({ x, y } or null: bottom left, a gap above the bottom) moved inside `area` ({ w, h }) for a
  // clock `size` ({ w, h }). A clock bigger than the area sits at the top left.
  function wbTimerPlace(pos, size, area, gap = 8) {
    const maxX = Math.max(0, area.w - size.w);
    const maxY = Math.max(0, area.h - size.h);
    const ok = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y);
    const x = ok ? pos.x : gap;
    const y = ok ? pos.y : area.h - size.h - gap;
    return { x: Math.round(Math.max(0, Math.min(maxX, x))), y: Math.round(Math.max(0, Math.min(maxY, y))) };
  }
  {
    let def = null;
    const now = () => (def.now ? def.now() : Date.now());
    const blocks = new Map(); // the timer blocks on this page (all of them: the oldest is the timer)
    const sounded = new Set(); // `${id}:${startedAt}`: the ends this page has sounded
    let clock = null; // the clock's parts, once made
    let shown = null; // the timer block as the clock last drew it
    let ticker = 0;
    const GAP = 8;
    const the = () => wbTimerPick([...blocks.values()]);

    const button = (cls, what, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sdk-icon-btn btn-quiet btn-small wb-timer-btn ${cls}`;
      btn.dataset.act = what;
      btn.setAttribute('aria-label', label);
      btn.dataset.tip = label;
      const ic = document.createElement('span');
      ic.className = 'ic';
      ic.setAttribute('aria-hidden', 'true');
      btn.append(ic);
      return btn;
    };
    const setIcon = (btn, name) => {
      const ic = btn.querySelector('.ic');
      if (!ic || ic.dataset.icon === name) return;
      ic.dataset.icon = name;
      ic.replaceChildren();
      if (def.icon) Promise.resolve(def.icon(name)).then((svg) => { if (ic.dataset.icon === name && svg) ic.innerHTML = svg; }, () => {});
    };
    const setLabel = (btn, label) => { btn.setAttribute('aria-label', label); btn.dataset.tip = label; };
    const store = (k) => (def.store ? def.store(k) : null);
    const area = () => ({ w: def.layer.clientWidth, h: def.layer.clientHeight });

    function make() {
      const el = document.createElement('div');
      el.className = 'wb-timer';
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', 'Timer');
      el.tabIndex = 0;
      el.hidden = true;
      const face = document.createElement('div');
      face.className = 'wb-timer-face';
      face.setAttribute('role', 'timer');
      face.setAttribute('aria-live', 'off');
      const ring = wb.svg('svg', { class: 'wb-timer-ring', viewBox: '0 0 100 100', 'aria-hidden': 'true' });
      ring.append(
        wb.svg('circle', { class: 'wb-timer-track', cx: 50, cy: 50, r: 44, pathLength: 100 }),
        wb.svg('circle', { class: 'wb-timer-arc', cx: 50, cy: 50, r: 44, pathLength: 100, transform: 'rotate(-90 50 50)' }),
      );
      const time = document.createElement('button');
      time.type = 'button';
      time.className = 'wb-timer-time';
      time.dataset.act = 'length';
      time.setAttribute('aria-haspopup', 'menu');
      const bar = document.createElement('div');
      bar.className = 'wb-timer-bar';
      bar.setAttribute('aria-hidden', 'true');
      bar.append(document.createElement('i'));
      face.append(ring, time, bar);
      const ctl = document.createElement('div');
      ctl.className = 'wb-timer-ctl';
      const reset = button('wb-timer-reset', 'reset', 'Reset');
      const go = button('wb-timer-go', 'start', 'Start');
      const view = button('wb-timer-view', 'view', 'Horizontal view');
      ctl.append(reset, go, view);
      const close = button('wb-timer-close', 'hide', 'Hide the timer');
      el.append(face, ctl, close);
      def.layer.append(el);
      clock = { el, face, time, arc: ring.querySelector('.wb-timer-arc'), bar: bar.firstChild, ctl, reset, go, view, close };
      setIcon(reset, 'rotate-left');
      setIcon(close, 'xmark');
      wire(el);
      if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (!el.hidden) place(); }).observe(def.layer);
    }

    // Clicks on the clock's buttons and the time.
    function wire(el) {
      el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn || !shown) return;
        if (btn.dataset.act === 'hide') { if (def.hide) def.hide(); return; }
        if (btn.classList.contains('wb-timer-static')) return;
        if (def.act) def.act(shown.id, btn.dataset.act, btn);
      });
      // Moved by dragging anywhere that is not a button, or with the arrow keys while the clock has the keyboard.
      let drag = null;
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (e.target.closest('button')) return;
        const r = el.getBoundingClientRect();
        drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, from: { x: el.offsetLeft, y: el.offsetTop }, moved: false };
        try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        el.classList.add('wb-timer-dragging');
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const box = def.layer.getBoundingClientRect();
        drag.moved = true;
        put(wbTimerPlace({ x: e.clientX - box.left - drag.dx, y: e.clientY - box.top - drag.dy }, size(), area()));
      });
      const end = (e, cancel) => {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        const d = drag;
        drag = null;
        el.classList.remove('wb-timer-dragging');
        try { el.releasePointerCapture(d.id); } catch { /* already free */ }
        if (cancel) put(d.from);
        else if (d.moved) save({ x: el.offsetLeft, y: el.offsetTop });
      };
      el.addEventListener('pointerup', (e) => end(e, false));
      el.addEventListener('pointercancel', (e) => end(e, true));
      el.addEventListener('keydown', (e) => {
        e.stopPropagation(); // the board's keys are not the clock's
        if (e.key === 'Escape') {
          e.preventDefault();
          if (drag) end(null, true); else if (def.leave) def.leave();
          return;
        }
        if (e.target !== el) return;
        const step = e.shiftKey ? 32 : 8;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d) return;
        e.preventDefault();
        const p = wbTimerPlace({ x: el.offsetLeft + d[0], y: el.offsetTop + d[1] }, size(), area());
        put(p);
        save(p);
      });
      for (const type of ['keyup', 'click', 'dblclick', 'wheel', 'copy', 'cut', 'paste']) el.addEventListener(type, (e) => e.stopPropagation());
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('contextmenu', (e) => { e.stopPropagation(); e.preventDefault(); if (def.menu) def.menu(e); });
    }
    const size = () => ({ w: clock.el.offsetWidth, h: clock.el.offsetHeight });
    const put = (p) => { clock.el.style.left = `${p.x}px`; clock.el.style.top = `${p.y}px`; };
    function save(p) { const s = store('pos'); if (s) s.set(p); }
    // Inside the board: where this person left it, else bottom left. Also puts a saved place that no longer fits back in.
    function place() {
      const s = store('pos');
      put(wbTimerPlace(s ? s.get() : null, size(), area(), GAP));
    }

    // The clock as it is at `t`: the time, the ring or bar, the words for a screen reader, and the end.
    function paint(b, t) {
      const left = wbTimerLeft(b, t);
      const up = b.state === 'running' && left <= 0;
      const text = wbTimerText(left);
      const { el, time } = clock;
      if (time.textContent !== text) time.textContent = text;
      const radial = b.view !== 'horizontal';
      if (radial) {
        const ring = clock.face.offsetWidth || 104;
        const f = `${wbTimerFit(ring, text)}px`;
        if (time.style.fontSize !== f) time.style.fontSize = f;
      } else if (time.style.fontSize) time.style.fontSize = '';
      const frac = b.length ? Math.max(0, Math.min(1, left / b.length)) : 0;
      clock.arc.setAttribute('stroke-dasharray', `${wbRound1(frac * 100)} 100`);
      clock.bar.style.width = `${wbRound1(frac * 100)}%`;
      const label = up ? 'Timer: time is up' : `Timer: ${wbTimerWords(left)} left${b.state === 'paused' ? ', paused' : b.state === 'idle' ? ', not started' : ''}`;
      if (clock.face.getAttribute('aria-label') !== label) clock.face.setAttribute('aria-label', label);
      if (up) el.dataset.done = 'true'; else delete el.dataset.done;
      return { left, up };
    }
    // The end seen happen here: sounded and said once, not for a timer that ended long before the page saw it.
    function ending(b, t, left) {
      const up = b.state === 'running' && left <= 0;
      const ends = b.state === 'running' ? b.startedAt + b.length * 1000 : Infinity;
      const key = `${b.id}:${b.startedAt}`;
      if (up && ending.was > 0 && t - ends < WB_TIMER_LATE && !sounded.has(key)) {
        sounded.add(key);
        if (def.done) def.done(b);
      }
      ending.was = left;
    }
    ending.was = 0;

    function tick() {
      const b = the();
      if (!b || b.state !== 'running') { stop(); return; }
      const t = now();
      const left = clock && !clock.el.hidden ? paint(b, t).left : wbTimerLeft(b, t);
      ending(b, t, left);
      if (left <= 0) { stop(); if (clock && !clock.el.hidden) refresh(); }
    }
    function stop() { if (ticker) { clearInterval(ticker); ticker = 0; } }
    // Four times a second while it runs here; it stops itself at the end or when the timer goes.
    function go() {
      if (ticker) return;
      const t = setInterval(() => {
        if (!def.layer || !def.layer.isConnected) { clearInterval(t); ticker = 0; return; } // the page is gone
        tick();
      }, 250);
      ticker = t;
    }

    // Draw the clock from the timer block now (or hide it).
    function refresh() {
      const b = the();
      if (!def.layer) return;
      if (!b) { shown = null; stop(); if (clock) clock.el.hidden = true; if (def.changed) def.changed(); return; }
      const was = shown;
      shown = b;
      const t = now();
      const left = wbTimerLeft(b, t);
      if (!was || was.id !== b.id || was.state !== 'running' || b.state !== 'running' || was.startedAt !== b.startedAt) ending.was = left;
      const visible = !(def.hidden && def.hidden());
      if (!visible && clock) clock.el.hidden = true;
      if (visible) {
        if (!clock) make();
        const { el } = clock;
        const wasHidden = el.hidden;
        el.hidden = false;
        el.dataset.view = b.view === 'horizontal' ? 'horizontal' : 'radial';
        el.dataset.state = b.state;
        const may = Boolean(def.controls && def.controls(b));
        clock.ctl.hidden = !may;
        clock.close.hidden = !(def.canHide && def.canHide());
        clock.time.classList.toggle('wb-timer-static', !may);
        clock.time.tabIndex = may ? 0 : -1;
        setLabel(clock.time, may ? 'Set the time' : `Timer: ${wbTimerWords(left)} left`);
        const running = b.state === 'running' && left > 0;
        clock.go.dataset.act = running ? 'pause' : 'start';
        setLabel(clock.go, running ? 'Pause' : 'Start');
        setIcon(clock.go, running ? 'pause' : 'play');
        const horizontal = b.view === 'horizontal';
        clock.view.dataset.act = 'view';
        setLabel(clock.view, horizontal ? 'Radial view' : 'Horizontal view');
        setIcon(clock.view, horizontal ? 'circle-notch' : 'ruler-horizontal');
        paint(b, t);
        if (wasHidden || !was || was.view !== b.view) place();
      }
      // Started, paused, reset or set again (here or by someone else): said once; the seconds themselves are not.
      if (was && def.say && (was.state !== b.state || was.startedAt !== b.startedAt || was.length !== b.length)) {
        if (b.state === 'running' && left > 0) def.say(`Timer started: ${wbTimerWords(left)} left.`);
        else if (b.state === 'paused') def.say(`Timer paused: ${wbTimerWords(left)} left.`);
        else if (b.state === 'idle') def.say(`Timer set to ${wbTimerWords(b.length)}.`);
      }
      if (b.state === 'running' && left > 0) go(); else stop();
      if (def.changed) def.changed();
    }

    def = blockTypes.register({
      type: 'timer',
      label: 'Timer',
      floating: true,
      create: () => ({ w: 200, h: 160, length: 300, state: 'idle', startedAt: 0, remaining: 300, view: 'radial' }),
      clean(raw) {
        const length = Number.isInteger(raw.length) && raw.length >= 1 && raw.length <= WB_TIMER_MAX ? raw.length : 300;
        let state = ['idle', 'running', 'paused'].includes(raw.state) ? raw.state : 'idle';
        const startedAt = typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt) && raw.startedAt > 0 && raw.startedAt < 1e14 ? Math.round(raw.startedAt) : 0;
        if (state === 'running' && !startedAt) state = 'idle';
        const r = typeof raw.remaining === 'number' && Number.isFinite(raw.remaining) ? wbRound1(Math.max(0, Math.min(length, raw.remaining))) : length;
        return {
          w: wb.size(raw.w, 160, 200), // no longer used: kept so an old timer still loads
          h: wb.size(raw.h, 120, 160),
          length,
          state,
          startedAt: state === 'running' ? startedAt : 0,
          remaining: state === 'idle' ? length : r,
          view: raw.view === 'horizontal' ? 'horizontal' : 'radial',
        };
      },
      box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
      linked: [['length', 'state', 'startedAt', 'remaining']], // where its count stands
      // The renderer hands the timer blocks here instead of drawing them (lib-d).
      float(b) { blocks.set(b.id, b); refresh(); },
      floatGone(id) { blocks.delete(id); refresh(); },
      // The clock shows or hides, or sits somewhere else (the page changed a setting): drawn again.
      redraw: () => refresh(),
      // The timer block now, for the page's toolbar and menus.
      current: () => the(),
      // The clock's own parts, for the page and the checks.
      clock: () => (clock ? clock.el : null),
      // Hooks the page sets: layer (the element the clock is put in), now() -> the server's time (ms), controls(block) ->
      // whether to draw the controls and the time as a button, canHide() -> whether the clock has a close button,
      // hidden() -> whether this person has hidden the clock, store('pos') -> { get, set } for where the clock is kept,
      // hide() (the close button), leave() (Escape: the keyboard goes back to the board), menu(event) (a right press),
      // icon(name) -> a promise of an icon's SVG, act(id, what, button) ('start', 'pause', 'reset', 'length', 'view'),
      // say(text) (read out once), done(block) (it reached zero while this page watched) and changed() (the clock was drawn
      // or taken away: the toolbar's button shows whether it is on).
      layer: null,
      now: null,
      controls: null,
      canHide: null,
      hidden: null,
      store: null,
      hide: null,
      leave: null,
      menu: null,
      icon: null,
      act: null,
      say: null,
      done: null,
      changed: null,
      render() {},
      describe: (b) => `Timer, ${wbTimerShort(b.length)}`,
    });
  }
