// What a space opens with when someone enters it (documentation/plans/plan-entering.md, "What opens on entering").
// canvas.js's restore() asks this, after a fresh request to open one module on one object (which wins, and is handled
// there), and the space list's "Open with" popover asks it for the ticks it starts with. Pure, no document and no
// imports, so tools/check-canvas.mjs runs it in node.
//
// In order:
//   1. the person's remembered layout for this space (`__open`), if they have been in it before; never for a guest;
//   2. the space's own "Opens with", leaving out what this person may not open here;
//   3. the environment's list for a space with none of its own (the template's spaceDefaults.opensWith);
//   4. with nothing set: the chat and every module on in the space, without the conference; for a guest, the
//      conference and the chat.
// A list that is set but holds nothing this person may open gives an empty list (an empty canvas), not the next step.
//
// `canOpen(id)` says whether this person may open a module here (the conference by conferenceAllowed() below, the chat
// by its permission; any other id by being on in the space for them). `modules` is the ids on in the space for
// this person, in the Modules menu's order.
// `column`: the always-on column holds the conference and the chat (plan-one-bar.md, step 6), so wider than a phone
// the canvas asks with it and the two ids are left out of the answer, whichever list names them. The lists still
// hold them (a phone opens them as tabs; nothing a person stored changes).
export const COLUMN_IDS = Object.freeze(['conference', 'chat']);
// `aliases` (composites.js's aliasesFor; plan-calendar-todo.md and plan-map-places.md, step 3): a stored id read as
// another, or as a list of others ({ calendar: 'dest:calendar', todo: 'dest:calendar' } while the Calendar is on in the
// space; { maps: 'dest:map' } while the space's Map is shown), each once, in the first place it is
// named. The lists themselves are never rewritten.
export function readAliased(list, aliases = {}) {
  const out = [];
  for (const id of Array.isArray(list) ? list : []) {
    const to = aliases && Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : id;
    for (const one of Array.isArray(to) ? to : [to]) if (typeof one === 'string' && one && !out.includes(one)) out.push(one);
  }
  return out;
}
export function whatOpens({ remembered = null, own = null, environment = null, modules = [], canOpen = () => true, guest = false, column = false, aliases = {} } = {}) {
  const keep = (list) => (column ? list.filter((id) => !COLUMN_IDS.includes(id)) : list);
  if (!guest && Array.isArray(remembered)) return keep(readAliased(remembered, aliases));
  const openable = (list) => keep(readAliased(list, aliases).filter((id) => canOpen(id)));
  if (Array.isArray(own)) return openable(own);
  if (Array.isArray(environment)) return openable(environment);
  return openable(guest ? ['conference', 'chat'] : ['chat', ...modules]);
}

// Which layout a visit opens on (plan-layout-views.md, step 5, "Opens with and the default layout, as one choice"):
// 'workspace' (the Workspace with whatOpens's list), a fixed layout's id (that tab, with the Workspace behind it), or a
// shared layout's id (loaded into the Workspace). `firstVisit` is the server's resolved { layout, opensWith }
// (GET /api/modules/for-space); Opens with is the Workspace's own content and sits beside any layout, so a layout never
// needs a list to open, and a list never stops a layout. Only the restore on entering asks (`entering`), and only a
// first visit: a person's remembered arrangement (`remembered`, never a guest's) wins afterwards. A guest has no tabs,
// so Calendar or Map open the Workspace for one (the server already answers 'workspace' for a guest).
export const SYSTEM_TABS = Object.freeze(['calendar', 'map', 'conference', 'whiteboard', 'documents']);
export function firstVisitLayout({ firstVisit = null, remembered = null, guest = false, entering = true } = {}) {
  if (!entering) return 'workspace';
  if (!guest && Array.isArray(remembered)) return 'workspace';
  const layout = firstVisit && typeof firstVisit.layout === 'string' && firstVisit.layout ? firstVisit.layout : 'workspace';
  if (guest && SYSTEM_TABS.includes(layout)) return 'workspace';
  return layout;
}

// Whether the conference may be opened: the server has a call service (branding.callService; with none there is no
// conference at all), the environment's switch, for everyone (an owner and the admin included), then this person's own
// permission ("See and join the conference").
export function conferenceAllowed({ callService = true, conferenceEnabled = true, permitted = false } = {}) {
  return callService !== false && conferenceEnabled !== false && Boolean(permitted);
}

// Whether entering a space joins the call by itself (GitHub #199, the environment's "join the call on entering"
// switch, branding.autoJoinCall). Only with the switch on; never while already in the call; only for a person the Join
// button would show to (`canJoin`: connected, the conference allowed here for them); never in an aside (an aside is the
// call already, and a pull into one keeps the call on its own); and not for a person who left the call since they
// entered (`left`): they stay out until they enter again. Asked once per entry, so a join never repeats.
export function shouldAutoJoin({ setting = false, inCall = false, canJoin = false, aside = false, left = false } = {}) {
  return setting === true && !inCall && Boolean(canJoin) && !aside && !left;
}

// What space settings says under Opens with about what a first visit opens, worked out from the stored list, never from
// the ticks on screen: with nothing set, what opens instead (the environment's list, else the chat and the modules);
// with a list set that holds nothing that can open now, that nothing opens; otherwise nothing ('').
// `nameOf(id)` is the name a person reads; `groupOf(id)` the id whose switch an id sits under, so each name is said once.
export function opensWithSummary({ list = null, environment = null, modules = [], canOpen = () => true, nameOf = (id) => id, groupOf = (id) => id } = {}) {
  const opens = whatOpens({ own: list, environment, modules, canOpen });
  if (Array.isArray(list)) return opens.length ? '' : 'None of the ones switched on can open now, so nothing opens.';
  const names = [...new Set(opens.map(groupOf))].map(nameOf); // `groupOf`: a part reads as the switch it sits under (To-do as Calendar)
  if (!names.length) return 'Nothing switched on: nothing opens.';
  const said = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `Nothing switched on: ${said} ${names.length > 1 ? 'open' : 'opens'}.`;
}
