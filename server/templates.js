'use strict';

// Templates (documentation/plans/plan-templates-redesign.md, "The template, as stored"; and plan-environment-templates.md
// for picking and switching): a template is a lens over the environment's catalog. It renames the words people may rename
// (space and member; home and the Lobby only as the environment's default template), offers a set of the catalog's
// modules and names them, adds reactions and icons to the fixed core set, and says what a new space and a new
// environment start with. One shape for every source: the bundled files (templates/<id>.json), the host's (host.json)
// and the owner's own (app.json).
//
// Its words, phases, home icon and module names and icons follow the template live (the store reads them from here on
// every build); its settings, Lobby, space defaults, added reactions and icons and modules are applied once when the
// environment is made, or offered on a switch and applied as confirmed, and recorded in app.json's own `template`.
//
// A template is easy to import, so every field is checked here, and nothing in it can reach a module's permissions,
// uploads, refs or access (decision 15): a module entry takes only name, icon, settings, labels and starter, settings
// only where the module's manifest marks them for a template, labels only where it declares them, starter content only
// for a module that opts in.
//
// A template is data: nothing in the code knows which template names which module.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const words = require('./words');
const { SPACE_PROFILES, QUALITY_OPTIONS, LANGUAGES, CURRENCIES, LOBBY, displayNameProblem } = require('./store');
const { DEFAULT_REACTION_LIST, DEFAULT_ICON_NAMES } = require('./default-lists');
const { SYSTEM_IDS } = require('./layouts');
const { bundledModules, buildModule } = require('./module-build');
const { cleanValue } = require('./module-settings');

const ROOT = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const MODULES_DIR = path.join(ROOT, 'modules');
// Font Awesome Free's own solid icons: what a template's icons must be, so every page can draw them (fa-solid fa-<id>).
const FA_FREE_SOLID = path.join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs', 'solid');
// The modules built into every environment: named like a bundled one, never installed.
const BUILTIN_MODULE_IDS = ['conference', 'chat'];
// The fixed template every environment falls back to (decision 3): nobody edits, hides or deletes it.
const DEFAULT_ID = 'default';
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const FIELDS = ['id', 'name', 'description', 'version', 'words', 'home', 'icons', 'lobby', 'modules', 'call', 'workspace', 'phases', 'phaseMeasure', 'reactions', 'iconSet', 'spaceDefaults', 'starterSpaces', 'settings'];
// What a module entry may hold (decision 15): nothing else, ever.
const MODULE_KEYS = ['name', 'icon', 'settings', 'labels', 'starter'];
const MODULE_KEYS_SENTENCE = 'a template sets only name, icon, settings, labels and starter.';
const MAX_MODULES = 60;
const MAX_PHASES = 12;
const MAX_OPENS_WITH = 20;
const PHASE_KEYS = ['id', 'label', 'main', 'icon'];
const PHASE_MEASURES = ['dates', 'goals', 'progress'];
// Additions only (decision 12): the core set is server/default-lists.js's.
const MAX_REACTIONS = 40;
const MAX_ICON_SET = 60;
const REACTION_ID_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const CORE_REACTIONS = DEFAULT_REACTION_LIST;
const CORE_ICONS = DEFAULT_ICON_NAMES;
// The core call settings a template may give (decision 16). The tile layouts are the call's own (public/space.js).
const CALL_KEYS = ['joinOnEntry', 'position', 'layout'];
const CALL_POSITIONS = ['top', 'bottom', 'left', 'right', 'float', 'workspace', 'window'];
const CALL_LAYOUTS = ['grid', 'strip', 'focus', 'spotlight'];
// The Default Workspace (decision 8): the Fixed Workspaces are every system layout but the Workspace itself.
const WORKSPACE_KEYS = ['opensWith', 'show', 'opensFirst'];
const FIXED_WORKSPACES = SYSTEM_IDS.filter((id) => id !== 'workspace');
const MAX_STARTER_SPACES = 5;
const STARTER_SPACE_NAME_MAX = 60;
const STARTER_SPACE_DESCRIPTION_MAX = 300;
// Starter content: the module's own data keys (the data route's rule, server/module-data.js) and values.
const STARTER_KEY_RE = /^[A-Za-z0-9_.:/-]{1,128}$/;
const MAX_STARTER_KEYS = 20;
const MAX_STARTER_BYTES = 64 * 1024;
// The whole template, as JSON, and how deep it may nest.
const MAX_TEMPLATE_BYTES = 128 * 1024;
const MAX_DEPTH = 16;
// Keys no template may hold anywhere: they reach an object's prototype in some code that reads them.
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
// Module setting types a template can never set (decision 15): a key, a file, or an outside address a module would contact.
const REFUSED_SETTING_TYPES = ['secret', 'file', 'files', 'url', 'note'];
const TEMPLATE_MARKS = ['driven', 'default'];
// The applied-once parts an update can offer, each with a fingerprint of the template's value kept in the record once
// applied or passed over (addendum 2), so a part is offered again only when the template changed it.
const PARTS = ['modules', 'reactions', 'iconSet', 'lobby', 'spaceDefaults'];
const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
// The value of one applied-once part: the module ids (their names and icons are live), and what a new space starts with
// (its profile, and the Default Workspace's opensWith, which a new space takes until the workspaces step reads it live).
function partValue(template, part) {
  if (part === 'modules') return moduleIdsOf(template);
  if (part === 'spaceDefaults') return [template.spaceDefaults ?? null, template.workspace?.opensWith ?? null];
  return template[part] ?? null;
}
function partFingerprints(template) {
  return Object.fromEntries(PARTS.map((part) => [part, fingerprint(partValue(template, part))]));
}
// Whether a part the template applies once changed since a record's fingerprints (`applied`) were taken; a record
// without them counts as changed.
function appliedPartsChanged(record, template) {
  const applied = record && record.applied;
  if (!applied || typeof applied !== 'object') return true;
  const prints = partFingerprints(template);
  return PARTS.some((part) => applied[part] !== prints[part]);
}
// What a template applies or creates once, as a whole: a bundled template's version must go up when this changes
// (tools/template-versions.json).
const starterOf = (template) => (isObject(template.modules) ? Object.entries(template.modules).filter(([, m]) => m.starter).map(([id, m]) => [id, m.starter]) : []);
const appliedOnceFingerprint = (template) => fingerprint([moduleIdsOf(template), ...['settings', 'lobby', 'spaceDefaults', 'reactions', 'iconSet', 'workspace', 'starterSpaces'].map((k) => template[k] ?? null), starterOf(template)]);
// The whole template apart from its version. An edited bundled template's notice opens when this or the applied-once
// fingerprint differs from the file the edits were made against (addendum 3).
const wholeFingerprint = (template) => fingerprint(FIELDS.filter((k) => k !== 'version').map((k) => template[k] ?? null));
const bool = (v) => typeof v === 'boolean';
// The environment's settings a template may give, applied once when an environment is made from it (each also the
// owner's to change afterwards), with what each takes. No theme: the theme left templates (decision 13).
const SETTINGS = {
  language: (v) => LANGUAGES.includes(v),
  clock: (v) => v === '12' || v === '24',
  currency: (v) => typeof v === 'string' && CURRENCIES.has(v),
  loginText: (v) => typeof v === 'string' && v.length <= 1000,
  allowRegistration: bool,
  mfaRequired: bool,
  maxQuality: (v) => QUALITY_OPTIONS.includes(v),
  allowScreenShare: bool,
  allowAsides: bool,
  allowPrivate: bool,
  allowReactions: bool,
  showCalendar: bool,
  showMap: bool,
  calendarFeeds: bool,
  otherCalendars: bool,
  publishedCalendar: bool,
};
const LOBBY_NAME_MAX = 40;
const LOBBY_DESCRIPTION_MAX = 300;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const drawable = (icon, faDir) => typeof icon === 'string' && /^[a-z0-9-]{1,40}$/.test(icon) && fs.existsSync(path.join(faDir, `${icon}.svg`));
// Text a person reads, on one line: no control or text-direction characters and no < or >.
const plainText = (v, max, { empty = false } = {}) => typeof v === 'string' && (empty || v.trim().length > 0) && v.length <= max && !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069<>]/.test(v);
// What a sentence shows of a key someone typed: at most 40 characters, quoted by the caller.
const shown = (key) => String(key).slice(0, 40);

