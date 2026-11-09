import { loadBranding, api, wireOverlayBack, renderTopbar, renderPageBar, escapeHtml, getIcons, setUpdateBadge, setManageBadge, manageBadgeLabel, hasOwnerRights, roleLabel, word, setWords, applyWords, themeMode, productName, overCall } from '/brand.js';
import { pickBackground } from '/background-picker.js';
import { CHANGEABLE, DEFAULTS, homeDefault, words, fill as fillWords, VERBS, DEFAULT_VERBS, verbs } from '/words.js';
import { wireFlightSchedule } from '/flight-schedule.js';
import '/slot-paste.js'; // paste a picture into any image slot
import { renderOffer, switchConfirm } from '/template-offer.js';
import { confirmDialog } from '/confirm.js';
import { fileText } from '/file-text.js';
import { rowTabs } from '/page-tabs.js';
import { moduleConfigMarkup, drawModuleConfig } from '/module-config.js';
import { nav } from '/nav-bar.js';
import { mountAiForm } from '/ai-form.js';
import { mountSees } from '/ai-sees.js';
import { drawAiUse } from '/ai-use.js';

const $ = (id) => document.getElementById(id);
const userCards = new Map(); // key -> the user's card element
let me = null;
let streamKey = '';
let streamShown = false;
// The environment this Manage page runs in, on a host with several (GET /api/me's `environment`): hosted says the host has
// environments, owner that the viewer is this one's admin (its owner), hostAdmin that the viewer is the host's own cross
// sign-in. What only the host may do is hidden from an owner; the Environment panel shows the plan and its use.
let environment = { hosted: false, owner: false, hostAdmin: false, slug: '', name: '' };
const hostOnlyHidden = () => environment.hosted && !environment.hostAdmin;
let users = [];
let feeds = new Map(); // who has a calendar feed: key -> { on, made, readAt } (loadFeeds)

// The choices come from the icon list on the Template tab. null (only with a template) is the template's own.
let selectedHomeIcon = 'couch';

// The template this environment was made from (plan-environment-templates.md; GET /api/settings' `template`: { id, name,
// appliedAt, skipped }), or null for none, and the owner's own words and home icon (`ownWords`, `ownHomeIcon`).
let madeFrom = null;
let ownWords = {};
let ownHomeIcon = null;
// What the template gives, whatever the owner has set over it (`templateWords`: { <key>: { one, many, a? } }, and
// `templateHomeIcon`), each null for none.
let templateWords = {};
let templateHomeIcon = null;
// The verbs the same way (addendum 4): the owner's own (`ownVerbs`, {} for none) and the template's (`templateVerbs`).
let ownVerbs = {};
let templateVerbs = {};
const DEFAULT_HOME_ICON = 'couch';
function useOwnerSettings(settings) {
  madeFrom = settings.template || null;
  ownWords = settings.ownWords || {};
  ownVerbs = settings.ownVerbs || {};
  templateVerbs = (madeFrom && settings.templateVerbs) || {};
  ownHomeIcon = settings.ownHomeIcon || null;
  templateWords = (madeFrom && settings.templateWords) || {};
  templateHomeIcon = (madeFrom && settings.templateHomeIcon) || null;
}

function buildHomeIconGrid() {
  const grid = $('set-home-icon');
  grid.textContent = '';
  for (const { id, classes, label } of getIcons()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.icon = id;
    btn.dataset.tip = label || id;
    btn.setAttribute('aria-label', label || id);
    btn.innerHTML = `<i class="${escapeHtml(classes)} fa-fw" aria-hidden="true"></i>`;
    btn.addEventListener('click', () => {
      selectedHomeIcon = id;
      renderHomeIconSelection();
    });
    grid.appendChild(btn);
  }
}
function renderHomeIconSelection() {
  for (const btn of $('set-home-icon').children) btn.classList.toggle('selected', btn.dataset.icon === selectedHomeIcon);
  // With a template, its own icon is the first choice: "Template's own" (or "Default" when it gives none), saved as no
  // icon of the owner's, so the template's stays in use.
  const box = $('home-icon-template');
  box.hidden = !madeFrom;
  if (!madeFrom) return;
  const btn = $('home-icon-template-btn');
  const on = selectedHomeIcon === null;
  btn.querySelector('span').textContent = templateHomeIcon ? "Template's own" : 'Default';
  btn.querySelector('i').className = `fa-solid fa-${templateHomeIcon || DEFAULT_HOME_ICON} fa-fw`;
  btn.setAttribute('aria-pressed', String(on));
  $('home-icon-template-hint').textContent = on ? 'In use. Pick an icon below to choose your own.' : '';
}
$('home-icon-template-btn').addEventListener('click', () => {
  selectedHomeIcon = null;
  renderHomeIconSelection();
});

// A status line's message; a plain one clears after 3 s. Each new message cancels the last one's timer, so an earlier
// message's clearing never takes a later one with it (two saves within 3 s).
const sayTimers = new WeakMap();
function say(el, text, error = false) {
  clearTimeout(sayTimers.get(el));
  sayTimers.delete(el);
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) sayTimers.set(el, setTimeout(() => { sayTimers.delete(el); el.textContent = ''; }, 3000));
}

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusEl) say(statusEl, 'copied');
  } catch (err) {
    window.prompt('Copy this:', text);
  }
}

function imgUrl(key, slot) {
  return `/img/${encodeURIComponent(key)}/${slot}?v=${Date.now()}`;
}

// Environment / Template / Theme / Spaces / Roles / Users / Modules / About tabs, remembered in the address
const TABS = ['environment', 'template', 'theme', 'spaces', 'roles', 'users', 'modules', 'about'];
// The Environment tab's parts (#261): General (the plan, the name and icon, the sign-in page), Localization and Stream,
// each a stack of its own, chosen in the page bar's row (#env-subtabs). The address names the part shown: #general,
// #localization, #stream (#environment, the tab's own name, opens General).
const ENV_PARTS = ['general', 'localization', 'stream'];
let envPart = 'general';
function showEnvPart(part) {
  envPart = ENV_PARTS.includes(part) ? part : 'general';
  for (const el of document.querySelectorAll('#tab-environment > [data-env-part]')) el.hidden = el.dataset.envPart !== envPart;
  for (const b of $('env-subtabs').querySelectorAll('.subtab')) b.classList.toggle('active', b.dataset.envPart === envPart);
}
// The Modules tab's parts (#264), in the page bar's row (#module-subtabs): Configuration (the list, the filters, the
// activity), then a tab for each module that is on, Conference's while it is on. A tab that is not there (a module that
// is off, or was just turned off or uninstalled) opens Configuration, once the list has loaded.
let modulePart = 'config';
let modulesLoaded = false;
function showModulePart(part) {
  const known = modulesLoaded ? moduleTabIds() : null;
  modulePart = !known || known.includes(part) ? part : 'config';
  $('module-part-config').hidden = modulePart !== 'config';
  $('module-part-conference').hidden = modulePart !== 'conference';
  $('module-part-ai').hidden = modulePart !== 'ai';
  $('module-part-module').hidden = ['config', 'conference', 'ai'].includes(modulePart);
  for (const b of $('module-subtabs').querySelectorAll('.subtab')) {
    const on = b.dataset.modulePart === modulePart;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (modulesLoaded) drawModuleTab();
}
// A strip wider than the page scrolls inside itself (style.css): bring the chosen tab into it, the page left as it is.
function scrollToChosen(strip) {
  const on = strip.querySelector('.subtab.active');
  if (on && strip.scrollWidth > strip.clientWidth) {
    const t = on.getBoundingClientRect();
    const s = strip.getBoundingClientRect();
    if (t.left < s.left) strip.scrollLeft += t.left - s.left;
    else if (t.right > s.right) strip.scrollLeft += t.right - s.right;
  }
}
let tabNow = 'environment';
function selectTab(name) {
  let part = 'general';
  if (ENV_PARTS.includes(name)) {
    part = name;
    name = 'environment';
  }
  // The Modules tab's parts (#264): #modules/<id> a module's tab (Conference's and the AI service's too); #modules is
  // Configuration.
  let modPart = 'config';
  if (name && name.startsWith('modules/')) {
    modPart = decodeURIComponent(name.slice('modules/'.length)) || 'config';
    name = 'modules';
  }
  // A link to a section (an element's id, such as #words-panel or a module's row on the Template tab) opens its tab at it.
  const at = !TABS.includes(name) && name ? $(name) : null;
  const inTab = at && at.closest('section[id^="tab-"]');
  if (inTab) name = inTab.id.slice(4);
  const inPart = at && at.closest('#tab-environment > [data-env-part]');
  if (inPart) part = inPart.dataset.envPart;
  const tab = TABS.includes(name) ? name : 'environment';
  tabNow = tab;
  for (const t of TABS) $(`tab-${t}`).hidden = tab !== t;
  for (const b of $('subtabs').querySelectorAll('.subtab')) b.classList.toggle('active', b.dataset.tab === tab);
  if (tab === 'environment') showEnvPart(part);
  if (tab === 'modules') showModulePart(modPart);
  nav.draw('secondary'); // the page bar's row holds the Environment tab's parts, or the Modules tab's, only while it is shown
  if (tab === 'environment') requestAnimationFrame(() => scrollToChosen($('env-subtabs')));
  if (tab === 'modules') requestAnimationFrame(() => scrollToChosen($('module-subtabs')));
  scrollToChosen($('subtabs'));
  const hash = tab === 'environment' ? envPart : tab === 'modules' && modulePart !== 'config' ? `modules/${encodeURIComponent(modulePart)}` : tab;
  if (location.hash !== `#${hash}`) history.replaceState(null, '', `#${hash}`);
  // Who has a calendar feed changes on their own Profile, so the Users tab asks again each time it opens.
  if (tab === 'users' && users.length) loadFeeds().then(renderUsers);
  if (inTab) {
    at.scrollIntoView({ block: 'start' });
    // The section's first field, or the control itself (#add-space, "+ New <space>" in the top bar's switcher).
    const field = at.matches('input, select, button, summary') ? at : at.querySelector('input[type="text"]') || at.querySelector('input, select, button, summary');
    if (field) field.focus({ preventScroll: true });
  }
}
$('subtabs').addEventListener('click', (event) => {
  const b = event.target.closest('.subtab');
  if (b) selectTab(b.dataset.tab);
});
$('env-subtabs').addEventListener('click', (event) => {
  const b = event.target.closest('.subtab');
  if (b) selectTab(b.dataset.envPart);
});
$('module-subtabs').addEventListener('click', (event) => {
  const b = event.target.closest('.subtab');
  if (!b) return;
  const was = modulePart;
  selectTab(b.dataset.modulePart === 'config' ? 'modules' : `modules/${b.dataset.modulePart}`);
  if (modulePart !== was) window.scrollTo(0, 0); // a new part starts at its top
});
window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));
// A section drawn later (a module's row on the Template tab) is opened again once the page has drawn it (init).
const firstHash = location.hash.slice(1);
selectTab(firstHash);

$('add-toggle').addEventListener('click', () => {
  $('add-user').hidden = !$('add-user').hidden;
  if (!$('add-user').hidden) $('new-login').focus();
});
$('add-cancel').addEventListener('click', () => {
  $('add-user').hidden = true;
  $('add-user').reset();
  $('new-link').checked = true;
});

// A card is just a roster row now: status, a thumbnail, quick mute/kick for
// whoever is live, and a link to their profile page, which is the one place
// any of a user's own settings actually get edited (see profile.js).
function fill(card, user) {
  card.dataset.key = user.key;
  card.querySelector('[data-name]').textContent = user.displayName;
  card.querySelector('[data-login]').textContent = user.login;
  card.querySelector('[data-role]').textContent = roleLabel(user);
  card.querySelector('[data-key]').textContent = user.key;
  card.querySelector('[data-thumb]').src = imgUrl(user.key, 'profile');
  card.querySelector('[data-action="edit"]').href = `/profile/${encodeURIComponent(user.key)}`;
  card.querySelector('[data-mfa]').hidden = !user.mfaEnrolled;
  // Whether they have a calendar feed (plan-google-calendar.md): never the address, only on or off, with Turn off.
  const feedOn = Boolean(feeds.get(user.key)?.on);
  card.querySelector('[data-feed]').hidden = !feedOn;
  card.querySelector('[data-action="feed-off"]').hidden = !feedOn;
  renderLive(card, user.online);
}

function renderLive(card, online) {
  const dot = card.querySelector('[data-dot]');
  dot.classList.toggle('online', !!online);
  dot.title = online ? 'in a call' : 'offline';
  const live = card.querySelector('[data-live]');
  const inSpace = online && online.space ? spaces.find((r) => r.id === online.space) : null;
  live.textContent = online ? `${inSpace ? `in ${inSpace.name} · ` : ''}${online.micOn ? 'mic on' : 'mic off'} · ${online.cameraOn ? 'camera on' : 'camera off'}` : '';
  card.querySelector('[data-action="mute"]').hidden = !online || !online.micOn;
  card.querySelector('[data-action="kick"]').hidden = !online;
}

function cardFor(user) {
  let card = userCards.get(user.key);
  if (card) return card;
  card = $('user-card').content.firstElementChild.cloneNode(true);
  userCards.set(user.key, card);
  $('users').appendChild(card);
  wire(card);
  return card;
}

function userOf(card) {
  return users.find((u) => u.key === card.dataset.key);
}

function wire(card) {
  card.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !card.contains(button)) return;
    const user = userOf(card);
    const action = button.dataset.action;
    if (action === 'mute') {
      api('POST', `/api/users/${user.key}/mute`, { muted: true }).then(refreshLive).catch((err) => say($('party-status'), err.message, true));
    } else if (action === 'feed-off') {
      if (!await confirmDialog({ title: `Turn off ${user.displayName}'s calendar feed?`, message: 'Their address stops working. They can make a new one.', action: 'Turn off', kind: 'destructive' })) return;
      api('DELETE', `/api/users/${user.key}/feed`)
        .then(() => { feeds.delete(user.key); fill(card, user); say($('party-status'), 'calendar feed turned off'); })
        .catch((err) => say($('party-status'), err.message, true));
    } else if (action === 'kick') {
      if (!await confirmDialog({ title: `Kick ${user.displayName} from the call?`, message: 'They can rejoin.', action: 'Kick', kind: 'destructive' })) return;
      api('POST', `/api/users/${user.key}/kick`).then(refreshLive).catch((err) => say($('party-status'), err.message, true));
    }
  });
}

function renderUsers() {
  for (const user of users) fill(cardFor(user), user);
  for (const [key, card] of userCards) {
    if (!users.some((u) => u.key === key)) {
      card.remove();
      userCards.delete(key);
    }
  }
  $('party-status').textContent = `${users.filter((u) => u.online).length} of ${users.length} in a call`;
  renderSpaces(); // the member lists follow the users
}

async function refreshLive() {
  try {
    const status = await api('GET', '/api/status');
    const byKey = new Map(status.users.map((u) => [u.key, u]));
    users = users.map((u) => ({ ...u, online: byKey.get(u.key)?.online || null }));
    for (const user of users) renderLive(cardFor(user), user.online);
    $('party-status').textContent = `${users.filter((u) => u.online).length} of ${users.length} in a call`;
  } catch (err) {
    // leave the last known state
  }
}

// Who has a calendar feed (feeds, above): /api/status leaves it out (the access key reads that), so it comes from the
// owners' own list of users.
async function loadFeeds() {
  try {
    feeds = new Map((await api('GET', '/api/users')).users.filter((u) => u.calendarFeed?.on).map((u) => [u.key, u.calendarFeed]));
  } catch {
    // keeps what it knew
  }
}

async function loadUsers() {
  const [status] = await Promise.all([api('GET', '/api/status'), loadFeeds()]);
  users = status.users;
  spaces = status.spaces || spaces;
  renderUsers();
  renderModules(); // the "(not in <Lobby>)" hints, now the Lobby's name is known
  // The Words group's descriptions, now the Lobby's name is known (in place: nothing typed there is lost).
  for (const hint of document.querySelectorAll('#words-list [data-word-about]')) hint.textContent = wordAbout(hint.closest('[data-word-key]').dataset.wordKey);
}

// --- roles ---------------------------------------------------------------------
// A grid: one row per permission, one column per role. Owner is always all
// on and disabled; the other three save the moment a box is clicked.

const ROLE_COLUMNS = ['owner', 'moderator', 'member', 'guest'];

function renderRoles({ permissions, roles }) {
  const label = (role) => word(role, { cap: true });
  const rows = ['<thead><tr><th scope="col"><span class="visually-hidden">What they can do</span></th>' + ROLE_COLUMNS.map((role) => `<th scope="col" class="is-center">${escapeHtml(label(role))}</th>`).join('') + '</tr></thead><tbody>'];
  let group = null;
  for (const p of permissions) {
    if (p.group !== group) {
      group = p.group;
      rows.push(`<tr class="sdk-table-group"><th scope="colgroup" colspan="${ROLE_COLUMNS.length + 1}">${escapeHtml(group)}</th></tr>`);
    }
    rows.push(`<tr><th scope="row">${escapeHtml(p.label)}</th>` + ROLE_COLUMNS.map((role) => {
      const noGuestAi = role === 'guest' && p.key === 'useAi'; // the server refuses guests whatever the box says
      const locked = role === 'owner' || noGuestAi;
      return `<td class="is-center"><input type="checkbox" data-role="${role}" data-perm="${p.key}" ${(roles[role] || {})[p.key] && !noGuestAi ? 'checked' : ''} ${locked ? `disabled title="${escapeHtml(noGuestAi ? `${word('guest', { many: true, cap: true })} can never use AI` : `${word('owner', { many: true, cap: true })} can always do this`)}"` : ''} aria-label="${escapeHtml(p.label)}, ${escapeHtml(label(role))}"></td>`;
    }).join('') + '</tr>');
  }
  rows.push('</tbody>');
  $('roles-table').innerHTML = rows.join('');
}
async function loadRoles() {
  renderRoles(await api('GET', '/api/roles'));
}
$('roles-table').addEventListener('change', async (event) => {
  const box = event.target;
  if (!box.dataset.role) return;
  try {
    await api('PATCH', `/api/roles/${box.dataset.role}`, { [box.dataset.perm]: box.checked });
    say($('roles-status'), 'saved');
  } catch (err) {
    box.checked = !box.checked;
    say($('roles-status'), err.message, true);
  }
});

