/*
 * fake-store.mjs -- a stand-in for the module's storage (host.storage over PUT /api/modules/:id/data/:key), for the co-editing save and seed tests. Not a test.
 *
 * It keeps the rules the server was read to have (read as code, not run here): `version` is a compare-and-set where the expected number is compared with
 * (existing ? existing.version : 0), so version 0 means "create if absent", and a 409 carries `current`; keys match /^[A-Za-z0-9_.:/-]{1,128}$/; one value is
 * at most 60 KB serialized (413); the module holds at most 5 MB (413 "storage is full"); a person may write 240 times a minute (429, retryAfter in seconds);
 * a person without `edit` cannot write (403). Every call waits a few microtasks (seeded), so two pages that call at once interleave the way two requests do.
 * What it does NOT model: the network, the 'changes' events, the server's own counting of reads, or any other key rule.
 */
export class FakeStore {
  constructor({ now = () => 0, seed = 1, yields = 3, maxValue = 60 * 1024, maxTotal = 5 * 1024 * 1024, perMinute = 240 } = {}) {
    this.now = now; this.maxValue = maxValue; this.maxTotal = maxTotal; this.perMinute = perMinute; this.yields = yields;
    this.data = new Map(); // key -> { json, version }
    this.versionCounter = 0;
    this.writes = new Map(); // person -> [times]
    this.log = []; // { op, key, who, status }
    this.rnd = seed;
    this.fault = null; // (op, key, who) -> an Error to throw, or null
  }
  random() { this.rnd = (this.rnd * 1103515245 + 12345) & 0x7fffffff; return this.rnd / 0x7fffffff; }
  async wait() { const n = Math.floor(this.random() * (this.yields + 1)); for (let i = 0; i < n; i += 1) await Promise.resolve(); }
  total() { let n = 0; for (const [k, v] of this.data) n += k.length + v.json.length; return n; }
  err(status, message, extra) { return Object.assign(new Error(message), { status }, extra || {}); }
  // The store as one person sees it: role 'viewer' may read only.
  as(who, { role = 'editor' } = {}) {
    const st = this;
    const note = (op, key, status) => st.log.push({ op, key, who, status });
    const guard = async (op, key) => {
      await st.wait();
      if (st.fault) { const e = st.fault(op, key, who); if (e) { note(op, key, e.status || 0); throw e; } }
    };
    const charge = (op, key) => {
      if (role !== 'editor') { note(op, key, 403); throw st.err(403, 'you may not change this'); }
      const now = st.now();
      const list = (st.writes.get(who) || []).filter((t) => now - t < 60000);
      if (list.length >= st.perMinute) {
        st.writes.set(who, list);
        note(op, key, 429);
        throw st.err(429, 'Too many changes. Wait a moment and try again.', { retryAfter: Math.max(1, Math.ceil((list[0] + 60000 - now) / 1000)) });
      }
      list.push(now); st.writes.set(who, list);
    };
    return {
      get: async (key) => {
        await guard('get', key);
        const e = st.data.get(key); note('get', key, 200);
        return e ? { key, value: JSON.parse(e.json), version: e.version } : null;
      },
      list: async (prefix = '') => {
        await guard('list', prefix);
        note('list', prefix, 200);
        return [...st.data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, e]) => ({ key, value: JSON.parse(e.json), version: e.version }));
      },
      set: async (key, value, opt) => {
        await guard('set', key);
        if (!/^[A-Za-z0-9_.:/-]{1,128}$/.test(key)) { note('set', key, 400); throw st.err(400, 'that key is not allowed'); }
        charge('set', key);
        const json = JSON.stringify(value);
        if (json.length > st.maxValue) { note('set', key, 413); throw st.err(413, 'that value is too big'); }
        const e = st.data.get(key);
        if (opt && opt.version !== undefined && opt.version !== (e ? e.version : 0)) { note('set', key, 409); throw st.err(409, 'someone else changed this', { current: e ? { value: JSON.parse(e.json), version: e.version } : null }); }
        if (st.total() - (e ? e.json.length + key.length : 0) + json.length + key.length > st.maxTotal) { note('set', key, 413); throw st.err(413, 'storage is full'); }
        st.versionCounter += 1;
        st.data.set(key, { json, version: st.versionCounter });
        note('set', key, 200);
        return { key, version: st.versionCounter };
      },
      delete: async (key, opt) => {
        await guard('delete', key);
        charge('delete', key);
        const e = st.data.get(key);
        if (!e) { note('delete', key, 404); throw st.err(404, 'not found'); }
        if (opt && opt.version !== undefined && opt.version !== e.version) { note('delete', key, 409); throw st.err(409, 'someone else changed this'); }
        st.data.delete(key); note('delete', key, 200);
        return true;
      },
    };
  }
  // Direct reads for the test's own checks (no rate, no wait).
  peek(key) { const e = this.data.get(key); return e ? { value: JSON.parse(e.json), version: e.version } : null; }
  count(op, status) { return this.log.filter((x) => x.op === op && (status === undefined || x.status === status)).length; }
}
