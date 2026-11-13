// One module's own settings page: /module-config.html?id=<module id>, and the same settings in the module's tab on
// Manage > Modules (#264; admin.js draws them with drawModuleConfig()).
// Owners and the admin. Every module gets a page, so a module with many settings is not squeezed into a shared box.
// Above the module's own settings, the host draws the environment switches that belong to the module
// (plan-space-calendars.md, section 4, decision 11): Calendar sharing for a module that takes part in it, and Show in
// the top bar for a module whose page is a top bar destination's main part. Neither names a module.
import { loadBranding, api, renderTopbar, renderPageBar, wireOverlayBack, word, fill, hasOwnerRights, refreshDestinations } from '/brand.js';
import { renderModuleSettings } from '/module-settings.js';
import { confirmDialog } from '/confirm.js';
import { wireRegionCut } from '/region-cut.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id') || '';

// A status line's message; a plain one clears after 3 s, as on Manage.
const sayTimers = new WeakMap();
function say(el, text, error = false) {
  clearTimeout(sayTimers.get(el));
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) sayTimers.set(el, setTimeout(() => { el.textContent = ''; }, 3000));
}

// The top bar's destinations the host knows (server/destinations.js), each with the setting that shows it and the line
// under its switch. A module offers one by declaring its main part (surfaces.destination).
const DESTINATIONS = [
  { id: 'calendar', key: 'showCalendar', hint: () => fill('events and tasks from every {space} in one place.') },
  { id: 'map', key: 'showMap', hint: () => fill('places from every {space} on one map.') },
];
const SHARING = [
  { key: 'calendarFeeds', input: 'set-calendar-feeds', hint: 'calendar-feeds-hint' },
  { key: 'otherCalendars', input: 'set-other-calendars', hint: 'other-calendars-hint' },
  { key: 'publishedCalendar', input: 'set-published-calendar', hint: 'published-calendar-hint' },
];

// "3 hours ago", "yesterday", or a date for anything older than a week; as Profile's addresses say it.
function timeAgo(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `on ${dayOf(iso)}`;
}
const dayOf = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
const lastRead = (readAt) => (readAt ? `Last read ${timeAgo(readAt)}.` : 'Not read yet.');

// Why a read failed, in plain words: the server's own sentence when it sent one, never the browser's ("Failed to fetch").
function failure(err) {
  if (err && err.serverSaid) return err.message;
  if (err && err.status) return `the server answered ${err.status}`;
  if (!err || err instanceof TypeError) return 'the server didn\'t answer';
  return err.message;
}

// Manage > Modules draws the same configuration in a module's own tab (#264): it takes the #config markup from this
// page (moduleConfigMarkup) and draws it with drawModuleConfig(). The page's own code runs only on this page.
if (document.body && document.body.dataset.page === 'module-config') {
  renderTopbar();
  renderPageBar({ manage: '/admin#modules' }); // named once the module is known (plan-two-zone-nav.md)
  await loadBranding();
  wireOverlayBack();

  // Owners and the admin only. Signed out (401): to sign-in and back. Signed in without the right (403): say so and stop,
  // since sign-in would only send them back here. Anything else: say the list could not be read.
  let data;
  let stop = '';
  let denied = false;
  try {
    data = await api('GET', '/api/modules');
  } catch (err) {
    denied = err.status === 403;
    if (err.status === 401) location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    else stop = err.status === 403 ? `Only ${word('owner', { many: true })} can change this.` : `The ${word('module', { many: true })} could not be read (${failure(err)}). Reload the page to try again.`;
  }
  const m = data && data.modules.find((x) => x.id === id);
  if (stop) {
    $('cfg-denied').textContent = stop;
    $('cfg-denied').hidden = false;
    if (denied) document.querySelector('.module-config-back').hidden = true; // Modules is not theirs either
  } else if (data && !m) {
    $('cfg-missing').hidden = false;
  } else if (m) {
    // What this environment calls it (its display name and icon, else its own), with its own name beside the version
    // when the two differ, as its card on the Modules tab shows.
    const name = m.displayName || m.name;
    document.title = `${document.title.split(' - ')[0]} - ${name} configuration`; // the environment's name is in front once branding has loaded
    renderPageBar({ name, icon: m.displayIcon || m.icon });
    await drawModuleConfig(m);
  }
}