// --- spaces ---------------------------------------------------------------------
// A roster, same as Users: click a space to configure it on its own page
// (/spaces/<id>) instead of editing it inline in this list.

let spaces = [];
const spaceRows = new Map();

function spaceRowFor(space) {
  let row = spaceRows.get(space.id);
  if (row) return row;
  row = $('space-card').content.firstElementChild.cloneNode(true);
  applyWords(row); // the template's data-fill (Edit space), in this environment's words
  row.dataset.space = space.id;
  spaceRows.set(space.id, row);
  $('spaces').appendChild(row);
  return row;
}

const PROFILE_LABELS = { roleplaying: 'Participant images', participants: 'Participant images', characters: 'Character images' };

function fillSpaceRow(row, space, index) {
  const img = row.querySelector('[data-thumb]');
  img.hidden = !space.hasImage;
  if (space.hasImage) img.src = `/img/space/${space.id}?v=${Date.now()}`;
  row.querySelector('[data-thumb-fallback]').hidden = space.hasImage;
  row.querySelector('[data-name]').textContent = space.name;
  const count = space.isLobby ? users.length : space.members.length;
  const who = space.isLobby ? 'Everyone' : `${count} ${word('member', { many: count !== 1 })}`;
  row.querySelector('[data-meta]').textContent = `${who} · ${PROFILE_LABELS[space.profile] || 'Roleplaying'}`;
  row.querySelector('[data-action="edit"]').href = setupHref(space.id);
  row.classList.toggle('lobby', space.isLobby);
  // The Lobby always sits first and isn't reorderable; among the rest, hide
  // whichever arrow would be a no-op at that end of the list.
  row.querySelector('[data-action="space-up"]').hidden = space.isLobby || index <= 1;
  row.querySelector('[data-action="space-down"]').hidden = space.isLobby || index >= spaces.length - 1;
}

function renderSpaces() {
  spaces.forEach((space, index) => {
    const row = spaceRowFor(space);
    fillSpaceRow(row, space, index);
    $('spaces').appendChild(row); // also fixes the row's position after a reorder
  });
  for (const [id, row] of spaceRows) {
    if (!spaces.some((r) => r.id === id)) {
      row.remove();
      spaceRows.delete(id);
    }
  }
  $('spaces-status').textContent = `${spaces.length} ${word('space', { many: spaces.length !== 1 })}`;
  renderInviteSpaces();
}

async function saveSpaceOrder() {
  try {
    await api('POST', '/api/spaces/order', { order: spaces.filter((r) => !r.isLobby).map((r) => r.id) });
  } catch (err) {
    say($('spaces-status'), err.message, true);
  }
}

// A space is set up in its Set up panel (plan-setup-panel.md, step 6): /?setup=<id> enters it and opens the panel. Over
// a call (this page in the space page's frame) the space page underneath does it, so the call keeps running
// (app:enter-space { action: 'setup' }); anywhere else the whole window goes there.
const setupHref = (id) => `/?setup=${encodeURIComponent(id)}`;
function openSetup(id) {
  if (overCall()) {
    try {
      const doc = window.parent.document;
      const handled = !doc.dispatchEvent(new window.parent.CustomEvent('app:enter-space', { detail: { id, action: 'setup' }, cancelable: true }));
      if (handled) return;
    } catch {
      // not the space page's own frame: the window goes
    }
  }
  let win = window;
  try {
    if (window.top.location.origin === location.origin) win = window.top;
  } catch {
    // framed by another origin: this page goes
  }
  win.location.href = setupHref(id);
}

$('spaces').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-action="edit"]');
  if (edit && !(event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
    event.preventDefault();
    openSetup(edit.closest('.user-card').dataset.space);
    return;
  }
  const button = event.target.closest('[data-action="space-up"], [data-action="space-down"]');
  if (!button) return;
  const id = button.closest('.user-card').dataset.space;
  const index = spaces.findIndex((r) => r.id === id);
  const swapWith = button.dataset.action === 'space-up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= spaces.length || spaces[swapWith].isLobby) return;
  [spaces[index], spaces[swapWith]] = [spaces[swapWith], spaces[index]];
  renderSpaces();
  saveSpaceOrder();
});

$('add-space').addEventListener('click', async () => {
  try {
    const { space } = await api('POST', '/api/spaces', { name: `${word('space', { cap: true })} ${spaces.length}`, description: '', members: [] });
    openSetup(space.id); // into the new space with Set up open: its name, members and picture right away
  } catch (err) {
    say($('spaces-status'), err.message, true);
  }
});

$('add-user').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('add-error').hidden = true;
  try {
    const { user } = await api('POST', '/api/users', {
      login: $('new-login').value,
      displayName: $('new-name').value,
      role: $('new-role').value,
      password: $('new-password').value,
      passwordless: $('new-link').checked,
    });
    users.push({ ...user, online: null });
    renderUsers();
    $('add-user').reset();
    $('new-link').checked = true;
    $('add-user').hidden = true;
    location.href = `/profile/${encodeURIComponent(user.key)}`; // set up their images etc. right away
  } catch (err) {
    $('add-error').textContent = err.message;
    $('add-error').hidden = false;
  }
});

async function saveSettings(patch, statusEl) {
  try {
    const answer = await api('PATCH', '/api/settings', patch);
    if (answer && answer.settings) {
      useOwnerSettings(answer.settings);
      renderHomeIconSelection();
    }
    await loadBranding();
    say(statusEl, 'saved');
  } catch (err) {
    say(statusEl, err.message, true);
  }
}
$('save-settings').addEventListener('click', () => saveSettings({ environmentName: $('set-environment-name').value }, $('settings-status')));
// The home icon, on the Template tab (addendum 2): saved on its own.
$('save-home-icon').addEventListener('click', () => saveSettings({ homeIcon: selectedHomeIcon }, $('home-icon-status')));
// --- words ---------------------------------------------------------------------
// The Words group (Environment tab): the ten level and role words an owner may change, each a singular, a plural and,
// when "a"/"an" is wrong for it, the singular with its article. Blank is the default, shown as the placeholder. Saved
// together with Save; Reset puts one back at once. The server checks every word and says why it refused one, and a
// refused save changes nothing. Host and admin are the host's own words, so they are not here.
const WORD_ABOUT = {
  environment: 'What people sign in to',
  space: 'Where people meet: {lobby}, and each one you add',
  home: 'The page that lists the {spaces}, named in the top bar',
  aside: 'A short, private call apart from the {space}',
  canvas: 'Where {modules} are used in {a space}',
  module: 'A tool on the {canvas}',
  object: 'A thing {a module} holds: a task, a note',
  owner: 'Who runs the {environment}',
  moderator: 'Who runs things in one {space}',
  member: 'A person with an account',
  guest: 'A person in by {a guest} link',
};
// A word's description; the space word's names the Lobby by its own name (a template may rename it: "Home base"), or
// "the first one" until the spaces are loaded.
function wordAbout(key) {
  const lobby = spaces.find((sp) => sp.isLobby);
  const name = !lobby ? 'the first one' : lobby.name === 'Lobby' ? 'the Lobby' : lobby.name;
  const about = fillWords(WORD_ABOUT[key]).replace('{lobby}', name);
  // Home's blank is the template's own word when it gives one, else the space word's plural.
  if (key === 'home') return templateWords.home ? `${about}. Blank uses the template's: ${templateWords.home.many}` : `${about}. Blank follows the ${word('space')} word`;
  return about;
}
// A row's name where it is not the default word itself: home's default is the space word's plural. Every sentence
// about a row (its label, Reset and its status) names it by wordName().
const WORD_NAMES = { home: 'Home page' };
const wordName = (key) => WORD_NAMES[key] || capitalOf(DEFAULTS[key].one);
// The rows without an article field: home is a name, never "a Trips".
const NO_ARTICLE = ['home'];
const usualArticle = (one) => `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`;
const capitalOf = (text) => text.charAt(0).toLocaleUpperCase('en') + text.slice(1);

function renderWords() {
  const list = $('words-list');
  const now = words();
  list.textContent = '';
  // With a template, a blank word is the template's (marked "From the template"), else the default.
  $('words-blank').textContent = madeFrom ? `Leave a word blank for the ${madeFrom.name || madeFrom.id} template's word, or the default where it gives none.` : 'Leave a word blank for its default.';
  const head = document.createElement('div');
  head.className = 'word-row word-row-head';
  head.setAttribute('aria-hidden', 'true');
  head.innerHTML = '<span></span><span class="field-label">Singular</span><span class="field-label">Plural</span><span class="field-label">With its article</span><span></span>';
  list.appendChild(head);
  for (const key of CHANGEABLE) {
    const d = key === 'home' ? homeDefault(now.space) : DEFAULTS[key]; // home's default follows the space word in use
    const w = now[key];
    const own = Boolean(ownWords[key]);
    // What a blank field reads: the template's word where it gives one, else the default.
    const t = templateWords[key] || null;
    const base = t ? { one: t.one, many: t.many, a: t.a || usualArticle(t.one) } : { one: d.one, many: d.many, a: usualArticle(d.one) };
    const name = wordName(key);
    const article = !NO_ARTICLE.includes(key);
    const note = !t ? '' : own ? `The template's: ${t.one}` : 'From the template';
    const back = t ? `Back to ${t.one}, the template's` : `Back to ${d.one}, the default`;
    const row = document.createElement('div');
    row.className = 'word-row';
    row.dataset.wordKey = key;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', name);
    row.innerHTML = `
      <div class="word-name"><strong>${escapeHtml(name)}</strong><span class="hint" data-word-about>${escapeHtml(wordAbout(key))}</span>${note ? `<span class="from-template">${escapeHtml(note)}</span>` : ''}</div>
      <label><span class="word-field-label">Singular</span><input type="text" data-word-part="one" maxlength="30" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(base.one)}" aria-label="${escapeHtml(name)}, singular${t ? `, blank for ${escapeHtml(t.one)}, the template's` : ''}"></label>
      <label><span class="word-field-label">Plural</span><input type="text" data-word-part="many" maxlength="30" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(base.many)}" aria-label="${escapeHtml(name)}, plural"></label>
      ${article ? `<label><span class="word-field-label">With its article</span><input type="text" data-word-part="a" maxlength="41" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(base.a)}" aria-label="${escapeHtml(name)}, with its article (optional)"></label>` : '<span></span>'}
      <button class="btn btn-small" type="button" data-word-reset ${own ? '' : 'disabled'} title="${escapeHtml(back)}" aria-label="Reset ${escapeHtml(name)}: ${escapeHtml(back.charAt(0).toLowerCase() + back.slice(1))}">Reset</button>`;
    const input = (part) => row.querySelector(`[data-word-part="${part}"]`);
    if (own) {
      input('one').value = w.one;
      input('many').value = w.many;
      if (article && w.a !== usualArticle(w.one)) input('a').value = w.a;
    }
    // The article's placeholder follows the singular being typed ("a trip"), so the usual one is always shown.
    if (article) {
      const follow = () => { const typed = input('one').value.trim(); input('a').placeholder = typed ? usualArticle(typed) : base.a; };
      input('one').addEventListener('input', follow);
      follow();
    }
    list.appendChild(row);
  }
  for (const key of VERBS) list.appendChild(verbRow(key));
}

// A verb's row (addendum 4), under the words: its name, one field (blank for the template's or the default), Reset.
const VERB_NAMES = { enter: () => fillWords('Button for entering {a space}'), layout: () => fillWords('Button for the {canvas} layout') };
const VERB_ABOUT = {
  enter: () => fillWords('The {space} list\'s main button and the {guest} form. {An aside}\'s button always reads Join.'),
  layout: () => fillWords('The {space} bar\'s menu that shows and hides {modules} on the {canvas}.'),
};
function verbRow(key) {
  const own = ownVerbs[key] || '';
  const t = templateVerbs[key] || null;
  const name = VERB_NAMES[key] ? VERB_NAMES[key]() : key;
  const note = !t ? '' : own ? `The template's: ${t}` : 'From the template';
  const back = t ? `Back to ${t}, the template's` : `Back to ${DEFAULT_VERBS[key]}, the default`;
  const row = document.createElement('div');
  row.className = 'word-row verb-row';
  row.dataset.verbKey = key;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', name);
  row.innerHTML = `
      <div class="word-name"><strong>${escapeHtml(name)}</strong><span class="hint">${escapeHtml(VERB_ABOUT[key] ? VERB_ABOUT[key]() : '')} Now: ${escapeHtml(verbs()[key])}.</span>${note ? `<span class="from-template">${escapeHtml(note)}</span>` : ''}</div>
      <label class="verb-field"><span class="word-field-label">Button</span><input type="text" data-verb-input maxlength="20" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t || DEFAULT_VERBS[key])}" aria-label="${escapeHtml(name)}${t ? `, blank for ${escapeHtml(t)}, the template's` : `, blank for ${escapeHtml(DEFAULT_VERBS[key])}`}"></label>
      <button class="btn btn-small" type="button" data-verb-reset ${own ? '' : 'disabled'} title="${escapeHtml(back)}" aria-label="Reset ${escapeHtml(name)}: ${escapeHtml(back.charAt(0).toLowerCase() + back.slice(1))}">Reset</button>`;
  row.querySelector('[data-verb-input]').value = own;
  return row;
}

// After the words change (`settings`: the PATCH's answer): the page's own words (data-word and data-fill are done by
// loadBranding), then the parts this page draws with word(), then the group itself.
async function wordsChanged(settings) {
  if (settings) useOwnerSettings(settings);
  await loadBranding();
  renderWords();
  loadRoles().catch(() => {});
  loadModules().catch(() => {});
  loadEnvironment().catch(() => {});
}

$('save-words').addEventListener('click', async () => {
  const patch = {};
  for (const row of $('words-list').querySelectorAll('[data-word-key]')) {
    const key = row.dataset.wordKey;
    const value = (part) => (row.querySelector(`[data-word-part="${part}"]`)?.value || '').trim(); // home has no article field
    const [one, many, a] = [value('one'), value('many'), value('a')];
    if (one || many || a) patch[key] = a ? { one, many, a } : { one, many };
    else if (ownWords[key]) patch[key] = null; // emptied: back to the template's word or the default
  }
  // The verbs (addendum 4), in the same change: a refused one refuses the whole patch.
  const verbPatch = {};
  for (const row of $('words-list').querySelectorAll('[data-verb-key]')) {
    const key = row.dataset.verbKey;
    const text = row.querySelector('[data-verb-input]').value.trim();
    if (text && text !== ownVerbs[key]) verbPatch[key] = text;
    else if (!text && ownVerbs[key]) verbPatch[key] = null; // emptied: back to the template's or the default
  }
  if (!Object.keys(patch).length && !Object.keys(verbPatch).length) {
    say($('words-status'), 'nothing to save');
    return;
  }
  const button = $('save-words');
  button.disabled = true;
  try {
    const answer = await api('PATCH', '/api/settings', { ...(Object.keys(patch).length ? { words: patch } : {}), ...(Object.keys(verbPatch).length ? { verbs: verbPatch } : {}) });
    await wordsChanged(answer && answer.settings);
    say($('words-status'), 'saved');
  } catch (err) {
    say($('words-status'), err.message, true); // the server's own sentence; nothing was changed
  } finally {
    button.disabled = false;
  }
});

$('words-list').addEventListener('click', async (event) => {
  const verbReset = event.target.closest('[data-verb-reset]');
  if (verbReset) {
    const key = verbReset.closest('[data-verb-key]').dataset.verbKey;
    verbReset.disabled = true;
    try {
      const answer = await api('PATCH', '/api/settings', { verbs: { [key]: null } });
      await wordsChanged(answer && answer.settings);
      const name = VERB_NAMES[key] ? VERB_NAMES[key]() : key;
      const t = templateVerbs[key];
      say($('words-status'), t ? `${name} is back to ${t}, the template's` : `${name} is back to ${DEFAULT_VERBS[key]}, the default`);
      $('words-list').querySelector(`[data-verb-key="${key}"] [data-verb-input]`)?.focus();
    } catch (err) {
      verbReset.disabled = false;
      say($('words-status'), err.message, true);
    }
    return;
  }
  const reset = event.target.closest('[data-word-reset]');
  if (!reset) return;
  const key = reset.closest('[data-word-key]').dataset.wordKey;
  reset.disabled = true;
  try {
    const answer = await api('PATCH', '/api/settings', { words: { [key]: null } });
    await wordsChanged(answer && answer.settings);
    const t = templateWords[key];
    say($('words-status'), t ? `${wordName(key)} is back to ${t.one}, the template's` : key === 'home' ? `${wordName(key)} is back to ${words().home.many}` : `${wordName(key)} is back to its default`);
    $('words-list').querySelector(`[data-word-key="${key}"] [data-word-part="one"]`)?.focus();
  } catch (err) {
    reset.disabled = false;
    say($('words-status'), err.message, true);
  }
});