// The module ids a template offers: '*' for every module in the catalog (the Default template, decision 33), else its
// entries' ids in display order. With `catalog` (the ids the catalog has), '*' reads as those.
function moduleIdsOf(template, catalog = null) {
  if (!template) return [];
  if (template.modules === '*') return catalog ? [...catalog] : '*';
  return isObject(template.modules) ? Object.keys(template.modules) : [];
}
// Whether a template offers module `id`.
const offers = (template, id) => template.modules === '*' || (isObject(template.modules) && Object.hasOwn(template.modules, id));
// A template's module display names (or icons) by module id, for the store's live part.
const moduleField = (template, field) => (isObject(template?.modules) ? Object.fromEntries(Object.entries(template.modules).filter(([, m]) => typeof m[field] === 'string' && m[field]).map(([id, m]) => [id, m[field]])) : {});

// The manifests a template is checked against, by module id: the bundled modules' by default.
let bundledCache = null;
const bundledManifests = () => (bundledCache ||= new Map(bundledModules(MODULES_DIR).map((m) => [m.id, m])));
const asManifestMap = (manifests) => (manifests instanceof Map ? manifests : Array.isArray(manifests) ? new Map(manifests.map((m) => [m.id, m])) : bundledManifests());

// The first key no template may hold, anywhere in `value`, or the first place it nests too deep: one sentence, or null.
function hostileShape(value, depth = 0) {
  if (depth > MAX_DEPTH) return `A template can nest at most ${MAX_DEPTH} levels deep.`;
  if (Array.isArray(value)) {
    for (const v of value) { const p = hostileShape(v, depth + 1); if (p) return p; }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.includes(key)) return `A template can't hold a key called "${key}".`;
      const p = hostileShape(value[key], depth + 1);
      if (p) return p;
    }
  }
  return null;
}

