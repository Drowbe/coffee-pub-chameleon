// Set up (documentation/plans/plan-setup-panel.md; plan-one-bar.md, decision 5, step 4): every setting of a space in
// one side panel on the space's own screen, with tabs and Save and Cancel in an action bar locked to its bottom
// (public/action-bar.js). The bar's Set up tool puts `body.setting-up` on (and shows pressed), the space's name becomes
// an input in the bar, and this panel opens (a full-screen sheet on a phone). `/?setup=<id>#<tab>` opens it from an
// address (space.js; setupAddress below reads it).
//
// The tabs, each a code id that is also its address fragment (#show, #space, #members, #phases, #modules). Two ids
// differ from the words a person reads, and are kept as they are (links and stored addresses use them): `show` is
// the tab labelled "Modules" (the first tab) and `modules` is the tab labelled "Settings" (the last).
//   show        "Modules": the page's menu of modules (the switches), Arrange and Layouts
//   space       the picture, name, description, faces in the call, launch link, link icon, the published calendar
//               switch, and a danger section with Delete (its own confirmation here; it does not wait for Save)
//   members     the members and Allow guests (drafts), then Generate invite link and the guest link (actions, at once)
//   phases      each phase's start and end, inline, through the rule in public/phases.js (a draft; the phase chip's
//               sheet is its own surface and still saves as it is set there), then the budget (while a module here
//               reads it, or one is set: #216; budgetTabOf says where it goes when the template has no phases)
//   modules     "Settings": first the First visit section (the Workspace with its Opens with switches, Calendar, Map or a
//               shared layout; a saved id that cannot open now is kept and said why; a default layout can be stopped),
//               then Turn AI off and What AI may see (an owner's), then a section per module with its settings for this space (module-settings.js, its draft mode)
// An owner and the admin see every tab; a moderator sees phases and Settings (First visit and the module settings; the
// server lets a moderator PATCH exactly `phases`, `opensWith`, `defaultLayout` and `budget`, and set a space's module
// settings; the Budget field is on the phases tab, which the three of them see);
// a member has no Set up. A tab with nothing to show (no phases in the template, no module settings for a moderator) is
// left out. The Lobby shows no Delete, no member switches and no calendar switch.
//
// Every field is a draft until Save. Save sends, in order, and stops at the first refusal: PATCH /api/spaces/:id with
// what changed (one body; a moderator's holds only their fields), the picture (PUT or DELETE /api/spaces/:id/image),
// then each changed module's settings (PUT /api/modules/:id/settings/space). (The plan's module switches are not
// here: availability per space was removed, and the server ignores a module's list of spaces.) A
// refusal keeps the panel open on that field's tab with the server's sentence and the keyboard on the field, and says
// what did save. After a full save the panel closes. A tab with unsaved changes shows a dot. Cancel drops every draft;
// Escape cancels at once when nothing changed and asks "Discard your changes?" when something did; a click outside does
// nothing.
//
// The pure parts (setupTabs, pickTab, setupAddress, setupPatch, dirtyTabs, takeSaved, problemField, setupSaidWords,
// budgetEntryProblem, budgetWanted) touch no
// document, so tools/check-nav.mjs runs them in node; the page hands the panel what it needs (createSpaceSetup's `deps`).
import { actionBar } from './action-bar.js';
import { mountSees, fullSees, sameSees } from './ai-sees.js';
import { rowsOf, dayWords, plainDays, sameDates, tintOf, rowIconHtml } from './phase-sheet.js';

// The name of the Set up button and of the panel's title: "<space word> Configuration" (Trip Configuration), in the
// template's word; in an aside, the aside's word. `word` is the page's word helper. One helper, so the two say the same.
export const configurationLabel = (word, aside = false) => `${word(aside ? 'aside' : 'space', { cap: true })} Configuration`;