// Language, time and money: the currency list is the one every picker uses (window.hostCurrency, from /sdk/host.js): the
// common ones first, then every other the server takes, by name, plus whatever is set if it is in neither (so a code chosen
// elsewhere is shown, not lost). Without the server's list it falls back to the browser's.
let picker = null; // the searchable list over the select (host.ui.currencySelect's)
async function fillCurrencies(current) {
  const select = $('set-currency');
  let currencies;
  try { ({ currencies } = await api('GET', '/api/currencies')); } catch (err) { currencies = undefined; }
  if (picker) picker.destroy();
  picker = window.hostCurrency.select(select, { value: current, currencies });
}
$('save-locale').addEventListener('click', () => saveSettings({ language: $('set-language').value, clock: $('set-clock').value, currency: $('set-currency').value }, $('locale-status')));
$('save-features').addEventListener('click', () => saveSettings({
  maxQuality: Number($('set-max-quality').value),
  pictureScale: Number($('set-picture-scale').value),
  allowScreenShare: $('set-allow-screen-share').checked,
  allowAsides: $('set-allow-asides').checked,
  allowPrivate: $('set-allow-private').checked,
  allowReactions: $('set-allow-reactions').checked,
  autoJoinCall: $('set-auto-join-call').checked,
}, $('features-status')));
$('save-login').addEventListener('click', () => saveSettings({ loginText: $('set-login-text').value, mfaRequired: $('set-mfa-required').checked }, $('login-status')));

// --- theme -------------------------------------------------------------------
// A chooser (the default theme, + every saved theme) and a
// Light/Dark switch, plus the same seven color inputs, used to create/edit
// whichever theme and mode is picked rather than a single live override.
// Every theme holds a light and a dark set (either may be missing: the
// other then stands in); the default theme's two come from the server and
// can't be edited.
const TC = window.ThemeColour; // public/theme-colour.js (the picks and the Auto formulas, shared with the server), loaded by admin.html
// The key of a theme set IS the colour role (server/store.js THEME_BASE and THEME_OPTIONAL), and the role is the CSS property.
const THEME_FIELDS = [
  ['theme-bg', '--surface-page', 'surface-page'],
  ['theme-bg-section', '--surface-panel', 'surface-panel'],
  ['theme-border', '--edge-hairline', 'edge-hairline'],
  ['theme-text', '--text-primary', 'text-primary'],
  ['theme-text-dim', '--text-muted', 'text-muted'],
  ['theme-accent', '--accent-fill', 'accent-fill'],
  ['theme-on-accent', '--text-on-accent', 'text-on-accent'],
];
// Colors a theme may leave on Auto (system.css derives them). For an Auto field the preview sets the same formula
// (ThemeColour.AUTO_CSS), so what you see is right whichever theme happens to be live.
const THEME_OPTIONAL_FIELDS = [
  ['theme-card', 'surface-card'],
  ['theme-header-bg', 'surface-bar-top'],
  ['theme-header-text', 'text-bar'],
  // The top bar's colour areas (plan-two-zone-nav.md decision 8): the branding area and the right side.
  ['theme-nav-brand-bg', 'surface-bar-brand'],
  ['theme-nav-brand-text', 'text-bar-brand'],
  ['theme-nav-right-bg', 'surface-bar-right'],
  ['theme-nav-right-text', 'text-bar-right'],
  ['theme-icon', 'icon-default'],
  ['theme-icon-hover', 'icon-hover'],
  ['theme-primary-hover', 'accent-fill-hover'],
  ['theme-secondary', 'fill-secondary'],
  ['theme-secondary-text', 'text-on-secondary'],
  ['theme-secondary-hover', 'fill-secondary-hover'],
  // The status colours' bases (the text on each and each as text are picked from them, theme-colour.js): Auto is the mode's own
  // fill (TC.STATUS_AUTO), not a formula, so these have none here.
  ['theme-status-danger', 'status-danger-fill'],
  ['theme-status-ok', 'status-ok-fill'],
  ['theme-status-warn', 'status-warn-fill'],
  ['theme-status-info', 'status-info-fill'],
  ['theme-field', 'surface-field'],
  ['theme-menu', 'surface-menu'],
  ['theme-nav-bg', 'surface-bar-nav'],
  ['theme-field-edge', 'edge-field'],
  ['theme-wash', 'wash-ink'],
  ['theme-mf-title', 'mf-surface-title'],
  ['theme-mf-toolbar', 'mf-surface-toolbar'],
  ['theme-mf-row', 'mf-surface-row'],
  ['theme-mf-row-hover', 'mf-surface-row-hover'],
  ['theme-message', 'surface-message'],
  ['theme-chosen', 'fill-chosen'],
  ['theme-chosen-text', 'text-on-chosen'],
  ['theme-chosen-ink', 'ink-chosen'],
  ['theme-brand-ink', 'ink-brand'],
  ['theme-neutral', 'ink-neutral'],
  ['theme-icon-bar', 'icon-bar'],
  ['theme-tone-gold', 'tone-gold'],
  ['theme-tone-blue', 'tone-blue'],
  ['theme-tone-green', 'tone-green'],
  ['theme-tone-teal', 'tone-teal'],
  ['theme-tone-purple', 'tone-purple'],
  ['theme-tone-red', 'tone-red'],
  ['theme-tone-orange', 'tone-orange'],
  ['theme-tone-pink', 'tone-pink'],
].map(([id, key]) => [id, `--${key}`, key, TC.AUTO_CSS[key] ?? null]);
// What an Auto field is set to on the page while previewing: its formula, or for a status fill the Auto fill of the mode being edited.
const autoCssFor = (key, formula) => formula ?? (key.startsWith('tone-') ? TC.TONE_AUTO[selectedMode][key.slice(5)] : TC.STATUS_AUTO[selectedMode][key.split('-')[1]]);
const autoBox = (id) => document.querySelector(`[data-auto-for="${id}"]`);
const isAuto = (id) => autoBox(id).checked;
let colorProbeCtx = null;
// Any CSS color (including color-mix results) as #rrggbb for a color input.
function toHex(cssColor) {
  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  // color-mix() results serialize as color(srgb r g b) with 0-1 channels.
  const srgb = String(cssColor).match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) return '#' + srgb.slice(1, 4).map((n) => hex2(Number(n) * 255)).join('');
  colorProbeCtx ||= document.createElement('canvas').getContext('2d');
  colorProbeCtx.fillStyle = '#000000';
  colorProbeCtx.fillStyle = cssColor;
  const v = colorProbeCtx.fillStyle;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : '#000000';
}
function computedColor(css) {
  const probe = document.createElement('span');
  probe.style.color = css;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}
// A see-through color (the top bar's areas are a 3% shade by default) shows as it looks over the header.
function resolvedVar(cssVar) {
  const color = computedColor(`var(${cssVar})`);
  const rgba = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!rgba || Number(rgba[4]) >= 1) return toHex(color);
  const under = toHex(computedColor('var(--nav-primary-bg, var(--header-bg))'));
  const a = Number(rgba[4]);
  const mix = (i) => Math.round(Number(rgba[i]) * a + parseInt(under.slice(2 * i - 1, 2 * i + 1), 16) * (1 - a));
  return '#' + [1, 2, 3].map((i) => mix(i).toString(16).padStart(2, '0')).join('');
}
let themes = [];
let defaultTheme = null; // the default theme: { name, light, dark }
let activeThemeId = null; // what's actually live right now (persisted)
let activeMode = 'dark';
let selectedThemeId = null; // whatever the dropdown/editor is showing -- may not be applied yet
let selectedMode = 'dark';
// Whether the page shows the editor's colors (a theme, mode or color picked here and not yet applied) instead of its
// own live look. Until something is picked here, the page keeps the live theme in the viewer's own light or dark (the
// header's switch), so that switch works on this page too.
let previewing = false;

