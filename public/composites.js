// Composites on the Workspace (plan-calendar-todo.md step 3; plan-map-places.md step 3 reuses it): one module on the
// canvas that holds a destination's page at space scope (`/calendar?space=<id>` or `/map?space=<id>` in a frame), in
// place of the modules whose parts the page draws. The person sees one Calendar, one Map; the modules behind it keep
// their ids, their data and everything stored under them.
//
// Pure: no document, no storage, no imports, so tools/check-canvas.mjs runs it in node. canvas.js reads the table;
// opens-with.js and layouts.js take the `aliases` map this file builds and read a stored list through it, so a
// remembered list, an Opens with or a saved layout naming `calendar`, `todo` or `maps` opens the composite,
// and nothing stored is rewritten.
//
// A composite: { id, dest, path, main, parts, width, height, ask? }. `main` is the module whose name, icon and tint the
// composite shows and whose being on in a space turns the composite on; `parts` are the module ids it stands in for
// there (the main included). While the main is off in a space the other parts keep their own canvas surfaces.
// `ask`: the main being on is not enough; the page asks the destination for the space first (GET
// /api/destinations/<dest>?space=<id>: the Map needs a map file, server/destinations.js `needsFile`), and the composite
// is on only where that answered. The callers below take the dest ids that answered as `shown`.
export const COMPOSITES = Object.freeze([
  Object.freeze({ id: 'dest:calendar', dest: 'calendar', path: '/calendar', main: 'calendar', parts: Object.freeze(['calendar', 'todo']), width: 760, height: 600 }),
  Object.freeze({ id: 'dest:map', dest: 'map', path: '/map', main: 'maps', parts: Object.freeze(['maps']), width: 760, height: 600, ask: true }),
]);

export const isCompositeId = (id) => typeof id === 'string' && id.startsWith('dest:');
export const compositeById = (id) => COMPOSITES.find((c) => c.id === id) || null;

// The composites the page must ask the destination about before they are on, given the ids of the modules on in a
// space: each with `ask` whose main is among them. The caller asks GET /api/destinations/<dest>?space=<id> for each
// and hands the ids that answered to compositesOn, aliasesFor and composeList as `shown`.
export function compositesToAsk(ids) {
  const on = new Set(Array.isArray(ids) ? ids : []);
  return COMPOSITES.filter((c) => c.ask && on.has(c.main));
}

// The composites on, given the ids of the modules on in a space for this person: each whose main is among them, and,
// for one that asks, whose destination is among `shown` (the dest ids that answered for the space).
export function compositesOn(ids, shown = []) {
  const on = new Set(Array.isArray(ids) ? ids : []);
  const answered = new Set(Array.isArray(shown) ? shown : []);
  return COMPOSITES.filter((c) => on.has(c.main) && (!c.ask || answered.has(c.dest)));
}

// The aliases a stored list is read through, given the ids on in a space: each part of a composite that is on reads
// as the composite; a composite that is off reads as whichever of its parts are on (so a remembered `dest:calendar`
// still opens the To-do's own list where the Calendar went off, and a remembered `dest:map` opens Maps as
// it is where there is no map file). { <stored id>: <id> | [<ids>] }.
export function aliasesFor(ids, shown = []) {
  const on = new Set(Array.isArray(ids) ? ids : []);
  const live = new Set(compositesOn(ids, shown).map((c) => c.id));
  const aliases = {};
  for (const c of COMPOSITES) {
    if (live.has(c.id)) for (const part of c.parts) aliases[part] = c.id;
    else aliases[c.id] = c.parts.filter((part) => on.has(part));
  }
  return aliases;
}

// A list of ids read through the aliases: each id as itself or what it reads as, in order, each once (the first place
// a composite is named is where it goes). Never changes the list it is given.
export function readAs(list, aliases = {}) {
  const out = [];
  for (const id of Array.isArray(list) ? list : []) {
    const to = aliases && Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : id;
    for (const one of Array.isArray(to) ? to : [to]) if (typeof one === 'string' && one && !out.includes(one)) out.push(one);
  }
  return out;
}

// The Show list's modules: the server's list with each composite that is on in the main's place and its other parts
// left out. A composite's entry reads like a module's for the canvas ({ id, name, icon, color, canvas, composite }),
// its name, icon and colour the main's as this environment shows it.
export function composeList(modules, shown = []) {
  const list = Array.isArray(modules) ? modules.filter((m) => m && typeof m.id === 'string') : [];
  const on = compositesOn(list.map((m) => m.id), shown);
  const hidden = new Set(on.flatMap((c) => c.parts));
  const out = [];
  for (const m of list) {
    const c = on.find((x) => x.main === m.id);
    if (c) {
      out.push({
        id: c.id, name: m.name, displayName: m.displayName, icon: m.icon, description: m.description, color: m.color || null, version: m.version, scope: m.scope,
        runMode: 'frame', composite: c, commands: [], permissions: [],
        canvas: { entry: null, width: c.width, height: c.height, mode: ['dock', 'float'] },
      });
    } else if (!hidden.has(m.id)) out.push(m);
  }
  return out;
}

// Opens with, grouped as the canvas groups (Set up's First visit): the Calendar
// switch for To-do. The stored list is never reshaped except by a switch being turned: a list naming the main or any of
// its parts reads as the main being on; turning it on stores the main; turning it off takes the main and the parts out,
// so nothing is left that no switch can turn off.
const partsOf = (id) => COMPOSITES.find((c) => c.main === id)?.parts || null;
// The id a row stands under: a part reads as its main, any other id as itself.
export const groupOf = (id) => COMPOSITES.find((c) => c.parts.includes(id))?.main || id;
// Whether the switch for `id` is on given the stored list.
export function switchOn(list, id) {
  const l = Array.isArray(list) ? list : [];
  return (partsOf(id) || [id]).some((p) => l.includes(p));
}
// The parts that get no row of their own, given the ids that do have one: each part of a composite whose main has a row.
export function groupedParts(rowIds) {
  const ids = Array.isArray(rowIds) ? rowIds : [];
  return COMPOSITES.filter((c) => ids.includes(c.main)).flatMap((c) => c.parts.filter((p) => p !== c.main));
}
// The stored list after the switch for `id` is turned `on` or off; null when it ends empty. A new list; the old one is kept.
export function setSwitch(list, id, on) {
  const l = Array.isArray(list) ? list : [];
  const gone = partsOf(id) || [id];
  const next = l.filter((x) => !gone.includes(x));
  if (on) next.push(id);
  return next.length ? next : null;
}