// What is wrong with one module entry (modules.<id>), as sentences. `manifest`: the module's, or null for a built-in one.
function moduleEntryProblems(id, entry, manifest, faDir, say) {
  const where = `modules.${id}`;
  if (!isObject(entry)) { say(`${where} must be an object; ${MODULE_KEYS_SENTENCE}`); return; }
  if (Object.keys(entry).some((k) => !MODULE_KEYS.includes(k))) say(`${where}: ${MODULE_KEYS_SENTENCE}`);
  if (entry.name !== undefined) {
    const name = typeof entry.name === 'string' ? entry.name.replace(/\s+/g, ' ').trim() : '';
    const problem = typeof entry.name !== 'string' || !name ? 'A display name must be text.' : displayNameProblem(name);
    if (problem) say(`${where}.name: ${problem}`);
  }
  if (entry.icon !== undefined && !drawable(entry.icon, faDir)) say(`${where}.icon: "${shown(entry.icon)}" is not a Font Awesome Free solid icon.`);
  if (entry.settings !== undefined) {
    if (!isObject(entry.settings)) say(`${where}.settings must be an object of settings by key.`);
    else {
      const defs = new Map((Array.isArray(manifest?.settings) ? manifest.settings : []).filter((d) => d && typeof d.key === 'string').map((d) => [d.key, d]));
      for (const [key, value] of Object.entries(entry.settings)) {
        const def = defs.get(key);
        if (!def || !TEMPLATE_MARKS.includes(def.template)) { say(`${where}.settings: "${shown(key)}" is not a setting the ${id} module lets a template set.`); continue; }
        if (REFUSED_SETTING_TYPES.includes(def.type)) { say(`${where}.settings: "${key}" is a ${def.type}, so a template can't set it.`); continue; }
        if (def.scope === 'person' && def.template === 'driven') { say(`${where}.settings: "${key}" is each person's own, so a template can only suggest it.`); continue; }
        try {
          cleanValue(def, value); // the module's own rules for the value (server/module-settings.js)
        } catch (err) {
          say(`${where}.settings: ${err.message}.`);
        }
      }
    }
  }
  if (entry.labels !== undefined) {
    if (!isObject(entry.labels)) say(`${where}.labels must be an object of words by key.`);
    else {
      const declared = isObject(manifest?.labels) ? manifest.labels : {};
      for (const [key, value] of Object.entries(entry.labels)) {
        if (!Object.hasOwn(declared, key)) { say(`${where}.labels: "${shown(key)}" is not a word the ${id} module lets a template rename.`); continue; }
        const { error } = words.cleanWord(key, value);
        if (error) say(`${where}.labels: ${error}`);
      }
    }
  }
  if (entry.starter !== undefined) {
    if (manifest?.starter !== true) say(`${where}: the ${id} module takes no starter content.`);
    else if (!isObject(entry.starter)) say(`${where}.starter must be an object of the module's own data by key.`);
    else {
      const keys = Object.keys(entry.starter);
      if (keys.length > MAX_STARTER_KEYS) say(`${where}.starter can hold at most ${MAX_STARTER_KEYS} keys.`);
      for (const key of keys) if (!STARTER_KEY_RE.test(key)) say(`${where}.starter: "${shown(key)}" is not a data key; a key is 1 to 128 letters, digits and . _ : / -.`);
    }
  }
}