const selectedTheme = () => themes.find((t) => t.id === selectedThemeId) || null;
// The colors the editor shows: the picked theme's set for the picked mode, or its other set when it has no such one yet.
function selectedColors() {
  const theme = selectedTheme() || defaultTheme;
  return theme[selectedMode] || theme.light || theme.dark;
}
function loadThemeInputsFrom(colors) {
  for (const [id, , key] of THEME_FIELDS) $(id).value = colors[key];
  for (const [id, , key] of THEME_OPTIONAL_FIELDS) {
    const auto = !colors[key];
    autoBox(id).checked = auto;
    $(id).disabled = auto;
    if (!auto) $(id).value = colors[key];
  }
}
// The set the inputs show now: every base colour, and each optional one or null when it is on Auto.
function currentThemeSet() {
  const set = {};
  for (const [id, , key] of THEME_FIELDS) set[key] = $(id).value;
  for (const [id, , key] of THEME_OPTIONAL_FIELDS) set[key] = isAuto(id) ? null : $(id).value;
  return set;
}
// Every property the preview has put on :root, so that leaving the preview takes exactly those off again.
const previewed = new Set();
const setPreviewVar = (name, value) => { document.documentElement.style.setProperty(name, value); previewed.add(name); };
// Sets these straight on :root (not just a scoped preview box) -- several
// other rules (button surfaces, hover shades) are themselves computed FROM
// these seven with color-mix(), and that only recomputes for real when the
// values it references change at the SAME element custom properties
// inherit their already-resolved value, they don't re-substitute var() per
// descendant. Root it is; this only previews locally until Apply actually
// persists it. Not previewing, the colors go on only long enough to read the Auto fields' values, and come off again
// before the page paints.
function updateThemePreview() {
  for (const [id, cssVar] of THEME_FIELDS) setPreviewVar(cssVar, $(id).value);
  for (const [id, cssVar, key, formula] of THEME_OPTIONAL_FIELDS) {
    const auto = isAuto(id);
    setPreviewVar(cssVar, auto ? autoCssFor(key, formula) : $(id).value);
    const old = TC.LEGACY[key]; // the old token the server also writes for this role (theme-colour.js LEGACY)
    if (old) setPreviewVar(old, auto ? TC.LEGACY_AUTO[old] : $(id).value);
  }
  // What the server picks for this set (text on the accent and on the status fills, the accent and status colours as text).
  const got = TC.resolve(currentThemeSet(), selectedMode);
  if (got) for (const [role, hex] of Object.entries(got.picks)) setPreviewVar(`--${role}`, hex);
  renderThemeContrast();
  // An Auto field shows what it currently works out to: what the product draws, which for the four roles that still have an old
  // token with a default of its own (theme-colour.js LEGACY) is that token's. --icon has no value when Auto; show what an icon on
  // the header's main colour draws (style.css, .topbar .icon-link). Not read from the sample header's icons: they sit in its right
  // side, whose text colour a theme may set apart.
  for (const [id, cssVar, key] of THEME_OPTIONAL_FIELDS) {
    if (!isAuto(id)) continue;
    const old = TC.LEGACY[key];
    $(id).value = old === '--icon'
      ? toHex(computedColor('var(--icon, color-mix(in srgb, var(--header-text) 75%, transparent))'))
      : resolvedVar(old || cssVar);
  }
  if (!previewing) clearThemePreview();
}
// A change made here: the page previews it from now until Apply.
function previewThemeEdit() {
  previewing = true;
  updateThemePreview();
}
// The header's switch, or a theme another page applied, changed the live look: the Auto fields read it again.
document.addEventListener('app:theme', () => {
  if (!previewing && defaultTheme) updateThemePreview();
});
function clearThemePreview() {
  for (const name of previewed) document.documentElement.style.removeProperty(name);
  previewed.clear();
}
// The contrast panel: how the colors being edited read together, with the same picks and the same ratios the server uses
// (theme-colour.js): text on the page and a panel, muted text, the accent as text and as a mark, the text on the accent and on each
// status fill, each status colour as text and as a mark, and the border. A pair under its minimum (4.5 : 1 for text, 3 : 1 for a
// mark) is named in a plain sentence above the list of pairs. The text on the accent has an Auto-fix: the server picks it, so the button
// only shows the colour that was picked, in the field.
const ratioText = (x) => `${x.toFixed(2)} : 1`;
const mk = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function renderThemeContrast() {
  const box = $('theme-contrast');
  const got = TC.resolve(currentThemeSet(), selectedMode);
  if (!got) { box.replaceChildren(); return; }
  const notes = mk('ul', 'theme-contrast-notes');
  for (const r of got.report) {
    if (r.id === 'on-accent' && r.picked) {
      const own = r.own === null ? '' : `The text on the accent reads at ${ratioText(r.own)}, under the 4.5 : 1 text needs. `;
      const item = mk('li');
      if (r.ok) {
        item.append(mk('span', '', `${own}${productName()} uses ${r.pick} instead, which reads at ${ratioText(r.ratio)}.`));
        const fix = mk('button', 'btn btn-small', 'Auto-fix');
        fix.type = 'button';
        fix.dataset.fixOnAccent = r.pick;
        fix.title = `Set the text on the accent to ${r.pick}, the color picked for it`;
        item.append(fix);
      } else {
        item.append(mk('span', '', `Neither white nor near-black reaches 4.5 : 1 on this accent; the better one reads at ${ratioText(r.ratio)}. Pick a lighter or a darker accent.`));
      }
      notes.append(item);
    } else if (!r.ok) {
      notes.append(mk('li', '', `${r.label} reads at ${ratioText(r.ratio)}; ${r.kind === 'mark' ? 'a mark needs 3 : 1' : 'text needs 4.5 : 1'}.`));
    }
  }
  const pairs = mk('table', 'theme-contrast-pairs');
  const theme = selectedTheme() || defaultTheme;
  pairs.append(mk('caption', 'hint', `${theme.name}, ${selectedMode}`));
  const head = mk('tr');
  for (const name of ['Pair', 'Looks like', 'Reads at', 'Needs', '']) head.append(mk('th', '', name));
  const thead = mk('thead');
  thead.append(head);
  const body = mk('tbody');
  for (const r of got.report) {
    const row = mk('tr');
    row.append(mk('td', '', r.label));
    const sample = mk('td');
    const chip = mk('span', 'theme-contrast-sample', r.kind === 'mark' ? '■' : 'Aa');
    chip.style.setProperty('--sample-fg', r.fg);
    chip.style.setProperty('--sample-bg', r.bg);
    sample.append(chip);
    row.append(sample, mk('td', '', ratioText(r.ratio)), mk('td', '', r.min ? ratioText(r.min) : '-'));
    row.append(mk('td', `theme-contrast-state${r.min === 0 ? '' : r.ok ? ' pass' : ' fail'}`, r.min === 0 ? 'No minimum' : r.ok ? 'Reads well' : 'Too low'));
    body.append(row);
  }
  pairs.append(thead, body);
  box.replaceChildren(notes.children.length ? notes : mk('p', 'theme-contrast-ok', 'Every pair reads well.'), pairs);
}
$('theme-contrast').addEventListener('click', (event) => {
  const fix = event.target.closest('[data-fix-on-accent]');
  if (!fix) return;
  $('theme-on-accent').value = fix.dataset.fixOnAccent;
  previewThemeEdit();
});
for (const [id] of THEME_FIELDS) $(id).addEventListener('input', previewThemeEdit);
for (const [id] of THEME_OPTIONAL_FIELDS) {
  $(id).addEventListener('input', previewThemeEdit);
  autoBox(id).addEventListener('change', () => {
    $(id).disabled = autoBox(id).checked;
    previewThemeEdit();
  });
}
// The colors to save: the seven, and each optional one or null when on Auto.
function themeColors() {
  const colors = {};
  for (const [id, , key] of THEME_FIELDS) colors[key] = $(id).value;
  for (const [id, , key] of THEME_OPTIONAL_FIELDS) colors[key] = isAuto(id) ? null : $(id).value;
  return colors;
}
// /theme.css only changes what the *server* sends on the *next* request --
// this page's own <link> already fetched the old one. Re-pointing it at a
// cache-busted URL and waiting for it to load is what makes actually
// applying a theme visibly repaint this page too, not just the next page
// someone opens.
function reloadThemeStylesheet() {
  return new Promise((resolve) => {
    const link = $('theme-link');
    const onLoad = () => { link.removeEventListener('load', onLoad); resolve(); };
    link.addEventListener('load', onLoad);
    link.setAttribute('href', `/theme.css?v=${Date.now().toString(36)}`); // kept relative: brand.js finds it by its start
  });
}
function renderThemeChooser() {
  const select = $('theme-select');
  select.innerHTML = `<option value="">${escapeHtml(defaultTheme.name)} (Default)</option>` + themes.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  select.value = selectedThemeId || '';
  const selected = selectedTheme();
  $('theme-mode').setAttribute('aria-checked', String(selectedMode === 'dark'));
  $('theme-mode').title = selectedMode === 'dark' ? 'The default is dark: switch to light' : 'The default is light: switch to dark';
  $('theme-update-name').textContent = selected ? `${selected.name}, ${selectedMode}` : '';
  $('theme-update').hidden = !selected;
  $('theme-delete').hidden = !selected;
  $('theme-apply').disabled = selectedThemeId === activeThemeId && selectedMode === activeMode;
  // Export: the saved theme in the chooser, as a file (the default theme is "default"). The server names the download.
  $('theme-export').href = `/api/themes/${encodeURIComponent(selectedThemeId || 'default')}/export`;
  // Who made an imported theme: shown, never edited here (plan-themes.md).
  $('theme-author').textContent = selected?.author ? `Made by ${selected.author}` : '';
  $('theme-author').hidden = !selected?.author;
}
// What the last import said: stays until another theme is picked, so a list of what was left out can be read.
function sayImport(text, error = false) {
  $('theme-import-status').textContent = text;
  $('theme-import-status').classList.toggle('error', error);
  $('theme-import-status').hidden = !text;
}
// Picking a theme or a mode: into the editor and the preview, not live until Apply.
function showSelectedTheme() {
  renderThemeChooser();
  // A theme with only one set shows it in both modes until Update saves the other.
  const missing = selectedTheme() && !selectedTheme()[selectedMode];
  say($('theme-status'), missing ? `no ${selectedMode} version yet -- Update saves one` : '');
  loadThemeInputsFrom(selectedColors());
  updateThemePreview();
}
async function loadThemes() {
  const data = await api('GET', '/api/themes');
  themes = data.themes;
  defaultTheme = data.defaultTheme;
  activeThemeId = data.activeThemeId;
  activeMode = data.themeMode === 'light' ? 'light' : 'dark';
  selectedThemeId = activeThemeId;
  selectedMode = activeMode;
  showSelectedTheme();
}
// Browsing the dropdown only previews -- it takes an explicit Apply to
// actually persist and go live, rather than every click through the list
// changing what everyone else sees.
$('theme-select').addEventListener('change', () => {
  sayImport('');
  selectedThemeId = $('theme-select').value || null;
  previewing = true;
  showSelectedTheme();
});
$('theme-mode').addEventListener('click', () => {
  selectedMode = selectedMode === 'dark' ? 'light' : 'dark';
  previewing = true;
  showSelectedTheme();
});
// Apply puts the theme live, and its mode as the default: every open page follows at once (the notifications stream's
// 'theme' event, brand.js). Someone who picked their own light or dark with the header's switch keeps it, this owner too.
$('theme-apply').addEventListener('click', async () => {
  await saveSettings({ activeThemeId: selectedThemeId, themeMode: selectedMode }, $('theme-status'));
  if ($('theme-status').classList.contains('error')) return;
  await reloadThemeStylesheet();
  previewing = false;
  clearThemePreview();
  activeThemeId = selectedThemeId;
  activeMode = selectedMode;
  renderThemeChooser();
  const own = themeMode();
  say($('theme-status'), own === selectedMode ? 'applied' : `applied -- you still see ${own}, your own pick (the switch at the top)`);
});
// Import…: a theme file (plan-themes.md), read here and sent as its text; the server checks it and adds it as a new
// theme ("Name (2)" when the name is taken). It is chosen and previewed, never applied: Apply does that, as for any theme.
$('theme-import').addEventListener('click', () => $('theme-import-file').click());
$('theme-import-file').addEventListener('change', async () => {
  const input = $('theme-import-file');
  const file = input.files[0];
  input.value = ''; // the same file can be picked again
  if (!file) return;
  sayImport('');
  // Far bigger than any theme (the server takes 16 KB): not read at all.
  if (file.size > 1024 * 1024) return sayImport(`That isn't a ${[productName(), 'theme'].filter(Boolean).join(' ')} file.`, true);
  try {
    const { theme, dropped } = await api('POST', '/api/themes/import', new Blob([await fileText(file)], { type: 'text/plain' }));
    themes.push(theme);
    selectedThemeId = theme.id;
    previewing = true;
    showSelectedTheme();
    const left = Array.isArray(dropped) && dropped.length ? ` Left out: ${dropped.join(', ')}.` : '';
    sayImport(`Imported ${theme.name}${theme.author ? ` by ${theme.author}` : ''}.${left} Apply to use it.`);
  } catch (err) {
    sayImport(err.message, true);
  }
});
$('theme-save-new').addEventListener('click', async () => {
  const name = window.prompt('Name this theme:');
  if (!name) return;
  const colors = themeColors();
  try {
    const { theme } = await api('POST', '/api/themes', { name, mode: selectedMode, ...colors });
    themes.push(theme);
    selectedThemeId = theme.id;
    renderThemeChooser();
    say($('theme-status'), 'saved -- Apply to go live');
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});
$('theme-update').addEventListener('click', async () => {
  if (!selectedThemeId) return;
  const colors = themeColors();
  try {
    const { theme } = await api('PATCH', `/api/themes/${selectedThemeId}`, { mode: selectedMode, ...colors });
    themes = themes.map((t) => (t.id === theme.id ? theme : t));
    renderThemeChooser();
    // Only reapplies for real if this is the theme and mode actually live
    // right now -- editing one you're just browsing shouldn't make it live.
    if (selectedThemeId === activeThemeId && selectedMode === activeMode) {
      await reloadThemeStylesheet();
      previewing = false;
      clearThemePreview();
    }
    say($('theme-status'), 'saved');
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});
$('theme-delete').addEventListener('click', async () => {
  const selected = themes.find((t) => t.id === selectedThemeId);
  if (!selected) return;
  if (!await confirmDialog({ title: `Delete the theme "${selected.name}"?`, message: "This can't be undone.", action: 'Delete', kind: 'final' })) return;
  try {
    await api('DELETE', `/api/themes/${selected.id}`);
    themes = themes.filter((t) => t.id !== selected.id);
    // The server already fell back activeThemeId to the default if this was
    // the live one -- mirror that here rather than leaving a dangling
    // reference to a theme that no longer exists.
    const wasActive = activeThemeId === selected.id;
    if (wasActive) activeThemeId = null;
    selectedThemeId = activeThemeId;
    renderThemeChooser();
    loadThemeInputsFrom(selectedColors());
    previewing = false; // back on the live theme: the page shows its own look again
    updateThemePreview();
    if (wasActive) {
      await reloadThemeStylesheet();
      previewing = false;
      clearThemePreview();
    }
    say($('theme-status'), 'deleted');
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});
$('save-registration').addEventListener('click', () => saveSettings({ allowRegistration: $('set-allow-registration').checked }, $('registration-status')));

// --- invites -----------------------------------------------------------------

function renderInviteSpaces() {
  const container = $('invite-spaces');
  const keep = new Set();
  for (const space of spaces) {
    if (space.isLobby) continue; // everyone is already there; nothing to pick
    keep.add(space.id);
    let label = container.querySelector(`[data-space="${CSS.escape(space.id)}"]`);
    if (!label) {
      label = document.createElement('label');
      label.className = 'sdk-member sdk-member-toggle';
      label.dataset.space = space.id;
      const input = document.createElement('input');
      input.type = 'checkbox';
      const name = document.createElement('span');
      name.className = 'sdk-member-name';
      label.append(input, name);
      container.appendChild(label);
    }
    label.querySelector('.sdk-member-name').textContent = space.name;
  }
  for (const label of [...container.children]) if (!keep.has(label.dataset.space)) label.remove();
}

$('invite-spaces').addEventListener('change', (event) => {
  event.target.closest('.sdk-member-toggle')?.classList.toggle('is-on', event.target.checked);
});

$('make-invite').addEventListener('click', async () => {
  try {
    const spaceIds = [...$('invite-spaces').querySelectorAll('input:checked')].map((i) => i.closest('[data-space]').dataset.space);
    const { invite } = await api('POST', '/api/invites', { spaces: spaceIds });
    $('invite-link').textContent = invite.url;
    $('invite-link-row').hidden = false;
    say($('invite-status'), 'link made');
  } catch (err) {
    say($('invite-status'), err.message, true);
  }
});
$('invite-copy').addEventListener('click', () => copy($('invite-link').textContent, $('invite-status')));

// --- reactions --------------------------------------------------------------

function reactionRow(reaction) {
  const row = $('reaction-row').content.firstElementChild.cloneNode(true);
  row.dataset.id = reaction?.id || '';
  row.querySelector('.reaction-glyph').value = reaction?.glyph || '';
  row.querySelector('.reaction-label').value = reaction?.label || '';
  return row;
}

function renderReactionRows(reactions) {
  const list = $('reactions-list');
  list.textContent = '';
  for (const r of reactions || []) list.appendChild(reactionRow(r));
}

function slugify(text) {
  return String(text || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

$('reactions-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const row = button.closest('.reaction-row');
  if (button.dataset.action === 'reaction-remove') row.remove();
  else if (button.dataset.action === 'reaction-up' && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
  else if (button.dataset.action === 'reaction-down' && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
});
$('reaction-add').addEventListener('click', () => $('reactions-list').appendChild(reactionRow()));

$('save-reactions').addEventListener('click', async () => {
  const seen = new Set();
  const reactions = [...$('reactions-list').querySelectorAll('.reaction-row')]
    .map((row) => {
      const glyph = row.querySelector('.reaction-glyph').value.trim();
      const label = row.querySelector('.reaction-label').value.trim();
      let id = row.dataset.id || slugify(label) || slugify(glyph);
      if (!id || seen.has(id)) id = `r${Math.random().toString(36).slice(2, 8)}`;
      seen.add(id);
      return { id, glyph, label };
    })
    .filter((r) => r.glyph);
  try {
    const { settings } = await api('PATCH', '/api/settings', { reactions });
    renderReactionRows(settings.reactions);
    say($('reactions-status'), 'saved');
  } catch (err) {
    say($('reactions-status'), err.message, true);
  }
});

// --- modules ----------------------------------------------------------------
// Upload a zip, review what it asks for, enable it. See docs/MODULES.md.
let installedModules = [];
let builtinModules = [];
let bundledModules = []; // the modules that ship with this server, and whether each is installed or has an update
// What this environment calls a module and shows it as (plan-environment-templates.md, "Module display names and icons"):
// its display name and icon, else its own (the manifest's `name` and `icon`, which the card keeps beside them).
const shownName = (m) => (m && (m.displayName || m.name)) || '';
const shownIcon = (m) => (m && (m.displayIcon || m.icon)) || 'puzzle-piece';
// Any module's name as shown, by id: installed first, then the ones that ship with the server.
const shownNameOf = (id) => shownName(installedModules.find((m) => m.id === id) || bundledModules.find((b) => b.id === id)) || id;

async function loadModules() {
  const data = await api('GET', '/api/modules');
  installedModules = data.modules;
  builtinModules = data.builtin || [];
  bundledModules = data.bundled || [];
  modulesLoaded = true;
  await loadAi(); // the AI service's entry and tab come from it
  renderModuleTabs();
  renderModules();
  // The tab shown again from the list as it is now; a module's tab that has gone (turned off or uninstalled) leaves
  // Configuration shown, and the address says so.
  showModulePart(modulePart);
  if (tabNow === 'modules') {
    const hash = modulePart === 'config' ? 'modules' : `modules/${encodeURIComponent(modulePart)}`;
    if (location.hash !== `#${hash}`) history.replaceState(null, '', `#${hash}`);
    nav.draw('secondary');
  }
  renderModuleNames();
  renderTemplateNote();
  loadActivity();
  // Say on the tab itself when an update is waiting, so it is seen without opening it.
  const updates = bundledModules.filter((b) => b.update).length;
  const fresh = bundledModules.filter((b) => !b.installed).length;
  setUpdateBadge(updates);
  setManageBadge(updates, fresh);
  // The same count badge as on the header's gear (see setUpdateBadge in brand.js).
  const tab = document.querySelector('[data-tab="modules"]');
  if (tab) {
    tab.textContent = word('module', { many: true, cap: true });
    tab.title = '';
    if (updates + fresh) {
      const badge = document.createElement('span');
      badge.className = 'badge update-badge badge-ok';
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', manageBadgeLabel(updates, fresh));
      badge.textContent = updates + fresh > 9 ? '9+' : String(updates + fresh);
      tab.append(badge);
      tab.title = manageBadgeLabel(updates, fresh);
    }
  }
}

// What a module needs turned on first, as HTML: the AI service (with the way to its tab), or another module.
const needsText = (r) => (r === 'ai' ? '<a href="#modules/ai">the AI service</a> enabled' : `${escapeHtml(shownNameOf(r))} installed and turned on`);

// What a bundled module still needs before it can be turned on (Maps needs Places): said in its row of the list, so the
// admin installs those first instead of meeting a disabled Approve button afterwards.
function bundledNeeds(b) {
  const waiting = (b.requires || []).filter((r) => !installedModules.some((m) => m.id === r && m.enabled));
  if (!waiting.length) return '';
  const name = shownNameOf;
  return `<div class="hint module-needs"><i class="fa-solid fa-circle-info fa-fw" aria-hidden="true"></i> Needs ${waiting.map((r) => `<strong>${escapeHtml(name(r))}</strong>`).join(' and ')} installed and turned on first.</div>`;
}

// The switch that turns a module, a built-in one or the AI service on and off (#264): one control in place of the
// Enabled pill and the Disable button, the switch (input.sdk-switch) with its word beside it. Its name says whose it is.
function enabledSwitch({ id, attr, name, on, disabled = false }) {
  return `<label class="sdk-choice-row module-toggle"><input type="checkbox" class="sdk-switch" role="switch" ${attr}="${escapeHtml(id)}" aria-label="${escapeHtml(name)} enabled"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}> Enabled</label>`;
}

// An installed module's card, in one of four shapes (#264):
//   'row'  on the Configuration tab, for a module that is on: its head (the switch), notes and what it does; its name
//          opens its tab, where the rest is;
//   'full' on the Configuration tab, for a module that is off (it has no tab): everything, so what it asks for is read
//          before it is turned on, and its versions and Uninstall are still within reach;
//   'tab'  the top of its own tab: its head, notes, what it does and the name it is shown as;
//   'more' the foot of its own tab: what it is approved to do, how it runs, its versions and Uninstall.
function moduleCard(m, shape = 'full') {
  // Where it shows (a person's own data is not a place of its own).
  // An outdated module's old scopes are not read, so it has no place to show: say why instead.
  const scopes = m.outdated ? 'Can\'t run until it is updated' : m.scope.filter((s) => s !== 'person').map((s) => (s === 'environment' ? `${word('environment', { cap: true })} page` : `${word('space', { cap: true })} ${word('canvas')}`)).join(' + ');
  // Versions built for an older version of the product can't be switched to: marked, and not offered.
  const staleVersions = new Set(m.outdatedVersions || (m.outdated ? [m.version] : []));
  // What a requirement needs to be turned on first (one built for an older version of the product is in needsUpdate instead).
  const nameOf = (r) => escapeHtml(shownName(installedModules.find((x) => x.id === r)) || r);
  const asks = [
    ...m.permissions.map((p) => `<li><strong>${escapeHtml(p.label)}</strong> <span class="hint">permission, appears in Roles</span></li>`),
    ...(m.hooks.schedule ? ['<li><strong>Run things on a schedule</strong> <span class="hint">reminders and timed events</span></li>'] : []),
    ...(m.hooks.notify ? ['<li><strong>Send notifications</strong> <span class="hint">to people using it</span></li>'] : []),
    ...(m.hooks.external ? ['<li><strong>See each person\'s own other calendars</strong> <span class="hint">only to them</span></li>'] : []),
    ...(m.events && m.events.subscribes.length ? [`<li><strong>Hear what happens in other ${escapeHtml(word('module', { many: true }))}</strong> <span class="hint">${escapeHtml(m.events.subscribes.map((c) => c === '*' ? `any ${word('module')}` : c.replace(':', ' ')).join(', '))}: their events, only for people who can see them</span></li>`] : []),
    ...(m.actions && m.actions.uses.length ? [`<li><strong>Ask other ${escapeHtml(word('module', { many: true }))} to do things</strong> <span class="hint">${escapeHtml(m.actions.uses.map((c) => c === '*' ? `any ${word('module')}` : c.replace(':', ' ')).join(', '))}: each request is carried out by the ${escapeHtml(word('module'))} that owns the action</span></li>`] : []),
    ...(m.refs && m.refs.consumes.length ? [`<li><strong>Link to other ${escapeHtml(word('module', { many: true }))}' ${escapeHtml(word('object', { many: true }))}</strong> <span class="hint">${escapeHtml(m.refs.consumes.map((c) => c.replace(':', ' ')).join(', '))}, shown only to people who can already see them</span></li>`] : []),
  ];
  const modeTag = m.runMode === 'page' ? '<span class="sdk-status" data-tone="warn">In the page</span>' : '<span class="sdk-status">Sandboxed</span>';
  // The state: one switch (#264); a module built for an older version of the product can't be turned on, so it says so.
  const control = m.outdated ? '<span class="sdk-status" data-tone="warn">Needs an update</span>' : `${m.needsApproval && !m.enabled ? '<span class="sdk-status" data-tone="warn">Needs approval</span> ' : ''}${enabledSwitch({ id: m.id, attr: 'data-module-enabled', name: shownName(m), on: m.enabled, disabled: !m.enabled && Boolean(m.missing?.length || m.needsUpdate?.length) })}`;
  const several = m.versions.length > 1; // the picker lists every kept version, the running one selected
  const name = escapeHtml(shownName(m));
  const head = `
    <div class="module-head">
      <i class="fa-solid fa-${escapeHtml(shownIcon(m))} fa-fw module-icon" aria-hidden="true"></i>
      <div class="grow"><h2>${shape === 'row' ? `<a href="#modules/${escapeHtml(encodeURIComponent(m.id))}" title="Open ${name}'s tab">${name}</a>` : name} <span class="hint">${m.displayName ? `${escapeHtml(m.name)} ` : ''}v${escapeHtml(m.version)}${m.author ? ' by ' + escapeHtml(m.author) : ''}</span></h2>
        <div class="hint">${escapeHtml(scopes)}</div></div>
      ${modeTag} ${control}
    </div>`;
  const about = `${m.description ? `<p>${escapeHtml(m.description)}</p>` : ''}${m.hooks?.ai === 'optional' ? '<p class="hint">Can use the <a href="#modules/ai">AI service</a>.</p>' : ''}`;
  const approvals = `
    <p class="hint">${asks.length ? (m.needsApproval ? 'Asks for these -- enabling approves them:' : 'Approved to:') : 'Asks for nothing beyond showing itself.'}</p>
    ${asks.length ? `<ul class="module-asks">${asks.join('')}</ul>` : ''}
    <div class="module-runmode">
      <p class="hint"><strong>${m.runMode === 'page' ? 'Runs in the page' : 'Runs sandboxed'}</strong>${m.source === 'bundled' ? ', ships with this server' : ', uploaded'}. ${m.runMode === 'page' ? `It can read and change anything on the page, including what you can see and do. Only allow that for ${escapeHtml(word('module', { a: true }))} you trust.` : `It is walled off in its own frame and can only reach the host through its approved permissions. ${escapeHtml(word('module', { a: true, cap: true }))} in a frame cannot take part in drag and drop between ${escapeHtml(word('module', { many: true }))}.`}</p>
      ${m.source === 'bundled' || m.outdated || hostOnlyHidden() ? '' : `<button class="btn" data-module-runmode="${m.runMode === 'page' ? 'sandbox' : 'page'}" type="button">${m.runMode === 'page' ? 'Switch back to sandboxed' : 'Run in the page...'}</button>`}
    </div>`;
  const actions = `
    <div class="row">
      ${m.scope.includes('space') && !m.outdated && m.lobby === false ? `<span class="hint">${escapeHtml(notInLobby())}</span>` : ''}
      ${!m.outdated && !m.enabled && m.missing?.length ? `<span class="hint">Needs ${m.missing.map(needsText).join(', and ')} first.</span>` : ''}
      ${!m.outdated && m.needsUpdate?.length ? `<span class="hint">Needs ${m.needsUpdate.map(nameOf).join(' and ')}, which ${m.needsUpdate.length === 1 ? 'needs' : 'need'} an update from ${m.needsUpdate.length === 1 ? 'its author' : 'their authors'}.</span>` : ''}
      ${several ? `<select data-module-version aria-label="Version">${m.versions.map((v) => `<option value="${escapeHtml(v)}"${v === m.version ? ' selected' : ''}${staleVersions.has(v) && v !== m.version ? ' disabled' : ''}>${escapeHtml(v)}${v === m.version ? ' (current)' : ''}${staleVersions.has(v) ? ' (needs an update)' : ''}</option>`).join('')}</select><button class="btn" data-module-action="rollback" type="button" disabled>Switch to this version</button>` : ''}
      <button class="btn btn-danger" data-module-action="uninstall" type="button">Uninstall</button>
    </div>`;
  const el = document.createElement('article');
  el.className = 'panel module-card';
  el.dataset.id = m.id;
  if (shape === 'more') {
    el.innerHTML = `<h2>Permissions and versions</h2>${approvals}${actions}`;
    return el;
  }
  el.innerHTML = shape === 'row' ? `${head}${about}`
    : shape === 'tab' ? `${head}${about}${shownAsLink(m)}<p class="status" id="module-tab-status" role="status"></p>`
      : `${head}${about}${shownAsLink(m)}${approvals}${actions}`;
  // Built for an older version of the product (its module.json uses a name that has since changed): it can't be turned on until its author
  // updates it. Say so plainly, and what exactly, and offer no switch; Update, another version and Uninstall still work.
  if (m.outdated) {
    const why = document.createElement('div');
    why.className = 'module-outdated';
    why.setAttribute('role', 'note');
    why.innerHTML = `<i class="fa-solid fa-triangle-exclamation fa-fw" aria-hidden="true"></i> <div><strong>${escapeHtml(m.outdated)}</strong>${m.outdatedWhy ? `<div class="hint">${escapeHtml(m.outdatedWhy)}</div>` : ''}</div>`;
    el.querySelector('.module-head').after(why);
  }
  // A newer version ships with this server: offer it, no zip to upload.
  const newer = bundledModules.find((b) => b.id === m.id && b.update);
  if (newer) {
    const note = document.createElement('div');
    note.className = 'module-update';
    note.innerHTML = `<span class="sdk-status" data-tone="warn">Update available</span> <strong>Version ${escapeHtml(newer.version)}</strong> comes with this server. <button class="btn btn-primary btn-small" data-bundled-action="install" data-bundled-id="${escapeHtml(newer.id)}" type="button">Update to ${escapeHtml(newer.version)}</button> <span class="hint">Your data stays as it is, and you can switch back${shape === 'full' ? ' below' : ` on its tab`}. If it asks for anything new you approve it first.</span>`;
    (el.querySelector('.module-outdated') || el.querySelector('.module-head')).after(note);
  }
  return el;
}

// A built-in module's card (the conference, chat): not removable; the conference has a switch, chat is always on. On
// the Configuration tab (`link`) the name of one with a tab opens it. With no call service the server marks the
// conference `unavailable` (the sentence to show): its switch is off and can't be turned on, and the card says why once.
function builtinCard(b, { link = false } = {}) {
  const el = document.createElement('article');
  el.className = 'panel module-card';
  el.dataset.builtin = b.id;
  const name = escapeHtml(shownName(b));
  const control = b.switchable ? enabledSwitch({ id: b.id, attr: 'data-builtin-toggle', name: shownName(b), on: b.enabled && !b.unavailable, disabled: Boolean(b.unavailable) }) : '<span class="sdk-status" data-tone="ok">Always on</span>';
  el.innerHTML = `
    <div class="module-head">
      <i class="fa-solid fa-${escapeHtml(shownIcon(b))} fa-fw module-icon" aria-hidden="true"></i>
      <div class="grow"><h2>${link && builtinHasTab(b) ? `<a href="#modules/${escapeHtml(encodeURIComponent(b.id))}" title="Open ${name}'s tab">${name}</a>` : name} <span class="hint">${b.displayName ? `${escapeHtml(b.name)}, ` : ''}built in</span></h2>
        <div class="hint">On ${escapeHtml(word('space', { a: true }))}'s ${escapeHtml(word('canvas'))}</div></div>
      ${control}
    </div>
    <p>${escapeHtml(b.description)}</p>
    ${b.unavailable ? `<p><span class="sdk-status" data-tone="warn">${escapeHtml(b.unavailable)}</span></p>` : ''}
    ${shownAsLink(b)}
    <p class="hint">It comes with the server and can't be removed. Its permissions are on the Roles tab: ${escapeHtml(b.permissions)}.${b.switchable && b.needs && !b.unavailable ? ` ${escapeHtml(b.needs)}` : ''}</p>`;
  return el;
}

// What this environment calls a module and the icon it wears (plan-environment-templates.md, "Module display names and
// icons"), on each card, built-in modules too: a name (blank for the module's own), an icon from the same list as the
// home icon, Save, and Reset back to the module's own. The server checks both and says why it refused one; a refused
// save changes nothing. Its own name and version stay beside the display name in the card's heading.
// The icons offered: this environment's (Template tab) that draw as a plain solid Font Awesome icon, as every module icon
// does, then every module's own icon.
function displayIconChoices() {
  const out = new Map();
  for (const i of getIcons()) {
    const tokens = String(i.classes || '').split(/\s+/).filter((t) => t && !/^fa-(fw|lg|xs|sm|2x|3x)$/.test(t));
    if (tokens.length === 2 && tokens.includes('fa-solid') && tokens.includes(`fa-${i.id}`)) out.set(i.id, i.label || i.id.replace(/-/g, ' '));
  }
  for (const m of [...builtinModules, ...installedModules]) if (m.icon && !out.has(m.icon)) out.set(m.icon, m.icon.replace(/-/g, ' '));
  return [...out];
}
// What the template gives a module (`templateDisplayName`, `templateDisplayIcon`): { name, icon }, each null for none.
const templateDisplay = (m) => ({ name: m.templateDisplayName || null, icon: m.templateDisplayIcon || null });
function displayEditor(m) {
  // What a blank field and "its own icon" mean: the template's name and icon where it gives them, else the module's own.
  const t = templateDisplay(m);
  const fallbackName = m.ownDisplayName ? t.name || m.name : shownName(m);
  const fallbackIcon = m.ownDisplayIcon ? t.icon || m.icon : shownIcon(m);
  const chosen = m.ownDisplayIcon || '';
  const own = Boolean(m.ownDisplayName || m.ownDisplayIcon);
  const fromT = Boolean(t.name || t.icon);
  const back = fromT ? "Back to the template's name and icon" : 'Back to its own name and icon';
  const note = !fromT ? '' : own ? (t.name ? `The template's: ${t.name}` : '') : 'From the template';
  const firstIcon = t.icon ? "The template's icon" : 'Its own icon';
  const iconButton = (id, label, pressed) => `<button type="button" data-display-icon="${escapeHtml(id)}" data-tip="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" aria-pressed="${pressed}"${pressed ? ' class="selected"' : ''}><i class="fa-solid fa-${escapeHtml(id || fallbackIcon)} fa-fw" aria-hidden="true"></i></button>`;
  return `<div class="module-display" data-display-id="${escapeHtml(m.id)}" data-display-chosen="${escapeHtml(chosen)}" data-display-fallback="${escapeHtml(fallbackIcon)}" data-display-was-name="${escapeHtml(m.ownDisplayName || '')}" data-display-was-icon="${escapeHtml(chosen)}"${own ? ' data-display-own="1"' : ''} role="group" aria-label="What this ${escapeHtml(word('environment'))} calls it">
      <div class="module-display-head"><span class="field-label">Shown as</span>${note ? `<span class="from-template">${escapeHtml(note)}</span>` : ''}</div>
      <div class="module-display-row">
        <details class="icon-pick"><summary title="Icon" aria-label="Icon: ${escapeHtml(chosen || (t.icon ? "the template's" : 'its own'))}"><i class="fa-solid fa-${escapeHtml(chosen || fallbackIcon)} fa-fw" aria-hidden="true"></i></summary><div class="icon-grid" role="group" aria-label="Icon">${iconButton('', firstIcon, !chosen)}${displayIconChoices().map(([id, label]) => iconButton(id, label, id === chosen)).join('')}</div></details>
        <input type="text" data-display-name maxlength="40" autocomplete="off" spellcheck="false" value="${escapeHtml(m.ownDisplayName || '')}" placeholder="${escapeHtml(fallbackName)}" aria-label="Display name (blank for ${escapeHtml(fallbackName)})">
        <button class="btn btn-small" type="button" data-display-save>Save</button>
        <button class="btn btn-small" type="button" data-display-reset ${own ? '' : 'disabled'} title="${escapeHtml(back)}" data-display-back="${escapeHtml(back)}">Reset</button>
      </div>
      <span class="status" data-display-status aria-live="polite"></span>
    </div>`;
}
// The Lobby's own name here ("Home base" under the travel template), and the hint beside Enable for a module
// not made for it (plan-modules, "the Lobby is for being together": the server keeps it out of the Lobby).
const lobbyName = () => spaces.find((sp) => sp.isLobby)?.name || 'the Lobby';
const notInLobby = () => `(not in ${lobbyName()})`;
// On a Modules card: the name and icon it is shown as, and a link to its row on the Template tab, where they change.
function shownAsLink(m) {
  return `<div class="module-shown-as"><span class="field-label">Shown as</span> <span><i class="fa-solid fa-${escapeHtml(shownIcon(m))} fa-fw" aria-hidden="true"></i> ${escapeHtml(shownName(m))}</span> <a href="#template-module-${escapeHtml(m.id)}" aria-label="Change the name and icon of ${escapeHtml(shownName(m))}">Change</a></div>`;
}
// The Template tab's list (addendum 2): every module, built-in ones first, with its own name and version beside the
// editor. Each row's id is what the Modules cards link to.
function renderModuleNames() {
  const list = $('module-names');
  const row = (m, about) => `<div class="module-name-row" id="template-module-${escapeHtml(m.id)}"><div class="module-name-head"><i class="fa-solid fa-${escapeHtml(shownIcon(m))} fa-fw module-icon" aria-hidden="true"></i> <strong>${escapeHtml(shownName(m))}</strong> <span class="hint">${escapeHtml(about)}</span></div>${displayEditor(m)}</div>`;
  list.innerHTML = [
    ...builtinModules.map((b) => row(b, `${b.name}, built in`)),
    ...installedModules.map((m) => row(m, `${m.name} v${m.version}`)),
  ].join('');
}
const displayBox = (id) => $('module-names').querySelector(`.module-display[data-display-id="${CSS.escape(id)}"]`);
async function saveDisplay(box, patch, done) {
  const id = box.dataset.displayId;
  for (const b of box.querySelectorAll('button')) b.disabled = true;
  try {
    const { module } = await api('PATCH', `/api/modules/${encodeURIComponent(id)}`, patch);
    await loadModules();
    loadRoles().catch(() => {}); // the Roles grid's group is named by it
    const again = displayBox(id);
    if (again) {
      say(again.querySelector('[data-display-status]'), done(module));
      again.querySelector('[data-display-name]').focus();
    }
  } catch (err) {
    for (const b of box.querySelectorAll('button')) b.disabled = false;
    box.querySelector('[data-display-reset]').disabled = !box.dataset.displayOwn; // as it was: only a saved one resets
    say(box.querySelector('[data-display-status]'), err.message, true); // the server's own sentence; nothing was changed
  }
}
function closeIconPicks(except) {
  for (const d of $('module-names').querySelectorAll('.module-display details[open]')) if (d !== except) d.open = false;
}
$('module-names').addEventListener('click', (event) => {
  const box = event.target.closest('.module-display');
  if (!box) { closeIconPicks(); return; }
  const choice = event.target.closest('[data-display-icon]');
  if (choice) {
    // Picked, not saved yet: Save sends it with the name.
    box.dataset.displayChosen = choice.dataset.displayIcon;
    for (const b of box.querySelectorAll('[data-display-icon]')) {
      const on = b === choice;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const summary = box.querySelector('summary');
    summary.querySelector('i').className = `fa-solid fa-${choice.dataset.displayIcon || box.dataset.displayFallback} fa-fw`;
    summary.setAttribute('aria-label', `Icon: ${choice.dataset.displayIcon || choice.getAttribute('aria-label').replace(/ icon$/, '').toLowerCase()}`);
    box.querySelector('details').open = false;
    summary.focus();
    return;
  }
  if (event.target.closest('summary')) { closeIconPicks(box.querySelector('details')); return; }
  if (event.target.closest('[data-display-save]')) {
    // Only what the owner changed here, so a stored choice this page can't show (an icon it doesn't offer) is kept.
    const name = box.querySelector('[data-display-name]').value.trim().replace(/\s+/g, ' ');
    const patch = {};
    if (name !== box.dataset.displayWasName) patch.displayName = name || null;
    if (box.dataset.displayChosen !== box.dataset.displayWasIcon) patch.displayIcon = box.dataset.displayChosen || null;
    if (!Object.keys(patch).length) { say(box.querySelector('[data-display-status]'), 'Nothing to save'); return; }
    saveDisplay(box, patch, (m) => `Saved. Shown as ${shownName(m)}`);
    return;
  }
  if (event.target.closest('[data-display-reset]')) {
    const back = event.target.closest('[data-display-reset]').dataset.displayBack || 'Back to its own name and icon';
    saveDisplay(box, { displayName: null, displayIcon: null }, () => back);
  }
});
$('module-names').addEventListener('keydown', (event) => {
  const box = event.target.closest('.module-display');
  if (!box) return;
  if (event.key === 'Enter' && event.target.matches('[data-display-name]')) {
    event.preventDefault();
    box.querySelector('[data-display-save]').click();
  } else if (event.key === 'Escape' && box.querySelector('details[open]')) {
    event.preventDefault();
    box.querySelector('details').open = false;
    box.querySelector('summary').focus();
  }
});
document.addEventListener('click', (event) => { if (!event.target.closest('#module-names')) closeIconPicks(); });

// Recent activity, in the box at the top of the tab: one row per thing a module did (when, which module, what, by whom), newest
// first. Redrawn in place when it changes, keeping the scroll position, and refreshed while the tab is open.
const activityWhen = (at) => {
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return time;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};
// Something the server refused or slowed shows as a warning (no colour alone: a small icon too).
const activityLevel = (what) => (/slowed|too many|over the limit|refused|denied|failed|error/i.test(what || '') ? 'warn' : 'info');
let activityKey = '';
async function loadActivity() {
  const list = $('module-activity');
  if (!list) return;
  let items = [];
  try {
    items = (await api('GET', '/api/modules/activity')).activity || [];
  } catch {
    $('module-activity-empty').textContent = 'Recent activity is unavailable.';
    $('module-activity-empty').hidden = false;
    return;
  }
  const key = items.length + ':' + (items[0] ? items[0].at : '');
  if (key === activityKey) return;
  activityKey = key;
  const box = $('activity-box');
  const top = box.scrollTop;
  list.replaceChildren(...items.map((a) => {
    const li = document.createElement('li');
    li.className = 'activity-row';
    li.dataset.level = activityLevel(a.what);
    li.innerHTML = `<span class="activity-time" title="${escapeHtml(new Date(a.at).toLocaleString())}">${escapeHtml(activityWhen(a.at))}</span><span class="activity-source">${escapeHtml(a.moduleName)}</span><span class="activity-event">${li.dataset.level === 'warn' ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' : ''}${escapeHtml(a.what)}${a.byName ? ` <span class="hint">by ${escapeHtml(a.byName)}</span>` : ''}</span>`;
    return li;
  }));
  $('module-activity-empty').textContent = 'No activity yet.';
  $('module-activity-empty').hidden = items.length > 0;
  box.scrollTop = top;
}
setInterval(() => { if (!document.hidden && !$('tab-modules').hidden) loadActivity(); }, 15000);

// The AI service: server-wide (the one service, model and key the Assistant, Chat's AI and Research share), not one
// module's setting. Like a module it has an entry on the Configuration tab with its switch, and a tab of its own
// (#modules/ai): the same entry, then its setup (/ai-form.js). The tab is always there, since the service is set up
// there before it can be turned on.
const AI_NAMES = { openai: 'OpenAI', anthropic: 'Anthropic', compatible: 'Other (OpenAI-compatible)' };
let aiCard = { saved: false, on: false, provider: 'none', model: '', usage: {}, dependents: [] };
// Whether there is anything to show at all (false only when its API call fails, e.g. not an admin): no entry, no tab.
let aiAvailable = false;
async function loadAi() {
  try {
    const { ai, usage, dependents } = await api('GET', '/api/ai');
    // The service in use: the host's managed one or this environment's own (ai.provider is only the latter).
    const custom = ai.source !== 'managed';
    const provider = custom && ai.provider === 'openai' && ai.address && !/api\.openai\.com/.test(ai.address) ? 'compatible' : ai.active.provider;
    const saved = provider !== 'none';
    aiCard = { saved, on: saved && ai.enabled !== false, provider, model: ai.active.model, usage: usage || {}, dependents: dependents || [] };
    aiAvailable = true;
  } catch {
    aiAvailable = false;
  }
}
function aiSummary() {
  if (!aiCard.saved) return 'Not set up.';
  if (!aiCard.on) return 'Set up, and switched off.';
  const used = aiCard.usage;
  return `${AI_NAMES[aiCard.provider] || aiCard.provider}, ${aiCard.model || 'no model chosen'}. ${Number(used.tokens || 0).toLocaleString()} tokens this month${used.monthlyTokens ? ` of ${used.monthlyTokens.toLocaleString()}` : ''}.`;
}
// Its entry: on the Configuration tab (`link`) its name opens its tab.
function aiEntry({ link = false } = {}) {
  const el = document.createElement('article');
  el.className = 'panel module-card';
  el.dataset.ai = '';
  const setUp = link ? '<a href="#modules/ai">Set it up on its tab</a> first.' : 'Set it up below first.';
  el.innerHTML = `
    <div class="module-head">
      <i class="fa-solid fa-wand-magic-sparkles fa-fw module-icon" aria-hidden="true"></i>
      <div class="grow"><h2>${link ? '<a href="#modules/ai" title="Open the AI service\'s tab">AI service</a>' : 'AI service'} <span class="hint">built in</span></h2>
        <div class="hint">${escapeHtml(aiSummary())}</div></div>
      ${enabledSwitch({ id: 'ai', attr: 'data-ai-toggle', name: 'AI service', on: aiCard.on, disabled: !aiCard.saved })}
    </div>
    <p class="hint">Lets ${escapeHtml(word('module', { many: true }))} that ask for it summarise and answer questions about the ${escapeHtml(word('object', { many: true }))} a person selects, with one service, model and key for all of them.${aiCard.saved ? '' : ` ${setUp}`}</p>`;
  return el;
}
// Its setup, loaded the first time its tab opens; a save draws the entry again (a service set up can be turned on).
const aiForm = mountAiForm({ get: '/api/ai', put: '/api/ai', models: '/api/ai/models', source: true, cap: true, usage: true, onSave: () => loadModules() });
let aiFormLoaded = false;
// What AI may see, and this month's use, on the same tab (the owner's; ai-sees.js, ai-use.js).
const aiSees = mountSees($('ai-sees-box'), { word, idPrefix: 'ai-sees' });
async function loadAiSees() {
  try {
    const { ai } = await api('GET', '/api/ai');
    aiSees.setModules(installedModules.filter((m) => m.enabled));
    aiSees.set(ai.sees);
  } catch { $('ai-sees-block').hidden = true; }
}
$('ai-sees-save').addEventListener('click', async () => {
  const problem = aiSees.problem();
  if (problem) { say($('ai-sees-status'), problem, true); return; }
  say($('ai-sees-status'), 'saving...');
  try { await api('PUT', '/api/ai', { sees: aiSees.get() }); await loadAiSees(); say($('ai-sees-status'), 'saved'); } catch (err) { say($('ai-sees-status'), err.message, true); }
});
$('ai-sees-reset').addEventListener('click', async () => {
  say($('ai-sees-status'), 'saving...');
  try { await api('PUT', '/api/ai', { sees: null }); await loadAiSees(); say($('ai-sees-status'), 'back to the usual'); } catch (err) { say($('ai-sees-status'), err.message, true); }
});
async function loadAiUse() {
  try { drawAiUse($('ai-use-box'), await api('GET', '/api/ai/usage'), { people: users, spaces }); } catch (err) { $('ai-use-box').innerHTML = `<p class="hint">${escapeHtml(err.message || 'The use could not be loaded.')}</p>`; }
}
// Turned on and off with its switch (#264), like every module.
$('tab-modules').addEventListener('change', async (event) => {
  const input = event.target.closest('[data-ai-toggle]');
  if (!input) return;
  const name = AI_NAMES[aiCard.provider] || 'the service';
  let force = false;
  if (aiCard.on) {
    let ask = { title: 'Disable AI for everyone?', message: `${word('module', { many: true, cap: true })} that use it are told AI is not available. Your setup is kept.`, action: 'Disable', kind: 'destructive' };
    if (aiCard.dependents?.length) {
      const names = aiCard.dependents.map((d) => d.name).join(' and ');
      ask = { title: `${names} need${aiCard.dependents.length === 1 ? 's' : ''} the AI service. Turn ${aiCard.dependents.length === 1 ? 'it' : 'them'} off too?`, action: 'Turn off', kind: 'destructive' };
      force = true;
    }
    if (!await confirmDialog(ask)) { input.checked = true; return; }
  } else if (!await confirmDialog({ title: 'Enable AI?', message: `${word('module', { many: true, cap: true })} that use it can send what a person selects, and their question, to ${name} under your account. Only people whose role allows it (Roles tab) can use it.`, action: 'Enable' })) { input.checked = false; return; }
  input.disabled = true;
  const status = () => (modulePart === 'ai' ? $('ai-status') : $('modules-status'));
  try {
    const wasOn = aiCard.on;
    await api('PUT', '/api/ai', { enabled: !wasOn, ...(force ? { force: true } : {}) });
    await loadModules(); // the list (a forced cascade may have turned some off) and the entry
    say(status(), wasOn ? 'AI disabled' : 'AI enabled');
  } catch (err) {
    input.checked = aiCard.on;
    input.disabled = false;
    say(status(), err.message, true);
  }
});

// Which modules the Configuration tab lists: all of them, those with an update waiting, those with settings, or those
// that could be turned on (#264: installed and off, and the ones that ship with this server and are not installed yet).
let moduleFilter = 'all';
const hasUpdate = (id) => bundledModules.some((b) => b.id === id && b.update);
// A module can be configured when it has settings the admin chooses for the server (what its tab's Settings shows).
// A module has a configuration when it has environment settings, takes part in calendar sharing (GET /api/modules'
// `sharing`), or its page is a top bar destination's main part (Show in the top bar): plan-space-calendars.md, section 4.
const isDestinationMain = (m) => (m.surfaces?.destination || []).some((p) => p && p.part === 'main');
const isConfigurable = (m) => !m.outdated && !m.needsUpdate?.length && ((m.settings || []).some((d) => d.scope === 'environment') || m.sharing === true || isDestinationMain(m));
const canTurnOn = (m) => !m.enabled && !m.outdated;
const moduleMatches = (m) => moduleFilter === 'updates' ? hasUpdate(m.id) : moduleFilter === 'configurable' ? isConfigurable(m) : moduleFilter === 'available' ? canTurnOn(m) : true;
// The built-in modules each filter shows: every one under All; Conference under Configurable while it has its tab, and
// under Available while it is off.
// The AI service's entry under each filter: All and Configurable (it has its tab); Available while set up and off.
const aiShownFor = (filter) => filter === 'all' || filter === 'configurable' || (filter === 'available' && aiCard.saved && !aiCard.on);
const builtinsFor = (filter) => filter === 'all' ? builtinModules : filter === 'configurable' ? builtinModules.filter(builtinHasTab) : filter === 'available' ? builtinModules.filter((b) => b.switchable && !b.enabled && !b.unavailable) : [];
function syncModuleFilters() {
  const updates = installedModules.filter((m) => hasUpdate(m.id)).length;
  for (const b of document.querySelectorAll('[data-module-filter]')) {
    const on = b.dataset.moduleFilter === moduleFilter;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  const all = $('module-filters').querySelector('[data-count="all"]');
  const up = $('module-filters').querySelector('[data-count="updates"]');
  const ai = (filter) => (aiAvailable && aiShownFor(filter) ? 1 : 0);
  all.textContent = String(builtinModules.length + ai('all') + installedModules.length);
  up.textContent = String(updates);
  up.hidden = !updates;
  greenCount(up, updates, `${updates} ${updates === 1 ? 'update' : 'updates'} available`);
  const conf = $('module-filters').querySelector('[data-count="configurable"]');
  conf.textContent = String(installedModules.filter(isConfigurable).length + builtinsFor('configurable').length + ai('configurable'));
  const avail = $('module-filters').querySelector('[data-count="available"]');
  const availableNow = bundledModules.filter((b) => !b.installed).length + installedModules.filter(canTurnOn).length + builtinsFor('available').length + ai('available');
  avail.textContent = String(availableNow);
  greenCount(avail, availableNow, `${availableNow} available`);
}
// A count above zero is a green pill with a spoken name; at zero it is the neutral grey one.
function greenCount(el, n, label) {
  if (n > 0) el.dataset.tone = 'ok'; else delete el.dataset.tone;
  if (n > 0) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); } else { el.removeAttribute('role'); el.removeAttribute('aria-label'); }
}
$('module-filters').addEventListener('click', (event) => {
  const b = event.target.closest('[data-module-filter]');
  if (!b || b.dataset.moduleFilter === moduleFilter) return;
  moduleFilter = b.dataset.moduleFilter;
  renderModules();
});

function renderModules() {
  const list = $('modules-list');
  list.textContent = '';
  syncModuleFilters();
  // The AI service's entry: not a versioned module, so never under Updates; it has its tab, so it is under Configurable.
  const aiRow = $('ai-row');
  aiRow.hidden = !aiAvailable || !aiShownFor(moduleFilter);
  aiRow.replaceChildren(...(aiRow.hidden ? [] : [aiEntry({ link: true })]));
  // The built-in modules first: not removable; Conference can be turned off, Chat is always on.
  const builtins = builtinsFor(moduleFilter);
  for (const b of builtins) list.appendChild(builtinCard(b, { link: true }));
  // Installed modules: one that is on is a short card whose name opens its tab; one that is off (it has no tab) shows
  // everything, so what it asks for is read before it is turned on.
  const shown = installedModules.filter(moduleMatches);
  if (moduleFilter !== 'available' && !shown.length) {
    const none = document.createElement('div');
    none.className = 'panel';
    none.innerHTML = moduleFilter === 'updates' ? '<p class="hint">Everything is up to date.</p>' : moduleFilter === 'configurable' ? `<p class="hint">No installed ${escapeHtml(word('module'))} has settings.</p>` : `<p class="hint">No other ${escapeHtml(word('module', { many: true }))} installed yet.</p>`;
    list.appendChild(none);
  }
  for (const m of shown) list.appendChild(moduleCard(m, moduleHasTab(m) ? 'row' : 'full'));
  // Modules that ship with this server and are not installed yet: shown under All and under Available.
  const available = moduleFilter === 'all' || moduleFilter === 'available' ? bundledModules.filter((b) => !b.installed) : [];
  if (available.length) {
    const box = document.createElement('div');
    box.className = 'panel';
    box.innerHTML = `<h2>Available with this server</h2><p class="hint">These come with the server, so there is nothing to upload.</p>${available.map((b) => `
      <div class="row module-available">
        <i class="fa-solid fa-${escapeHtml(shownIcon(b))} fa-fw module-icon" aria-hidden="true"></i>
        <div class="grow"><strong>${escapeHtml(shownName(b))}</strong> <span class="hint">${b.displayName ? `${escapeHtml(b.name)} ` : ''}v${escapeHtml(b.version)}</span><div class="hint">${escapeHtml(b.description || '')}</div>${b.notInPlan ? '<div class="hint module-needs"><i class="fa-solid fa-circle-info fa-fw" aria-hidden="true"></i> Not in your plan.</div>' : bundledNeeds(b)}</div>
        <button class="btn btn-primary" data-bundled-action="install" data-bundled-id="${escapeHtml(b.id)}" type="button" ${b.notInPlan ? `disabled title="Your plan does not include this ${escapeHtml(word('module'))}"` : ''}>Install</button>
      </div>`).join('')}`;
    list.appendChild(box);
  } else if (moduleFilter === 'available' && !shown.length && !builtins.length && $('ai-row').hidden) {
    const none = document.createElement('div');
    none.className = 'panel';
    none.innerHTML = '<p class="hint">Nothing new to install or turn on right now.</p>';
    list.appendChild(none);
  }
}

// What happened, said on the Configuration tab and on the module's tab while it is shown.
function sayModules(text, error = false) {
  say($('modules-status'), text, error);
  const here = $('module-tab-status');
  if (here && !$('module-part-module').hidden) say(here, text, error);
}

// A built-in module's switch (the conference): it goes through the same enable step as a module.
$('tab-modules').addEventListener('change', async (event) => {
  const input = event.target.closest('[data-builtin-toggle]');
  if (!input) return;
  const b = builtinModules.find((x) => x.id === input.dataset.builtinToggle);
  if (!b) return;
  const enable = input.checked;
  if (!enable && !await confirmDialog({ title: `Turn off ${shownName(b)} for everyone?`, message: b.turnOff || `It stops working in every ${word('space')} until you enable it again.`, action: 'Turn off', kind: 'destructive' })) { input.checked = true; return; }
  if (enable && !await confirmDialog({ title: `Enable ${shownName(b)}?`, message: b.turnOn || b.description, action: 'Enable' })) { input.checked = false; return; }
  input.disabled = true;
  try {
    await api('PATCH', '/api/settings', { [b.setting || `${b.id}Enabled`]: enable });
    await loadModules();
    say($('modules-status'), `${shownName(b)} ${enable ? 'enabled' : 'disabled'}`);
  } catch (err) {
    input.checked = !enable;
    input.disabled = false;
    say($('modules-status'), err.message, true);
  }
});

// An installed module's switch (#264): on approves what it asks for (said first when it waits for approval); off asks
// first when other modules need it, and turns them off too.
$('tab-modules').addEventListener('change', async (event) => {
  const input = event.target.closest('[data-module-enabled]');
  if (!input) return;
  const m = installedModules.find((x) => x.id === input.dataset.moduleEnabled);
  if (!m) return;
  const enable = input.checked;
  let force = false;
  if (!enable && m.dependents?.length) {
    const names = m.dependents.map(shownNameOf).join(' and ');
    if (!await confirmDialog({ title: `${names} needs ${shownName(m)}. Turn ${m.dependents.length === 1 ? 'it' : 'them'} off too?`, action: 'Turn off', kind: 'destructive' })) { input.checked = true; return; }
    force = true;
  }
  if (enable && m.needsApproval && !await confirmDialog({ title: `Turn on ${shownName(m)}?`, message: 'This approves what it asks for, listed under its name.', action: 'Turn on' })) { input.checked = false; return; }
  input.disabled = true;
  try {
    await api('PATCH', `/api/modules/${m.id}`, { enabled: enable, ...(force ? { force: true } : {}) });
    await loadModules();
    await loadRoles(); // a module's permissions join the Roles grid when it is on
    sayModules(`${shownName(m)} ${enable ? 'enabled' : 'disabled'}`);
  } catch (err) {
    input.checked = !enable;
    input.disabled = false;
    sayModules(err.message, true);
  }
});

// Install or update a module that ships with this server, by building it here.
$('tab-modules').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-bundled-action]');
  if (!button) return;
  button.disabled = true;
  sayModules('installing...');
  try {
    const { module } = await api('POST', `/api/modules/bundled/${encodeURIComponent(button.dataset.bundledId)}/install`);
    await loadModules();
    await loadRoles();
    sayModules(`${shownName(module)} ${module.version} installed${module.enabled ? '' : ' -- review it below, then turn it on'}`);
  } catch (err) {
    sayModules(err.message, true);
    button.disabled = false;
  }
});

$('module-install').addEventListener('click', async () => {
  const file = $('module-file').files[0];
  if (!file) return say($('modules-status'), 'choose a zip file first', true);
  say($('modules-status'), 'installing...');
  try {
    const { module } = await api('POST', '/api/modules', file, 'application/zip');
    $('module-file').value = '';
    await loadModules();
    await loadRoles(); // a module's permissions join the Roles grid when it is on
    say($('modules-status'), `${shownName(module)} ${module.version} installed${module.enabled ? '' : ' -- review it below, then turn it on'}`);
  } catch (err) {
    say($('modules-status'), err.message, true);
  }
});

$('tab-modules').addEventListener('click', async (event) => {
  const mode = event.target.closest('[data-module-runmode]');
  if (!mode) return;
  const m = installedModules.find((x) => x.id === mode.closest('.module-card').dataset.id);
  const to = mode.dataset.moduleRunmode;
  try {
    if (to === 'page' && !await confirmDialog({ title: `Run ${shownName(m)} in the page?`, message: `${word('module', { a: true, cap: true })} in the page is not walled off. It can read and change everything on the page, act as you, and reach anything you can. the host cannot hold it to its approved permissions.\n\nOnly continue if you trust whoever wrote it.`, action: 'Run in the page', kind: 'destructive' })) return;
    await api('PATCH', `/api/modules/${m.id}`, { runMode: to, acceptRisk: to === 'page' });
    await loadModules();
    sayModules(`${shownName(m)} now runs ${to === 'page' ? 'in the page' : 'sandboxed'}`);
  } catch (err) {
    sayModules(err.message, true);
  }
});

$('tab-modules').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-module-action]');
  if (!button) return;
  const card = button.closest('.module-card');
  const m = installedModules.find((x) => x.id === card.dataset.id);
  try {
    if (button.dataset.moduleAction === 'rollback') {
      const version = card.querySelector('[data-module-version]').value;
      if (version === m.version) return;
      if (!await confirmDialog({ title: `Switch ${shownName(m)} to version ${version}?`, message: 'Its data stays as it is.', action: 'Switch' })) return;
      await api('POST', `/api/modules/${m.id}/rollback`, { version });
    } else if (button.dataset.moduleAction === 'uninstall') {
      if (!await confirmDialog({ title: `Uninstall ${shownName(m)}?`, message: m.dependents?.length ? `${m.dependents.map(shownNameOf).join(' and ')} needs it and will be turned off.` : '', action: 'Uninstall', kind: 'destructive' })) return;
      const wipe = await confirmDialog({ title: `Also delete ${shownName(m)}'s saved data?`, message: `Keep it, and a later reinstall picks up where it left off.\n\nFiles you placed in the ${word('module')}'s own folder (a map file, say) are never deleted.`, action: 'Delete data too', cancel: 'Keep data', kind: 'final' });
      await api('DELETE', `/api/modules/${m.id}?keepData=${wipe ? 0 : 1}`);
    }
    await loadModules();
    await loadRoles(); // a module's permissions join the Roles grid when it is on
    sayModules('');
  } catch (err) {
    sayModules(err.message, true);
  }
});