// This page's #config markup, for Manage's module tabs: read once, a fresh copy each time (its ids are this page's, so
// only one copy is in a document at a time).
let markup = null;
export async function moduleConfigMarkup() {
  if (!markup) {
    const res = await fetch('/module-config.html', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    markup = new DOMParser().parseFromString(await res.text(), 'text/html').getElementById('config');
    if (!markup) throw new Error('the configuration could not be read');
  }
  return document.importNode(markup, true);
}

// One module's configuration, drawn into the #config markup in the document (this page's, or the copy in a module's tab
// on Manage). `live()` says whether that copy is still the one shown: a draw that waited on the server and was replaced
// in the meantime stops there, so it never fills the next module's copy.
export async function drawModuleConfig(m, { live = () => true } = {}) {
  const name = m.displayName || m.name;
  $('config').hidden = false;
  $('cfg-icon').classList.add(`fa-${m.displayIcon || m.icon}`);
  $('cfg-name').textContent = `${name} configuration`;
  $('cfg-version').textContent = `${m.displayName ? `${m.name} ` : ''}v${m.version}${m.author ? ' by ' + m.author : ''}`;
  $('cfg-state').textContent = m.enabled ? 'Enabled' : 'Disabled';
  $('cfg-state').dataset.tone = m.enabled ? 'ok' : 'warn';
  $('cfg-desc').textContent = m.description || '';
  let mine = (scope) => (m.settings || []).filter((d) => d.scope === scope).length; // the server's scope names (plan-names step 5a)
  // A setting with `needsModule` is offered only while that module is on: the server's list (what the form draws) is the
  // judge, so a module whose only settings wait on another module reads as having none.
  if (m.enabled && (m.settings || []).some((d) => d.scope === 'environment' && d.needsModule)) {
    try {
      const offered = (await api('GET', '/api/module-settings/environment')).modules.find((x) => x.id === m.id)?.settings.length || 0;
      const all = mine;
      mine = (scope) => (scope === 'environment' ? offered : all(scope));
    } catch { /* the form below says what went wrong */ }
  }
  const showSettings = () => renderModuleSettings($('settings'), { scope: 'environment', only: m.id, heading: false });
  const hostSections = await wireHostSections(m, name, live);
  if (!live()) return;
  if (!mine('environment')) {
    $('cfg-none').hidden = hostSections;
  } else if (!m.enabled) {
    $('cfg-off').hidden = false;
    $('cfg-off').textContent = `Turn ${name} on (Manage > ${word('module', { many: true, cap: true })}) to change its settings.`;
  } else {
    await showSettings();
  }
  if (!live()) return;
  if (m.geocoder && m.enabled) wireCache(m.id);
  if (m.regionSource && m.enabled) wireRegion(m, showSettings);
  const others = [mine('space') && `each ${word('space')}'s ${word('moderator', { many: true })} choose some in the ${word('space')}'s ${word('module')} settings`, mine('person') && 'each person chooses some in their own profile'].filter(Boolean);
  if (others.length) {
    $('cfg-other').hidden = false;
    $('cfg-other').textContent = `Also: ${others.join('; ')}.`;
  }
}

// Draws the host's sections this module has: Calendar sharing (m.sharing) and Show in the top bar (a destination's main
// part). Each switch is saved as it is flipped (PATCH /api/settings) and redrawn from the answer, since otherCalendars
// follows calendarFeeds until it is set. Answers whether any section is shown.
async function wireHostSections(m, name, live = () => true) {
  const sharing = m.sharing === true;
  const mains = DESTINATIONS.filter((d) => (m.surfaces?.destination || []).some((p) => p && p.id === d.id && p.part === 'main'));
  if (!sharing && !mains.length) return false;
  let settings;
  let publishedUrl = ''; // the published calendar's address just made: answered once, kept only until the page is left
  let approver = false; // owners and the admin approve a module's update, so its reason links them to Modules
  try {
    [settings, approver] = await Promise.all([
      api('GET', '/api/settings').then((r) => r.settings),
      api('GET', '/api/me').then((r) => hasOwnerRights(r.user)).catch(() => false),
    ]);
  } catch {
    return false; // nothing to draw the switches from: the module's own settings still show
  }
  if (!live()) return false; // another module's configuration is shown now
  const modulesLink = () => {
    const a = document.createElement('a');
    a.href = '/admin#modules';
    a.textContent = `Go to ${word('module', { many: true, cap: true })}`;
    return a;
  };
  // A switch's line: its own words, or the reason it can't be used (off and disabled), with the link to Modules.
  const drawSwitch = (input, hint, on, reason, link = false) => {
    if (!hint.dataset.own) hint.dataset.own = hint.textContent;
    input.checked = !reason && on;
    input.disabled = Boolean(reason);
    input.closest('label').classList.toggle('disabled', Boolean(reason));
    hint.textContent = reason || hint.dataset.own;
    if (reason && link) hint.append(' ', modulesLink());
  };
  const save = async (input, key, status, after) => {
    try {
      const answer = await api('PATCH', '/api/settings', { [key]: input.checked });
      if (answer && answer.settings) settings = answer.settings;
      drawAll();
      if (after) after();
      say(status, 'saved');
    } catch (err) {
      input.checked = !input.checked;
      say(status, failure(err), true);
    }
  };
  const drawSharing = () => {
    const reasons = m.sharingReasons || {};
    for (const s of SHARING) {
      const input = $(s.input);
      const shown = s.key in reasons; // a module takes part in the switches it has a use for
      input.closest('label').hidden = !shown;
      $(s.hint).hidden = !shown;
      // Whatever the server says: { reason } as it answers now, or a plain sentence.
      const why = reasons[s.key];
      if (shown) drawSwitch(input, $(s.hint), settings[s.key] === true, typeof why === 'string' ? why : why?.reason || '', approver);
    }
    drawPublished();
  };
  // The published calendar's address (section 2): shown while its switch is on and the module takes part. One address,
  // answered once when made; its state is settings.publishedCalendarFeed { on, made, readAt }.
  const drawPublished = () => {
    const reasons = m.sharingReasons || {};
    const box = $('published-calendar');
    const on = 'publishedCalendar' in reasons && settings.publishedCalendar === true && !reasons.publishedCalendar;
    box.hidden = !on;
    if (!on) { publishedUrl = ''; $('published-url').textContent = ''; $('published-made').hidden = true; return; } // nothing shows an address while the box is hidden
    const address = settings.publishedCalendarFeed || { on: false };
    $('published-state').textContent = address.on ? `Made ${dayOf(address.made)}. ${lastRead(address.readAt)}` : 'No address yet.';
    $('published-made').hidden = !(address.on && publishedUrl);
    $('published-url').textContent = address.on ? publishedUrl : '';
    $('published-make').hidden = address.on;
    $('published-new').hidden = !address.on;
    $('published-off').hidden = !address.on;
  };
  const drawTopBar = () => {
    const reasons = settings.topBarReasons || {};
    for (const d of mains) {
      const why = typeof reasons[d.id] === 'string' ? reasons[d.id] : '';
      drawSwitch($(`set-show-${d.id}`), $(`show-${d.id}-hint`), settings[d.key] === true, why);
    }
  };
  const drawAll = () => {
    if (sharing) drawSharing();
    if (mains.length) drawTopBar();
  };
  if (sharing) {
    $('cfg-sharing').hidden = false;
    if (!m.enabled) {
      $('sharing-off').hidden = false;
      $('sharing-off').textContent = `${name} is off, so none of these work until it is on.`;
    }
    for (const s of SHARING) $(s.input).addEventListener('change', (event) => save(event.target, s.key, $('calendar-feeds-status')));
    const makePublished = async () => {
      const made = await api('POST', '/api/settings/published-calendar', {});
      publishedUrl = made.url;
      settings = { ...settings, publishedCalendarFeed: { on: true, made: made.made, readAt: null } };
      drawPublished();
      $('published-copy').focus();
    };
    const publishedStatus = $('published-status');
    $('published-make').addEventListener('click', async () => {
      try { await makePublished(); say(publishedStatus, 'address made'); } catch (err) { say(publishedStatus, failure(err), true); }
    });
    $('published-new').addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Make a new address?', message: 'The old address stops working for everyone who has it.', action: 'Make new', kind: 'destructive' })) return;
      try { await makePublished(); say(publishedStatus, 'new address made'); } catch (err) { say(publishedStatus, failure(err), true); }
    });
    $('published-off').addEventListener('click', async () => {
      if (!await confirmDialog({ title: "Turn off the published calendar's address?", message: 'It stops working for everyone who has it.', action: 'Turn off', kind: 'destructive' })) return;
      try {
        await api('DELETE', '/api/settings/published-calendar');
        publishedUrl = '';
        settings = { ...settings, publishedCalendarFeed: { on: false, made: null, readAt: null } };
        drawPublished();
        say(publishedStatus, 'address turned off');
      } catch (err) { say(publishedStatus, failure(err), true); }
    });
    $('published-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(publishedUrl); say(publishedStatus, 'copied'); } catch { window.prompt('Copy this:', publishedUrl); }
    });
  }
  if (mains.length) {
    $('cfg-top-bar').hidden = false;
    for (const d of mains) {
      const label = document.createElement('label');
      label.className = 'sdk-choice-row';
      const input = document.createElement('input');
      Object.assign(input, { id: `set-show-${d.id}`, type: 'checkbox', className: 'sdk-switch' });
      input.setAttribute('role', 'switch');
      input.setAttribute('aria-describedby', `show-${d.id}-hint`);
      label.append(input, ' Show in the top bar');
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.id = `show-${d.id}-hint`;
      hint.textContent = `Adds ${name} to the top bar: ${d.hint()}`;
      $('top-bar-checks').append(label, hint);
      input.addEventListener('change', (event) => save(event.target, d.key, $('top-bar-status'), () => {
        refreshDestinations(); // the bar's entry comes or goes on this page too
      }));
    }
  }
  drawAll();
  return true;
}

