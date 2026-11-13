/*
 * sync-bus.mjs -- the stand-ins the co-editing channel tests share: a manual clock, a bus that stands for host.live (it can drop, duplicate, reorder and
 * refuse messages, and stamps the server's seq and `from`), and run(), which moves the clock and delivers as it goes. A copy of the ones in
 * check-documents-coedit-sync.mjs (which keeps its own). Not a test.
 */
const micro = async (n = 6) => { for (let i = 0; i < n; i += 1) await Promise.resolve(); };
export { micro };
export class Clock {
  constructor() { this.t = 1000; this.timers = []; this.n = 0; }
  now() { return this.t; }
  set(fn, ms) { const id = (this.n += 1); this.timers.push({ id, at: this.t + Math.max(0, ms), fn }); return id; }
  clear(id) { this.timers = this.timers.filter((x) => x.id !== id); }
  api() { return { now: () => this.now(), set: (f, ms) => this.set(f, ms), clear: (i) => this.clear(i) }; }
}
export class Bus {
  constructor(clock, { bytes = 2048, paceMs = 0 } = {}) { this.paceMs = paceMs; this.clock = clock; this.members = new Map(); this.seq = 0; this.bytes = bytes; this.drop = () => false; this.dup = () => false; this.log = []; this.held = null; this.refuse = null; }
  connect(key, name = key, opt = {}) {
    const m = { key, name, subs: new Map(), people: [], state: 'open', ups: [], hidden: Boolean(opt.hidden) };
    this.members.set(key, m);
    const bus = this;
    const live = {
      get state() { return m.state; },
      subscribe(topic, fn) { m.subs.set(topic, fn); return () => m.subs.delete(topic); },
      on(ev, fn) {
        if (ev === 'state') { m.stateFn = fn; return () => { m.stateFn = null; }; }
        m.peopleFn = fn;
        Promise.resolve().then(() => fn({ joined: null, left: null, people: bus.people() }));
        return () => { m.peopleFn = null; };
      },
      publish(topic, data, opt) {
        if (m.state !== 'open') return Promise.reject(Object.assign(new Error('closed'), { status: 503 }));
        const n = JSON.stringify(data).length;
        if (n > bus.bytes) return Promise.reject(Object.assign(new Error('too big'), { status: 413 }));
        if (bus.refuse) { const r = bus.refuse(topic, data); if (r) return Promise.reject(r); }
        bus.seq += 1;
        const msg = { topic, data: JSON.parse(JSON.stringify(data)), from: { key: m.key, name: m.name, guest: false, tint: 'blue' }, seq: bus.seq, to: opt && opt.to ? opt.to : null, bytes: n };
        bus.log.push({ topic, bytes: n, from: key, to: msg.to, kind: Object.keys(data).join('') });
        // paceMs: the module's rate (30 messages a second is 33 ms): the publish is answered, and the message goes, after that long
        if (bus.paceMs) return new Promise((resolve) => { bus.clock.set(() => { bus.pending.push(msg); resolve(true); }, bus.paceMs); });
        bus.pending.push(msg);
        return Promise.resolve(true);
      },
    };
    this.pending = this.pending || [];
    m.live = live;
    for (const o of this.members.values()) if (o.peopleFn) o.peopleFn({ joined: o === m ? null : { key, name, guest: false, tint: 'blue' }, left: null, people: this.people() });
    return m;
  }
  people() { return [...this.members.values()].filter((x) => !x.hidden).map((x) => ({ key: x.key, name: x.name, guest: false, tint: 'blue' })); }
  disconnect(key) { const m = this.members.get(key); this.members.delete(key); for (const o of this.members.values()) if (o.peopleFn) o.peopleFn({ joined: null, left: { key, name: key, guest: false, tint: 'blue' }, people: this.people() }); return m; }
  flush() {
    const out = this.pending.splice(0);
    let n = 0;
    for (const msg of out) {
      if (this.drop(msg)) continue;
      for (const [k, m] of this.members) {
        if (k === msg.from.key || (msg.to && !msg.to.includes(k)) || m.state !== 'open') continue;
        const fn = m.subs.get(msg.topic);
        if (!fn) continue;
        for (let c = this.dup(msg) ? 2 : 1; c > 0; c -= 1) fn(JSON.parse(JSON.stringify(msg.data)), { ...msg.from }, { topic: msg.topic, at: this.clock.now(), seq: msg.seq });
        n += 1;
      }
    }
    return n;
  }
}
// runs the clock forward, delivering as it goes
export async function run(clock, bus, ms, step = 5) {
  const end = clock.t + ms;
  while (clock.t < end) {
    clock.t += step;
    for (const tm of clock.timers.filter((x) => x.at <= clock.t).sort((a, b) => a.at - b.at)) { clock.timers = clock.timers.filter((x) => x !== tm); tm.fn(); }
    await micro();
    bus.flush();
    await micro();
    bus.flush();
  }
}