$('tab-modules').addEventListener('change', async (event) => {
  if (event.target.matches('[data-module-version]')) {
    // Switching is only offered for a version that is not the running one.
    const card = event.target.closest('.module-card');
    const m = installedModules.find((x) => x.id === card.dataset.id);
    card.querySelector('[data-module-action="rollback"]').disabled = event.target.value === m.version;
  }
});

// The Modules tab's row (#264): Configuration, Conference while it is on (its settings are its call features), the AI
// service, then each installed module that is on, by the name it is shown as. Drawn again only when the list changes.
const builtinHasTab = (b) => b.id === 'conference' && b.switchable && b.enabled;
const moduleHasTab = (m) => m.enabled && !m.outdated;
function moduleTabIds() {
  return ['config', ...builtinModules.filter(builtinHasTab).map((b) => b.id), ...(aiAvailable ? ['ai'] : []), ...installedModules.filter(moduleHasTab).map((m) => m.id)];
}
let moduleTabsDrawn = '';
function renderModuleTabs() {
  const strip = $('module-subtabs');
  const named = (m) => [m.id, shownName(m)];
  const want = [...builtinModules.filter(builtinHasTab).map(named), ...(aiAvailable ? [['ai', 'AI service']] : []), ...installedModules.filter(moduleHasTab).map(named)];
  const key = JSON.stringify(want);
  if (key === moduleTabsDrawn) return;
  moduleTabsDrawn = key;
  for (const b of [...strip.querySelectorAll('.subtab')]) if (b.dataset.modulePart !== 'config') b.remove();
  for (const [id, name] of want) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'subtab';
    b.dataset.modulePart = id;
    b.textContent = name;
    strip.append(b);
  }
}