// The saved search results of a module that keeps them: counts, and purging (unused ones, unused ones older than a number of days, everything).
// Used places survive the first two. A destructive button asks twice: it reads "Really purge?" for a few seconds.
function wireCache(id) {
  const box = $('cfg-cache');
  box.hidden = false;
  const base = `/api/modules/${encodeURIComponent(id)}/geocode`;
  const status = $('cache-status');
  const show = (s) => {
    $('cache-saved').textContent = String(s.saved);
    $('cache-used').textContent = String(s.used);
    $('cache-unused').textContent = String(Math.max(0, s.saved - s.used));
    $('cache-oldest').textContent = s.oldest ? new Date(s.oldest).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
  };
  const load = () => api('GET', `${base}/stats`).then(show).catch(() => { status.textContent = 'The counts could not be read.'; status.classList.add('error'); });
  load();
  const armed = new Map();
  box.addEventListener('click', async (event) => {
    const b = event.target.closest('[data-purge]');
    if (!b) return;
    const what = b.dataset.purge;
    if (!armed.has(b)) {
      const label = b.textContent;
      b.textContent = 'Really purge?';
      armed.set(b, setTimeout(() => { b.textContent = label; armed.delete(b); }, 4000));
      return;
    }
    clearTimeout(armed.get(b));
    armed.delete(b);
    b.textContent = b.dataset.purge === 'older' ? 'Purge unused older than' : what === 'all' ? 'Purge everything' : 'Purge unused';
    status.classList.remove('error');
    status.textContent = 'purging...';
    try {
      const body = what === 'all' ? { what: 'all' } : what === 'older' ? { what: 'unused', olderThanDays: Math.max(1, Number($('cache-days').value) || 90) } : { what: 'unused' };
      const s = await api('POST', `${base}/purge`, body);
      show(s);
      status.textContent = `${s.removed} removed`;
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    }
  });
}