// What is wrong with one template, as sentences ([] when nothing is). `manifests`: the modules the catalog has, by id (a
// Map, or a list of manifests; the bundled modules' by default). `file`: the file it came from, whose name its id must
// match.
function problemsOf(raw, { file = null, manifests = null, faDir = FA_FREE_SOLID } = {}) {
  const out = [];
  const say = (text) => out.push(text);
  if (!isObject(raw)) return ['A template must be a JSON object.'];
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(raw)); } catch { return ['A template must be plain JSON.']; }
  if (size > MAX_TEMPLATE_BYTES) return [`A template can be at most ${MAX_TEMPLATE_BYTES / 1024} KB.`];
  const hostile = hostileShape(raw);
  if (hostile) return [hostile];
  const catalog = asManifestMap(manifests);
  const knownModule = (id) => typeof id === 'string' && ID_RE.test(id) && (catalog.has(id) || BUILTIN_MODULE_IDS.includes(id));
  for (const key of Object.keys(raw)) if (!FIELDS.includes(key)) say(`"${shown(key)}" is not a template field; the fields are ${FIELDS.join(', ')}.`);
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) say('"id" must be lowercase letters, digits and dashes, starting with a letter.');
  else if (file && path.basename(file, '.json') !== raw.id) say(`"id" must match the file's name (${path.basename(file)}).`);
  if (!plainText(raw.name, 40)) say('"name" must be plain text of 1 to 40 characters.');
  if (!plainText(raw.description, 200)) say('"description" must be plain text of 1 to 200 characters.');
  if (raw.version !== undefined && (!Number.isInteger(raw.version) || raw.version < 1)) say('"version" must be a whole number, 1 or more.');

  if (raw.words !== undefined) {
    if (!isObject(raw.words)) say('"words" must be an object of words by name.');
    else {
      for (const [key, value] of Object.entries(raw.words)) {
        if (key === 'home') say('words: the Home word goes in "home", not in "words".');
        else if (words.LOCKED.includes(key)) say(`words: "${key}" reads the same everywhere, so a template can't change it.`);
        else if (!words.SPACE_KEYS.includes(key)) say(`words: there is no word called "${shown(key)}"; a template may change ${words.SPACE_KEYS.join(' and ')}.`);
        else {
          const { error } = words.cleanWord(key, value);
          if (error) say(`words: ${error}`);
        }
      }
    }
  }
  if (raw.home !== undefined) {
    const { error } = words.cleanWord('home', raw.home);
    if (error) say(`home: ${error}`);
  }
  if (raw.icons !== undefined) {
    if (!isObject(raw.icons) || Object.keys(raw.icons).some((k) => k !== 'home')) say('"icons" takes only "home".');
    else if (raw.icons.home !== undefined && !drawable(raw.icons.home, faDir)) say(`icons.home: "${shown(raw.icons.home)}" is not a Font Awesome Free solid icon.`);
  }
  if (raw.lobby !== undefined) {
    if (!isObject(raw.lobby) || Object.keys(raw.lobby).some((k) => !['name', 'description'].includes(k))) say('"lobby" takes only "name" and "description".');
    else {
      if (raw.lobby.name !== undefined && !plainText(raw.lobby.name, LOBBY_NAME_MAX)) say(`lobby.name must be plain text of 1 to ${LOBBY_NAME_MAX} characters.`);
      if (raw.lobby.description !== undefined && !plainText(raw.lobby.description, LOBBY_DESCRIPTION_MAX, { empty: true })) say(`lobby.description must be plain text of at most ${LOBBY_DESCRIPTION_MAX} characters.`);
    }
  }

  // modules: '*' (the whole catalog), or one entry per module id, in display order.
  const listed = new Set();
  if (raw.modules === '*') {
    // every module the catalog has
  } else if (!isObject(raw.modules)) {
    say('"modules" must be "*" for every module, or an object with one entry per module id.');
  } else {
    const ids = Object.keys(raw.modules);
    if (ids.length > MAX_MODULES) say(`"modules" can list at most ${MAX_MODULES} modules.`);
    for (const id of ids.slice(0, MAX_MODULES)) {
      if (!knownModule(id)) { say(`modules: "${shown(id)}" is not a module this server has.`); continue; }
      listed.add(id);
      moduleEntryProblems(id, raw.modules[id], catalog.get(id) || null, faDir, say);
    }
    // Chat has no switch of its own yet (plan-optional-conference), so a template can't leave it out.
    if (!Object.hasOwn(raw.modules, 'chat')) say('modules: "chat" must be listed; Chat can\'t be switched off yet.');
    const starterBytes = Buffer.byteLength(JSON.stringify(starterOf(raw)));
    if (starterBytes > MAX_STARTER_BYTES) say(`A template's starter content can be at most ${MAX_STARTER_BYTES / 1024} KB.`);
  }
  const inModules = (id) => (raw.modules === '*' ? knownModule(id) : listed.has(id));

  if (raw.call !== undefined) {
    if (!isObject(raw.call) || Object.keys(raw.call).some((k) => !CALL_KEYS.includes(k))) say('"call" takes only joinOnEntry, position and layout.');
    else {
      if (raw.call.joinOnEntry !== undefined && typeof raw.call.joinOnEntry !== 'boolean') say('call.joinOnEntry must be true or false.');
      if (raw.call.position !== undefined && !CALL_POSITIONS.includes(raw.call.position)) say(`call.position must be one of ${CALL_POSITIONS.join(', ')}.`);
      if (raw.call.layout !== undefined && !CALL_LAYOUTS.includes(raw.call.layout)) say(`call.layout must be one of ${CALL_LAYOUTS.join(', ')}.`);
    }
  }
  if (raw.workspace !== undefined) {
    if (!isObject(raw.workspace) || Object.keys(raw.workspace).some((k) => !WORKSPACE_KEYS.includes(k))) say('"workspace" takes only opensWith, show and opensFirst.');
    else {
      const w = raw.workspace;
      if (w.opensWith !== undefined) {
        if (!Array.isArray(w.opensWith) || w.opensWith.length > MAX_OPENS_WITH) say(`workspace.opensWith must be a list of at most ${MAX_OPENS_WITH} module ids.`);
        else {
          const seen = new Set();
          for (const id of w.opensWith) {
            if (typeof id !== 'string') say(`workspace.opensWith: ${shown(JSON.stringify(id))} is not a module id.`);
            else if (!inModules(id)) say(`workspace.opensWith: "${shown(id)}" is not one of this template's modules.`);
            else if (seen.has(id)) say(`workspace.opensWith: "${id}" is listed twice.`);
            else seen.add(id);
          }
        }
      }
      if (w.show !== undefined) {
        if (!Array.isArray(w.show) || w.show.some((id) => !FIXED_WORKSPACES.includes(id)) || new Set(w.show).size !== w.show.length) say(`workspace.show must be a list of Fixed Workspaces, each once: ${FIXED_WORKSPACES.join(', ')}.`);
      }
      if (w.opensFirst !== undefined && !SYSTEM_IDS.includes(w.opensFirst)) say(`workspace.opensFirst must be one of ${SYSTEM_IDS.join(', ')}.`);
    }
  }
  if (raw.phases !== undefined) {
    if (!Array.isArray(raw.phases) || raw.phases.length > MAX_PHASES) say(`"phases" must be a list of at most ${MAX_PHASES} phases.`);
    else {
      const seen = new Set();
      let main = false;
      raw.phases.forEach((phase, i) => {
        if (!isObject(phase)) { say(`phases[${i}] must be an object with an id and a label.`); return; }
        for (const key of Object.keys(phase)) if (!PHASE_KEYS.includes(key)) say(`phases[${i}]: "${shown(key)}" is not a phase field; a phase takes id, label, main and icon.`);
        if (typeof phase.id !== 'string' || !ID_RE.test(phase.id)) say(`phases[${i}]: an id is lowercase letters, digits and dashes, starting with a letter.`);
        else if (seen.has(phase.id)) say(`phases: "${phase.id}" is listed twice.`);
        else seen.add(phase.id);
        if (!plainText(phase.label, 40)) say(`phases[${i}]: a label is plain text of 1 to 40 characters.`);
        if (phase.icon !== undefined && !drawable(phase.icon, faDir)) say(`phases[${i}]: icon "${shown(phase.icon)}" is not a Font Awesome Free solid icon.`);
        if (phase.main !== undefined && phase.main !== true) say(`phases[${i}]: "main" is true or left out.`);
        else if (phase.main === true) {
          if (main) say('phases: only one phase can be the main one.');
          main = true;
        }
      });
    }
  }
  if (raw.phaseMeasure !== undefined && !PHASE_MEASURES.includes(raw.phaseMeasure)) say(`"phaseMeasure" must be one of ${PHASE_MEASURES.join(', ')}.`);
  if (raw.reactions !== undefined) {
    if (!Array.isArray(raw.reactions) || raw.reactions.length > MAX_REACTIONS) say(`"reactions" must be a list of at most ${MAX_REACTIONS} reactions to add.`);
    else {
      const ids = new Set();
      const glyphs = new Set();
      raw.reactions.forEach((r, i) => {
        if (!isObject(r) || Object.keys(r).some((k) => !['id', 'glyph', 'label'].includes(k))) { say(`reactions[${i}]: a reaction takes only id, glyph and label.`); return; }
        if (typeof r.id !== 'string' || !REACTION_ID_RE.test(r.id)) say(`reactions[${i}]: an id is 1 to 24 lowercase letters, digits and dashes.`);
        if (!plainText(r.glyph, 8)) { say(`reactions[${i}]: each reaction needs a glyph of 1 to 8 characters.`); return; }
        if (r.label !== undefined && !plainText(r.label, 40)) say(`reactions[${i}]: a label is plain text of 1 to 40 characters.`);
        const glyph = r.glyph.trim();
        if (CORE_REACTIONS.some((c) => c.glyph === glyph || c.id === r.id)) say(`reactions[${i}]: ${glyph} is in the core set already; a template only adds.`);
        else if (glyphs.has(glyph) || ids.has(r.id)) say(`reactions[${i}]: ${glyph} is listed twice.`);
        glyphs.add(glyph);
        ids.add(r.id);
      });
    }
  }
  if (raw.iconSet !== undefined) {
    if (!Array.isArray(raw.iconSet) || raw.iconSet.length > MAX_ICON_SET) say(`"iconSet" must be a list of at most ${MAX_ICON_SET} icon names to add.`);
    else {
      const seen = new Set();
      for (const icon of raw.iconSet) {
        if (!drawable(icon, faDir)) say(`iconSet: "${shown(icon)}" is not a Font Awesome Free solid icon.`);
        else if (CORE_ICONS.includes(icon)) say(`iconSet: "${icon}" is in the core set already; a template only adds.`);
        else if (seen.has(icon)) say(`iconSet: "${icon}" is listed twice.`);
        seen.add(icon);
      }
    }
  }
  if (raw.spaceDefaults !== undefined) {
    if (!isObject(raw.spaceDefaults) || Object.keys(raw.spaceDefaults).some((k) => k !== 'profile')) say(`"spaceDefaults" takes only "profile"; what a new ${words.word('space')} opens with is in "workspace".`);
    else if (raw.spaceDefaults.profile !== undefined && !SPACE_PROFILES.includes(raw.spaceDefaults.profile)) say(`spaceDefaults.profile must be one of ${SPACE_PROFILES.join(', ')}.`);
  }
  if (raw.starterSpaces !== undefined) {
    if (!Array.isArray(raw.starterSpaces) || raw.starterSpaces.length > MAX_STARTER_SPACES) say(`"starterSpaces" must be a list of at most ${MAX_STARTER_SPACES} ${words.word('space', { many: true })}.`);
    else {
      raw.starterSpaces.forEach((sp, i) => {
        if (!isObject(sp) || Object.keys(sp).some((k) => !['name', 'description'].includes(k))) { say(`starterSpaces[${i}] takes only name and description.`); return; }
        if (!plainText(sp.name, STARTER_SPACE_NAME_MAX)) say(`starterSpaces[${i}]: a name is plain text of 1 to ${STARTER_SPACE_NAME_MAX} characters.`);
        if (sp.description !== undefined && !plainText(sp.description, STARTER_SPACE_DESCRIPTION_MAX, { empty: true })) say(`starterSpaces[${i}]: a description is plain text of at most ${STARTER_SPACE_DESCRIPTION_MAX} characters.`);
      });
    }
  }
  if (raw.settings !== undefined) {
    if (!isObject(raw.settings)) say('"settings" must be an object.');
    else {
      for (const [key, value] of Object.entries(raw.settings)) {
        if (!Object.hasOwn(SETTINGS, key)) say(`settings: "${shown(key)}" is not a setting a template can give; those are ${Object.keys(SETTINGS).join(', ')}.`);
        else if (!SETTINGS[key](value)) say(`settings: ${shown(JSON.stringify(value))} is not a value "${key}" takes.`);
      }
    }
  }
  return out;
}