// The tab shown, drawn from the list as it is now: Conference's card, the AI service's, or an installed module's card, its settings and
// the rest. The settings (module-config.html's markup) are drawn again only for another module, version or state, so
// a refresh of the list never drops what someone is typing in them.
let moduleConfigKey = '';
let moduleConfigSeq = 0;
function drawModuleTab() {
  if (modulePart === 'config') return;
  if (modulePart === 'conference') {
    const b = builtinModules.find((x) => x.id === 'conference');
    if (b) $('conference-card').replaceChildren(builtinCard(b));
    return;
  }
  if (modulePart === 'ai') {
    $('ai-tab-card').replaceChildren(aiEntry());
    if (!aiFormLoaded) { aiFormLoaded = true; aiForm.load(); }
    loadAiSees();
    loadAiUse();
    return;
  }
  const m = installedModules.find((x) => x.id === modulePart);
  if (!m) return;
  $('module-tab-card').replaceChildren(moduleCard(m, 'tab'));
  $('module-tab-more').replaceChildren(moduleCard(m, 'more'));
  const key = `${m.id}:${m.version}:${m.enabled}`;
  if (key !== moduleConfigKey) drawModuleSettings(m, key);
}
async function drawModuleSettings(m, key) {
  moduleConfigKey = key;
  const seq = ++moduleConfigSeq;
  const live = () => seq === moduleConfigSeq;
  const box = $('module-tab-settings');
  box.replaceChildren(); // the last module's copy leaves first: its ids are the ones the next copy uses
  let section;
  try {
    section = await moduleConfigMarkup();
  } catch (err) {
    if (!live()) return;
    moduleConfigKey = '';
    box.innerHTML = `<div class="panel"><p class="status error">The settings could not be read (${escapeHtml(err.message)}). Reload the page to try again.</p></div>`;
    return;
  }
  if (!live()) return;
  // The card above already names the module and says what it does: the copy keeps only its settings, under a heading.
  section.querySelector('.module-head').hidden = true;
  section.querySelector('#cfg-desc').hidden = true;
  const heading = document.createElement('h2');
  heading.textContent = 'Settings';
  section.prepend(heading);
  box.append(section);
  applyWords(section);
  try {
    await drawModuleConfig(m, { live });
  } catch (err) {
    if (live()) sayModules(err.message, true);
  }
}

