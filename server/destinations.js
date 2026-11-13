// Destinations (documentation/plans/plan-calendar-destination.md, plan-map-destination.md): a page of its own in the top
// bar's middle zone, made of parts that modules declare (`surfaces.destination` in module.json, checked by cleanManifest
// in server/modules.js) and that the host page (public/destination.html) mounts. The host names the destinations, never
// the modules: a module takes part by declaring a part, so nothing here knows which module is the Calendar.
//
// Each destination is shown only while its environment option is on (`settings.<setting>`, an owner's switch on
// Manage), and only when its one `main` part is enabled and readable by the viewer at environment level; one that
// `needsFile` also needs its main module to have a file to draw from (a map file: plan-map-destination.md, "Server").
// Pure: the caller (server/index.js) hands in the settings, the enabled modules, who may read what and which modules
// have a file.
'use strict';

// The destinations the host knows, in the order the top bar shows them. `setting`: the environment option that shows
// it (null: never shown). `path`: its page. `needsFile`: shown only while its main module's environment file settings
// name at least one file that is there (the caller's `hasFile`); the host asks this of the destination, never of a
// module by name.
const DESTINATIONS = [
  { id: 'calendar', setting: 'showCalendar', path: '/calendar' },
  { id: 'map', setting: 'showMap', path: '/map', needsFile: true },
];
const DESTINATION_IDS = DESTINATIONS.map((d) => d.id);
const DESTINATION_PARTS = ['main', 'panel'];
// Where a panel sits among the others when its manifest gives no `order`.
const DEFAULT_PART_ORDER = 100;

const destinationById = (id) => DESTINATIONS.find((d) => d.id === id) || null;
const optionOn = (dest, settings) => Boolean(dest.setting) && settings?.[dest.setting] === true;

// The part a manifest declares for a destination (`main` or `panel`), or null. cleanManifest allows one of each.
// The stored manifest is the author's own file, checked when it was installed.
const partOf = (manifest, id, part) => {
  const parts = manifest?.surfaces?.destination;
  return (Array.isArray(parts) ? parts : []).find((p) => p && p.id === id && p.part === part) || null;
};

// The destination's one main among the enabled modules ([{ manifest, entry }]): the bundled module that declares it,
// else the first that declares it in id order. Whether the viewer may read it is the caller's question.
function mainOf(id, enabled) {
  const declaring = enabled.filter(({ manifest }) => partOf(manifest, id, 'main')).sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  const chosen = declaring.find(({ entry }) => entry?.source === 'bundled') || declaring[0] || null;
  return chosen ? { ...chosen, part: partOf(chosen.manifest, id, 'main') } : null;
}

// Whether a panel's own switch leaves it shown. A part may carry `showWhenSetting`, the key of one boolean environment setting
// of its own module (checked when the module is installed): the panel is hidden while that setting is false, and only
// false hides it. A part without the flag is always shown. A setting that `needsModule` a module that is not enabled is
// not offered, so its value is ignored and its default counts. `values(manifest)` reads the module's environment settings;
// without it the defaults count.
function flagAllows(manifest, part, enabled, values) {
  const key = part.showWhenSetting;
  if (key === undefined) return true;
  const def = (manifest.settings || []).find((d) => d.key === key && d.type === 'boolean' && d.scope === 'environment');
  if (!def) return true;
  const met = !def.needsModule || enabled.some((m) => m.manifest.id === def.needsModule);
  const value = met && typeof values === 'function' ? values(manifest)?.[key] : undefined;
  return (typeof value === 'boolean' ? value : def.default) !== false;
}

// Every enabled module's panel for the destination, by `order`, then id. `values`: see flagAllows.
function panelsOf(id, enabled, values) {
  return enabled
    .map((m) => ({ ...m, part: partOf(m.manifest, id, 'panel') }))
    .filter((m) => m.part && flagAllows(m.manifest, m.part, enabled, values))
    .sort((a, b) => (a.part.order ?? DEFAULT_PART_ORDER) - (b.part.order ?? DEFAULT_PART_ORDER) || a.manifest.id.localeCompare(b.manifest.id));
}

// The destination `id` as one viewer sees it, or null when it is not shown for them:
//   settings: the environment's settings (store.settings);
//   enabled:  the enabled modules, [{ manifest, entry }] (modules.enabledAll());
//   canRead:  (manifest) => whether the viewer may read that module at environment level;
//   hasFile:  (manifest) => whether that module has a file to draw from (asked only for a destination that needsFile);
//   values:   (manifest) => the module's environment setting values, for a panel's `showWhenSetting` (flagAllows).
// Answers { dest, main, panels }, each part { manifest, entry, part }; panels only the readable ones.
function resolveDestination(id, { settings, enabled, canRead, hasFile = () => false, values }) {
  const dest = destinationById(id);
  if (!dest || !optionOn(dest, settings)) return null;
  const main = mainOf(id, enabled);
  if (!main || !canRead(main.manifest)) return null;
  if (dest.needsFile && !hasFile(main.manifest)) return null;
  return { dest, main, panels: panelsOf(id, enabled, values).filter(({ manifest }) => canRead(manifest)) };
}

// The destination `id` as a view of one space (plan-calendar-todo.md and plan-map-places.md, step 1): the same parts,
// but without the environment option, which governs only the aggregate page. Here `canRead` is the caller's test for
// that space (the module on in that space, the viewer in it and holding its read permission there), and `hasFile` as
// above (a map file is the environment's, or the host's; a space has none of its own). Answers { dest, main, panels }
// as resolveDestination does, or null.
function resolveDestinationInSpace(id, { enabled, canRead, hasFile = () => false, values }) {
  const dest = destinationById(id);
  if (!dest) return null;
  const main = mainOf(id, enabled);
  if (!main || !canRead(main.manifest)) return null;
  if (dest.needsFile && !hasFile(main.manifest)) return null;
  return { dest, main, panels: panelsOf(id, enabled, values).filter(({ manifest }) => canRead(manifest)) };
}

// Every destination shown for the viewer, in the bar's order.
const shownDestinations = (ctx) => DESTINATIONS.map((d) => resolveDestination(d.id, ctx)).filter(Boolean);

// The shown destination a module is a part of (its main, or a readable panel), or null: where its environment page leads
// while the destination is shown (decision 16).
function destinationOfModule(moduleId, ctx) {
  return shownDestinations(ctx).find((d) => d.main.manifest.id === moduleId || d.panels.some((p) => p.manifest.id === moduleId)) || null;
}

// Why a destination cannot show for anyone whatever its option, for Manage's switch (plan-map-destination.md, decision
// 18), or null when nothing stands in its way: { why: 'no-main' } (no enabled module declares its main part) or
// { why: 'no-file', manifest } (its main module has no file to draw from). Who may read it is each viewer's own
// question, not asked here.
function blockerOf(id, { enabled, hasFile = () => false }) {
  const dest = destinationById(id);
  if (!dest) return null;
  const main = mainOf(id, enabled);
  if (!main) return { why: 'no-main' };
  if (dest.needsFile && !hasFile(main.manifest)) return { why: 'no-file', manifest: main.manifest };
  return null;
}

module.exports = { blockerOf, DESTINATIONS, DESTINATION_IDS, DESTINATION_PARTS, DEFAULT_PART_ORDER, destinationById, partOf, mainOf, panelsOf, resolveDestination, resolveDestinationInSpace, shownDestinations, destinationOfModule };