function cleanPhases(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((phase) => ({ id: phase.id, label: String(phase.label).trim(), ...(phase.main === true ? { main: true } : {}), ...(phase.icon ? { icon: phase.icon } : {}) }));
}

// One module entry as the server keeps it: only the five keys, each there only when given.
function cleanModuleEntry(entry, manifest) {
  const out = {};
  if (typeof entry.name === 'string') out.name = entry.name.replace(/\s+/g, ' ').trim();
  if (typeof entry.icon === 'string') out.icon = entry.icon;
  if (isObject(entry.settings) && Object.keys(entry.settings).length) {
    // Only what the module (as installed now) still marks for a template, each by its rules; anything else is left out,
    // so a template saved before its module changed still reads.
    const defs = new Map((Array.isArray(manifest?.settings) ? manifest.settings : []).filter((d) => d && TEMPLATE_MARKS.includes(d.template) && !REFUSED_SETTING_TYPES.includes(d.type)).map((d) => [d.key, d]));
    const settings = {};
    for (const [k, v] of Object.entries(entry.settings)) {
      if (!defs.has(k)) continue;
      try { settings[k] = cleanValue(defs.get(k), v); } catch { /* no longer a value it takes */ }
    }
    if (Object.keys(settings).length) out.settings = settings;
  }
  if (isObject(entry.labels) && Object.keys(entry.labels).length) {
    const declared = isObject(manifest?.labels) ? manifest.labels : {};
    const labels = {};
    for (const [k, v] of Object.entries(entry.labels)) {
      const { word } = Object.hasOwn(declared, k) ? words.cleanWord(k, v) : {};
      if (word) labels[k] = word;
    }
    if (Object.keys(labels).length) out.labels = labels;
  }
  if (manifest?.starter === true && isObject(entry.starter) && Object.keys(entry.starter).length) out.starter = structuredClone(entry.starter);
  return out;
}