// --- Font Awesome icons -----------------------------------------------------
// Paste the HTML Font Awesome gives you; we keep just its classes.
function parseIconClasses(text) {
  const raw = String(text || '');
  const m = raw.match(/class\s*=\s*["']([^"']+)["']/i);
  const tokens = (m ? m[1] : raw).split(/\s+/).filter((t) => /^fa-[a-z0-9-]+$/.test(t));
  const hasStyle = tokens.some((t) => /^fa-(solid|regular|brands|light|thin|duotone|sharp)$/.test(t));
  return tokens.length > (hasStyle ? 1 : 0) ? tokens.join(' ') : '';
}

function iconRow(icon) {
  const row = $('icon-row').content.firstElementChild.cloneNode(true);
  const html = row.querySelector('.icon-html');
  const preview = row.querySelector('.icon-preview');
  row.dataset.id = icon?.id || '';
  row.querySelector('.icon-label').value = icon?.label || '';
  if (icon?.classes) html.value = `<i class="${icon.classes}"></i>`;
  const show = () => {
    const classes = parseIconClasses(html.value);
    preview.textContent = '';
    if (classes) {
      const i = document.createElement('i');
      i.className = classes + ' fa-fw';
      preview.appendChild(i);
    }
    html.classList.toggle('invalid', Boolean(html.value.trim()) && !classes);
  };
  html.addEventListener('input', show);
  show();
  return row;
}

function renderIconRows(icons) {
  const list = $('icons-list');
  list.textContent = '';
  for (const icon of icons || []) list.appendChild(iconRow(icon));
}

$('icons-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const row = button.closest('.icon-row');
  if (button.dataset.action === 'icon-remove') row.remove();
  else if (button.dataset.action === 'icon-up' && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
  else if (button.dataset.action === 'icon-down' && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
});
$('icon-add').addEventListener('click', () => $('icons-list').appendChild(iconRow()));

$('save-icons').addEventListener('click', async () => {
  const icons = [...$('icons-list').querySelectorAll('.icon-row')]
    .map((row) => ({ id: row.dataset.id, classes: parseIconClasses(row.querySelector('.icon-html').value), label: row.querySelector('.icon-label').value.trim() }))
    .filter((i) => i.classes);
  try {
    const { settings } = await api('PATCH', '/api/settings', { icons });
    renderIconRows(settings.icons);
    await loadBranding();
    buildHomeIconGrid();
    renderHomeIconSelection();
    say($('icons-status'), 'saved');
  } catch (err) {
    say($('icons-status'), err.message, true);
  }
});

// Site images (icon, sign-in background): click the picture to change it,
// Remove to clear it. The icon falls back to the built-in one when unset.
function renderSiteImages(b) {
  for (const slot of document.querySelectorAll('#tab-environment [data-site]')) {
    const name = slot.dataset.site;
    const has = name === 'icon' ? b.hasIcon : b.hasBackground;
    const img = slot.querySelector('img');
    const showImage = has || name === 'icon';
    img.hidden = !showImage;
    if (showImage) img.src = `/img/site/${name}?v=${Date.now()}`;
    else img.removeAttribute('src');
    slot.querySelector('.unset').hidden = showImage;
    slot.classList.toggle('set', has);
    slot.querySelector('[data-action="site-clear"]').hidden = !has;
  }
}

// A site image (the icon, the sign-in background) from a file the person chose or a pre-made one from the library.
async function saveSiteImage(name, file) {
  try {
    await api('PUT', `/api/settings/${name}`, file, file.type);
    renderSiteImages(await loadBranding());
    say($('settings-status'), `${name} saved`);
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
}
$('tab-environment').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'file' || !input.closest('[data-site]')) return;
  const file = input.files[0];
  if (!file) return;
  await saveSiteImage(input.closest('[data-site]').dataset.site, file);
  input.value = '';
});
$('tab-environment').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="site-library"]');
  if (!button) return;
  const file = await pickBackground({ title: 'Choose the sign-in background' });
  if (file) await saveSiteImage(button.closest('[data-site]').dataset.site, file);
});

$('tab-environment').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="site-clear"]');
  if (!button) return;
  const name = button.closest('[data-site]').dataset.site;
  try {
    await api('DELETE', `/api/settings/${name}`);
    renderSiteImages(await loadBranding());
    say($('settings-status'), `${name} removed`);
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
});

// The shared guest Participant picture set, same click-to-change/Clear
// shape as every other image slot in the app.
function renderGuestImages(b) {
  for (const slot of document.querySelectorAll('#guest-images [data-guest-slot]')) {
    const name = slot.dataset.guestSlot;
    const has = !!b.guestImages?.[name];
    const img = slot.querySelector('img');
    img.hidden = !has;
    if (has) img.src = `/img/guest/${name}?v=${Date.now()}`;
    else img.removeAttribute('src');
    slot.querySelector('.unset').hidden = has;
    slot.classList.toggle('set', has);
    slot.querySelector('[data-action="guest-image-clear"]').hidden = !has;
  }
}

$('guest-images').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'file' || !input.closest('[data-guest-slot]')) return;
  const slot = input.closest('[data-guest-slot]').dataset.guestSlot;
  const file = input.files[0];
  if (!file) return;
  try {
    await api('PUT', `/api/settings/guest-images/${slot}`, file, file.type);
    renderGuestImages(await loadBranding());
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
  input.value = '';
});
$('guest-images').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="guest-image-clear"]');
  if (!button) return;
  const slot = button.closest('[data-guest-slot]').dataset.guestSlot;
  try {
    await api('DELETE', `/api/settings/guest-images/${slot}`);
    renderGuestImages(await loadBranding());
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});

// The server-wide Default Images set -- what a member's own Participant
// box falls back to once neither they nor their space has set a picture.
// Same click-to-change/Clear shape as every other image slot in the app.
function renderDefaultImages(b) {
  for (const slot of document.querySelectorAll('#default-images [data-default-slot]')) {
    const name = slot.dataset.defaultSlot;
    const has = !!b.defaultImages?.[name];
    const img = slot.querySelector('img');
    img.hidden = !has;
    if (has) img.src = `/img/default/${name}?v=${Date.now()}`;
    else img.removeAttribute('src');
    slot.querySelector('.unset').hidden = has;
    slot.classList.toggle('set', has);
    slot.querySelector('[data-action="default-image-clear"]').hidden = !has;
  }
}

$('default-images').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'file' || !input.closest('[data-default-slot]')) return;
  const slot = input.closest('[data-default-slot]').dataset.defaultSlot;
  const file = input.files[0];
  if (!file) return;
  try {
    await api('PUT', `/api/settings/default-images/${slot}`, file, file.type);
    renderDefaultImages(await loadBranding());
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
  input.value = '';
});
$('default-images').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="default-image-clear"]');
  if (!button) return;
  const slot = button.closest('[data-default-slot]').dataset.defaultSlot;
  try {
    await api('DELETE', `/api/settings/default-images/${slot}`);
    renderDefaultImages(await loadBranding());
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});