// The tabs, in the order shown, by rights.
export const SETUP_TABS = Object.freeze(['space', 'members', 'phases', 'modules']);
export const OWNER_TABS = SETUP_TABS;
export const MODERATOR_TABS = Object.freeze(['phases', 'modules']);
// The fields a moderator's PATCH may hold (server/index.js, MODERATOR_SPACE_FIELDS).
export const MODERATOR_FIELDS = Object.freeze(['phases', 'opensWith', 'defaultLayout', 'budget']);
// `phases`: the template has phases. Settings is always there for an owner and a moderator: the First visit section is
// in it, so it never has nothing to show.
// `show`: the Modules tab (id `show`: the modules' switches, Arrange and Layouts, for everyone wider than a phone) comes first.
export function setupTabs({ owner = false, moderator = false, phases = true, show = false } = {}) {
  const tabs = owner ? OWNER_TABS : moderator ? MODERATOR_TABS : [];
  return [...(show ? ['show'] : []), ...tabs].filter((t) => t !== 'phases' || phases);
}
// The tab an address fragment asks for, else the first the person may see (an unknown fragment is never an error).
export function pickTab(tabs, hash = '') {
  const id = String(hash || '').replace(/^#/, '');
  return tabs.includes(id) ? id : tabs[0] || null;
}
// `/?setup=<id>#<tab>`: the space to set up and the tab the fragment asks for ('' for none), or null when the address
// does not ask. The tab is checked later, against what the person may see (pickTab).
export function setupAddress(search = '', hash = '') {
  const id = new URLSearchParams(search).get('setup');
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return { id, tab: String(hash || '').replace(/^#/, '') };
}

// Which tab each saved field lives on (the dirty dots, and the tab a refusal opens).
export const FIELD_TAB = Object.freeze({
  name: 'space', description: 'space', profile: 'space', link: 'space', linkIcon: 'space', publishCalendar: 'space', image: 'space', imageRemoved: 'space', budget: 'phases',
  members: 'members', allowGuests: 'members',
  phases: 'phases',
  opensWith: 'modules', defaultLayout: 'modules',
  aiOff: 'modules', aiSees: 'modules',
});
// A module's settings, in the save's lists and its words, are `module:<id>`; they live on the Settings tab (id `modules`), as does the First visit section.
// The tab the budget is on: the phases tab (every role with a Set up has it), else, when the template has no phases, the
// space tab (an owner's), else the Settings tab (a moderator's, with First visit). `tabs` is the tabs the person has.
export const budgetTabOf = (tabs) => (tabs.includes('phases') ? 'phases' : tabs.includes('space') ? 'space' : 'modules');
export const tabOfField = (f, tabs = null) => (f === 'budget' && tabs ? budgetTabOf(tabs) : FIELD_TAB[f] || (String(f).startsWith('module:') ? 'modules' : null));

const sameList = (a, b) => {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((id, i) => id === b[i]);
};
const sameSet = (a = [], b = []) => a.length === b.length && a.every((k) => b.includes(k));
const listOrNull = (v) => (Array.isArray(v) && v.length ? v.filter((id) => typeof id === 'string') : null);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
// A space's phase dates as stored ({ <phase id>: { start?, end? } }), copied; anything else is none.
const datesCopy = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : {});
// The budget target as the panel holds it (#216): { amount, currency } as the fields' text ('' for none, '' for the
// reporting module's own currency), and in the draft `bad: true` while the number field holds something it cannot read
// (`12-3`, `1e`: the browser then reports the value as '' and validity.badInput). budgetSent() is what the PATCH sends:
// null for none (only when both the amount and the currency are empty), { currency } for a currency with no amount, else
// { amount, currency? }. The draft always holds the stored amount, so a changed currency goes with it (the server
// replaces the whole target, so a currency sent alone would lose an amount). An amount that is not a number (or a bad
// entry) goes as { amount: null }, which the server refuses with its sentence, so a bad entry never clears a stored budget.
const budgetText = (v) => ({
  amount: v && v.amount !== undefined && v.amount !== null && v.amount !== '' ? String(v.amount).trim() : '',
  currency: v && typeof v.currency === 'string' ? v.currency.trim().toUpperCase() : '',
});
// The sentence refusing what the budget field holds before anything is sent, or null when it may go: a bad entry, or an
// amount that is not a finite number. Empty is fine (no budget); the server's own rules (above zero, 12 digits) stay its.
export const BUDGET_NOT_A_NUMBER = 'The budget must be a number, such as 4000 or 4000.50.';
export function budgetEntryProblem(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.bad === true) return BUDGET_NOT_A_NUMBER;
  const { amount } = budgetText(v);
  if (amount && !Number.isFinite(Number(amount))) return BUDGET_NOT_A_NUMBER;
  return null;
}
// Whether Set up shows the Budget section, and the module it names: a module that reads the target is on here (its
// manifest says `"budget": true`; `installed` is the module list the person may read: GET /api/modules for an owner,
// GET /api/modules/for-space for a moderator, every enabled module being on in every space but the Lobby keeping its
// own), a module reported a fact marked `budget` (`reported`, { name }), or a target is set already, an amount or a
// currency alone. { show, name }.
export function budgetWanted({ lobby = false, installed = [], reported = null, stored = null } = {}) {
  if (lobby) return { show: false, name: '' };
  const reads = (Array.isArray(installed) ? installed : []).find((m) => m && m.enabled !== false && m.budget === true && Array.isArray(m.scope) && m.scope.includes('space'));
  const name = (reported && reported.name) || (reads ? reads.displayName || reads.name || '' : '');
  return { show: Boolean(reads || reported || budgetText(stored).amount || budgetText(stored).currency), name };
}
function budgetSent(v) {
  const b = budgetText(v);
  if (v && v.bad === true) return { amount: null, ...(b.currency ? { currency: b.currency } : {}) };
  if (!b.amount) return b.currency ? { currency: b.currency } : null;
  const amount = Number(b.amount);
  return { amount: Number.isFinite(amount) ? amount : null, ...(b.currency ? { currency: b.currency } : {}) };
}
const sameBudget = (a, b) => JSON.stringify(budgetSent(a)) === JSON.stringify(budgetSent(b));

// The PATCH body for what changed between `before` (the space as it was) and `after` (the panel's draft), each
// { name, description, profile, link, linkIcon, publishCalendar, members, allowGuests, phases, opensWith, defaultLayout,
// aiOff, budget }; a field left out of `after` is unchanged. The budget goes as null (none) or { amount, currency? }. The phase dates go whole, when any phase's start or end changed
// (the order of the keys is no change). A name is trimmed, and an empty one is no change. The first visit's layout and
// Opens with are independent (plan-layout-views.md, step 5): each goes only when it changed, never one for the other.
// `defaultLayout` is 'calendar', 'map' or a shared layout's id; the Workspace (null, or 'workspace') goes as null. The
// members are a set (their order is no change). {} when nothing changed.
const sameAiSees = (a, b) => (a ? (b ? sameSees(a, b) : false) : !b);
const layoutOrNull = (v) => (typeof v === 'string' && v && v !== 'workspace' ? v : null);
export function setupPatch(before = {}, after = {}) {
  const patch = {};
  const name = typeof after.name === 'string' ? after.name.trim() : '';
  if (name && name !== (before.name || '')) patch.name = name;
  if (typeof after.description === 'string' && text(after.description) !== text(before.description)) patch.description = text(after.description);
  if (after.profile !== undefined && after.profile !== (before.profile || 'participants')) patch.profile = after.profile;
  if (typeof after.link === 'string' && text(after.link) !== text(before.link)) patch.link = text(after.link);
  if (typeof after.linkIcon === 'string' && after.linkIcon && after.linkIcon !== before.linkIcon) patch.linkIcon = after.linkIcon;
  if (typeof after.publishCalendar === 'boolean' && after.publishCalendar !== (before.publishCalendar !== false)) patch.publishCalendar = after.publishCalendar;
  if (Array.isArray(after.members) && !sameSet(after.members, Array.isArray(before.members) ? before.members : [])) patch.members = [...after.members];
  if (typeof after.allowGuests === 'boolean' && after.allowGuests !== (before.allowGuests !== false)) patch.allowGuests = after.allowGuests;
  if (typeof after.guestsSeeHidden === 'boolean' && after.guestsSeeHidden !== (before.guestsSeeHidden === true)) patch.guestsSeeHidden = after.guestsSeeHidden;
  if (after.phases && typeof after.phases === 'object' && !sameDates(after.phases, datesCopy(before.phases))) patch.phases = datesCopy(after.phases);
  if (typeof after.aiOff === 'boolean' && after.aiOff !== (before.aiOff === true)) patch.aiOff = after.aiOff;
  // What AI may see: null follows the environment's choice; else the space's own, whole.
  if (after.aiSees !== undefined && !sameAiSees(after.aiSees, before.aiSees)) patch.aiSees = after.aiSees ? fullSees(after.aiSees) : null;
  if (after.budget !== undefined && !sameBudget(after.budget, before.budget)) patch.budget = budgetSent(after.budget);
  const wasLayout = layoutOrNull(before.defaultLayout);
  const nowLayout = after.defaultLayout === undefined ? wasLayout : layoutOrNull(after.defaultLayout);
  if (nowLayout !== wasLayout) patch.defaultLayout = nowLayout;
  const wasList = listOrNull(before.opensWith);
  const nowList = after.opensWith === undefined ? wasList : listOrNull(after.opensWith);
  if (!sameList(wasList, nowList)) patch.opensWith = nowList;
  return patch;
}

// The tabs with unsaved changes: the PATCH's fields, the picture when one was chosen or removed, and a module's
// settings when any changed.
export function dirtyTabs(patch = {}, { image = false, modules = false, tabs: have = null } = {}) {
  const tabs = new Set(Object.keys(patch).map((f) => (FIELD_TAB[f] ? tabOfField(f, have) : null)).filter(Boolean));
  if (image) tabs.add('space');
  if (modules) tabs.add('modules');
  return tabs;
}

// Which field of a refused PATCH the server's sentence is about (store.updateSpace's sentences), else its first.
const PROBLEM_FIELDS = [
  [/budget|currenc/i, 'budget'], [/may see/i, 'aiSees'], [/\bAI\b/, 'aiOff'], [/icon/i, 'linkIcon'], [/publish/i, 'publishCalendar'], [/link/i, 'link'], [/member/i, 'members'], [/guest/i, 'allowGuests'],
  [/opens with/i, 'opensWith'], [/layout|first visit/i, 'defaultLayout'], [/profile/i, 'profile'], [/phase|date|\b(starts?|ends?)\b/i, 'phases'],
];
export function problemField(patch = {}, problem = '') {
  const keys = Object.keys(patch);
  for (const [re, field] of PROBLEM_FIELDS) if (keys.includes(field) && re.test(problem)) return field;
  return keys[0] || null;
}

// The line a person reads after Save: what was saved, in words, and what to do next. `saved` is the fields that went
// through (the PATCH's keys, 'image' or 'imageRemoved', and `module:<id>` for a module's settings); `failed` a field
// that did not with the server's sentence. `words` names a field in this environment's words: the panel always gives
// the members ("the players") and Allow guests, which are role words, and each module's settings by its name.
const FIELD_WORDS = {
  name: 'the name', description: 'the description', profile: 'the faces in the call', link: 'the launch link', linkIcon: 'the link icon',
  publishCalendar: 'the published calendar', opensWith: 'Opens with', phases: 'the phase dates', aiOff: 'Turn AI off', aiSees: 'What AI may see',
  defaultLayout: 'the first visit', image: 'the picture', imageRemoved: 'the picture', budget: 'the budget',
};
export function setupSaidWords({ saved = [], failed = null, problem = '' } = {}, { setUp = 'Set up', words = {} } = {}) {
  const wordOf = (f) => words[f] || FIELD_WORDS[f] || f;
  const names = [...new Set(saved.map(wordOf))];
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '';
  if (failed) {
    const what = wordOf(failed);
    const why = problem ? ` ${problem[0].toUpperCase()}${problem.slice(1).replace(/\.?$/, '.')}` : '';
    const many = ['members', 'phases'].includes(failed) || String(failed).startsWith('module:'); // "the players", "the Maps settings"
    return `${what[0].toUpperCase()}${what.slice(1)} ${many ? 'were' : 'was'} not saved.${why}${names.length ? ` ${list[0].toUpperCase()}${list.slice(1)} ${names.length > 1 ? 'were' : 'was'} saved.` : ''} Change it and press Save again, or Cancel.`;
  }
  if (!names.length) return `Nothing changed. Press ${setUp} to change something.`;
  return `Saved ${list}. Everyone sees it now; press ${setUp} to change more.`;
}

// The space as the panel's `before`: each field as the server means it (no link is '', the calendar and guests are
// on unless false).
function beforeOf(space = {}) {
  return {
    name: space.name || '',
    description: typeof space.description === 'string' ? space.description : '',
    // 'roleplaying' is the older name of the participants' pictures (server/store.js), so it reads as that here.
    profile: space.profile === 'characters' ? 'characters' : 'participants',
    link: typeof space.link === 'string' ? space.link : '',
    linkIcon: typeof space.linkIcon === 'string' ? space.linkIcon : '',
    publishCalendar: space.publishCalendar !== false,
    members: Array.isArray(space.members) ? [...space.members] : [],
    allowGuests: space.allowGuests !== false,
    guestsSeeHidden: space.guestsSeeHidden === true,
    opensWith: listOrNull(space.opensWith),
    defaultLayout: space.defaultLayout || null,
    phases: datesCopy(space.phases),
    aiOff: space.aiOff === true,
    aiSees: space.aiSees && typeof space.aiSees === 'object' ? fullSees(space.aiSees) : null,
    budget: budgetText(space.budget),
  };
}
const copyOf = (b) => ({ ...b, members: [...b.members], opensWith: b.opensWith ? [...b.opensWith] : null, phases: datesCopy(b.phases), budget: { ...b.budget }, aiSees: b.aiSees ? { ...b.aiSees, modules: Array.isArray(b.aiSees.modules) ? [...b.aiSees.modules] : b.aiSees.modules } : null });
// After a step of the save went through: each field it sent is now what the server answered, in both `before` and the
// draft, so a value the server normalized (a link stored as https://example.com/ for https://example.com) is no
// change and leaves no dot. The fields it did not send stay as they were. Answers { before, draft }, new objects.
export function takeSaved(before = {}, draft = {}, fields = [], answer = {}) {
  const fresh = beforeOf(answer);
  const nextBefore = { ...before };
  const nextDraft = { ...draft };
  for (const k of fields) {
    if (!(k in fresh)) continue;
    const v = fresh[k];
    nextBefore[k] = v;
    nextDraft[k] = Array.isArray(v) ? [...v] : k === 'phases' ? datesCopy(v) : k === 'budget' ? { ...v } : v;
  }
  return { before: nextBefore, draft: nextDraft };
}
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- the panel ----------------------------------------------------------------------------------------------------

// `deps`: { tabOverflow, openMenu, api, word, verb, icons, switchListHtml, wireSwitchList, opensWithSummary, escapeHtml, doc, layoutVerb,
// renderModuleSettings }. Returns { open(opts), close(), done(), cancel(), isOpen(), select(tab), el }. `open({ space,
// owner, moderator, phases, rule, today, tab, onDone, onSaved, onDeleted, onLinks, onTab, onLeave, nameInput })`:
// `space` the space's record, `phases` the template's phases (a list) and `rule` the Phases object (public/phases.js),
// `today` a day (YYYY-MM-DD), `tab` the address fragment asking for a tab, `nameInput` the bar's input (kept in step
// with the Name), `onDone(space, said, saved)` is told once the whole save went through, `onSaved(space, saved)` after
// a part of it did and a later request was refused, `onDeleted(space)` after Delete, `onLinks(space)` after an invite
// or guest link action, `onTab(id)` as the tab changes, `onLeave()` when the mode ends either way.
export function createSpaceSetup(deps) {
  const { api, word, switchListHtml, wireSwitchList, opensWithSummary, escapeHtml, tabOverflow, openMenu: openHostMenu } = deps; // tabOverflow (primary-nav.js) and openMenu (host-menu.js) come from the page
  const doc = deps.doc || document;
  const el = doc.createElement('aside');
  el.id = 'space-setup';
  el.className = 'space-setup action-surface';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'space-setup-title');
  el.hidden = true;
  let state = null; // while open: { space, tabs, tab, draft, before, options, layouts, opts, image, links, users, saving, bar }

  const esc = (s) => escapeHtml(String(s ?? ''));
  const spaceWord = () => word('space');
  const membersWord = (cap = false) => word('member', { many: true, cap });
  const modulesWord = (cap = false) => word('module', { many: true, cap });
  const configLabel = () => configurationLabel(word, Boolean(state && state.space && state.space.isAside)); // the button's name too (space.js setupLabel)
  const tabLabel = (id) => ({ show: modulesWord(true), space: word('space', { cap: true }), members: membersWord(true), phases: 'Phases', modules: 'Settings' })[id];
  const sectionHtml = (id, title, inner, { hidden = false, cls = '' } = {}) => `<section class="setup-section${cls ? ` ${cls}` : ''}" data-section="${id}"${hidden ? ' hidden' : ''}><h3 class="setup-heading">${title}</h3>${inner}</section>`;

  function spaceTabHtml() {
    const { space } = state;
    const parts = [];
    parts.push(sectionHtml('picture', 'Picture', `
        <div class="setup-picture">
          <img id="setup-picture-img" alt="" hidden>
          <span class="setup-picture-none" id="setup-picture-none">No picture</span>
          <span class="setup-picture-buttons">
            <label class="btn btn-small setup-picture-pick"><input type="file" id="setup-picture-file" accept="image/png,image/jpeg,image/gif,image/webp" class="visually-hidden"><i class="fa-solid fa-image fa-fw" aria-hidden="true"></i> Choose a picture</label>
            <button type="button" class="btn btn-small" id="setup-picture-remove" hidden><i class="fa-solid fa-xmark fa-fw" aria-hidden="true"></i> Remove</button>
          </span>
        </div>
        <p class="hint">Shown with its name on Home.</p>`));
    parts.push(sectionHtml('name', 'Name', '<label class="setup-field"><span class="visually-hidden">Name</span><input type="text" id="setup-name" maxlength="40" autocomplete="off"></label><p class="hint">Shown in the bar and on Home.</p>'));
    parts.push(sectionHtml('description', 'Description <span class="sdk-optional">(optional)</span>', `<label class="setup-field"><span class="visually-hidden">Description</span><textarea id="setup-description" rows="3" maxlength="300"></textarea></label><p class="hint">A line or two about this ${esc(spaceWord())}.</p>`));
    parts.push(sectionHtml('faces', 'Faces in the call', `
        <label class="setup-field"><span class="visually-hidden">Faces in the call</span><select id="setup-profile">
          <option value="participants">People's own pictures</option>
          <option value="characters">Their character pictures</option>
        </select></label>
        <p class="hint">What each person's tile shows while their camera is off.</p>`));
    const enter = typeof deps.verb === 'function' ? deps.verb('enter') : 'Enter';
    parts.push(sectionHtml('link', 'Launch link <span class="sdk-optional">(optional)</span>', `<label class="setup-field"><span class="visually-hidden">Launch link</span><input type="url" id="setup-link" maxlength="500" placeholder="https://your-game-or-site.example" autocomplete="off" inputmode="url"></label><p class="hint">A button next to ${esc(enter)} and in the call's toolbar opens it.</p>`));
    if ((typeof deps.icons === 'function' ? deps.icons() : []).length) {
      parts.push(sectionHtml('link-icon', '<span id="setup-link-icon-heading">Link icon</span>', '<div class="icon-grid setup-icon-grid" id="setup-link-icon" role="radiogroup" aria-labelledby="setup-link-icon-heading"></div><p class="hint">The icon on the launch link\'s button.</p>'));
    }
    if (!space.isLobby) {
      parts.push(sectionHtml('calendar', '<span id="setup-calendar-heading">Calendar</span>', `<label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">In the published calendar</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-publish-calendar"></label><p class="hint">${esc(word('owner', { many: true, cap: true }))} can publish one calendar with every ${esc(spaceWord())}'s events. Turn this off to leave this ${esc(spaceWord())} out.</p>`, { hidden: true }));
    }
    return parts.join('');
  }

  // The Delete section: the last thing on the space tab, after the budget and everything else (draw adds it). Not for the Lobby.
  function dangerSectionHtml() {
    return sectionHtml('danger', `Delete this ${esc(spaceWord())}`, `
        <button type="button" class="btn btn-small btn-danger" id="setup-delete" aria-haspopup="true" aria-expanded="false"><i class="fa-solid fa-trash fa-fw" aria-hidden="true"></i> Delete ${esc(spaceWord())}</button>
        <p class="hint">Happens at once; it does not wait for Save.</p>
        <div class="setup-confirm" id="setup-delete-confirm" role="alertdialog" aria-labelledby="setup-delete-words" hidden>
          <p class="setup-confirm-words" id="setup-delete-words"></p>
          <div class="setup-confirm-buttons">
            <button type="button" class="btn btn-small btn-danger" id="setup-delete-yes">Delete</button>
            <button type="button" class="btn btn-small" id="setup-delete-keep">Keep</button>
          </div>
          <p class="setup-confirm-problem" id="setup-delete-problem" role="status" aria-live="polite"></p>
        </div>`, { cls: 'setup-danger' });
  }

  // The budget (#216): an amount and its currency, a draft saved with Save. Drawn for every space but the Lobby, on the
  // tab budgetTabOf names, and shown while a module here reads it or one is set (budgetWanted; paintBudgetSection), which
  // is known only once the person's own record, the module list and the facts have come: hidden until then, so nothing
  // typed is lost. An owner, the admin and a moderator of the space have it; a member has no Set up.
  function budgetSectionHtml() {
    return sectionHtml('budget', '<span id="setup-budget-heading">Budget</span>', `
        <div class="setup-budget" role="group" aria-labelledby="setup-budget-heading">
          <label class="setup-field setup-budget-amount"><span class="visually-hidden">Amount</span><input type="number" id="setup-budget-amount" min="0" step="any" inputmode="decimal" placeholder="No budget" autocomplete="off"></label>
          <label class="setup-field setup-budget-currency"><span class="visually-hidden">Currency</span><select id="setup-budget-currency"></select></label>
        </div>
        <p class="hint" id="setup-budget-hint"></p>`, { hidden: true });
  }

  function membersTabHtml() {
    const { space } = state;
    const guest = word('guest');
    const guests = word('guest', { many: true, cap: true });
    const parts = [];
    parts.push(sectionHtml('members', `<span id="setup-members-heading">${esc(membersWord(true))}</span>`, space.isLobby
      ? `<p class="hint">Everyone belongs to the ${esc(space.name || 'Lobby')}.</p>`
      : `<div class="setup-members" id="setup-members" role="group" aria-labelledby="setup-members-heading"></div><p class="hint">Who is in this ${esc(spaceWord())}. Saved with Save.</p>`));
    parts.push(sectionHtml('guests', esc(guests), `<label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">Allow ${esc(guests)}</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-allow-guests"></label><p class="hint">Whether a ${esc(guest)} link can be used here. Saved with Save.</p>
        <label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">${esc(guests)} can see costs and booking codes</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-guests-see-hidden"></label><p class="hint">Off keeps amounts and booking codes from ${esc(guests.toLowerCase())}. Only ${esc(word('owner', { many: true }))} can change this. Saved with Save.</p>`));
    parts.push(sectionHtml('links', 'Links', `
        <p class="hint setup-links-hint">These work at once; they are not part of Save.</p>
        <h4 class="setup-subheading">Invite to sign up</h4>
        <div class="setup-link-row">
          <button type="button" class="btn btn-small" id="setup-make-invite"><i class="fa-solid fa-envelope fa-fw" aria-hidden="true"></i> Generate invite link</button>
        </div>
        <div class="setup-link-row" id="setup-invite-row" hidden>
          <code class="key link" id="setup-invite-link"></code>
          <button type="button" class="btn btn-small" id="setup-invite-copy">Copy</button>
        </div>
        <p class="hint">Signs someone up and puts them in this ${esc(spaceWord())}. One use, for 7 days.</p>
        <h4 class="setup-subheading">${esc(word('guest', { cap: true }))} link</h4>
        <div class="setup-link-row">
          <code class="key link" id="setup-guest-link-value">off</code>
          <button type="button" class="btn btn-small" id="setup-guest-link-on">Turn on</button>
          <button type="button" class="btn btn-small" id="setup-guest-link-copy" hidden>Copy</button>
          <button type="button" class="btn btn-small" id="setup-guest-link-new" hidden>New link</button>
          <button type="button" class="btn btn-small btn-danger" id="setup-guest-link-off" hidden>Turn off</button>
        </div>
        <p class="hint" id="setup-guest-link-note" hidden></p>
        <p class="hint">Anyone with it can come in with just a name.</p>
        <p class="setup-links-status" id="setup-links-status" role="status" aria-live="polite"></p>`));
    return parts.join('');
  }

  // Phases (plan-setup-panel.md, step 4): the phase sheet's rows, inline, one per phase in the template's order: its
  // name, a start and an end (native date inputs) and its length; an undated row reads "Not scheduled" with Add dates.
  // Every edit goes through the rule (public/phases.js: setPhaseDate, addDatesFor, skipPhase, as the sheet does), so the
  // timeline stays contiguous; a refusal is one sentence by the row and the input snaps back. Nothing dated yet: the
  // first step, "Start the first phase on". The dates are a draft: they go in Save's PATCH.
  function phasesTabHtml() {
    const rows = state.phaseList.map((p, i) => `
          <li class="phase-row" data-id="${esc(p.id)}" data-tint="${state.rule && state.rule.tintOf ? state.rule.tintOf(i) : tintOf(i)}">
            <div class="phase-row-name">
              <span class="phase-swatch" aria-hidden="true"></span>
              ${rowIconHtml(p)}<span class="phase-row-label">${esc(p.label)}</span>
              <span class="sdk-chip-tag" data-phase-tag="now" data-tone="info" hidden>now</span>
              <span class="sdk-chip-tag" data-phase-tag="main" hidden>main</span>
            </div>
            <label class="phase-row-field phase-row-start"><span class="phase-row-word">Start</span><input type="date" class="phase-date" data-edge="start" data-id="${esc(p.id)}" aria-label="${esc(p.label)} starts"></label>
            <label class="phase-row-field phase-row-end"><span class="phase-row-word">End</span><input type="date" class="phase-date" data-edge="end" data-id="${esc(p.id)}" aria-label="${esc(p.label)} ends"></label>
            <span class="phase-row-days"></span>
            <div class="phase-row-tools"><button type="button" class="btn btn-small phase-skip" aria-label="Skip ${esc(p.label)}: clear its dates">Skip</button></div>
            <div class="phase-row-off" hidden><span class="phase-row-off-word">Not scheduled</span><button type="button" class="btn btn-small phase-add" aria-label="Add dates for ${esc(p.label)}"><i class="fa-solid fa-plus fa-fw" aria-hidden="true"></i> Add dates</button></div>
            <p class="phase-row-problem" hidden></p>
          </li>`).join('');
    return `<section class="setup-section" data-section="phases"><h3 class="setup-heading" id="setup-phases-heading">Phases</h3>
        <p class="setup-phases-now" id="setup-phases-now"></p>
        <div class="phase-first setup-phase-first" id="setup-phase-first" hidden>
          <label class="phase-first-label" for="setup-phase-first-day">Start the first phase on</label>
          <input type="date" class="phase-date" id="setup-phase-first-day">
          <button type="button" class="btn btn-small" id="setup-phase-first-go">Start</button>
        </div>
        <ol class="phase-list setup-phase-list" id="setup-phase-list" aria-labelledby="setup-phases-heading">${rows}</ol>
        <p class="hint">Each phase starts the day after the one before ends. A phase with no dates is skipped. Saved with Save.</p>
        <p class="setup-phases-status" id="setup-phases-status" role="status" aria-live="polite"></p></section>`;
  }

  // First visit, a section of the Settings tab (plan-layout-views.md, step 5): one choice, radios of one name. The Workspace first, with its Opens
  // with switches directly under it (always editable, whichever is picked: they are what the Workspace holds), then
  // Calendar and Map while they are on here, then the shared layouts by name (paintLayouts).
  function firstVisitHtml() {
    return `<section class="setup-section" data-section="first-visit"><h3 class="setup-heading" id="setup-first-visit-heading">First visit</h3>
        <p class="hint setup-first-visit-hint" id="setup-first-visit-hint">What someone sees the first time they enter this ${esc(spaceWord())}. After that, each person's own arrangement is remembered.</p>
        <div class="setup-opens-with-layout" id="setup-opens-with-layout" hidden>
          <span class="setup-opens-with-layout-text" id="setup-opens-with-layout-text"></span>
          <button type="button" class="btn btn-small" id="setup-opens-with-layout-stop">Stop using it</button>
        </div>
        <fieldset class="setup-first-visit" id="setup-first-visit" aria-labelledby="setup-first-visit-heading" aria-describedby="setup-first-visit-hint">
          <label class="setup-choice"><input type="radio" name="setup-first-visit" value="workspace" id="setup-first-workspace"><i class="fa-solid fa-columns fa-fw" aria-hidden="true" id="setup-workspace-icon"></i><span class="setup-choice-name" id="setup-workspace-name">Workspace</span></label>
          <div class="setup-workspace-content">
            <p class="setup-subheading" id="setup-opens-with-label">Opens with</p>
            <div class="opens-with-list setup-opens-with" id="setup-opens-with" role="group" aria-labelledby="setup-opens-with-label" aria-describedby="setup-opens-with-hint"></div>
            <p class="hint" id="setup-opens-with-note" hidden></p>
            <p class="hint" id="setup-opens-with-hint">What the Workspace starts with, whichever is picked.</p>
          </div>
          <div class="setup-first-layouts" id="setup-first-visit-layouts"></div>
        </fieldset>
        <p class="hint" id="setup-layout-note" hidden></p></section>`;
  }

  // The Settings tab (id `modules`; plan-setup-panel.md, step 5). It starts with the First visit section (everyone with this
  // tab). For an owner and the admin: the modules on here (a list: an enabled
  // module is on in every space, so there are no switches; Manage's Modules tab turns one on or off), Turn AI off while
  // the server has an AI service, then a section per module with its settings for this space. A moderator sees the
  // module settings only. The settings are drawn by module-settings.js in its draft mode (no Save on each).
  function modulesTabHtml() {
    const parts = [firstVisitHtml()];
    if (state.owner) {
      parts.push(sectionHtml('ai', '<i class="fa-solid fa-wand-magic-sparkles fa-fw" aria-hidden="true"></i> AI', `<label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">Turn AI off in this ${esc(spaceWord())}</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-ai-off"></label><p class="hint">${esc(modulesWord(true))} here can use the server's AI service to summarise and answer questions. Turned off, nobody here can, whatever the roles allow. Saved with Save.</p>`, { hidden: true }));
      parts.push(sectionHtml('ai-sees', 'What AI may see', `<p class="hint">What goes to the AI with a question in this ${esc(spaceWord())}. This only narrows it: the AI never sees what the person asking could not open. Saved with Save.</p><label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label" id="setup-ai-sees-follow-label">Same as the ${esc(word('environment'))}'s choice</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-ai-sees-follow"></label><div id="setup-ai-sees-box"></div>`, { hidden: true }));
    }
    parts.push(sectionHtml('module-settings', `${esc(word('module', { cap: true }))} settings`, `<p class="hint">What each ${esc(word('module'))} does in this ${esc(spaceWord())}. Saved with Save; deleting a file happens at once.</p><div class="setup-module-settings" id="setup-module-settings"><p class="hint">Loading…</p></div>`));
    return parts.join('');
  }

  // The Modules tab (id `show`): the menu is drawn into #setup-show; an owner and the admin read at its foot where modules are turned on.
  const showTabHtml = () => `<div class="setup-show" id="setup-show"></div>${state.owner ? `<p class="hint setup-modules-note" id="setup-modules-note">${esc(modulesWord(true))} are turned on for the whole ${esc(word('environment'))} in Manage.</p>` : ''}`;
  const TAB_HTML = { show: showTabHtml, space: spaceTabHtml, members: membersTabHtml, phases: phasesTabHtml, modules: modulesTabHtml };

  function draw() {
    const { tabs, space } = state;
    const one = tabs.length === 1;
    const tabButtons = tabs.map((id) => `<button type="button" role="tab" class="setup-tab" id="setup-tab-${id}" data-tab="${id}" aria-controls="setup-content-${id}" aria-selected="false" tabindex="-1"><span class="setup-tab-label">${esc(tabLabel(id))}</span><span class="setup-tab-dot" aria-hidden="true" hidden></span><span class="visually-hidden setup-tab-unsaved"></span></button>`).join('');
    const contents = tabs.map((id) => `<div role="tabpanel" class="setup-tab-content" id="setup-content-${id}" data-tab="${id}" aria-labelledby="setup-tab-${id}" tabindex="-1" hidden>${TAB_HTML[id]()}${id === budgetTabOf(tabs) && !space.isLobby ? budgetSectionHtml() : ''}${id === 'space' && !space.isLobby ? dangerSectionHtml() : ''}</div>`).join('');
    el.innerHTML = `
      <div class="setup-head">
        <h2 id="space-setup-title">${esc(one ? tabLabel(tabs[0]) : configLabel())}</h2>
        <p class="setup-which" id="space-setup-which"></p>
        <div class="setup-tabs setup-tabs-fit" id="setup-tabs" role="tablist" aria-label="${esc(configLabel())}"${one ? ' hidden' : ''}>${tabButtons}<button type="button" class="core-link layout-tabs-more" id="setup-tabs-more" data-tip="More tabs" aria-label="More tabs" aria-haspopup="menu" aria-expanded="false" hidden><i class="fa-solid fa-ellipsis-vertical fa-fw" aria-hidden="true"></i></button></div>
      </div>
      <div class="setup-body">${contents}</div>
      <p class="setup-status status" id="space-setup-status" role="status" aria-live="polite"></p>`;
    el.querySelector('.setup-body').classList.add('action-content');
    state.bar = actionBar({
      label: 'Save the set up',
      doc,
      readOnly: !(state.opts.owner || state.opts.moderator), // only the Modules tab: nothing to save, only Close
      ids: { save: 'setup-save', cancel: 'setup-cancel-button' },
      discardWords: 'Discard your changes?',
      dirty: isDirty,
      onSave: () => done(),
      onCancel: () => close(),
    });
    el.appendChild(state.bar.el);
    el.querySelector('#space-setup-which').textContent = space.name;
    fillFields();
    wire();
    mountShow();
  }

  // The Modules tab (id `show`): the page's menu of modules, Arrange and Layouts (canvas.mountMenu), drawn into the tab and kept up to date.
  function mountShow() {
    const holder = q('#setup-show');
    if (!holder || typeof state.opts.show !== 'function') return;
    state.showView = state.opts.show(holder);
  }

  // The tabs that fit show; the rest go into the "..." after them (tabOverflow: the first tab and the one shown never
  // leave). The "..." lists the hidden ones on the shared menu, a check on none of them (the one shown is always in the row).
  function fitTabs() {
    if (!state) return;
    const strip = q('#setup-tabs');
    const more = q('#setup-tabs-more');
    if (!strip || !more) return;
    const list = [...strip.querySelectorAll(':scope > .setup-tab')];
    for (const t of list) t.classList.remove('layout-tab-out');
    more.hidden = true;
    if (strip.hidden || !strip.getClientRects().length) return;
    const view = doc.defaultView || window;
    const css = view.getComputedStyle(strip);
    const gap = parseFloat(css.columnGap) || 0;
    const avail = strip.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0);
    more.hidden = false;
    const moreWidth = more.getBoundingClientRect().width;
    more.hidden = true;
    const { out, more: showMore } = tabOverflow({ avail: Math.floor(avail) - 1, gap, widths: list.map((t) => t.getBoundingClientRect().width), more: moreWidth, current: list.findIndex((t) => t.dataset.tab === state.tab) });
    const focused = doc.activeElement && strip.contains(doc.activeElement) ? doc.activeElement : null;
    list.forEach((t, i) => t.classList.toggle('layout-tab-out', out.includes(i)));
    more.hidden = !showMore;
    if (focused && focused.classList.contains('layout-tab-out')) more.focus();
  }
  function openMoreTabs() {
    const more = q('#setup-tabs-more');
    const hidden = [...el.querySelectorAll('#setup-tabs > .setup-tab.layout-tab-out')];
    const dirty = dirtyNow();
    openHostMenu(more, hidden.map((t) => ({
      label: tabLabel(t.dataset.tab),
      radio: true,
      checked: t.dataset.tab === state.tab,
      ...(dirty.has(t.dataset.tab) ? { tag: 'Unsaved' } : {}),
      onPick: () => select(t.dataset.tab, { focus: true }),
    })));
  }

  const q = (sel) => el.querySelector(sel);
  const say = (words) => { const s = q('#space-setup-status'); if (s) { s.textContent = ''; s.textContent = words; } };
  const sayIn = (sel, words) => { const s = q(sel); if (s) { s.textContent = ''; s.textContent = words; } };

  // --- the tabs ---
  function select(id, { focus = false } = {}) {
    if (!state || !state.tabs.includes(id)) return;
    state.tab = id;
    for (const b of el.querySelectorAll('.setup-tab')) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    fitTabs(); // the tab shown never stays in the "..."
    if (focus) q(`#setup-tab-${id}`)?.focus();
    for (const p of el.querySelectorAll('.setup-tab-content')) p.hidden = p.dataset.tab !== id;
    hideDeleteConfirm();
    if (typeof state.opts.onTab === 'function') state.opts.onTab(id);
  }

  // The dots: a tab with unsaved changes, said to a screen reader too.
  function paintDots() {
    if (!state) return;
    const dirty = dirtyNow();
    for (const b of el.querySelectorAll('.setup-tab')) {
      const on = dirty.has(b.dataset.tab);
      b.querySelector('.setup-tab-dot').hidden = !on;
      b.querySelector('.setup-tab-unsaved').textContent = on ? ', unsaved changes' : '';
      b.classList.toggle('dirty', on);
    }
  }
  function refresh() {
    if (!state) return;
    state.bar.refresh();
    paintDots();
  }

  // --- filling the fields from the draft ---
  function fillFields() {
    const { draft, opts } = state;
    const set = (sel, v) => { const f = q(sel); if (f && f.value !== v) f.value = v; };
    set('#setup-name', draft.name);
    set('#setup-description', draft.description);
    set('#setup-profile', draft.profile);
    set('#setup-link', draft.link);
    const cal = q('#setup-publish-calendar');
    if (cal) cal.checked = draft.publishCalendar;
    const guests = q('#setup-allow-guests');
    if (guests) guests.checked = draft.allowGuests;
    const seeHidden = q('#setup-guests-see-hidden');
    if (seeHidden) seeHidden.checked = draft.guestsSeeHidden;
    paintPicture();
    paintIcons();
    paintMembers();
    paintGuestLink();
    if (q('#setup-first-visit')) paintLayouts();
    if (q('#setup-opens-with')) paintOpensWith();
    const ai = q('#setup-ai-off');
    if (ai) ai.checked = draft.aiOff;
    paintAiSees();
    paintBudgetSection();
    paintBudget();
    paintPhases();
    if (opts.nameInput && state.owner) opts.nameInput.value = draft.name;
  }

  // What AI may see (ai-sees.js): the space's own, or, with the switch on, the environment's choice shown and not changeable.
  function wireAiSees() {
    const box = q('#setup-ai-sees-box');
    if (!box) return;
    state.sees = mountSees(box, { word, idPrefix: 'setup-ai-sees', onChange: (v) => { state.draft.aiSees = v; refresh(); } });
    q('#setup-ai-sees-follow').addEventListener('change', (event) => {
      state.draft.aiSees = event.target.checked ? null : fullSees(state.envSees);
      paintAiSees();
      refresh();
    });
  }
  function paintAiSees() {
    if (!state.sees) return;
    const follow = state.draft.aiSees === null || state.draft.aiSees === undefined;
    q('#setup-ai-sees-follow').checked = follow;
    state.sees.setModules((state.installed || []).filter((m) => m.enabled && Array.isArray(m.scope) && m.scope.includes('space')));
    state.sees.set(follow ? state.envSees : state.draft.aiSees, { locked: follow, lookupOff: state.envSees && state.envSees.lookup === false ? `Off for the whole ${word('environment')}.` : '' });
  }

  function paintPicture() {
    const img = q('#setup-picture-img');
    if (!img) return;
    const { space, image } = state;
    let src = '';
    if (image.file) src = image.url;
    else if (!image.remove && space.hasImage) src = `/img/space/${encodeURIComponent(space.id)}?v=${space.imageVersion || 0}`;
    img.hidden = !src;
    if (src) img.src = src;
    q('#setup-picture-none').hidden = Boolean(src);
    q('#setup-picture-remove').hidden = !src;
  }

  // Whether the Budget section shows, and its hint naming the module that reads it (budgetWanted). Once shown it stays
  // for this opening, so a field someone is typing in never goes away under them.
  function budgetNow() {
    return budgetWanted({ lobby: state.space.isLobby, installed: state.installed || (state.options && state.options.budgetModules) || [], reported: state.opts.budget || null, stored: state.before.budget });
  }
  function paintBudgetSection() {
    const section = q('[data-section="budget"]');
    if (!section) return;
    const { show, name } = budgetNow();
    if (show && state.ownerPartsIn) section.hidden = false;
    const hint = q('#setup-budget-hint');
    if (hint) hint.textContent = `What you plan to spend.${name ? ` ${name} shows what is spent against it.` : ''} Leave it empty for no budget.${name ? ` The currency is also used for costs in ${name}.` : ''}`;
  }
  // The budget's amount and currency (the page's currency list, window.hostCurrency from /sdk/host.js: the common ones
  // first, then every other the server takes; the first choice "" is the reporting module's own currency). A bad entry
  // in the field is left as it is (the browser holds it; the draft says `bad`).
  function paintBudget() {
    const amount = q('#setup-budget-amount');
    const currency = q('#setup-budget-currency');
    if (!amount || !currency) return;
    const b = state.draft.budget || budgetText(null);
    if (!state.draft.budget?.bad && amount.value !== b.amount) amount.value = b.amount;
    const empty = 'Default currency';
    const fill = doc.defaultView && doc.defaultView.hostCurrency ? doc.defaultView.hostCurrency.fill : null;
    if (fill) fill(currency, { value: b.currency, empty, currencies: state.currencies || undefined });
    else if (!currency.options.length) currency.innerHTML = `<option value="">${esc(empty)}</option>${b.currency ? `<option value="${esc(b.currency)}">${esc(b.currency)}</option>` : ''}`;
    currency.value = b.currency;
  }

  // The link icon: a radio group of icon buttons (the page's .icon-grid), one tab stop, the arrows move the choice.
  function paintIcons() {
    const grid = q('#setup-link-icon');
    if (!grid) return;
    const icons = deps.icons();
    const picked = icons.some((i) => i.id === state.draft.linkIcon) ? state.draft.linkIcon : (icons[0] && icons[0].id);
    grid.innerHTML = icons.map(({ id, classes, label }) => `<button type="button" role="radio" data-icon="${esc(id)}" data-tip="${esc(label || id)}" aria-label="${esc(label || id)}" aria-checked="${id === picked}" tabindex="${id === picked ? 0 : -1}"${id === picked ? ' class="selected"' : ''}><i class="${esc(classes)} fa-fw" aria-hidden="true"></i></button>`).join('');
  }
  function pickIcon(id, { focus = false } = {}) {
    state.draft.linkIcon = id;
    for (const b of el.querySelectorAll('#setup-link-icon [data-icon]')) {
      const on = b.dataset.icon === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('selected', on);
      if (on && focus) b.focus();
    }
    refresh();
  }

  // The members: a switch for each account, its picture and name; on while it is in the draft.
  function paintMembers() {
    const list = q('#setup-members');
    if (!list) return;
    const chosen = new Set(state.draft.members);
    if (!state.users) { list.innerHTML = '<p class="hint">Loading…</p>'; return; }
    list.innerHTML = state.users.map((u) => `<label class="sdk-choice-row setup-member"><img class="setup-member-face" alt="" src="/img/${encodeURIComponent(u.key)}/profile"><span class="sdk-choice-text"><span class="sdk-choice-label">${esc(u.displayName || u.key)}</span></span><input type="checkbox" class="sdk-switch" role="switch" data-member="${esc(u.key)}"${chosen.has(u.key) ? ' checked' : ''}></label>`).join('');
    wireSwitchList(list);
  }

  // The guest link as the server has it (the same record the in-space guest link controls read: guestToken and
  // allowGuests). It follows the saved Allow guests, not the draft: turning guests on is saved with Save.
  function paintGuestLink() {
    const value = q('#setup-guest-link-value');
    if (!value) return;
    const { links, draft } = state;
    const token = links.guestToken || null;
    const allowed = links.allowGuests !== false;
    const origin = doc.defaultView ? doc.defaultView.location.origin : '';
    value.textContent = token ? `${origin}/guest/${token}` : 'off';
    q('#setup-guest-link-on').hidden = !allowed || Boolean(token);
    q('#setup-guest-link-copy').hidden = !token;
    q('#setup-guest-link-new').hidden = !allowed || !token;
    q('#setup-guest-link-off').hidden = !token;
    const note = q('#setup-guest-link-note');
    const guests = word('guest', { many: true, cap: true });
    note.textContent = !allowed
      ? (draft.allowGuests ? `Press Save to allow ${guests}, then turn the link on.` : `Allow ${guests} is off, so the link can't be turned on.`)
      : (!draft.allowGuests && token ? `Saving with Allow ${guests} off turns this link off too.` : '');
    note.hidden = !note.textContent;
  }

  // Opens with, as space-settings draws it: what can open now (the chat, the modules on here), then any saved id that
  // cannot open now, kept and said why. The conference is not a switch here: the call follows joining (GitHub #199), so
  // a `conference` id a list still holds is kept in the stored list and not drawn.
  function choices() {
    const o = state.options;
    const shown = (id, name, icon) => ({ id, name, icon, ...(o.builtin.find((b) => b.id === id) || {}) });
    return [
      shown('chat', 'Chat', 'message'),
      ...o.modules.map((m) => ({ id: m.id, name: m.name, icon: m.icon })),
    ];
  }
  // A saved id that cannot open now, as the old page said it: its name and icon where they are known, and why (from the
  // installed modules, which an owner can read; a moderator reads the shorter note).
  function keptChoice(id) {
    const installed = state.installed;
    if (!installed) return { id, name: id, icon: 'puzzle-piece', note: `not on in this ${word('space')}` };
    const m = installed.find((x) => x.id === id);
    if (!m) return { id, name: id, icon: 'puzzle-piece', note: 'not installed' };
    const shown = { id, name: m.displayName || m.name, icon: m.displayIcon || m.icon };
    if (!m.enabled) return { ...shown, note: 'turned off' };
    return { ...shown, note: `can't open on the ${word('canvas')}` };
  }
  function paintOpensWith() {
    const list = q('#setup-opens-with');
    const all = choices();
    const chosen = new Set(state.draft.opensWith || []);
    const kept = (state.draft.opensWith || []).filter((id) => id !== 'conference' && !all.some((c) => c.id === id)).map(keptChoice);
    list.innerHTML = switchListHtml([...all, ...kept].map((c) => ({ ...c, on: chosen.has(c.id) })), 'opens');
    wireSwitchList(list);
    const note = q('#setup-opens-with-note');
    const summary = opensWithSummary({
      list: state.draft.opensWith,
      environment: state.options.environment,
      modules: state.options.modules.map((m) => m.id),
      canOpen: (id) => all.some((c) => c.id === id),
      nameOf: (id) => all.find((c) => c.id === id)?.name || id,
    });
    note.textContent = summary;
    note.hidden = !summary;
  }
  // The choices after the Workspace: Calendar and Map while the layouts payload's `system` lists them, then the shared
  // layouts by name, each with its icon. The one checked is the draft's; one no longer listed reads as the Workspace.
  const iconOk = (icon) => /^[a-z0-9-]{1,40}$/.test(icon || '');
  function layoutChoices() {
    const { system, shared } = state.layouts;
    return [
      ...system.filter((l) => l.id === 'calendar' || l.id === 'map').map((l) => ({ id: l.id, name: l.name, icon: iconOk(l.icon) ? l.icon : 'object-group' })),
      ...shared.map((l) => ({ id: l.id, name: l.name, icon: iconOk(l.icon) && l.icon !== 'object-group' ? l.icon : 'user-group' })),
    ];
  }
  function paintLayouts() {
    const { layouts, draft } = state;
    const workspace = layouts.system.find((l) => l.id === 'workspace');
    q('#setup-workspace-name').textContent = workspace && workspace.name ? workspace.name : 'Workspace';
    if (workspace && iconOk(workspace.icon)) q('#setup-workspace-icon').className = `fa-solid fa-${workspace.icon} fa-fw`;
    const choices = layoutChoices();
    q('#setup-first-visit-layouts').innerHTML = choices.map((c) => `<label class="setup-choice"><input type="radio" name="setup-first-visit" value="${escapeHtml(c.id)}"><i class="fa-solid fa-${escapeHtml(c.icon)} fa-fw" aria-hidden="true"></i><span class="setup-choice-name">${escapeHtml(c.name)}</span></label>`).join('');
    const picked = choices.some((c) => c.id === draft.defaultLayout) ? draft.defaultLayout : 'workspace';
    for (const r of el.querySelectorAll('input[name="setup-first-visit"]')) {
      r.checked = r.value === picked;
      r.disabled = !layouts.canSetDefault;
    }
    const note = q('#setup-layout-note');
    note.textContent = layouts.shared.length ? '' : `A shared layout can be picked too: save one from the ${modulesWord(true)} tab, for everyone in this ${word('space')}.`;
    note.hidden = !note.textContent;
    paintLayoutLine();
  }
  // While the first visit is a layout (a shared one, Calendar or Map), the line above the choices names it, with Stop
  // using it (the old page's, now a draft: the Workspace is picked, the Opens with switches stay as they are).
  function paintLayoutLine() {
    const box = q('#setup-opens-with-layout');
    if (!box) return;
    const id = layoutOrNull(state.draft.defaultLayout);
    const known = id ? layoutChoices().find((c) => c.id === id) : null;
    box.hidden = !id;
    q('#setup-opens-with-layout-text').textContent = id ? (known ? `Opens with the layout ${known.name}` : 'Opens with a saved layout') : '';
  }
  function stopUsingLayout() {
    state.draft.defaultLayout = null;
    paintLayouts();
    const workspace = q('#setup-first-workspace');
    if (workspace && !workspace.disabled) workspace.focus();
    refresh();
  }

  // --- the phases: the sheet's rows, inline, as a draft (phasesTabHtml) ---
  const fmtDay = (d) => dayWords(d, { today: state.today });
  const phaseTimeline = () => state.rule.timelineOf(state.phaseList, state.draft.phases, { today: state.today, created: state.space.createdAt });
  const phaseRow = (id) => [...el.querySelectorAll('#setup-phase-list .phase-row')].find((li) => li.dataset.id === id) || null;
  const daysWord = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  function paintPhases() {
    const list = q('#setup-phase-list');
    if (!list || !state.rule) return;
    const R = state.rule;
    const bands = phaseTimeline();
    const rows = rowsOf(bands, { rule: R });
    q('#setup-phases-now').textContent = state.today ? `Today, ${fmtDay(state.today)}: ${R.chipWords(bands, state.today)}` : R.chipWords(bands, state.today);
    for (const r of rows) {
      const row = phaseRow(r.id);
      if (!row) continue;
      row.classList.toggle('off', !r.dated);
      row.classList.toggle('current', r.current);
      row.classList.toggle('main', r.main);
      row.querySelector('[data-phase-tag="now"]').hidden = !r.current;
      row.querySelector('[data-phase-tag="main"]').hidden = !r.main;
      const start = row.querySelector('input[data-edge="start"]');
      const end = row.querySelector('input[data-edge="end"]');
      start.value = r.start || '';
      end.value = r.end || '';
      start.disabled = !r.dated;
      end.disabled = !r.endEditable;
      if (r.minStart) start.min = r.minStart; else start.removeAttribute('min');
      if (r.maxStart) start.max = r.maxStart; else start.removeAttribute('max');
      if (r.minEnd) end.min = r.minEnd; else end.removeAttribute('min');
      row.querySelector('.phase-row-days').textContent = !r.dated ? '' : r.days !== null ? daysWord(r.days) : 'no end yet';
      row.querySelector('.phase-row-tools').hidden = !r.canSkip;
      row.querySelector('.phase-row-off').hidden = r.dated;
    }
    const nothing = !Object.keys(R.cleanDates(state.draft.phases)).length;
    const first = q('#setup-phase-first');
    first.hidden = !nothing;
    const firstDay = q('#setup-phase-first-day');
    if (nothing && !firstDay.value) firstDay.value = state.today || '';
  }
  // A refusal's sentence by its row (and read out); an edit kept clears every row's.
  function phaseProblem(id, words) {
    for (const row of el.querySelectorAll('#setup-phase-list .phase-row')) {
      const mine = row.dataset.id === id ? words || '' : '';
      const p = row.querySelector('.phase-row-problem');
      p.textContent = mine;
      p.hidden = !mine;
      row.classList.toggle('has-problem', Boolean(mine));
      for (const d of row.querySelectorAll('.phase-date')) { if (mine) d.setAttribute('aria-invalid', 'true'); else d.removeAttribute('aria-invalid'); }
    }
  }
  function phaseAnswer(id, answer, said) {
    if (!answer.ok) {
      const words = plainDays(answer.problem, fmtDay);
      phaseProblem(id, words);
      sayIn('#setup-phases-status', words);
      paintPhases(); // the input snaps back
      return false;
    }
    state.draft.phases = answer.dates;
    phaseProblem(id, '');
    paintPhases();
    sayIn('#setup-phases-status', said(phaseTimeline()));
    refresh();
    return true;
  }
  const labelOf = (id) => (state.phaseList.find((p) => p.id === id) || { label: id }).label;
  function phaseSet(id, edge, day) {
    const created = state.space.createdAt;
    return phaseAnswer(id, state.rule.setPhaseDate(state.phaseList, state.draft.phases, id, edge, day, { created }), (bands) => {
      const me = bands.find((b) => b.id === id);
      if (edge === 'end' && !me.end) return `${me.label} has no end now.`;
      if (edge === 'end' && !bands.some((b, k) => k > bands.indexOf(me) && b.dated)) return `${me.label} runs ${fmtDay(me.start)} to ${fmtDay(me.end)}.`;
      return `${me.label} ${edge === 'end' ? 'ends' : 'starts'} ${fmtDay(edge === 'end' ? me.end : me.start)}.`;
    });
  }
  function phaseSkip(id) {
    const ok = phaseAnswer(id, state.rule.skipPhase(state.phaseList, state.draft.phases, id, { created: state.space.createdAt }), () => `${labelOf(id)} is skipped.`);
    if (ok) phaseRow(id)?.querySelector('.phase-add')?.focus();
  }
  function phaseAdd(id) {
    const ok = phaseAnswer(id, state.rule.addDatesFor(state.phaseList, state.draft.phases, id, { created: state.space.createdAt, today: state.today }), (bands) => {
      const me = bands.find((b) => b.id === id);
      return `${me.label} ${me.end ? `is ${fmtDay(me.start)} to ${fmtDay(me.end)}` : `starts ${fmtDay(me.start)}`}.`;
    });
    if (ok) phaseRow(id)?.querySelector('input[data-edge="start"]')?.focus();
  }
  // A date input keeps its edit when its value is a whole day that differs from the row's (Chromium fires change on
  // every keystroke in the year: those wait for the fourth digit, Enter or leaving), as the sheet's do.
  function wirePhaseInput(input) {
    const current = () => {
      const me = phaseTimeline().find((b) => b.id === input.dataset.id);
      return me && me.dated ? (input.dataset.edge === 'end' ? me.end || '' : me.start) : '';
    };
    const tryKeep = ({ typing = false } = {}) => {
      const v = input.value;
      if (!state.rule.isDay(v)) {
        // An emptied end gives the end up (open-ended again), on leaving or Enter only, as the sheet does.
        if (!typing && v === '' && input.dataset.edge === 'end' && current() !== '') phaseSet(input.dataset.id, 'end', '');
        else if (!typing) paintPhases();
        return;
      }
      if (typing && Number(v.slice(0, 4)) < 1000) return;
      if (v === current()) return;
      phaseSet(input.dataset.id, input.dataset.edge, v);
    };
    input.addEventListener('change', () => tryKeep({ typing: true }));
    input.addEventListener('blur', () => tryKeep());
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); tryKeep(); } });
  }
  function phaseStartFirst() {
    const day = q('#setup-phase-first-day').value;
    if (!state.phaseList.length || !state.rule.isDay(day)) { sayIn('#setup-phases-status', 'Pick a day to start on.'); return; }
    if (phaseSet(state.phaseList[0].id, 'start', day)) phaseRow(state.phaseList[0].id)?.querySelector('input[data-edge="end"]')?.focus();
  }

  // --- Delete: its own question inside the panel, at once, not part of the draft ---
  function showDeleteConfirm() {
    const box = q('#setup-delete-confirm');
    if (!box) return;
    q('#setup-delete-words').textContent = `Delete ${state.space.name}? Its ${membersWord()} stay in the Lobby.`;
    sayIn('#setup-delete-problem', '');
    box.hidden = false;
    q('#setup-delete').setAttribute('aria-expanded', 'true');
    q('#setup-delete-keep').focus();
    if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
  }
  function hideDeleteConfirm({ focus = false } = {}) {
    const box = q('#setup-delete-confirm');
    if (!box || box.hidden) return false;
    box.hidden = true;
    q('#setup-delete').setAttribute('aria-expanded', 'false');
    if (focus) q('#setup-delete').focus();
    return true;
  }
  async function deleteSpace() {
    if (!state || state.saving) return;
    const { space, opts } = state;
    state.saving = true;
    el.classList.add('saving');
    try {
      await api('DELETE', `/api/spaces/${encodeURIComponent(space.id)}`);
    } catch (err) {
      sayIn('#setup-delete-problem', err.message || 'It was not deleted.');
      state.saving = false;
      el.classList.remove('saving');
      return;
    }
    const onDeleted = opts.onDeleted;
    close();
    if (typeof onDeleted === 'function') onDeleted(space);
  }

  // --- the invite and the guest link: actions, at once ---
  async function linkAction(run, okWords) {
    try {
      await run();
      if (okWords) sayIn('#setup-links-status', okWords);
      if (typeof state?.opts.onLinks === 'function') state.opts.onLinks(state.space);
    } catch (err) {
      sayIn('#setup-links-status', err.message || 'That did not work.');
    }
  }
  async function copyText(value) {
    try {
      await doc.defaultView.navigator.clipboard.writeText(value);
      sayIn('#setup-links-status', 'Copied.');
    } catch {
      doc.defaultView.prompt('Copy this:', value);
    }
  }
  async function setGuestLink(body) {
    const id = encodeURIComponent(state.space.id);
    await linkAction(async () => {
      const answer = body === null ? await api('DELETE', `/api/spaces/${id}/guest-link`) : await api('POST', `/api/spaces/${id}/guest-link`, body);
      if (state && answer && answer.space) {
        state.links = { guestToken: answer.space.guestToken || null, allowGuests: answer.space.allowGuests !== false };
        paintGuestLink();
      }
    }, body === null ? 'The link is off.' : body.regenerate ? 'A new link; the old one no longer works.' : 'The link is on.');
  }

  function wire() {
    const tablist = q('#setup-tabs');
    tablist.addEventListener('click', (event) => {
      const b = event.target.closest('.setup-tab');
      if (b) select(b.dataset.tab, { focus: true });
    });
    q('#setup-tabs-more').addEventListener('click', openMoreTabs);
    if (typeof (doc.defaultView || window).ResizeObserver === 'function') {
      state.fitWatch = new (doc.defaultView || window).ResizeObserver(() => fitTabs());
      state.fitWatch.observe(tablist);
    }
    tablist.addEventListener('keydown', (event) => {
      const all = [...el.querySelectorAll('.setup-tab:not(.layout-tab-out)')];
      if (event.target.id === 'setup-tabs-more') {
        if (event.key === 'ArrowLeft' && all.length) { event.preventDefault(); all[all.length - 1].focus(); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); openMoreTabs(); }
        return;
      }
      const at = all.indexOf(event.target.closest('.setup-tab'));
      if (at < 0) return;
      const more = q('#setup-tabs-more');
      if (event.key === 'ArrowRight' && at === all.length - 1 && !more.hidden) { event.preventDefault(); more.focus(); return; }
      const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      const next = all[(to + all.length) % all.length];
      select(next.dataset.tab, { focus: true });
    });

    const field = (sel, key) => { const f = q(sel); if (f) f.addEventListener('input', () => { state.draft[key] = f.value; }); };
    const name = q('#setup-name');
    if (name) name.addEventListener('input', () => { state.draft.name = name.value; if (state.opts.nameInput) state.opts.nameInput.value = name.value; });
    field('#setup-description', 'description');
    field('#setup-link', 'link');
    const profile = q('#setup-profile');
    if (profile) profile.addEventListener('change', () => { state.draft.profile = profile.value; });
    // A new object on each edit, so the draft never shares one with `before`.
    const budgetAmount = q('#setup-budget-amount');
    // A bad entry (`12-3`, `1e`) reads as '' with validity.badInput: kept as `bad`, never as an empty field (which clears).
    if (budgetAmount) budgetAmount.addEventListener('input', () => {
      const bad = Boolean(budgetAmount.validity && budgetAmount.validity.badInput);
      const { bad: _was, ...rest } = state.draft.budget || {};
      state.draft.budget = { ...rest, amount: budgetAmount.value.trim(), ...(bad ? { bad: true } : {}) };
    });
    const budgetCurrency = q('#setup-budget-currency');
    if (budgetCurrency) budgetCurrency.addEventListener('change', () => { state.draft.budget = { ...state.draft.budget, currency: budgetCurrency.value }; });
    const cal = q('#setup-publish-calendar');
    if (cal) cal.addEventListener('change', () => { state.draft.publishCalendar = cal.checked; });
    const guests = q('#setup-allow-guests');
    if (guests) guests.addEventListener('change', () => { state.draft.allowGuests = guests.checked; paintGuestLink(); });
    const seeHidden = q('#setup-guests-see-hidden');
    if (seeHidden) seeHidden.addEventListener('change', () => { state.draft.guestsSeeHidden = seeHidden.checked; });
    const members = q('#setup-members');
    if (members) members.addEventListener('change', (event) => {
      if (event.target.type !== 'checkbox') return;
      state.draft.members = [...members.querySelectorAll('input:checked')].map((i) => i.dataset.member);
    });

    const grid = q('#setup-link-icon');
    if (grid) {
      grid.addEventListener('click', (event) => { const b = event.target.closest('[data-icon]'); if (b) pickIcon(b.dataset.icon); });
      grid.addEventListener('keydown', (event) => {
        const all = [...grid.querySelectorAll('[data-icon]')];
        const at = all.indexOf(event.target.closest('[data-icon]'));
        if (at < 0) return;
        const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[event.key];
        if (to === undefined) return;
        event.preventDefault();
        pickIcon(all[(to + all.length) % all.length].dataset.icon, { focus: true });
      });
    }

    const file = q('#setup-picture-file');
    if (file) file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      if (state.image.url) URL.revokeObjectURL(state.image.url);
      state.image = { file: f, url: URL.createObjectURL(f), remove: false };
      paintPicture();
    });
    const remove = q('#setup-picture-remove');
    if (remove) remove.addEventListener('click', () => {
      if (state.image.url) URL.revokeObjectURL(state.image.url);
      state.image = { file: null, url: '', remove: true };
      paintPicture();
      q('.setup-picture-pick input').focus();
    });

    const del = q('#setup-delete');
    if (del) {
      del.addEventListener('click', () => (q('#setup-delete-confirm').hidden ? showDeleteConfirm() : hideDeleteConfirm({ focus: true })));
      q('#setup-delete-keep').addEventListener('click', () => hideDeleteConfirm({ focus: true }));
      q('#setup-delete-yes').addEventListener('click', () => deleteSpace());
    }

    const invite = q('#setup-make-invite');
    if (invite) {
      invite.addEventListener('click', () => linkAction(async () => {
        const { invite: made } = await api('POST', '/api/invites', { spaces: [state.space.id] });
        q('#setup-invite-link').textContent = made.url;
        q('#setup-invite-row').hidden = false;
      }, 'Invite link made.'));
      q('#setup-invite-copy').addEventListener('click', () => copyText(q('#setup-invite-link').textContent));
      q('#setup-guest-link-on').addEventListener('click', () => setGuestLink({}));
      q('#setup-guest-link-new').addEventListener('click', () => setGuestLink({ regenerate: true }));
      q('#setup-guest-link-off').addEventListener('click', () => setGuestLink(null));
      q('#setup-guest-link-copy').addEventListener('click', () => copyText(q('#setup-guest-link-value').textContent));
    }

    const phaseList = q('#setup-phase-list');
    if (phaseList) {
      phaseList.querySelectorAll('input.phase-date').forEach(wirePhaseInput);
      phaseList.addEventListener('click', (event) => {
        const skip = event.target.closest('.phase-skip');
        if (skip) { phaseSkip(skip.closest('.phase-row').dataset.id); return; }
        const add = event.target.closest('.phase-add');
        if (add) phaseAdd(add.closest('.phase-row').dataset.id);
      });
      q('#setup-phase-first-go').addEventListener('click', phaseStartFirst);
      q('#setup-phase-first-day').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); phaseStartFirst(); } });
    }
    const stop = q('#setup-opens-with-layout-stop');
    if (stop) stop.addEventListener('click', () => stopUsingLayout());
    const ai = q('#setup-ai-off');
    if (ai) ai.addEventListener('change', () => { state.draft.aiOff = ai.checked; });
    wireAiSees();
    const list = q('#setup-opens-with');
    if (list) list.addEventListener('change', (event) => {
      if (event.target.type !== 'checkbox') return;
      const ticked = [...list.querySelectorAll('input:checked')].map((i) => i.dataset.opens);
      state.draft.opensWith = ticked.length ? ticked : null; // the first visit's choice stays as it is
      paintOpensWith();
    });
    const firstVisit = q('#setup-first-visit');
    if (firstVisit) firstVisit.addEventListener('change', (event) => {
      if (event.target.name !== 'setup-first-visit' || !event.target.checked) return;
      state.draft.defaultLayout = event.target.value === 'workspace' ? null : event.target.value; // Opens with stays as it is
      paintLayoutLine();
    });
  }
  // Any edit in the panel: Save and the dots follow what changed (once, here; the panel is drawn again on each open).
  el.addEventListener('input', () => refresh());
  el.addEventListener('change', () => refresh());
  el.addEventListener('click', () => refresh()); // Remove picture and the like
  // Escape: the Delete question first (Keep), else Cancel, which asks "Discard your changes?" when something changed.
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !state) return;
    event.preventDefault();
    event.stopPropagation();
    if (hideDeleteConfirm({ focus: true })) return;
    state.bar.requestCancel();
  });

  // What would be sent now: the draft against what was, the name from the bar's input for an owner, and for a moderator
  // only the fields the server lets them send.
  function patchNow() {
    const { draft, before, opts } = state;
    const name = opts.nameInput && state.owner ? opts.nameInput.value : draft.name;
    const patch = setupPatch(before, { ...draft, name });
    if (!state.owner) for (const k of Object.keys(patch)) if (!MODERATOR_FIELDS.includes(k)) delete patch[k];
    return patch;
  }
  const imageChanged = () => Boolean(state.image.file) || Boolean(state.image.remove && state.space.hasImage);
  // The modules whose settings were changed here: [{ id, name, values }] (module-settings.js, its draft mode).
  const moduleChanges = () => (state.moduleSettings ? state.moduleSettings.changes() : []);
  function dirtyNow() {
    return dirtyTabs(patchNow(), { image: imageChanged(), modules: moduleChanges().length > 0, tabs: state.tabs });
  }
  // Whether something would be lost on Cancel: the PATCH has something in it, a picture was chosen or removed, or a
  // module's settings changed.
  function isDirty() {
    if (!state) return false;
    return Object.keys(patchNow()).length > 0 || imageChanged() || moduleChanges().length > 0;
  }

  // What the panel draws comes from the server: the space's whole record and the accounts (an owner's tabs), the
  // published calendar's switch, Opens with's choices and the layouts. A field not touched while it was asked is set
  // from the answer.
  function takeServerSpace(record) {
    const fresh = beforeOf(record);
    for (const k of Object.keys(fresh)) {
      if (k === 'opensWith' || k === 'defaultLayout') continue; // loadOptions has these from the first visit's own answer
      if (sameValue(state.draft[k], state.before[k])) {
        state.draft[k] = Array.isArray(fresh[k]) ? [...fresh[k]] : k === 'phases' ? datesCopy(fresh[k]) : k === 'budget' ? { ...fresh[k] } : fresh[k];
        state.before[k] = fresh[k];
      }
    }
    state.space = { ...state.space, ...record };
    state.links = { guestToken: record.guestToken || null, allowGuests: record.allowGuests !== false };
  }
  // A moderator's own answer for the space ({ id, phases, opensWith, defaultLayout, budget }) holds the stored budget and
  // nothing else of the record, so only the budget is taken from it; the module list they may use is loadOptions'.
  async function loadModeratorParts(space) {
    const record = await api('GET', `/api/spaces/${encodeURIComponent(space.id)}`).then((r) => r.space).catch(() => null);
    if (!state || state.space.id !== space.id) return;
    if (!record) return; // the stored target is not known: the Budget section stays hidden rather than risk replacing it
    const fresh = budgetText(record.budget);
    if (sameValue(state.draft.budget, state.before.budget)) { state.draft.budget = { ...fresh }; state.before.budget = fresh; }
    if (q('#setup-budget-currency')) state.currencies = await api('GET', '/api/currencies').then((r) => r.currencies || null).catch(() => null);
    if (!state || state.space.id !== space.id) return;
    state.ownerPartsIn = true;
    fillFields();
    refresh();
  }
  async function loadOwnerParts(space) {
    const id = encodeURIComponent(space.id);
    const [record, users, installed, ai] = await Promise.all([
      api('GET', `/api/spaces/${id}`).then((r) => r.space).catch(() => null),
      space.isLobby ? Promise.resolve([]) : api('GET', '/api/users').then((r) => r.users || []).catch(() => []),
      api('GET', '/api/modules').then((r) => r.modules || []).catch(() => null),
      api('GET', '/api/ai').then((r) => r.ai || null).catch(() => null),
    ]);
    if (!state || state.space.id !== space.id) return;
    if (record) takeServerSpace(record);
    if (q('#setup-budget-currency')) state.currencies = await api('GET', '/api/currencies').then((r) => r.currencies || null).catch(() => null);
    if (!state || state.space.id !== space.id) return;
    state.users = users;
    state.installed = installed;
    state.ownerPartsIn = true; // the stored budget is known now: the Budget section may show (paintBudgetSection)
    fillFields();
    // Turn AI off is for a server that has an AI service set up (as the old page's).
    const aiSection = q('[data-section="ai"]');
    if (aiSection) aiSection.hidden = !ai || !ai.active || ai.active.provider === 'none';
    const seesSection = q('[data-section="ai-sees"]');
    if (seesSection) seesSection.hidden = !ai || !ai.active || ai.active.provider === 'none';
    state.envSees = fullSees(ai && ai.sees);
    paintAiSees();
    refresh();
    if (!space.isLobby) loadCalendarSwitch(space);
  }
  // The modules' own settings for this space, drawn without their Saves (module-settings.js, `draft: true`): the panel's
  // Save sends them. A moderator with none to change has only the First visit section.
  async function loadModuleSettings(space) {
    const box = q('#setup-module-settings');
    if (!box) return;
    const answer = typeof deps.renderModuleSettings === 'function'
      ? await deps.renderModuleSettings(box, { scope: 'space', space: space.id, draft: true, onChange: () => refresh() }).catch(() => null)
      : null;
    if (!state || state.space.id !== space.id) return;
    state.moduleSettings = answer;
    const section = q('[data-section="module-settings"]');
    if (answer) { if (section) section.hidden = false; refresh(); return; }
    if (section) section.hidden = true;
  }
  // The space's place in the published calendar (plan-space-calendars.md, section 2): shown only while an owner has
  // turned publishing on and the module whose events it carries is on, named after it.
  async function loadCalendarSwitch(space) {
    try {
      const settings = await api('GET', '/api/settings').then((r) => r.settings || {});
      if (!state || state.space.id !== space.id) return;
      const mods = state.installed || [];
      const m = mods.find((x) => x.sharing === true && x.sharingReasons && 'publishedCalendar' in x.sharingReasons);
      const section = q('[data-section="calendar"]');
      if (!section) return;
      q('#setup-calendar-heading').textContent = m ? (m.displayName || m.name) : 'Calendar';
      section.hidden = settings.publishedCalendar !== true || !(m && m.enabled);
    } catch {
      /* the switch stays hidden */
    }
  }

  async function loadOptions() {
    const { space } = state;
    const asks = state.tabs.includes('modules');
    const [answer, layouts] = await Promise.all([
      asks ? api('GET', `/api/modules/for-space?space=${encodeURIComponent(space.id)}`).catch(() => ({})) : Promise.resolve({}),
      asks ? api('GET', `/api/spaces/${encodeURIComponent(space.id)}/layouts`).catch(() => ({})) : Promise.resolve({}),
    ]);
    if (!state || state.space.id !== space.id) return;
    state.options = {
      modules: (answer.modules || []).filter((m) => !m.canvas || m.canvas.menu !== false),
      builtin: answer.builtin || [],
      environment: Array.isArray(answer.spaceDefaultsOpensWith) ? answer.spaceDefaultsOpensWith : null,
      budgetModules: answer.modules || [], // a moderator's list for the Budget section (an owner has GET /api/modules)
    };
    // The server's own view is the freshest: the presence record may lag a save by someone else. What was not touched
    // while it was asked is set from it; the first visit as the server resolved it (a layout no longer there reads as
    // the Workspace, and stays stored until another is picked).
    if (answer.opensWith !== undefined && sameList(listOrNull(state.draft.opensWith), listOrNull(state.before.opensWith))) {
      state.draft.opensWith = listOrNull(answer.opensWith);
      state.before.opensWith = state.draft.opensWith ? [...state.draft.opensWith] : null;
    }
    const fv = layouts.firstVisit || answer.firstVisit;
    const served = fv && typeof fv.layout === 'string' ? layoutOrNull(fv.layout) : answer.defaultLayout !== undefined ? (answer.defaultLayout ? answer.defaultLayout.id : null) : undefined;
    if (served !== undefined && layoutOrNull(state.draft.defaultLayout) === layoutOrNull(state.before.defaultLayout)) {
      state.draft.defaultLayout = served;
      state.before.defaultLayout = served;
    }
    state.layouts = { system: Array.isArray(layouts.system) ? layouts.system : [], shared: Array.isArray(layouts.shared) ? layouts.shared : [], canSetDefault: layouts.canSetDefault !== false };
  }

  function open(opts) {
    if (state) close();
    const space = opts.space;
    // The template's phases (a list) and the rule (public/phases.js); without either, no phases tab.
    const rule = opts.rule || null;
    const phaseList = rule && Array.isArray(opts.phases) ? rule.cleanPhases(opts.phases) : [];
    const tabs = setupTabs({ owner: opts.owner, moderator: opts.moderator, phases: phaseList.length > 0, show: typeof opts.show === 'function' });
    if (!tabs.length) return false;
    const before = beforeOf(space);
    state = {
      space, tabs, tab: null, opts, owner: Boolean(opts.owner), before, draft: copyOf(before),
      options: { modules: [], builtin: [], environment: null }, layouts: { system: [], shared: [], canSetDefault: true },
      image: { file: null, url: '', remove: false }, links: { guestToken: space.guestToken || null, allowGuests: space.allowGuests !== false },
      users: null, saving: false, rule, phaseList, today: opts.today || null, installed: null, moduleSettings: null,
    };
    el.dataset.who = opts.owner ? 'owner' : opts.moderator ? 'moderator' : 'member';
    draw();
    // The bar's input and the panel's Name are one name: typed in either, the other follows.
    if (opts.nameInput && state.owner) {
      state.onBarName = () => { if (!state) return; state.draft.name = opts.nameInput.value; refresh(); const f = q('#setup-name'); if (f && f.value !== opts.nameInput.value) f.value = opts.nameInput.value; };
      opts.nameInput.addEventListener('input', state.onBarName);
    }
    el.hidden = false;
    if (!el.isConnected) doc.body.appendChild(el);
    select(pickTab(tabs, opts.tab));
    focusFirst();
    fitTabs();
    (doc.defaultView || window).requestAnimationFrame(() => fitTabs());
    refresh();
    loadOptions().then(() => { if (state && state.space.id === space.id) { if (q('#setup-opens-with')) paintOpensWith(); if (q('#setup-first-visit')) paintLayouts(); paintBudgetSection(); refresh(); } });
    if (state.owner) loadOwnerParts(space);
    else if (opts.moderator && !space.isLobby) loadModeratorParts(space);
    if (state.tabs.includes('modules')) loadModuleSettings(space);
    return true;
  }
  // The keyboard goes to the tab's first field: the name, the first member's switch, the first phase's start (or the
  // first step's day), the first visit's choice, the first module setting.
  const FIRST_FIELD = { show: '#setup-show .host-menu-item[tabindex="0"]', space: '#setup-name', members: '#setup-members input, #setup-allow-guests', phases: '#setup-phase-list input:not(:disabled), #setup-phase-list .phase-add', modules: '#setup-first-visit input:checked, #setup-first-visit input, #setup-module-settings input, #setup-module-settings select' };
  function focusFirst() {
    const content = q(`#setup-content-${state.tab}`);
    const firstStep = state.tab === 'phases' && q('#setup-phase-first') && !q('#setup-phase-first').hidden ? q('#setup-phase-first-day') : null;
    const first = firstStep || q(FIRST_FIELD[state.tab] || '');
    if (first) first.focus();
    else if (content) content.focus();
  }

  function close() {
    if (!state) return;
    if (state.image.url) URL.revokeObjectURL(state.image.url);
    const { opts } = state;
    if (state.onBarName && opts.nameInput) opts.nameInput.removeEventListener('input', state.onBarName);
    state.showView?.destroy();
    state.fitWatch?.disconnect();
    state = null;
    el.hidden = true;
    el.innerHTML = '';
    if (typeof opts.onLeave === 'function') opts.onLeave();
  }

  // Cancel, as Escape does: asks "Discard your changes?" first when something was edited.
  function cancel() {
    if (!state || state.saving) return;
    state.bar.requestCancel();
  }

  // A refusal: the panel stays, on the field's tab, with the sentence and the keyboard on the field. What went through
  // before it stays saved and is said.
  const FIELD_INPUT = {
    name: '#setup-name', description: '#setup-description', profile: '#setup-profile', link: '#setup-link', linkIcon: '#setup-link-icon [aria-checked="true"]',
    publishCalendar: '#setup-publish-calendar', members: '#setup-members input', allowGuests: '#setup-allow-guests', budget: '#setup-budget-amount',
    opensWith: '#setup-opens-with input', defaultLayout: '#setup-first-visit input:checked', image: '.setup-picture-pick input', imageRemoved: '.setup-picture-pick input',
    phases: '#setup-phase-list input:not(:disabled)', aiOff: '#setup-ai-off', aiSees: '#setup-ai-sees-follow',
  };
  // The fields in this environment's words: the members, Allow guests, and each module's settings by its name.
  function fieldWords() {
    const words = { members: `the ${membersWord()}`, allowGuests: `Allow ${word('guest', { many: true, cap: true })}` };
    for (const m of (state && state.moduleSettings ? state.moduleSettings.modules : [])) words[`module:${m.id}`] = `the ${m.name} settings`;
    return words;
  }
  function refused(saved, failed, problem) {
    say(setupSaidWords({ saved, failed, problem }, { setUp: configLabel(), words: fieldWords() }));
    const tab = tabOfField(failed, state.tabs);
    if (tab && state.tabs.includes(tab)) select(tab);
    const moduleId = String(failed).startsWith('module:') ? failed.slice(7) : null;
    const card = moduleId && state.moduleSettings ? state.moduleSettings.sectionOf(moduleId) : null;
    const input = card ? card.querySelector('input, select, textarea, button') : q(FIELD_INPUT[failed] || '') || (failed === 'name' && state.opts.nameInput);
    if (input) input.focus();
    if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });
    refresh();
    return false;
  }

  // One save, in order, stopping at the first refusal: the PATCH for what changed, the picture, then each changed
  // module's settings. (No module switches: availability per space was removed; the server ignores `spaces`.)
  async function done() {
    if (!state || state.saving) return false;
    const { space, image, opts } = state;
    if (opts.nameInput && state.owner) state.draft.name = opts.nameInput.value;
    // A budget the field cannot read is refused here, before anything is sent: sent, it would read as no budget.
    const budgetField = q('#setup-budget-amount');
    const entry = budgetField && !q('[data-section="budget"]').hidden ? budgetEntryProblem({ ...state.draft.budget, bad: Boolean(state.draft.budget?.bad || (budgetField.validity && budgetField.validity.badInput)) }) : null;
    if (entry) return refused([], 'budget', entry);
    const patch = patchNow();
    const moduleChanged = moduleChanges();
    const saved = [];
    let answered = null;
    state.saving = true;
    el.classList.add('saving');
    say('');
    try {
      if (Object.keys(patch).length) {
        try {
          answered = (await api('PATCH', `/api/spaces/${encodeURIComponent(space.id)}`, patch)).space;
          saved.push(...Object.keys(patch));
          // What went through is now what was: a later refusal leaves only the rest to save.
          if (answered) {
            ({ before: state.before, draft: state.draft } = takeSaved(state.before, state.draft, Object.keys(patch), answered));
            for (const [k, sel] of [['description', '#setup-description'], ['link', '#setup-link']]) {
              const f = k in patch ? q(sel) : null;
              if (f && f.value !== state.draft[k]) f.value = state.draft[k];
            }
            state.space = { ...state.space, ...answered };
            state.links = { guestToken: answered.guestToken || null, allowGuests: answered.allowGuests !== false };
          }
        } catch (err) {
          return refused(saved, problemField(patch, err.message), err.message);
        }
      }
      if (image.file) {
        try {
          answered = (await api('PUT', `/api/spaces/${encodeURIComponent(space.id)}/image`, image.file, image.file.type)).space;
          saved.push('image');
        } catch (err) {
          if (saved.length && typeof opts.onSaved === 'function') opts.onSaved(answered, saved);
          paintGuestLink();
          return refused(saved, 'image', err.message);
        }
      } else if (image.remove && state.space.hasImage) {
        try {
          answered = (await api('DELETE', `/api/spaces/${encodeURIComponent(space.id)}/image`)).space;
          saved.push('imageRemoved');
        } catch (err) {
          if (saved.length && typeof opts.onSaved === 'function') opts.onSaved(answered, saved);
          return refused(saved, 'imageRemoved', err.message);
        }
      }
      for (const change of moduleChanged) {
        try {
          await api('PUT', `/api/modules/${encodeURIComponent(change.id)}/settings/space`, { values: change.values, space: space.id });
          saved.push(`module:${change.id}`);
          state.moduleSettings.saved(change.id); // what went through is now what was
        } catch (err) {
          if (saved.length && typeof opts.onSaved === 'function') opts.onSaved(answered, saved);
          return refused(saved, `module:${change.id}`, err.message);
        }
      }
    } finally {
      if (state) { state.saving = false; el.classList.remove('saving'); }
    }
    const said = setupSaidWords({ saved }, { setUp: configLabel(), words: fieldWords() });
    const onDone = opts.onDone;
    close();
    if (typeof onDone === 'function') onDone(answered, said, saved);
    return true;
  }

  // The page's facts arrived after the panel opened (opened by address, say): a module reads the budget, so the section
  // shows, named after it. Nothing typed is touched.
  function offerBudget(info) {
    if (!state || !info) return;
    state.opts = { ...state.opts, budget: { name: String(info.name || '') } };
    paintBudgetSection();
    paintBudget();
  }

  return { el, open, close, done, cancel, offerBudget, select: (id) => select(id, { focus: true }), isOpen: () => Boolean(state) };
}