// A valid template (problemsOf answered []) as the server keeps it: every field there, tidied.
function cleanTemplate(raw, { manifests = null } = {}) {
  const catalog = asManifestMap(manifests);
  const own = {};
  for (const [key, value] of Object.entries(raw.words || {})) own[key] = words.cleanWord(key, value).word;
  const call = {};
  for (const key of CALL_KEYS) if (raw.call && raw.call[key] !== undefined) call[key] = raw.call[key];
  const workspace = {};
  if (raw.workspace?.opensWith) workspace.opensWith = [...raw.workspace.opensWith];
  if (raw.workspace?.show) workspace.show = [...raw.workspace.show];
  if (raw.workspace?.opensFirst) workspace.opensFirst = raw.workspace.opensFirst;
  return {
    id: raw.id,
    name: raw.name.trim(),
    description: raw.description.trim(),
    // A template's version (a bundled file without one is 1).
    version: Number.isInteger(raw.version) ? raw.version : 1,
    words: own,
    home: raw.home !== undefined ? words.cleanWord('home', raw.home).word : null,
    icons: { ...(raw.icons?.home ? { home: raw.icons.home } : {}) },
    lobby: { ...(raw.lobby?.name !== undefined ? { name: raw.lobby.name.trim() } : {}), ...(raw.lobby?.description !== undefined ? { description: raw.lobby.description.trim() } : {}) },
    modules: raw.modules === '*' ? '*' : Object.fromEntries(Object.entries(raw.modules).map(([id, entry]) => [id, cleanModuleEntry(entry, catalog.get(id))])),
    call,
    workspace,
    phases: cleanPhases(raw.phases),
    phaseMeasure: raw.phaseMeasure || 'dates',
    reactions: (raw.reactions || []).map((r) => ({ id: r.id, glyph: r.glyph.trim(), label: (r.label || r.glyph).trim() })),
    iconSet: Array.isArray(raw.iconSet) ? [...raw.iconSet] : [],
    spaceDefaults: { ...(raw.spaceDefaults?.profile ? { profile: raw.spaceDefaults.profile } : {}) },
    starterSpaces: (raw.starterSpaces || []).map((sp) => ({ name: sp.name.trim(), description: (sp.description || '').trim() })),
    settings: { ...(raw.settings || {}) },
  };
}

// A template's own fields as they are stored or written to a file: every field, without those it leaves empty.
function storedFields(t) {
  const out = {};
  for (const key of FIELDS) {
    const v = t[key];
    if (v === undefined || v === null) continue;
    if (key !== 'modules' && key !== 'words' && isObject(v) && !Object.keys(v).length) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[key] = structuredClone(v);
  }
  return out;
}

// Every template in `dir`, checked against the modules in `modulesDir`. Throws one Error naming each problem (file:
// sentence) when any is invalid, or when the Default template is missing, so a server never starts with a template it
// can't apply.
function loadTemplates({ dir = TEMPLATES_DIR, modulesDir = MODULES_DIR, faDir = FA_FREE_SOLID } = {}) {
  const manifests = new Map(bundledModules(modulesDir).map((m) => [m.id, m]));
  const found = new Map();
  const problems = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    const file = path.join(dir, f);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { problems.push(`templates/${f}: not valid JSON (${err.message}).`); continue; }
    const wrong = problemsOf(raw, { file, manifests, faDir });
    if (wrong.length) { for (const p of wrong) problems.push(`templates/${f}: ${p}`); continue; }
    found.set(raw.id, cleanTemplate(raw, { manifests }));
  }
  if (!problems.length && !found.has(DEFAULT_ID)) problems.push(`templates/${DEFAULT_ID}.json: the Default template is missing, and the server needs it.`);
  if (problems.length) throw new Error(`A template is not valid, so the server will not start:\n  ${problems.join('\n  ')}`);
  // The Default template first, then the rest by id.
  return new Map([[DEFAULT_ID, found.get(DEFAULT_ID)], ...[...found].filter(([id]) => id !== DEFAULT_ID)]);
}

// The bundled templates, loaded once.
let loaded = null;
const all = () => (loaded ||= loadTemplates());
const get = (id) => all().get(id) || null;
const list = () => [...all().values()].map((t) => ({ id: t.id, name: t.name, description: t.description }));
// The Default template (decision 3): what an environment with none recorded reads.
const defaultTemplate = () => get(DEFAULT_ID);

// The live part of a template (its words, the Home word, phases, home icon and module names and icons) onto an
// environment's store. Answers the template; null clears it (the store then reads the defaults).
function useLive(store, template) {
  store.templateWords = template ? { ...template.words, ...(template.home ? { home: template.home } : {}) } : null;
  store.templatePhases = template ? template.phases || [] : null;
  store.templateModuleNames = template ? moduleField(template, 'name') : null;
  store.templateModuleIcons = template ? moduleField(template, 'icon') : null;
  store.templateHomeIcon = template ? template.icons.home || null : null;
  return template;
}