function showStreamKey() {
  $('stream-key').textContent = streamShown ? streamKey : '••••••••';
  $('stream-show').textContent = streamShown ? 'Hide' : 'Show';
}
$('stream-show').addEventListener('click', () => {
  streamShown = !streamShown;
  showStreamKey();
});
$('stream-copy').addEventListener('click', () => copy(streamKey, $('settings-status')));
$('stream-regen').addEventListener('click', async () => {
  if (!await confirmDialog({ title: 'Regenerate the access key?', message: 'Every link made with it and the Studio app need the new one.', action: 'Regenerate', kind: 'destructive' })) return;
  try {
    ({ streamKey } = await api('POST', '/api/stream-key/regenerate'));
    showStreamKey();
    for (const user of users) fill(cardFor(user), user);
    say($('settings-status'), 'new access key');
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
});

// The server's admin lockout bypass is on: say so on Manage until it is turned off (plans/plan-mfa.md, "The server's two switches").
function mfaBypassBanner() {
  if (document.querySelector('.sdk-banner-wide[data-mfa-bypass]')) return;
  const b = document.createElement('div');
  b.className = 'sdk-banner sdk-banner-wide';
  b.dataset.kind = 'warn';
  b.dataset.mfaBypass = '1';
  b.setAttribute('role', 'status');
  b.innerHTML = '<span class="sdk-banner-icon" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></span><span class="sdk-banner-text"></span>';
  b.querySelector('.sdk-banner-text').textContent = `The lockout bypass is on: ${word('owner', { many: true })} and the admin are not asked for their two-step code. Reset your factor on your profile if you need to, then turn ADMIN_MFA_LOCKOUT_BYPASS off on the server.`;
  const topbar = document.querySelector('.topbar');
  if (topbar) topbar.after(b); else document.body.prepend(b);
}

// --- the environment on a hosted server -----------------------------------------------------------------------------
// What only the host does (uploading a module zip, running a module in the page) is not offered to an owner. The host's
// own sign-in (the stand-in) sees everything.
function applyHosted() {
  if (!environment.hosted) return;
  for (const el of document.querySelectorAll('[data-host-only]')) el.hidden = hostOnlyHidden();
}

// --- the Template tab (plan-environment-templates.md, the switching addendum and addendum 2) ------------------------
// The templates it can switch to (GET /api/environment/template's `choices`: [{ id, name, description, source, version }]),
// the open offer after a switch (the same answer's `offer`, or the switch's), and whether "Not now" put it away for now.
let templateChoices = [];
let templateOffer = null;
let offerPutAway = false;
const templateName = (t) => (t && (t.name || t.id)) || '';
// A newer version of the template than the one applied (addendum 2): its offer lists what is new since.
const templateUpdated = (t) => Boolean(t && t.offerOpen && t.appliedAt && t.version && t.appliedVersion && t.version > t.appliedVersion);
const offerNote = (t) => (templateUpdated(t) ? `The ${templateName(t)} template was updated: review what's new.` : `The ${templateName(t)} template can turn on more.`);
async function loadTemplate() {
  try {
    const answer = await api('GET', '/api/environment/template');
    templateChoices = answer.choices || [];
    madeFrom = answer.template || null;
    templateOffer = answer.offer || null;
  } catch (err) {
    // the tab still shows what the settings said
  }
  renderTemplateNote();
}
// The Template tab's own badge while the offer is open: it waits for the owner's Apply, even after "Not now".
function renderTemplateBadge() {
  const tab = $('template-tab');
  const open = Boolean(madeFrom && madeFrom.offerOpen);
  tab.textContent = 'Template';
  tab.title = open ? offerNote(madeFrom) : '';
  if (open) {
    const badge = document.createElement('span');
    badge.className = 'badge update-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = '1';
    tab.append(badge);
  }
}
// The chooser: "No template", then each template this environment can switch to; Switch only once another is chosen.
function renderTemplateSwitch() {
  const select = $('template-select');
  const current = madeFrom ? madeFrom.id : 'none';
  const keep = select.dataset.filled ? select.value : current;
  const options = [new Option('No template', 'none'), ...templateChoices.map((c) => new Option(c.name || c.id, c.id))];
  // The template in use, even one this server no longer offers, so the chooser always says what is in use.
  if (madeFrom && !templateChoices.some((c) => c.id === madeFrom.id)) options.push(new Option(templateName(madeFrom), madeFrom.id));
  select.replaceChildren(...options);
  select.value = options.some((o) => o.value === keep) ? keep : current;
  select.dataset.filled = '1';
  syncTemplateSwitch();
}
function syncTemplateSwitch() {
  const select = $('template-select');
  const current = madeFrom ? madeFrom.id : 'none';
  const other = select.value !== current;
  $('template-switch').disabled = !other;
  $('template-switch').classList.toggle('btn-primary', other);
  const chosen = templateChoices.find((c) => c.id === select.value);
  const about = $('template-choice-about');
  about.textContent = !other ? '' : chosen ? chosen.description || '' : 'The default words and icons.';
  about.hidden = !about.textContent;
}
$('template-select').addEventListener('change', syncTemplateSwitch);
$('template-switch').addEventListener('click', async () => {
  const value = $('template-select').value;
  const chosen = templateChoices.find((c) => c.id === value);
  if (!await confirmDialog(switchConfirm(value === 'none' ? null : chosen ? chosen.name || chosen.id : value))) return;
  const button = $('template-switch');
  button.disabled = true;
  say($('template-status'), 'Switching...');
  try {
    const answer = await api('PATCH', '/api/settings', { template: value });
    templateOffer = answer.offer || null;
    offerPutAway = false;
    useOwnerSettings(answer.settings);
    madeFrom = answer.template || null;
    selectedHomeIcon = madeFrom ? ownHomeIcon : answer.settings.homeIcon || DEFAULT_HOME_ICON;
    renderHomeIconSelection();
    await wordsChanged(); // the words, the module names and icons, and every place that shows them
    renderTemplateNote();
    say($('template-status'), madeFrom ? `Switched to ${templateName(madeFrom)}` : 'Switched to no template');
    const first = $('template-offer').querySelector('input:not(:disabled), button');
    (first && !$('template-offer').hidden ? first : $('template-select')).focus(); // Switch is off again: never lose focus
  } catch (err) {
    say($('template-status'), err.message, true); // the server's own sentence; nothing was changed
    syncTemplateSwitch();
  }
});
// The offer: drawn while it is open and not put away; put away, a line says it waits, with Review to bring it back.
function renderTemplateOffer() {
  const box = $('template-offer');
  const open = Boolean(madeFrom && madeFrom.offerOpen && templateOffer);
  $('template-offer-note').hidden = !(open && offerPutAway);
  $('template-offer-note-text').textContent = open ? offerNote(madeFrom) : '';
  if (!open || offerPutAway) { box.hidden = true; box.replaceChildren(); return; }
  if (box.dataset.drawnFor === madeFrom.id && !box.hidden && box.childElementCount) return; // keep what is ticked
  box.dataset.drawnFor = madeFrom.id;
  renderOffer(box, {
    templateName: templateName(madeFrom),
    offer: templateOffer,
    lobbyName: spaces.find((sp) => sp.isLobby)?.name || '',
    later: () => {
      offerPutAway = true;
      renderTemplateOffer();
      $('template-offer-open').focus();
    },
    apply: async (body) => {
      const answer = await api('POST', '/api/environment/template/apply', body);
      madeFrom = answer.template || null;
      templateOffer = answer.offer || null;
      box.dataset.drawnFor = '';
      await loadModules(); // what was turned on (and renders the note, with what was left out)
      await loadUsers(); // the Lobby's name, if it was taken
      await loadRoles().catch(() => {});
      const skipped = (madeFrom && madeFrom.skipped) || [];
      say($('template-status'), skipped.length ? `Applied. ${skipped.length} left out, listed below` : 'Applied');
      $('template-select').focus();
    },
  });
}
$('template-offer-open').addEventListener('click', () => {
  offerPutAway = false;
  renderTemplateOffer();
  $('template-offer').querySelector('input:not(:disabled), button')?.focus();
});

// The template in use: "Uses the <name> template", its description, the switch and the offer, and what it left out
// that is still left out, each with why and where to put it right. A module turned on since is no longer listed.
const sentence = (text) => { const t = String(text || '').trim(); return t ? capitalOf(t) + (/[.!?]$/.test(t) ? '' : '.') : ''; };
function renderTemplateNote() {
  renderTemplateBadge();
  renderTemplateSwitch();
  renderTemplateOffer();
  renderTemplateFiles();
  $('template-hint').hidden = !madeFrom;
  const about = madeFrom && templateChoices.find((c) => c.id === madeFrom.id)?.description;
  $('template-about').textContent = about || '';
  $('template-about').hidden = !about;
  if (!madeFrom) {
    $('template-made').innerHTML = `<strong>No template.</strong> This ${escapeHtml(word('environment'))} uses the default words and icons.`;
    $('template-skipped').hidden = true;
    return;
  }
  $('template-made').innerHTML = `<strong>Uses the ${escapeHtml(templateName(madeFrom))} template.</strong>${madeFrom.version ? ` <span class="hint">Version ${escapeHtml(String(madeFrom.version))}${templateUpdated(madeFrom) ? `, updated: review what's new` : ''}</span>` : ''}`;
  const modulesTab = '#modules'; // the Modules tab's address
  const modulesLink = `<a href="${modulesTab}">${escapeHtml(word('module', { many: true, cap: true }))}</a>`;
  const item = (icon, title, detail) => `<li><i class="fa-solid fa-${icon} fa-fw" aria-hidden="true"></i><div><strong>${title}</strong>${detail ? `<div class="hint">${detail}</div>` : ''}</div></li>`;
  const items = (madeFrom.skipped || []).map((x) => {
    const installed = installedModules.find((m) => m.id === x.id);
    if (installed && installed.enabled) return ''; // turned on since: nothing left to do
    const name = escapeHtml(x.name || shownNameOf(x.id));
    // Installed and in every space, but off until what it needs is set up.
    if (installed) {
      const missing = (installed.missing || []).map((r) => (r === 'ai' ? '<a href="#modules/ai">the AI service</a>' : escapeHtml(shownNameOf(r))));
      const then = missing.length ? `Once ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} ready, turn it on under ${modulesLink}.` : `Once that is done, turn it on under ${modulesLink}.`;
      return item('circle-pause', `${name}: not on yet`, `${escapeHtml(sentence(x.why))} ${then}`);
    }
    if (x.why === 'not in the plan') {
      const bundled = bundledModules.find((b) => b.id === x.id);
      // The plan may have been widened since: then it was left out when it was made, and can be installed now.
      if (bundled && !bundled.notInPlan) return item('circle-plus', `${name}: can be installed now`, `Your plan includes it now: install it under ${modulesLink}.`);
      return item('lock', `${name}: not in your plan`, `Ask the ${escapeHtml(word('host'))} for a plan that includes it.`);
    }
    return item('circle-minus', `${name}: left out`, escapeHtml(sentence(x.why)));
  }).filter(Boolean);
  const box = $('template-skipped');
  box.hidden = !items.length;
  box.innerHTML = items.length ? `<p class="hint">Left out:</p><ul>${items.join('')}</ul>` : '';
}

// Template files (addendum 2): Export of the template in use (hosted and single alike); a single install also imports
// files (a clashing id asks for a new one) and deletes an imported template it no longer uses.
function renderTemplateFiles() {
  const single = !environment.hosted;
  const exportLink = $('template-export');
  exportLink.hidden = !madeFrom || !madeFrom.source;
  if (madeFrom) {
    exportLink.href = `/api/templates/${encodeURIComponent(madeFrom.id)}/export`;
    exportLink.title = `Download the ${templateName(madeFrom)} template as a file`;
  }
  $('template-import').hidden = !single;
  const imported = single ? templateChoices.filter((c) => c.source === 'imported') : [];
  const list = $('template-imported');
  list.hidden = !imported.length;
  list.innerHTML = imported.map((c) => {
    const inUse = madeFrom && madeFrom.id === c.id;
    return `<li class="sdk-row list-row"><span class="template-file-name"><strong>${escapeHtml(c.name || c.id)}</strong> <span class="hint">Imported, version ${escapeHtml(String(c.version || 1))}${inUse ? ', in use' : ''}</span></span>`
      + `<a class="btn btn-small" href="/api/templates/${encodeURIComponent(c.id)}/export" download>Export</a>`
      + `<button class="btn btn-small btn-danger" type="button" data-template-delete="${escapeHtml(c.id)}"${inUse ? ' disabled title="In use: switch to another template first"' : ''}>Delete</button></li>`;
  }).join('');
  $('template-files').hidden = exportLink.hidden && !single;
}
$('template-import').addEventListener('click', () => $('template-import-file').click());
$('template-import-file').addEventListener('change', async () => {
  const input = $('template-import-file');
  const file = input.files[0];
  input.value = ''; // the same file can be picked again
  if (!file) return;
  const status = $('template-files-status');
  if (file.size > 1024 * 1024) return say(status, `That isn't a ${[productName(), 'template'].filter(Boolean).join(' ')} file.`, true);
  const text = await fileText(file);
  let id = '';
  for (;;) {
    try {
      const { template, dropped } = await api('POST', `/api/templates/import${id ? `?id=${encodeURIComponent(id)}` : ''}`, new Blob([text], { type: 'text/plain' }));
      await loadTemplate();
      const left = Array.isArray(dropped) && dropped.length ? ` Left out: ${dropped.join(', ')}.` : '';
      return say(status, `Imported ${template.name}.${left} Switch to it above to use it.`);
    } catch (err) {
      // A clash: the same file under another id, if the owner gives one.
      if (/^There is already a template called /.test(err.message)) {
        const next = window.prompt(`${err.message} Give this one another id (lowercase letters, digits and dashes):`, id || '');
        if (next && next.trim()) { id = next.trim().toLowerCase(); continue; }
        return say(status, 'Not imported.');
      }
      return say(status, err.message, true);
    }
  }
});
$('template-imported').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-template-delete]');
  if (!b) return;
  const t = templateChoices.find((c) => c.id === b.dataset.templateDelete);
  if (!await confirmDialog({ title: `Delete the ${templateName(t) || b.dataset.templateDelete} template?`, message: 'Its file can be imported again.', action: 'Delete', kind: 'destructive' })) return;
  try {
    await api('DELETE', `/api/templates/${encodeURIComponent(b.dataset.templateDelete)}`);
    await loadTemplate();
    say($('template-files-status'), 'Deleted');
    $('template-import').focus();
  } catch (err) {
    say($('template-files-status'), err.message, true);
  }
});

// The plan and its use (GET /api/environment): each cap as a bar, the past-due banner with its date, the way to a bigger
// plan (the product page's plans), a copy of the environment, and a request to delete it.
let envInfo = null;
const gb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(bytes < 1e10 ? 1 : 0)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
async function loadEnvironment() {
  const card = $('env-panel');
  if (!environment.hosted) { card.hidden = true; return; }
  try {
    envInfo = await api('GET', '/api/environment');
    // The product page's address (Upgrade goes to its plans): the public product facts carry the base domain.
    if (!envInfo.baseDomain || !envInfo.productDomain) {
      const facts = await api('GET', '/api/product').catch(() => ({}));
      if (!envInfo.baseDomain) envInfo.baseDomain = facts.baseDomain || '';
      envInfo.productDomain = facts.productDomain || envInfo.productDomain || '';
    }
  } catch (err) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  renderEnvironment();
}
function renderEnvironment() {
  const e = envInfo;
  const plan = e.plan || {};
  const use = e.usage || {};
  $('env-plan-pill').textContent = plan.name ? `${plan.name} plan` : 'no plan';
  $('env-hint').textContent = `${e.name || environment.name} is at ${environment.slug}: its people, ${word('space', { many: true })}, settings and ${word('module', { many: true })} are its own. What the plan allows, and what is used:`;
  const rows = [
    [word('member', { many: true, cap: true }), use.members ?? 0, plan.members, (n) => `${n}`],
    ['Storage', use.storageBytes ?? 0, plan.storageBytes, gb],
    ['AI calls this month', use.aiCallsThisMonth ?? 0, plan.aiCallsPerMonth, (n) => `${n}`],
    ['Calls at once', use.callsNow ?? 0, plan.calls, (n) => `${n}`],
    [word('module', { many: true, cap: true }), Array.isArray(plan.modules) ? plan.modules.length : null, null, (n) => (n === null ? `every ${word('module')}` : `${n} allowed`), 'modules'],
  ];
  $('env-caps').innerHTML = rows.map(([label, used, cap, fmt, kind]) => {
    const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    const text = kind === 'modules' ? fmt(used) : cap ? `${fmt(used)} of ${fmt(cap)}` : `${fmt(used)}, no cap`;
    return `<dt>${escapeHtml(label)}</dt><dd><span class="env-cap-text">${escapeHtml(text)}</span>${cap ? `<span class="sdk-progress env-cap-bar${pct >= 90 ? ' warn' : ''}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${pct} percent${pct >= 90 ? ', almost full' : ''}"><span class="sdk-progress-fill" style="--pct:${pct}%"></span></span>` : ''}</dd>`;
  }).join('');
  const banner = $('env-banner');
  if (e.status === 'pastDue') {
    const until = e.graceEndsAt ? new Date(e.graceEndsAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : 'soon';
    $('env-banner-text').textContent = `Payment for this ${word('environment')} is overdue. It goes to the free plan on ${until}; nothing is deleted.`;
    banner.hidden = false;
  } else if (e.status === 'suspended') {
    $('env-banner-text').textContent = `This ${word('environment')} is suspended by the ${word('host')}.`;
    banner.hidden = false;
  } else banner.hidden = true;
  const up = $('env-upgrade');
  if (e.baseDomain) { up.href = `${location.protocol}//${e.productDomain || e.baseDomain}${location.port ? ':' + location.port : ''}/#plans`; up.hidden = false; } else up.hidden = true;
  const requested = Boolean(e.deleteRequestedAt);
  $('env-delete').hidden = requested;
  $('env-delete-cancel').hidden = !requested;
  if (requested) say($('env-status'), `Deletion asked for on ${new Date(e.deleteRequestedAt).toLocaleDateString()}; the host carries it out.`);
}
$('env-export').addEventListener('click', async () => {
  const b = $('env-export');
  b.disabled = true;
  say($('env-status'), 'packing...');
  try {
    const res = await fetch('/api/environment/export');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `could not export (${res.status})`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${environment.slug || 'environment'}-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    say($('env-status'), 'downloaded');
  } catch (err) { say($('env-status'), err.message, true); }
  b.disabled = false;
});
$('env-delete').addEventListener('click', () => { $('env-delete-form').hidden = false; $('env-delete-reason').focus(); });
$('env-delete-back').addEventListener('click', () => { $('env-delete-form').hidden = true; });
$('env-delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('POST', '/api/environment/delete-request', { reason: $('env-delete-reason').value.trim() });
    $('env-delete-form').hidden = true;
    await loadEnvironment();
  } catch (err) { say($('env-status'), err.message, true); }
});
$('env-delete-cancel').addEventListener('click', async () => {
  try {
    await api('DELETE', '/api/environment/delete-request');
    say($('env-status'), 'request withdrawn');
    await loadEnvironment();
  } catch (err) { say($('env-status'), err.message, true); }
});

// The flight schedule (plan-flight-lookup.md, step 5), on the Modules tab of a single install only.
const flightSchedule = wireFlightSchedule('/api/flight-schedule');

async function init() {
  renderTopbar();
  // The tabs in the top bar (#262), as a space's layout tabs are; the page bar's row is left for navigation inside a tab.
  $('subtabs').toggleAttribute('data-top-bar', true);
  renderPageBar({ name: 'Manage', icon: 'gear', controls: [$('subtabs')] }); // the page bar (plan-two-zone-nav.md), its tabs in the top bar
  // The page bar's row: the Environment tab's parts, while that tab is shown (#261).
  rowTabs({ strip: $('env-subtabs'), label: `${word('environment', { cap: true })} settings`, visible: () => tabNow === 'environment' });
  // And the Modules tab's: Configuration and a tab per module that is on (#264), while that tab is shown.
  rowTabs({ strip: $('module-subtabs'), label: word('module', { many: true, cap: true }), visible: () => tabNow === 'modules' });
  requestAnimationFrame(() => scrollToChosen($('env-subtabs'))); // a link to a part: its tab in view in the row
  await loadBranding();
  buildHomeIconGrid(); // after the branding: the choices are its icon list
  wireOverlayBack(word('space', { many: true, cap: true }));
  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    if (!hasOwnerRights(me)) {
      location.href = '/';
      return;
    }
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = imgUrl(me.key, 'profile');
    $('whoami-img').hidden = false;
    streamKey = info.streamKey;
    environment = { ...environment, ...(info.environment || {}) };
    applyHosted();
    if (info.mfaBypass) mfaBypassBanner();
    $('set-mfa-row').hidden = info.mfaOffered === false;
    const { settings } = await api('GET', '/api/settings');
    $('set-environment-name').value = settings.environmentName;
    $('set-language').value = settings.language || 'en';
    $('set-clock').value = settings.clock === '24' ? '24' : '12';
    fillCurrencies(settings.currency || 'USD');
    useOwnerSettings(settings);
    // With a template, no icon of the owner's is the template's own (null); without one, as before.
    selectedHomeIcon = madeFrom ? ownHomeIcon : settings.homeIcon || DEFAULT_HOME_ICON;
    renderHomeIconSelection();
    setWords(settings.words);
    renderWords();
    renderTemplateNote();
    await loadThemes();
    await loadRoles();
    await loadModules();
    $('set-max-quality').value = String(settings.maxQuality || 720);
    $('set-picture-scale').value = String(settings.pictureScale || 100);
    $('set-allow-screen-share').checked = settings.allowScreenShare !== false;
    $('set-allow-asides').checked = settings.allowAsides !== false;
    $('set-allow-private').checked = settings.allowPrivate !== false;
    $('set-allow-reactions').checked = settings.allowReactions !== false;
    $('set-auto-join-call').checked = settings.autoJoinCall === true;
    $('set-login-text').value = settings.loginText;
    $('set-mfa-required').checked = Boolean(settings.mfaRequired);
    $('set-allow-registration').checked = Boolean(settings.allowRegistration);
    renderReactionRows(settings.reactions);
    renderIconRows(settings.icons);
    renderSiteImages(settings);
    renderGuestImages(settings);
    renderDefaultImages(settings);
    showStreamKey();
    await loadUsers();
    await loadEnvironment();
    await loadTemplate();
    if (!environment.hosted) await flightSchedule.load(); // a hosted server's is the host console's: no section here
    if (firstHash && !TABS.includes(firstHash) && !ENV_PARTS.includes(firstHash)) selectTab(firstHash); // a section drawn just now
    setInterval(refreshLive, 5000);
  } catch (err) {
    location.href = '/login?next=/admin';
  }
}
init();