// "Add a region" (a module with `regionSource`): the shared region-cut UI (public/region-cut.js), cutting into this
// module's own folder. Not offered when the folder is the host's (a shared setting): the host console cuts there.
// `showSettings` redraws the settings card above once a cut lands, so the new file shows up ticked.
function wireRegion(m, showSettings) {
  const filesDef = (m.settings || []).find((d) => d.type === 'files' && d.folder === m.regionSource.folder);
  if (filesDef && filesDef.shared) return;
  wireRegionCut({
    base: `/api/modules/${encodeURIComponent(m.id)}/region-cut`,
    // Tick the new file in the files setting above (merging into its current value only -- the server keeps every
    // other setting as it was) and redraw the settings card so the admin sees it ticked without saving by hand.
    onDone: async (name) => {
      if (filesDef) {
        try {
          const mine = (await api('GET', '/api/module-settings/environment')).modules.find((x) => x.id === m.id);
          const current = mine?.settings.find((d) => d.key === filesDef.key)?.value;
          const list = Array.isArray(current) ? current : [];
          if (!list.includes(name)) await api('PUT', `/api/modules/${encodeURIComponent(m.id)}/settings/environment`, { values: { [filesDef.key]: [...list, name] } });
        } catch (err) {
          // the file is cut and on disk either way; the admin can tick it by hand if this could not be saved
        }
      }
      await showSettings();
    },
  });
}
