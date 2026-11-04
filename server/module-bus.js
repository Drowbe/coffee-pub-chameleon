// What passes between modules besides pointers: events (a module says something happened) and
// actions (a module asks another to do something). The host is only the transport. It does not know
// what any event or action means: modules declare them in module.json, an admin approves who may
// hear and who may ask, and this file keeps them until someone can act on them.
//
// Modules are front-end only, so nothing here runs a module. An event is kept (a short while) for
// modules that were not open when it happened to catch up on; an action request waits in the
// providing module's queue until a person has that module open, whose page claims it, does it under
// its own rules, and reports back. Persists to DATA_DIR/modules/bus.json.

'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const LIMITS = {
  events: 500, // kept in all
  eventAgeMs: 14 * 24 * 60 * 60 * 1000,
  actions: 500,
  actionAgeMs: 7 * 24 * 60 * 60 * 1000,
  claimMs: 60 * 1000, // a claimed request nobody completed can be claimed again after this
  dataBytes: 2000,
  // A request that is only for a page already open (Chat's Keep and Send to... asking a `local` action, such as a poll
  // form) is handed out for this long, then never: it does not wait for the next time the module is opened.
  openOnlyMs: 60 * 1000,
  // How long after a request finished the person who asked can still read how it went (GET /api/spaces/:id/action/:id).
  resultMs: 10 * 60 * 1000,
};

// Whether a request with a time limit (`expiresAt`) has passed it without being carried out: no page may take it now. A
// page that claimed it in time and is still within the claim's minute may still finish it.
function expired(a, now) {
  if (!a.expiresAt || a.status === 'done' || now <= a.expiresAt) return false;
  return !(a.status === 'claimed' && now - a.claimedAt <= LIMITS.claimMs);
}

class ModuleBus extends EventEmitter {
  constructor(modulesDir) {
    super();
    this.setMaxListeners(0);
    this.file = path.join(modulesDir, 'bus.json');
    this.state = { seq: 0, events: [], actions: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && Array.isArray(raw.events) && Array.isArray(raw.actions)) this.state = { seq: Number(raw.seq) || 0, events: raw.events, actions: raw.actions };
    } catch {
      // nothing yet
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }

  // Old events and requests go. A request that goes without having been carried out is announced ('actionsDropped'),
  // so what it left behind (a picture uploaded for it) can be removed with it; an expired one goes once its result
  // window is over.
  prune() {
    const now = Date.now();
    this.state.events = this.state.events.filter((e) => now - e.at < LIMITS.eventAgeMs).slice(-LIMITS.events);
    const before = this.state.actions;
    this.state.actions = before
      .filter((a) => now - a.at < LIMITS.actionAgeMs && !(expired(a, now) && now - a.expiresAt > LIMITS.resultMs))
      .slice(-LIMITS.actions);
    if (this.state.actions.length === before.length) return [];
    const kept = new Set(this.state.actions);
    return before.filter((a) => !kept.has(a) && a.status !== 'done');
  }

  // A deleted space: its events and its waiting or finished requests go with it (not announced as dropped: the space is gone).
  forgetSpace(spaceId) {
    const scope = `space:${spaceId}`;
    const inSpace = (x) => x.scopeKey === scope || x.space === spaceId;
    const before = this.state.events.length + this.state.actions.length;
    this.state.events = this.state.events.filter((e) => !inSpace(e));
    this.state.actions = this.state.actions.filter((a) => !inSpace(a));
    const gone = before - this.state.events.length - this.state.actions.length;
    if (gone) this.save();
    return gone;
  }

  // prune(), save, then say which requests went without being carried out.
  pruneAndSave() {
    const dropped = this.prune();
    this.save();
    if (dropped.length) this.emit('actionsDropped', dropped);
  }

  // --- events ---------------------------------------------------------------

  publish({ module, name, ref, data, scopeKey, by }) {
    const text = data === undefined ? '' : JSON.stringify(data);
    if (text.length > LIMITS.dataBytes) return null;
    const event = { id: ++this.state.seq, at: Date.now(), module, name, ref: ref || null, data: text ? JSON.parse(text) : null, scopeKey, by };
    this.state.events.push(event);
    this.pruneAndSave();
    this.emit('event', event);
    return event;
  }

  // What happened in a scope after event `after`, oldest first.
  eventsAfter(scopeKey, after) {
    return this.state.events.filter((e) => e.scopeKey === scopeKey && e.id > after);
  }

  latestEvent(scopeKey) {
    const list = this.state.events.filter((e) => e.scopeKey === scopeKey);
    return list.length ? list[list.length - 1].id : this.state.seq;
  }

  // --- actions --------------------------------------------------------------

  // `space`: for a request from an environment page about one of the provider's own objects in a space, that space.
  // The request still waits in `scopeKey` (where the asking and providing pages are), but only someone who may change
  // the module in that space may take it (plan-calendar-destination, decision 21).
  // `openOnly`: the request is for a page already open, and is handed out for LIMITS.openOnlyMs only (`expiresAt`).
  // `askerOnly`: only the asker's own page may take it (the routes check `by`); it waits for that page as any request does.
  request({ from, provider, action, input, scopeKey, by, local, askerOnly, space, openOnly }) {
    const at = Date.now();
    const request = { id: ++this.state.seq, at, from, provider, action, input, scopeKey, by, ...(local ? { local: true } : {}), ...(askerOnly ? { askerOnly: true } : {}), ...(space ? { space } : {}), ...(openOnly ? { expiresAt: at + LIMITS.openOnlyMs } : {}), status: 'pending', claimedAt: 0, result: null };
    this.state.actions.push(request);
    this.pruneAndSave();
    this.emit('action', request);
    return request;
  }

  actionById(id) {
    return this.state.actions.find((a) => a.id === id) || null;
  }

  // Requests waiting for the provider in a scope (or claimed too long ago to be still going).
  pending(provider, scopeKey) {
    const now = Date.now();
    return this.state.actions.filter((a) => a.provider === provider && a.scopeKey === scopeKey && !expired(a, now)
      && (a.status === 'pending' || (a.status === 'claimed' && now - a.claimedAt > LIMITS.claimMs)));
  }

  // How a request is going, in the bus's words, with 'expired' for one that passed its time limit unclaimed.
  statusOf(a) {
    return expired(a, Date.now()) ? 'expired' : a.status;
  }

  // One page takes a request; the others that saw it too are told no. Returns the request or null.
  claim(id, provider, scopeKey) {
    const a = this.actionById(id);
    const now = Date.now();
    if (!a || a.provider !== provider || a.scopeKey !== scopeKey || expired(a, now)) return null;
    if (!(a.status === 'pending' || (a.status === 'claimed' && now - a.claimedAt > LIMITS.claimMs))) return null;
    a.status = 'claimed';
    a.claimedAt = now;
    this.save();
    return a;
  }

  complete(id, provider, scopeKey, result) {
    const a = this.actionById(id);
    // Past its time limit, only a page that claimed it in time (and is within the claim's minute) may finish it.
    if (!a || a.provider !== provider || a.scopeKey !== scopeKey || a.status === 'done' || expired(a, Date.now())) return null;
    a.status = 'done';
    a.doneAt = Date.now();
    a.result = result;
    this.save();
    this.emit('actionDone', a);
    return a;
  }

  dropModule(id) {
    this.state.events = this.state.events.filter((e) => e.module !== id);
    this.state.actions = this.state.actions.filter((a) => a.provider !== id && a.from !== id);
    this.save();
  }
}

module.exports = { ModuleBus, BUS_LIMITS: LIMITS };