// The bundled module ids a template's list needs, each after what it requires (a module after the ones it requires), with the modules
// it requires added though the template left them out.
function withRequirements(ids, manifests) {
  const out = [];
  const visit = (id, seen = new Set()) => {
    if (out.includes(id) || seen.has(id) || !manifests.has(id)) return;
    seen.add(id);
    for (const r of manifests.get(id).requires || []) visit(r, seen);
    out.push(id);
  };
  for (const id of ids) visit(id);
  return out;
}

// Adds a template's icons (its home icon, its module icons and, with `iconSet`, the icons it adds) to the environment's
// icon list, so the owner's pickers offer them. Never removes one.
function addIcons(store, template, { iconSet = false } = {}) {
  const want = [template.icons.home, ...Object.values(moduleField(template, 'icon')), ...(iconSet ? template.iconSet || [] : [])].filter(Boolean);
  const have = store.iconIds();
  const add = [...new Set(want)].filter((id) => !have.includes(id)).map((id) => ({ id, classes: `fa-solid fa-${id}`, label: id.replace(/-/g, ' ') }));
  if (add.length) store.updateSettings({ icons: [...store.settings.icons, ...add] });
}

// The template's added reactions the environment's tray does not have yet (by glyph or id), or [].
function missingReactions(store, template) {
  const have = Array.isArray(store.settings.reactions) ? store.settings.reactions : [];
  return (template.reactions || []).filter((r) => !have.some((h) => h.glyph === r.glyph || h.id === r.id));
}
// Adds the template's reactions to the environment's tray, after the ones there (decision 12: a template only adds).
function addReactions(store, template) {
  const add = missingReactions(store, template);
  if (add.length) store.updateSettings({ reactions: [...(store.settings.reactions || []), ...add] });
}

// The modules a template turns on once, by id: its own entries (none for '*', which reads as the whole catalog as it is).
const modulesToTurnOn = (template) => (template.modules === '*' ? [] : moduleIdsOf(template));

// Installs (when needed), puts in every space and turns on the bundled modules `ids`, each after what it requires,
// with those added. Answers what was skipped: [{ id, why }]. An enabled module is on in every space it may be in; a
// module not made for the Lobby never lands there (plan-modules, "the Lobby is for being together").
async function turnOnModules(env, ids, { allowed = () => true, modulesDir = MODULES_DIR, name = (id) => id } = {}) {
  const { modules } = env;
  const manifests = new Map(bundledModules(modulesDir).map((m) => [m.id, m]));
  const skipped = [];
  const failed = new Set();
  for (const id of withRequirements(ids.filter((m) => !BUILTIN_MODULE_IDS.includes(m)), manifests)) {
    const manifest = manifests.get(id);
    const missing = (manifest.requires || []).find((r) => failed.has(r));
    let why = null;
    // The AI Assistant is a module like the rest (plan-ai-assistant.md): a template that lists it gets it.
    if (!allowed(id)) why = 'not in the plan';
    else if (missing) why = `needs ${name(missing)}, which was skipped`;
    else {
      // In every space first, then on: one that installs but can't be turned on yet (Research, until the AI service is
      // set up) stays in every space, off, and is recorded with why, so turning it on later is all the owner does.
      try {
        if (!modules.isInstalled(id)) {
          const { zip } = buildModule(path.join(modulesDir, id));
          await modules.install(zip, { source: 'bundled' });
        }
        modules.update(id, { enabled: true });
      } catch (err) {
        why = err.message;
      }
    }
    if (why) { failed.add(id); skipped.push({ id, why }); }
  }
  return skipped;
}

// What a new space starts with, from a template: its profile, and what the Workspace opens with.
function spaceDefaultsOf(template) {
  const out = {};
  if (template.spaceDefaults?.profile) out.profile = template.spaceDefaults.profile;
  if (Array.isArray(template.workspace?.opensWith) && template.workspace.opensWith.length) out.opensWith = [...template.workspace.opensWith];
  return out;
}

// Applies a template's once-only part to an environment made from it (settings, the Lobby, the space defaults, its
// icons into the icon list, its added reactions, then its modules), and answers what was skipped: [{ id, why }]. Safe
// to run again (the same result), but the server runs it only while the record has no appliedAt. `allowed(id)`: whether
// the billing plan includes a bundled module (a template never widens a plan); `modulesDir` where the bundled modules are.
async function applyTemplate(env, template, { allowed = () => true, modulesDir = MODULES_DIR, name = (id) => id } = {}) {
  const { store } = env;
  if (Object.keys(template.settings).length) store.updateSettings(template.settings);
  if (template.lobby.name !== undefined || template.lobby.description !== undefined) store.updateSpace(LOBBY, template.lobby);
  const defaults = spaceDefaultsOf(template);
  if (Object.keys(defaults).length) store.updateSettings({ spaceDefaults: defaults });
  // The home icon itself stays the template's (settings.homeIcon unset) until the owner picks one.
  addIcons(store, template, { iconSet: true });
  if (template.icons.home) store.updateSettings({ homeIcon: null });
  store.updateSettings({ conferenceEnabled: offers(template, 'conference') });
  addReactions(store, template);
  return turnOnModules(env, modulesToTurnOn(template), { allowed, modulesDir, name });
}

// --- switching (the switching addendum, GitHub #59) ------------------------------------------------------------------
// A switch changes only the live part at once (the store's useLive, and the template's icons into the icon list); its
// once-only part is offered, and applied only as confirmed. A switch never turns anything off, never clears the owner's
// home icon, never touches the environment's settings (decision 1 at approval) or any module's data.

