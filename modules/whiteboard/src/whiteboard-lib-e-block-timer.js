  // ---- whiteboard-lib-e-block-timer.js: a countdown --------------------------------------------------------------------
  // { ...block, w, h, length, state, startedAt, remaining, fill, stroke, ink }: a clock face that counts down from length
  // (whole seconds). state: 'idle' (not started; remaining is length), 'running' (startedAt is the server's time it counts
  // from, in ms: it ends at startedAt + length * 1000; remaining is what was left when it was started), or 'paused'
  // (remaining is what was left). Every page works out what is left from startedAt and its own guess of the server's
  // clock (the page's now(), lib-c), so nothing is written while it runs: Start, Pause, Reset and a new length are one
  // write each. A copy is never running: it is the same length, not started (copied). A corner changes its size.
  //
  // The face shows the time left (m:ss, or h:mm:ss over an hour) and a ring that empties; at zero it says "Time is up" and
  // pulses gently (still, for someone who asks for less motion). The controls (Start or Pause, Reset, the length) are on
  // the block, only for someone who may change it. What they do, the sounds and the words read out are the page's, through
  // the hooks it sets: now() -> the server's time (ms), controls(block) -> whether to draw the controls, icon(name) -> a
  // promise of an icon's SVG, act(id, what, button) ('start', 'pause', 'reset', 'length'), say(text) (read out once) and
  // done(block) (it reached zero while this page watched). The sums are the plain functions below, tested on their own.
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
  {
    const ticking = new Set(); // the elements of the running timers drawn on this page
    let ticker = 0;
    const sounded = new Set(); // `${id}:${startedAt}`: the ends this page has sounded
    let def = null;
    const now = () => (def.now ? def.now() : Date.now());

    // One timer's face, as it is at `t`: the time, the ring, the words for a screen reader, and the end.
    function show(el, b, t) {
      const left = wbTimerLeft(b, t);
      const up = b.state === 'running' && left <= 0;
      const text = up ? 'Time is up' : wbTimerText(left);
      const face = el.querySelector('.wb-timer-face');
      const time = el.querySelector('.wb-timer-time');
      if (time.textContent !== text) time.textContent = text;
      el.querySelector('.wb-timer-arc').setAttribute('stroke-dasharray', `${b.length ? wbRound1((left / b.length) * 100) : 0} 100`);
      const label = up ? 'Timer: time is up' : `Timer: ${wbTimerWords(left)} left${b.state === 'paused' ? ', paused' : b.state === 'idle' ? ', not started' : ''}`;
      if (face.getAttribute('aria-label') !== label) face.setAttribute('aria-label', label);
      if (up) el.dataset.done = 'true'; else delete el.dataset.done;
      // The end, seen happen here: sounded and said once, not for a timer that ended long before the page saw it.
      const ends = b.state === 'running' ? b.startedAt + b.length * 1000 : Infinity;
      const key = `${b.id}:${b.startedAt}`;
      if (up && el.wbLeft > 0 && t - ends < WB_TIMER_LATE && !sounded.has(key)) {
        sounded.add(key);
        if (def.done) def.done(b);
      }
      el.wbLeft = left;
      return up;
    }
    function tick() {
      const t = now();
      for (const el of [...ticking]) {
        if (!el.isConnected || !el.wbTimer || el.wbTimer.state !== 'running') { ticking.delete(el); continue; }
        // At the end: drawn once more whole, so the controls offer Start again.
        if (show(el, el.wbTimer, t)) { ticking.delete(el); def.render(el.wbTimer, el); }
      }
    }
    // Four times a second while a timer runs here; it stops itself once none does (the page closed: its elements gone).
    function startTicking() {
      if (ticker) return;
      const t = setInterval(() => { if (!ticking.size) { clearInterval(t); ticker = 0; return; } tick(); }, 250);
      ticker = t;
    }
    const button = (cls, what, icon, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `wb-ctl ${cls}`;
      btn.dataset.act = what;
      btn.setAttribute('aria-label', label);
      btn.title = label;
      if (icon) {
        const ic = document.createElement('span');
        ic.className = 'ic wb-ctl-icon';
        ic.setAttribute('aria-hidden', 'true');
        btn.append(ic);
      }
      return btn;
    };
    const setIcon = (btn, name) => {
      const ic = btn.querySelector('.wb-ctl-icon');
      if (!ic || ic.dataset.icon === name) return;
      ic.dataset.icon = name;
      ic.replaceChildren();
      if (def.icon) Promise.resolve(def.icon(name)).then((svg) => { if (ic.dataset.icon === name && svg) ic.innerHTML = svg; }, () => {});
    };

    def = blockTypes.register({
      type: 'timer',
      label: 'Timer',
      paint: { fill: {}, stroke: { label: 'Ring' }, ink: { label: 'Time' } },
      create: () => ({ w: 200, h: 160, length: 300, state: 'idle', startedAt: 0, remaining: 300, fill: 'teal', stroke: 'teal', ink: 'ink' }),
      clean(raw) {
        const length = Number.isInteger(raw.length) && raw.length >= 1 && raw.length <= WB_TIMER_MAX ? raw.length : 300;
        let state = ['idle', 'running', 'paused'].includes(raw.state) ? raw.state : 'idle';
        const startedAt = typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt) && raw.startedAt > 0 && raw.startedAt < 1e14 ? Math.round(raw.startedAt) : 0;
        if (state === 'running' && !startedAt) state = 'idle';
        const r = typeof raw.remaining === 'number' && Number.isFinite(raw.remaining) ? wbRound1(Math.max(0, Math.min(length, raw.remaining))) : length;
        return {
          w: wb.size(raw.w, 160, 200),
          h: wb.size(raw.h, 120, 160),
          length,
          state,
          startedAt: state === 'running' ? startedAt : 0,
          remaining: state === 'idle' ? length : r,
        };
      },
      box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
      resize: { handles: 'corners', min: { w: 160, h: 120 } },
      linked: [['x', 'y', 'w', 'h'], ['length', 'state', 'startedAt', 'remaining']], // its box; where its count stands
      // A copy (copy and paste, duplicate) is the same length, not started.
      copied: (b) => wbTimerReset(b),
      // Hooks the page sets (see the top of this file).
      now: null,
      controls: null,
      icon: null,
      act: null,
      say: null,
      done: null,
      render(b, el) {
        let face = el.querySelector('.wb-timer-face');
        if (!face) {
          face = document.createElement('div');
          face.className = 'wb-timer-face';
          face.setAttribute('role', 'timer');
          face.setAttribute('aria-live', 'off');
          const ring = wb.svg('svg', { class: 'wb-timer-ring', viewBox: '0 0 100 100', 'aria-hidden': 'true' });
          ring.append(
            wb.svg('circle', { class: 'wb-timer-track', cx: 50, cy: 50, r: 44, pathLength: 100 }),
            wb.svg('circle', { class: 'wb-timer-arc', cx: 50, cy: 50, r: 44, pathLength: 100, transform: 'rotate(-90 50 50)' }),
          );
          const time = document.createElement('div');
          time.className = 'wb-timer-time';
          time.setAttribute('aria-hidden', 'true');
          const len = document.createElement('div');
          len.className = 'wb-timer-length';
          len.setAttribute('aria-hidden', 'true');
          face.append(ring, time, len);
          el.replaceChildren(face);
        }
        const was = el.wbTimer;
        el.wbTimer = b;
        el.dataset.state = b.state;
        el.querySelector('.wb-timer-length').textContent = wbTimerShort(b.length);
        // The controls, for someone who may change it.
        const may = Boolean(def.controls && def.controls(b));
        let row = el.querySelector('.wb-timer-ctl');
        if (may && !row) {
          row = document.createElement('div');
          row.className = 'wb-timer-ctl';
          const lengthBtn = button('btn btn-quiet btn-small wb-timer-len', 'length', false, 'Length');
          lengthBtn.setAttribute('aria-haspopup', 'menu');
          row.append(
            button('sdk-icon-btn btn-quiet btn-small', 'start', true, 'Start'),
            button('sdk-icon-btn btn-quiet btn-small', 'reset', true, 'Reset'),
            lengthBtn,
          );
          row.addEventListener('click', (e) => {
            const btn = e.target.closest('.wb-ctl');
            if (btn && def.act) def.act(el.dataset.id, btn.dataset.act, btn);
          });
          el.append(row);
        }
        if (!may && row) { row.remove(); row = null; }
        const t = now();
        const left = wbTimerLeft(b, t);
        if (row) {
          const go = row.querySelector('[data-act="start"], [data-act="pause"]');
          const running = b.state === 'running' && left > 0;
          const word = running ? 'Pause' : b.state === 'paused' ? 'Go on' : b.state === 'running' ? 'Start again' : 'Start';
          go.dataset.act = running ? 'pause' : 'start';
          go.setAttribute('aria-label', word);
          go.title = word;
          setIcon(go, running ? 'pause' : 'play');
          setIcon(row.querySelector('[data-act="reset"]'), 'rotate-left');
          const lb = row.querySelector('.wb-timer-len');
          lb.textContent = wbTimerShort(b.length);
          lb.setAttribute('aria-label', `Length: ${wbTimerWords(b.length)}. Change it`);
          lb.title = 'Length';
        }
        el.wbLeft = was && was.id === b.id && was.state === 'running' && b.state === 'running' && was.startedAt === b.startedAt ? el.wbLeft : left;
        show(el, b, t);
        // Started, paused, reset or set again (here or by someone else): said once; the seconds themselves are not.
        if (was && def.say && (was.state !== b.state || was.startedAt !== b.startedAt || was.length !== b.length)) {
          if (b.state === 'running' && left > 0) def.say(`Timer started: ${wbTimerWords(left)} left.`);
          else if (b.state === 'paused') def.say(`Timer paused: ${wbTimerWords(left)} left.`);
          else if (b.state === 'idle') def.say(`Timer set to ${wbTimerWords(b.length)}.`);
        }
        if (b.state === 'running' && left > 0) {
          ticking.add(el);
          startTicking();
        } else ticking.delete(el);
      },
      // Saved as a picture or printed (lib-l): its face as it is now, without the controls (the length then shows under
      // the time, as it does for someone with no controls).
      exported(b, el) {
        const row = el.querySelector('.wb-timer-ctl');
        if (row) row.remove();
      },
      describe: (b) => {
        const left = wbTimerLeft(b, now());
        if (b.state === 'running' && left <= 0) return 'Timer: time is up';
        return `Timer, ${wbTimerShort(b.length)}${b.state === 'running' ? ', running' : b.state === 'paused' ? `, paused with ${wbTimerWords(left)} left` : ''}`;
      },
    });
  }