// What a switch to `template` would add, for the person switching to confirm:
//   modules: each module it lists (with what it requires) not already on in every space it may be in, with whether
//            the plan allows it ({ id, name, allowed, why? }); the conference when listed and off
//   lobby: the template's Lobby name and description when they differ from the Lobby's own, else null
//   spaceDefaults: the new-space profile, and what a new space opens with, for each that differs from the environment's, else null
//   reactions: the reactions it adds that the tray does not have, else null
//   iconSet: the icons it adds that the icon list does not have, else null
function offerFor(env, template, { allowed = () => true, modulesDir = MODULES_DIR, name = (id) => id, applied = null } = {}) {
  const { store, modules } = env;
  // With fingerprints from the last time this template's once-only part was applied or passed over, a part is offered
  // only when the template changed it since; without them (a switch, or a record from before), by the environment as
  // it is now.
  const prints = partFingerprints(template);
  const changed = (part) => !applied || applied[part] !== prints[part];
  const manifests = new Map(bundledModules(modulesDir).map((m) => [m.id, m]));
  const offered = [];
  if (changed('modules')) for (const id of withRequirements(modulesToTurnOn(template).filter((m) => !BUILTIN_MODULE_IDS.includes(m)), manifests)) {
    const view = modules.isInstalled(id) ? modules.view(id) : null;
    if (view && view.enabled) continue; // an enabled module is on in every space already
    const ok = Boolean(allowed(id));
    offered.push({ id, name: name(id), allowed: ok, ...(ok ? {} : { why: 'not in the plan' }) });
  }
  if (changed('modules') && offers(template, 'conference') && store.settings.conferenceEnabled === false) offered.push({ id: 'conference', name: name('conference'), allowed: true });
  const lobby = store.spaceById(LOBBY);
  const lobbyDiffers = (template.lobby.name !== undefined && template.lobby.name !== lobby?.name) || (template.lobby.description !== undefined && template.lobby.description !== lobby?.description);
  const wanted = spaceDefaultsOf(template);
  const haveDefaults = store.settings.spaceDefaults;
  const defaultsOffer = {};
  if (wanted.profile && wanted.profile !== haveDefaults?.profile) defaultsOffer.profile = wanted.profile;
  if (wanted.opensWith && JSON.stringify(wanted.opensWith) !== JSON.stringify(haveDefaults?.opensWith || [])) defaultsOffer.opensWith = wanted.opensWith;
  const missingIcons = changed('iconSet') ? (template.iconSet || []).filter((id) => !store.iconIds().includes(id)) : [];
  const reactions = changed('reactions') ? missingReactions(store, template) : [];
  return {
    iconSet: missingIcons.length ? missingIcons : null,
    reactions: reactions.length ? reactions : null,
    modules: offered,
    lobby: changed('lobby') && lobbyDiffers ? { name: template.lobby.name ?? lobby?.name ?? '', description: template.lobby.description ?? lobby?.description ?? '' } : null,
    spaceDefaults: changed('spaceDefaults') && Object.keys(defaultsOffer).length ? defaultsOffer : null,
  };
}

// Applies what was confirmed of the offer: `modules` (ids from the offer; anything else is ignored), and `lobby`,
// `spaceDefaults`, `reactions` and `iconSet` (true to take the template's). Answers what was skipped: every offered
// module the plan leaves out, and any confirmed one that could not be turned on, with why. Turns nothing off.
async function applyOffer(env, template, { modules: ids = [], lobby = false, spaceDefaults = false, reactions = false, iconSet = false } = {}, opts = {}) {
  const { store } = env;
  const offer = offerFor(env, template, opts);
  const offeredIds = new Set(offer.modules.map((m) => m.id));
  const chosen = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && offeredIds.has(id)))];
  if (lobby === true && offer.lobby) store.updateSpace(LOBBY, offer.lobby);
  if (spaceDefaults === true && offer.spaceDefaults) store.updateSettings({ spaceDefaults: offer.spaceDefaults });
  if (reactions === true && offer.reactions) addReactions(store, template);
  if (iconSet === true && offer.iconSet) addIcons(store, template, { iconSet: true });
  if (chosen.includes('conference')) store.updateSettings({ conferenceEnabled: true }); // offered only while off; never turned off
  const skipped = offer.modules.filter((m) => !m.allowed).map((m) => ({ id: m.id, why: m.why }));
  const allowedChosen = chosen.filter((id) => !BUILTIN_MODULE_IDS.includes(id) && offer.modules.find((m) => m.id === id).allowed);
  for (const miss of await turnOnModules(env, allowedChosen, opts)) if (!skipped.some((x) => x.id === miss.id)) skipped.push(miss);
  return skipped;
}

module.exports = {
  PARTS, partFingerprints, appliedPartsChanged, appliedOnceFingerprint, wholeFingerprint, loadTemplates, problemsOf, cleanTemplate, storedFields,
  get, list, all, defaultTemplate, useLive, applyTemplate, withRequirements, addIcons, turnOnModules, offerFor, applyOffer, moduleIdsOf, offers,
  bundledManifests, FIELDS, MODULE_KEYS, BUILTIN_MODULE_IDS, SETTINGS, TEMPLATES_DIR, DEFAULT_ID, CALL_POSITIONS, CALL_LAYOUTS, PHASE_MEASURES,
  FIXED_WORKSPACES, MAX_TEMPLATE_BYTES, MAX_STARTER_BYTES, MAX_STARTER_KEYS, MAX_REACTIONS, MAX_ICON_SET, MAX_STARTER_SPACES, MAX_MODULES,
};
