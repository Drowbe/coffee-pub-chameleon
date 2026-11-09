// The host console (admin.<base domain>): the deployment's own door. The environments (each its own people, spaces,
// settings and modules), their plans against their use, the host admins, the host itself. It shows no environment's
// data beyond the counts. The API is /api/host/ (documentation/plans/plan-environments.md, "Phase 1 in detail").
import { loadBranding, api, renderTopbar, productLockup } from '/brand.js';
import { wireRegionCut } from '/region-cut.js';
import { mountEnrolment, mountDisable } from '/mfa-enrol.js';
import { renderOffer, switchConfirm } from '/template-offer.js';
import { confirmDialog } from '/confirm.js';
import { openHostMenu } from '/host-menu.js';
import { initTemplates } from '/host-templates.js';
import { wireFlightSchedule } from '/flight-schedule.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const say = (el, text, error = false) => { el.textContent = text; el.classList.toggle('error', error); el.hidden = !text; };
const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
const slot = (el, name) => el.querySelector(`[data-slot="${name}"]`);

let settings = { baseDomain: '', version: '', hostAdmins: [], plans: {} };
const PLAN_ORDER = (plans) => Object.keys(plans || {}).sort((a, b) => (a === 'free' ? -1 : b === 'free' ? 1 : a.localeCompare(b)));
let environments = [];
let loaded = false; // the list has come at least once
let templates = []; // every template (GET /api/host/templates): [{ id, name, description, source, version, hidden, usedBy }]

const environmentUrl = (slug) => `${location.protocol}//${slug}.${settings.baseDomain}${location.port ? `:${location.port}` : ''}`; // the port only in development

let hostMe = null; // the signed-in host admin: mfaEnrolled, mfaRequired, mfaOffered, mfaBypass
async function load() {
  try {
    hostMe = await api('GET', '/api/host/me');
  } catch (err) {
    $('host-login').hidden = false;
    $('host-main').hidden = true;
    return;
  }
  renderHostMfa();
  $('host-login').hidden = true;
  $('host-main').hidden = false;
  try {
    settings = await api('GET', '/api/host/settings');
    environments = (await api('GET', '/api/host/environments')).environments;
    templates = (await api('GET', '/api/host/templates').catch(() => ({ templates: [] }))).templates || [];
    loaded = true;
  } catch (err) {
    say($('environments-status'), err.message, true);
    return;
  }
  $('base-hint').textContent = `<slug>.${settings.baseDomain}`;
  renderEnvironments();
  followTemplates();
  renderCreateChoices();
  // Templates: a change there (new, edited, hidden, deleted, imported) reaches the create form and the environments.
  initTemplates(templates, (next) => { templates = next; renderCreateChoices(); renderEnvironments(); }, settings.productName);
  renderAdmins();
  renderFacts();
  renderPlans();
  renderModules();
  await loadAiServices();
  await loadShared();
  await flightSchedule.load();
}
// The flight schedule every environment shares (plan-flight-lookup.md, step 5), in the Server section.
const flightSchedule = wireFlightSchedule('/api/host/flight-schedule');

// --- the managed AI services: one row per company ---------------------------------------------------------------
// GET /api/host/ai lists every company with whether it is offered (a key, or an address for Other, and a model); a row
// sets or replaces the key (write-only), picks the model from the company's own
// list, and saves that one company (PUT /api/host/ai { provider, ... }).
const AI_COMPANIES = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'compatible', name: 'Other (OpenAI-compatible)' },
];
async function loadAiServices() {
  let services = [];
  try {
    services = (await api('GET', '/api/host/ai')).services || [];
  } catch (err) {
    $('ai-panel').hidden = true;
    return;
  }
  const box = $('ai-services');
  box.replaceChildren();
  for (const c of AI_COMPANIES) {
    const s = services.find((x) => x.provider === c.id) || { provider: c.id, model: '', address: '', keySet: false, offered: false };
    box.appendChild(aiServiceRow(c, s));
  }
}
function aiServiceRow(c, s) {
  const form = clone('tpl-ai-service');
  form.dataset.provider = c.id;
  slot(form, 'name').textContent = c.name;
  const offered = slot(form, 'offered');
  offered.textContent = s.offered ? 'Offered' : 'Not offered';
  if (s.offered) offered.dataset.tone = 'ok'; else delete offered.dataset.tone;
  slot(form, 'address-row').hidden = c.id !== 'compatible';
  form.elements.address.value = s.address || '';
  slot(form, 'workspace-row').hidden = c.id !== 'anthropic'; // an organisation-level key must name its workspace
  form.elements.workspace.value = s.workspace || '';
  // The key: keep what is saved, replace it, or clear it; the page never sees the key itself.
  let keyMode = 'keep';
  const keyState = slot(form, 'key-state');
  const keyInput = form.elements.key;
  const replaceBtn = form.querySelector('[data-action="key-replace"]');
  const clearBtn = form.querySelector('[data-action="key-clear"]');
  const syncKey = () => {
    const set = (s.keySet || keyMode === 'replace') && keyMode !== 'clear';
    keyState.textContent = keyMode === 'clear' ? 'will be removed' : set ? 'set' : 'not set';
    if (set) keyState.dataset.tone = 'ok'; else delete keyState.dataset.tone;
    keyInput.hidden = keyMode !== 'replace';
    replaceBtn.textContent = keyMode === 'replace' ? 'Cancel' : s.keySet ? 'Replace the key' : 'Set a key';
    clearBtn.hidden = !s.keySet || keyMode === 'clear';
    slot(form, 'key-help').textContent = c.id === 'compatible' ? 'Optional for a model on your own network. Kept on the host and never shown again.' : 'Kept on the host and never shown again.';
  };
  replaceBtn.addEventListener('click', () => { keyMode = keyMode === 'replace' ? 'keep' : 'replace'; keyInput.value = ''; syncKey(); if (keyMode === 'replace') keyInput.focus(); else loadModels(); });
  clearBtn.addEventListener('click', () => { keyMode = 'clear'; syncKey(); });
  // The model, from the company's own list once there is a key (or an address); typed by hand when the list cannot be had.
  const sel = form.elements.model;
  const text = form.elements['model-text'];
  const manualBtn = form.querySelector('[data-action="model-manual"]');
  const refreshBtn = form.querySelector('[data-action="models-refresh"]');
  const hint = slot(form, 'models-hint');
  let manual = false;
  const syncModel = () => { sel.hidden = manual; text.hidden = !manual; refreshBtn.hidden = manual; };
  async function loadModels() {
    const wanted = manual ? text.value.trim() : sel.value || s.model || '';
    const haveKey = s.keySet || (keyMode === 'replace' && keyInput.value);
    if (c.id !== 'compatible' && !haveKey) { sel.replaceChildren(new Option('Set a key to see the models', '')); hint.textContent = ''; manualBtn.hidden = false; return; }
    if (c.id === 'compatible' && !form.elements.address.value.trim()) { sel.replaceChildren(new Option('Enter the address first', '')); hint.textContent = ''; return; }
    sel.replaceChildren(new Option('Loading models...', ''));
    hint.textContent = '';
    try {
      const body = { provider: c.id, address: form.elements.address.value.trim(), workspace: c.id === 'anthropic' ? form.elements.workspace.value.trim() : '' };
      if (keyMode === 'replace' && keyInput.value) body.key = keyInput.value;
      const { models: list = [] } = await api('POST', '/api/host/ai/models', body);
      sel.replaceChildren(...list.map((m) => new Option(m.name || m.id, m.id)));
      if (wanted && !list.some((m) => m.id === wanted)) sel.append(new Option(`${wanted} (current)`, wanted));
      if (!list.length) sel.append(new Option('No models were listed', ''));
      sel.value = wanted || (list[0] && list[0].id) || '';
      hint.textContent = list.length ? `${list.length} models available.` : '';
    } catch (err) {
      sel.replaceChildren(...(wanted ? [new Option(`${wanted} (current)`, wanted)] : [new Option('The list could not be loaded', '')]));
      sel.value = wanted;
      hint.textContent = `${err.message || 'The list of models could not be loaded'}.`;
    }
    manualBtn.hidden = false;
  }
  manualBtn.addEventListener('click', () => { manual = true; text.value = sel.value || s.model || ''; manualBtn.hidden = true; syncModel(); text.focus(); });
  refreshBtn.addEventListener('click', loadModels);
  form.elements.address.addEventListener('change', loadModels);
  form.elements.workspace.addEventListener('change', loadModels);
  keyInput.addEventListener('change', loadModels);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const model = manual ? text.value.trim() : sel.value;
    const body = { provider: c.id, model, address: c.id === 'compatible' ? form.elements.address.value.trim() : '', workspace: c.id === 'anthropic' ? form.elements.workspace.value.trim() : '' };
    if (keyMode === 'replace' && keyInput.value) body.key = keyInput.value;
    if (keyMode === 'clear') body.clearKey = true;
    say(slot(form, 'status'), 'saving...');
    try {
      await api('PUT', '/api/host/ai', body);
      say($('ai-status'), `${c.name} saved`);
      await loadAiServices();
    } catch (err) { say(slot(form, 'status'), err.message, true); }
  });
  syncKey();
  syncModel();
  loadModels();
  return form;
}

// --- the host's shared files (the map every environment shows) -------------------------------------------------
// GET /api/host/shared lists every bundled module's shared folder; phase 1 has one (Maps' map-tiles), so the panel
// is that one folder: its files, the world address regions are cut from, and the region cut itself.
let shared = null;
let regionWired = false;
const size = (b) => (b === undefined || b === null ? '' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
async function loadShared() {
  let folders = [];
  try {
    folders = (await api('GET', '/api/host/shared')).folders || [];
  } catch (err) {
    $('shared-panel').hidden = true;
    return;
  }
  shared = folders[0] || null;
  $('shared-panel').hidden = !shared;
  if (!shared) return;
  $('shared-title').textContent = shared.name || shared.module;
  $('shared-folder').textContent = `DATA_DIR/shared/${shared.module}/${shared.folder}/${shared.exists === false ? ' (not there yet: it is made on the first cut, or make it and copy a file in)' : ''}`;
  $('shared-address').value = shared.address || '';
  const files = shared.files || [];
  const hasZooms = files.some((f) => f.zoom);
  const KIND_WORDS = { picture: 'Picture', vector: 'Map data' }; // from the file's own header, blank when it says nothing
  const hasKinds = files.some((f) => f.kind);
  $('shared-files').innerHTML = files.length
    ? `<div class="sdk-table-wrap"><table class="sdk-table" aria-label="Map files"><thead><tr><th scope="col">File</th>${hasKinds ? '<th scope="col">Type</th>' : ''}${hasZooms ? '<th scope="col">Zoom</th>' : ''}<th scope="col" class="num">Size</th><th scope="col"><span class="visually-hidden">Delete</span></th></tr></thead><tbody>${files.map((f) => `<tr><th scope="row">${escapeHtml(f.name)}</th>${hasKinds ? `<td class="sdk-table-dim">${KIND_WORDS[f.kind] || ''}</td>` : ''}${hasZooms ? `<td class="sdk-table-dim">${f.zoom ? (f.zoom.minZoom === f.zoom.maxZoom ? f.zoom.maxZoom : `${f.zoom.minZoom}–${f.zoom.maxZoom}`) : ''}</td>` : ''}<td class="num sdk-table-dim">${size(f.size)}</td><td><button type="button" class="btn btn-small btn-danger" data-delete-file="${escapeHtml(f.name)}" data-tip="Delete ${escapeHtml(f.name)}" aria-label="Delete ${escapeHtml(f.name)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="hint">No map files yet. Every environment shows an empty map until one is here.</p>';
  if (!regionWired) {
    regionWired = true;
    wireRegionCut({ base: `/api/host/shared/${encodeURIComponent(shared.module)}/${encodeURIComponent(shared.folder)}/region-cut`, onDone: loadShared });
  }
}
$('shared-address-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!shared) return;
  try {
    await api('PUT', `/api/host/shared/${encodeURIComponent(shared.module)}/${encodeURIComponent(shared.folder)}`, { address: $('shared-address').value.trim() });
    say($('shared-status'), 'saved');
    await loadShared();
  } catch (err) { say($('shared-status'), err.message, true); }
});
const armedFiles = new Map();
$('shared-files').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-delete-file]');
  if (!b || !shared) return;
  const name = b.dataset.deleteFile;
  if (armedFiles.get(name) !== b) { armedFiles.set(name, b); b.textContent = 'Really delete?'; setTimeout(() => { if (armedFiles.get(name) === b) { armedFiles.delete(name); b.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>'; } }, 4000); return; }
  armedFiles.delete(name);
  try {
    await api('DELETE', `/api/host/shared/${encodeURIComponent(shared.module)}/${encodeURIComponent(shared.folder)}/files/${encodeURIComponent(name)}`);
    say($('shared-status'), `${name} deleted`);
    await loadShared();
  } catch (err) { say($('shared-status'), err.message, true); }
});

// The Sign-up line of the host's facts: on at the product host (the base domain unless PRODUCT_DOMAIN is another), free plan.
function signupFact(s) {
  if (s.signup === false) return 'off (SIGNUP=off)';
  const where = s.productDomain && s.productDomain !== s.baseDomain ? s.productDomain : '';
  return where ? `on, at ${where}, on the free plan` : 'on, at the base domain, on the free plan';
}

function renderFacts() {
  const webhook = settings.baseDomain ? `${location.protocol}//admin.${settings.baseDomain}${location.port ? ':' + location.port : ''}/api/host/billing` : '';
  $('host-facts').innerHTML = `<dt>Base domain</dt><dd>${escapeHtml(settings.baseDomain || '(none: one environment)')}</dd><dt>Start page</dt><dd>${escapeHtml(settings.productDomain || settings.baseDomain || '(none)')}</dd><dt>Product site</dt><dd>${escapeHtml(settings.productSiteUrl || '(none)')}</dd><dt>Version</dt><dd>${escapeHtml(settings.version || '')}</dd><dt>Environments</dt><dd>${environments.length}</dd><dt>Sign-up</dt><dd>${escapeHtml(signupFact(settings))}</dd><dt>Billing webhook</dt><dd>${webhook ? `<code>${escapeHtml(webhook)}</code>, a JSON body { slug, plan, event: paid | lapsed | cancelled } signed with <code>BILLING_SECRET</code> (x-billing-signature, HMAC-SHA256 of the body, hex)${settings.billingSecretSet === false ? '; <strong>BILLING_SECRET is not set</strong>, so the webhook refuses everything' : ''}` : 'needs a base domain'}</dd>`;
}

// --- Environments: the table ----------------------------------------------------------------------------------------
// One row per environment (plan-host-console.md, "Environments: the table"; Thomas's lock of the Prototype, 2026-11-09):
// Name with its address, Plan, Status, Use and Template, and a More menu. The needs-attention strip counts each kind and
// is a filter on the table. Built only from what GET /api/host/environments answers (decision 10).
const STATUS_WORD = { active: 'Active', pastDue: 'Past due', suspended: 'Suspended', refused: 'Won’t open' };
const STATUS_TONE = { active: 'ok', pastDue: 'danger', suspended: 'warn', refused: 'danger' };
const statusOf = (t) => (t.refused ? 'refused' : t.status === 'pastDue' || t.status === 'suspended' ? t.status : 'active');
const planName = (t) => { const id = t.plan && t.plan.name; return id ? (settings.plans && settings.plans[id] ? settings.plans[id].name || id : id) : 'No plan'; };
const templateName = (t) => (t.template ? t.template.name || t.template.id : 'No template');
const num = (n) => Number(n || 0).toLocaleString('en-US');
// Each use against its cap: members, AI calls this month, and calls now where the plan caps calls. Nothing for one that won't open.
function usesOf(t) {
  if (t.refused) return [];
  const u = t.usage || {};
  const p = t.plan || {};
  return [
    { label: 'Members', long: 'Members', used: u.members ?? 0, cap: p.members ?? null },
    { label: 'AI', long: 'AI calls this month', used: u.aiCallsThisMonth ?? 0, cap: p.aiCallsPerMonth ?? null },
    ...(p.calls != null ? [{ label: 'Calls', long: 'Calls at once', used: u.callsNow ?? 0, cap: p.calls }] : []),
  ];
}
// Near a cap and at a cap (decision 8): 80 percent or more of a cap is near, 100 percent or more is at it. Only an
// active environment is counted, and its bars use the same test.
const ratio = (x) => (x.cap ? x.used / x.cap : 0);
const atCap = (t) => statusOf(t) === 'active' && usesOf(t).some((x) => x.cap && ratio(x) >= 1);
const nearCap = (t) => statusOf(t) === 'active' && !atCap(t) && usesOf(t).some((x) => x.cap && ratio(x) >= 0.8);
const levelOf = (t, x) => (statusOf(t) !== 'active' || !x.cap ? 'ok' : ratio(x) >= 1 ? 'full' : ratio(x) >= 0.8 ? 'near' : 'ok');
// The kinds the strip counts, in its order (decision 9). One environment can be in more than one.
const KINDS = [
  { id: 'pastDue', word: 'past due', one: 'Past due', icon: 'credit-card', tone: 'danger', test: (t) => statusOf(t) === 'pastDue' },
  { id: 'suspended', word: 'suspended', one: 'Suspended', icon: 'circle-pause', tone: 'warn', test: (t) => statusOf(t) === 'suspended' },
  { id: 'refused', word: 'won’t open', one: 'Won’t open', icon: 'triangle-exclamation', tone: 'danger', test: (t) => Boolean(t.refused) },
  { id: 'deletion', word: 'deletion asked', one: 'Deletion asked', icon: 'trash-can', tone: 'warn', test: (t) => Boolean(t.deleteRequestedAt) },
  { id: 'atCap', word: 'at cap', one: 'At cap', icon: 'circle-exclamation', tone: 'danger', test: atCap },
  { id: 'nearCap', word: 'near a cap', one: 'Near a cap', icon: 'gauge-high', tone: 'warn', test: nearCap },
  { id: 'degraded', word: 'degraded', one: 'Degraded', icon: 'arrow-trend-down', tone: 'warn', test: (t) => Boolean(t.degradedAt) },
];
const needsAttention = (t) => KINDS.some((k) => k.test(t));
const chip = (tone, word, dot = true) => `<span class="sdk-status" data-tone="${tone}">${dot ? '<span class="sdk-chip-dot" aria-hidden="true"></span>' : ''}${escapeHtml(word)}</span>`;
// The chips of one environment: its status, then a deletion asked, a cap, degraded.
function chipsOf(t) {
  const s = statusOf(t);
  return chip(STATUS_TONE[s], STATUS_WORD[s])
    + (t.deleteRequestedAt ? chip('warn', 'Deletion asked', false) : '')
    + (atCap(t) ? chip('danger', 'At cap', false) : nearCap(t) ? chip('warn', 'Near a cap', false) : '')
    + (t.degradedAt ? chip('warn', 'Degraded', false) : '');
}
function bar(t, x, label) {
  const pct = x.cap ? Math.min(100, Math.round((x.used / x.cap) * 100)) : 0;
  const lv = levelOf(t, x);
  return `<span class="sdk-progress sdk-progress-sm${lv !== 'ok' ? ' warn' : ''}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${pct} percent${lv === 'full' ? ', at the cap' : lv === 'near' ? ', near the cap' : ''}"><span class="sdk-progress-fill" style="--pct:${pct}%"></span></span>`;
}
const useText = (x) => (x.cap ? `${num(x.used)} / ${num(x.cap)}` : `${num(x.used)}, no cap`);
const useRow = (t, x) => `<div class="hc-use-row"><span class="hc-use-key">${escapeHtml(x.label)}</span>${x.cap ? bar(t, x, `${x.long} of ${t.name || t.slug}`) : '<span></span>'}<span class="hc-use-val">${escapeHtml(useText(x))}</span></div>`;
// Comfortable: every use. Compact: the one closest to its cap, with its label and number; the others in the tooltip, read out
// to a screen reader, and on the environment's page.
function useCell(t, compact) {
  const uses = usesOf(t);
  if (!uses.length) return '<span class="sdk-table-dim">Nothing to count</span>';
  if (!compact) return `<div class="hc-use">${uses.map((x) => useRow(t, x)).join('')}</div>`;
  const top = uses.reduce((a, b) => (b.cap && (!a.cap || ratio(b) > ratio(a)) ? b : a));
  const all = uses.map((x) => `${x.long} ${useText(x)}`).join(', ');
  return `<div class="hc-use hc-use-one" title="${escapeHtml(all)}">${useRow(t, top)}<span class="visually-hidden">All uses: ${escapeHtml(all)}</span></div>`;
}

const table = { q: '', filter: 'all', sort: 'attention', density: 'comfortable' };
try { if (localStorage.getItem('host-console.rows') === 'compact') table.density = 'compact'; } catch { /* no storage: comfortable */ }
const matches = (t) => {
  const f = table.filter;
  if (f !== 'all' && !(f === 'active' ? statusOf(t) === 'active' : KINDS.find((k) => k.id === f).test(t))) return false;
  const q = table.q.trim().toLowerCase();
  return !q || (t.name || '').toLowerCase().includes(q) || t.slug.includes(q);
};
const useMax = (t) => Math.max(0, ...usesOf(t).filter((x) => x.cap).map(ratio));
const byName = (a, b) => (a.name || a.slug).localeCompare(b.name || b.slug);
const ORDER = {
  attention: (a, b) => (needsAttention(b) - needsAttention(a)) || byName(a, b),
  name: byName,
  plan: (a, b) => planName(a).localeCompare(planName(b)) || byName(a, b),
  newest: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || byName(a, b),
  use: (a, b) => (useMax(b) - useMax(a)) || byName(a, b),
};

function renderTable() {
  const all = environments;
  $('environments-empty').hidden = all.length > 0;
  $('environments-filled').hidden = !all.length;
  if (!all.length) return;
  // The strip: each kind with a count is a button that filters; pressed again (or Clear), the filter goes.
  const live = KINDS.map((k) => [k, all.filter(k.test).length]).filter(([, n]) => n);
  $('attention').innerHTML = '<span class="hc-attention-label"><i class="fa-solid fa-bell fa-fw" aria-hidden="true"></i><span>Needs attention</span></span>'
    + (live.length ? live.map(([k, n]) => `<button class="btn btn-small hc-kind" type="button" data-kind="${k.id}" data-tone="${k.tone}" aria-pressed="${table.filter === k.id}"><i class="fa-solid fa-${k.icon} fa-fw" aria-hidden="true"></i><b>${n}</b><span>${escapeHtml(k.word)}</span></button>`).join('') : '<span class="hc-attention-none">Nothing needs attention.</span>')
    + (table.filter !== 'all' ? '<button class="btn btn-quiet btn-small" type="button" data-kind="all">Clear</button>' : '');
  const filter = $('env-filter');
  if (!filter.options.length) filter.replaceChildren(new Option('All statuses', 'all'), ...KINDS.map((k) => new Option(k.one, k.id)), new Option('Active', 'active'));
  filter.value = table.filter;
  $('env-sort').value = table.sort;
  $('env-search').value = table.q;
  for (const b of $('env-density').querySelectorAll('[data-density]')) {
    const on = b.dataset.density === table.density;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  const compact = table.density === 'compact';
  $('env-table').dataset.density = table.density;
  const list = all.filter(matches).sort(ORDER[table.sort]);
  $('env-count').innerHTML = `${list.length} of ${all.length}<span class="hc-count-word"> environments</span>`;
  $('env-rows').innerHTML = list.length ? list.map((t) => {
    const name = escapeHtml(t.name || t.slug);
    return `<tr data-slug="${escapeHtml(t.slug)}"><th scope="row" class="hc-name-cell"><a class="hc-link" href="#environments/${encodeURIComponent(t.slug)}">${name}</a><span class="sdk-table-sub">${escapeHtml(`${t.slug}.${settings.baseDomain}`)}</span>${compact ? `<div class="hc-use-in-name">${useCell(t, true)}</div>` : ''}</th>`
      + `<td class="hc-plan-cell">${escapeHtml(planName(t))}</td>`
      + `<td class="hc-status-cell">${chipsOf(t)}</td>`
      + `<td class="hc-use-cell">${useCell(t, compact)}</td>`
      + `<td class="sdk-table-dim">${escapeHtml(templateName(t))}</td>`
      + `<td class="hc-more-cell"><button class="sdk-icon-btn btn-quiet btn-small" type="button" data-action="row-menu" aria-haspopup="menu" aria-label="More for ${name}"><i class="fa-solid fa-ellipsis fa-fw" aria-hidden="true"></i></button></td></tr>`;
  }).join('') : '<tr class="sdk-table-empty"><td colspan="6">No environment matches. Clear the search or the filter.</td></tr>';
  swipeCue();
}
// On a phone a table that scrolls sideways says so above itself; the cue goes when the table fits.
function swipeCue() {
  for (const box of document.querySelectorAll('.hc-tablebox')) {
    const wrap = box.querySelector('.sdk-table-wrap');
    const cue = box.querySelector('.hc-swipe');
    if (wrap && cue) cue.hidden = !(wrap.scrollWidth > wrap.clientWidth + 1);
  }
}
window.addEventListener('resize', swipeCue);
$('attention').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]');
  if (!b) return;
  table.filter = b.dataset.kind === 'all' || table.filter === b.dataset.kind ? 'all' : b.dataset.kind;
  renderTable();
  ($('attention').querySelector(`[data-kind="${CSS.escape(b.dataset.kind)}"]`) || $('env-search')).focus();
});
$('env-search').addEventListener('input', (e) => { table.q = e.target.value; renderTable(); });
$('env-filter').addEventListener('change', (e) => { table.filter = e.target.value; renderTable(); });
$('env-sort').addEventListener('change', (e) => { table.sort = e.target.value; renderTable(); });
$('env-tools-toggle').addEventListener('click', () => {
  const open = $('env-tools-more').toggleAttribute('data-open');
  $('env-tools-toggle').setAttribute('aria-expanded', String(open));
});
function setDensity(value) {
  table.density = value;
  try { localStorage.setItem('host-console.rows', value); } catch { /* kept for this visit only */ }
  renderTable();
  $('env-density').querySelector('[aria-checked="true"]').focus();
}
$('env-density').addEventListener('click', (e) => { const b = e.target.closest('[data-density]'); if (b) setDensity(b.dataset.density); });
$('env-density').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  setDensity(table.density === 'compact' ? 'comfortable' : 'compact');
});
// The row: its name is the link (the keyboard's), the whole row the mouse's target; More opens its menu.
$('env-rows').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-slug]');
  if (!row) return;
  const t = environments.find((x) => x.slug === row.dataset.slug);
  const more = e.target.closest('[data-action="row-menu"]');
  if (more) { if (t) rowMenu(more, t); return; }
  if (!e.target.closest('a, button')) go(`environments/${row.dataset.slug}`);
});
function rowMenu(trigger, t) {
  const suspended = t.status === 'suspended';
  openHostMenu(trigger, [
    { label: 'Open', icon: 'arrow-up-right-from-square', onPick: () => go(`environments/${t.slug}`) },
    { label: 'Back up', icon: 'download', onPick: () => backupEnvironment(t.slug, null, $('environments-status')) },
    suspended
      ? { label: 'Resume', icon: 'circle-play', onPick: () => suspendOrResume(t, $('environments-status')) }
      : { label: 'Suspend', icon: 'circle-pause', onPick: () => suspendOrResume(t, $('environments-status')) },
    { divider: true },
    { label: 'Delete', icon: 'trash', danger: true, onPick: () => deleteEnvironment(t, $('environments-status')) },
  ]);
}

// --- what a host admin does to one environment: back up, suspend or resume, delete ---------------------------------
async function backupEnvironment(slug, button, status) {
  if (button) button.disabled = true;
  try {
    const res = await fetch(`/api/host/environments/${encodeURIComponent(slug)}/backup`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `backup failed (${res.status})`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    say(status, `A backup of ${slug} is downloading.`);
  } catch (err) { say(status, err.message, true); }
  if (button) button.disabled = false;
}
// Suspend asks first (no one can open it until it is resumed); Resume asks too, as the plain question it is. The same
// PATCH as before: suspended goes back to active, anything else to suspended.
async function suspendOrResume(t, status) {
  const resume = t.status === 'suspended';
  const name = t.name || t.slug;
  const done = await confirmDialog({
    title: resume ? `Resume ${name}?` : `Suspend ${name}?`,
    message: resume ? 'People can open it again.' : 'No one can open it until you resume it. Nothing is removed.',
    action: resume ? 'Resume' : 'Suspend',
    kind: resume ? 'plain' : 'destructive',
    run: () => api('PATCH', `/api/host/environments/${encodeURIComponent(t.slug)}`, { status: resume ? 'active' : 'suspended' }),
  });
  if (!done) return;
  await reloadEnvironments();
  say(status, resume ? `${name} is open again.` : `${name} is suspended.`);
}
// Delete moves its data aside; the dialog asks for its address typed out before Delete turns on.
async function deleteEnvironment(t, status) {
  const name = t.name || t.slug;
  const done = await confirmDialog({
    title: `Delete ${name}?`,
    message: 'It is moved aside, not erased: its data is kept under environments-deleted on the server. Its owners can no longer open it.\n\nType its address to say you mean it.',
    action: 'Delete',
    kind: 'final',
    typed: t.slug,
    run: () => api('DELETE', `/api/host/environments/${encodeURIComponent(t.slug)}`),
  });
  if (!done) return;
  await reloadEnvironments();
  go('environments');
  say($('environments-status'), `${name} was deleted (moved aside).`);
  $('environments-status').focus();
}
async function reloadEnvironments() {
  try { environments = (await api('GET', '/api/host/environments')).environments; } catch (err) { say($('environments-status'), err.message, true); }
  renderEnvironments();
}

function renderEnvironments() {
  renderTable();
  if (page.slug) renderPage();
}

// --- One environment's page (#environments/<slug>, and /<tab>) --------------------------------------------------------
// Its name, address and chips, Open environment, and its tabs: Overview, Plan and modules, Template, Owners and two-step,
// Backups, Danger zone (and Domain, drawn but not yet in use). Every tab saves on its own, with the routes the cards used.
const PAGE = $('environment-page');
const TABS = ['overview', 'plan', 'template', 'owners', 'backups', 'danger'];
let page = { slug: '', tab: 'overview' };
const pageEnvironment = () => environments.find((x) => x.slug === page.slug) || null;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');
const gb = (bytes) => (bytes ? `${(bytes / 1e9).toFixed(bytes < 1e8 ? 2 : 1)} GB` : '0 GB');
function showEnvironment(slug, tab) {
  const changed = page.slug !== slug;
  page = { slug, tab: TABS.includes(tab) ? tab : 'overview' };
  if (changed) { closeFirstPasswordLink(PAGE, false); openOffers.clear(); planDirty = false; $('env-restore-file').value = ''; }
  renderPage();
}
function renderPage() {
  const t = pageEnvironment();
  if (!t) {
    // Gone (deleted elsewhere) or never there: back to the table, saying so.
    if (loaded && page.slug && !PAGE.hidden) {
      go('environments');
      say($('environments-status'), `There is no environment at ${page.slug}.`, true);
    }
    return;
  }
  const name = t.name || t.slug;
  $('env-title').textContent = name;
  $('env-address').textContent = `${t.slug}.${settings.baseDomain}`;
  $('env-chips').innerHTML = chipsOf(t);
  $('env-open').href = environmentUrl(t.slug);
  PAGE.dataset.slug = t.slug;
  $('env-tabs').setAttribute('aria-label', `${name}, pages`);
  for (const b of $('env-tabs').querySelectorAll('[data-tab]')) {
    const on = b.dataset.tab === page.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const id of TABS) $(`env-pane-${id}`).hidden = id !== page.tab;
  renderOverview(t);
  renderPlanForm(t);
  renderTemplatePane(t);
  renderOwners(t);
  renderDanger(t);
}
$('env-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) selectEnvironmentTab(b.dataset.tab);
});
$('env-tabs').addEventListener('keydown', (e) => {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const i = TABS.indexOf(page.tab);
  selectEnvironmentTab(e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]);
});
function selectEnvironmentTab(tab) {
  say($('env-status'), '');
  history.replaceState(null, '', `#environments/${encodeURIComponent(page.slug)}${tab === 'overview' ? '' : `/${tab}`}`);
  page.tab = tab;
  renderPage();
  $(`env-tab-${tab}`).focus();
}
PAGE.addEventListener('click', (e) => { const b = e.target.closest('[data-env-tab]'); if (b) selectEnvironmentTab(b.dataset.envTab); });

function refusedCopy() {
  const of = settings.productName ? ` of ${settings.productName}` : ''; // the name from the settings; none is written here
  return {
    words: {
      newer: `Won't open: its data is from a newer version${of}.`,
      failed: "Won't open: its data could not be updated.",
      unreadable: "Won't open: its data could not be read.",
    },
    hints: {
      newer: `Restore a good backup, or run a newer version${of}.`,
      failed: 'Restore a good backup. The server log has the details.',
      unreadable: 'Fix or restore this file (the server log names it), or restore a good backup.',
    },
  };
}
const banner = (kind, icon, text, extra = '') => `<div class="sdk-banner" data-kind="${kind}" role="status"><span class="sdk-banner-icon" aria-hidden="true"><i class="fa-solid fa-${icon}"></i></span><span class="sdk-banner-text">${text}${extra}</span></div>`;
// Overview: why it needs a look (won't open, past due, degraded, deletion asked), its status and dates, and its use
// against each cap. Storage is shown here only.
function renderOverview(t) {
  const r = t.refused;
  const copy = refusedCopy();
  const graceEnds = t.graceEndsAt ? new Date(t.graceEndsAt) : t.pastDueSince ? new Date(new Date(t.pastDueSince).getTime() + 14 * 86400000) : null;
  $('env-banners').innerHTML = [
    r ? banner('danger', 'triangle-exclamation', escapeHtml(copy.words[r.reason] || copy.words.failed), `<br><span class="hc-banner-sub">${r.file ? `<code>${escapeHtml(r.file)}</code>` : ''}${r.file && r.at ? ', ' : ''}${r.at ? `since ${escapeHtml(new Date(r.at).toLocaleString())}` : ''}${r.file || r.at ? '. ' : ''}${escapeHtml(copy.hints[r.reason] || copy.hints.failed)}</span>`) : '',
    t.status === 'pastDue' ? banner('danger', 'credit-card', escapeHtml(`Past due since ${day(t.pastDueSince) || '?'}. It goes back to the Free plan on ${graceEnds ? graceEnds.toLocaleDateString() : '?'}.`)) : '',
    t.degradedAt ? banner('warn', 'arrow-trend-down', escapeHtml(`Went back to the Free plan on ${day(t.degradedAt)}, after a payment stayed past due.`)) : '',
    t.deleteRequestedAt ? banner('warn', 'trash-can', escapeHtml(`Its owner asked for it to be deleted on ${day(t.deleteRequestedAt)}${t.deleteRequestReason ? `: ${t.deleteRequestReason}` : '.'}`)) : '',
  ].join('');
  if (r) $('env-banners').querySelector('.sdk-banner').title = r.message || '';
  const u = t.usage || {};
  const facts = [
    ['Status', chip(STATUS_TONE[statusOf(t)], STATUS_WORD[statusOf(t)])],
    ...(t.status === 'pastDue' ? [['Past due since', escapeHtml(day(t.pastDueSince))]] : []),
    ...(t.degradedAt ? [['Degraded', escapeHtml(day(t.degradedAt))]] : []),
    ...(t.deleteRequestedAt ? [['Deletion asked', escapeHtml(day(t.deleteRequestedAt))]] : []),
    ['Plan', escapeHtml(planName(t))],
    ['Template', escapeHtml(templateName(t))],
    ['Spaces', r ? '—' : escapeHtml(num(u.spaces))],
    ['Created', escapeHtml(day(t.createdAt))],
  ];
  $('env-facts').innerHTML = facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`).join('');
  const p = t.plan || {};
  const capRow = (label, value, x) => {
    const lv = x ? levelOf(t, x) : 'ok';
    return `<div class="hc-cap"><div class="hc-cap-top"><span class="hc-cap-key">${escapeHtml(label)}</span><span class="hc-cap-val">${escapeHtml(value)}</span></div>${x && x.cap ? bar(t, x, label) : ''}${lv !== 'ok' ? `<span class="hc-cap-note">${lv === 'full' ? 'At the cap' : 'Near the cap'}</span>` : ''}</div>`;
  };
  const uses = usesOf(t);
  const storage = u.storageBytes == null ? (p.storageBytes ? `Not measured yet, cap ${gb(p.storageBytes)}` : 'Not measured yet, no cap') : p.storageBytes ? `${gb(u.storageBytes)} of ${gb(p.storageBytes)}` : `${gb(u.storageBytes)}, no cap`;
  const of = (x) => (x.cap ? `${num(x.used)} of ${num(x.cap)}` : `${num(x.used)}, no cap`);
  $('env-caps').innerHTML = r
    ? '<p class="sdk-hint">Nothing to count until it opens again.</p>'
    : [
      capRow('Members', of(uses[0]), uses[0]),
      capRow('AI calls this month', of(uses[1]), uses[1]),
      capRow('Calls at once', p.calls != null ? `${num(u.callsNow)} now, of ${num(p.calls)}` : 'No cap', uses[2]),
      capRow('Storage', storage, null),
    ].join('');
}

// Plan and modules: the name, the plan (choosing one fills the caps from it), its own four caps and which modules it may
// run. One Save (PATCH, as the card's Edit did).
const BUILT_IN_MODULES = ['conference', 'chat'];
let planDirty = false;
function renderPlanForm(t) {
  if (planDirty) return; // never redraw under someone's hands
  const form = $('plan-form');
  const p = t.plan || {};
  form.elements.name.value = t.name || '';
  const pick = form.elements.planName;
  pick.replaceChildren(new Option('(none named)', ''), ...PLAN_ORDER(settings.plans).map((id) => new Option(settings.plans[id].name || id, id)));
  pick.value = p.name && settings.plans[p.name] ? p.name : '';
  fillCaps(form, p);
}
function fillCaps(form, p) {
  form.elements.members.value = p.members || '';
  form.elements.storageGb.value = p.storageBytes ? String(p.storageBytes / 1e9) : '';
  form.elements.aiCallsPerMonth.value = p.aiCallsPerMonth ?? '';
  form.elements.calls.value = p.calls || '';
  const list = Array.isArray(p.modules) ? p.modules : null;
  form.querySelector(`[name="modules"][value="${list ? 'list' : 'all'}"]`).checked = true;
  // The modules this host ships, then any other id the list already names (an uploaded module), kept ticked.
  const shipped = (settings.modules || []).filter((m) => !BUILT_IN_MODULES.includes(m.id));
  const extra = (list || []).filter((id) => !shipped.some((m) => m.id === id)).map((id) => ({ id, name: id }));
  $('plan-module-list').innerHTML = [...shipped, ...extra].map((m) => `<label class="sdk-choice-row"><input type="checkbox" value="${escapeHtml(m.id)}"${list && list.includes(m.id) ? ' checked' : ''}${list ? '' : ' disabled'}><span class="sdk-choice-text">${escapeHtml(m.name || m.id)}</span></label>`).join('');
}
$('plan-form').addEventListener('input', () => { planDirty = true; });
$('plan-form').addEventListener('change', (e) => {
  planDirty = true;
  const form = $('plan-form');
  if (e.target.name === 'planName') {
    const caps = (settings.plans[e.target.value] || {}).caps;
    if (caps) fillCaps(form, caps);
  }
  if (e.target.name === 'modules') for (const box of $('plan-module-list').querySelectorAll('input')) box.disabled = e.target.value !== 'list';
});
$('plan-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = $('plan-form').elements;
  const numOf = (el) => (el.value === '' ? null : Number(el.value));
  const bad = [...$('plan-form').querySelectorAll('input')].find((i) => !i.checkValidity());
  if (bad) { bad.reportValidity(); bad.focus(); return; }
  const list = $('plan-form').querySelector('[name="modules"]:checked').value === 'list';
  const plan = {
    name: f.planName.value || null,
    modules: list ? [...$('plan-module-list').querySelectorAll('input:checked')].map((i) => i.value) : 'all',
    members: numOf(f.members),
    storageBytes: f.storageGb.value === '' ? null : Math.round(Number(f.storageGb.value) * 1e9),
    aiCallsPerMonth: numOf(f.aiCallsPerMonth),
    calls: numOf(f.calls),
  };
  say($('plan-status'), 'Saving…');
  try {
    await api('PATCH', `/api/host/environments/${encodeURIComponent(page.slug)}`, { name: f.name.value.trim(), plan });
    planDirty = false;
    await reloadEnvironments();
    say($('plan-status'), 'Saved.');
  } catch (err) { say($('plan-status'), err.message, true); }
});

// Template: what it was made from, what was left out, Switch template, and the offer with Review (the switching
// addendum; drawn by /template-offer.js as on Manage's Template tab). The offer comes with the switch's answer; an offer
// left open (offerOpen in the list) is fetched again by Review.
const openOffers = new Map(); // slug -> the offer on show: { name, offer }
// What a template left out when an environment was made from it (plan-environment-templates.md, "Entitlement"): each
// module with why. Not in the plan (or needing one that was not) means it was never installed; anything else means it is
// installed and in every space but not on yet, for the owner to turn on once what it needs is set up.
const leftOut = (why) => why === 'not in the plan' || /^needs .+, which was skipped$/.test(why || '');
function renderSkipped(box, template) {
  const skipped = (template && template.skipped) || [];
  box.hidden = !skipped.length;
  if (!skipped.length) { box.replaceChildren(); return; }
  box.innerHTML = `<p class="hint">Left out of the ${escapeHtml(template.name || template.id)} template:</p><ul>${skipped.map((x) => `<li><strong>${escapeHtml(x.name || x.id)}</strong>: ${leftOut(x.why) ? escapeHtml(x.why) : `not on yet. ${escapeHtml(/[.!?]$/.test(x.why || '') ? x.why : `${x.why}.`)}`}</li>`).join('')}</ul>`;
}
function renderTemplatePane(t) {
  const tp = t.template;
  $('env-template-facts').innerHTML = `<dt>Made from</dt><dd>${escapeHtml(templateName(t))}</dd>${tp && tp.version ? `<dt>Version</dt><dd>${escapeHtml(String(tp.appliedVersion || tp.version))}</dd>` : ''}`;
  renderSkipped($('env-template-skipped'), tp);
  const select = $('env-template-select');
  const current = tp ? tp.id : 'none';
  const choices = templates.filter((x) => !x.hidden || x.id === current);
  $('env-template-switch').hidden = Boolean(t.refused) || !templates.length;
  if (document.activeElement !== select) {
    select.replaceChildren(...choices.map((x) => new Option(x.name || x.id, x.id)), new Option('No template', 'none'));
    if (tp && !choices.some((x) => x.id === current)) select.append(new Option(tp.name || current, current));
    select.value = current;
  }
  syncSwitch(t);
  const shown = openOffers.get(t.slug);
  const open = Boolean(tp && tp.offerOpen);
  $('env-offer-none').hidden = open;
  $('env-offer-none').textContent = t.refused ? 'Nothing can be offered until it opens again.' : tp ? 'Nothing new from this template.' : 'No template to offer anything.';
  $('env-offer-note').hidden = !open || Boolean(shown);
  $('env-offer-note-text').textContent = open ? `The ${tp.name || tp.id} template can turn on more here.` : '';
  const offerBox = $('env-offer');
  if (!open || !shown) { offerBox.hidden = true; offerBox.replaceChildren(); openOffers.delete(t.slug); return; }
  renderOffer(offerBox, {
    templateName: shown.name,
    offer: shown.offer,
    later: () => { openOffers.delete(t.slug); renderPage(); $('env-offer-review').focus(); },
    apply: async (body) => {
      const answer = await api('POST', `/api/host/environments/${encodeURIComponent(t.slug)}/template/apply`, body);
      openOffers.delete(t.slug);
      const skipped = (answer.environment.template && answer.environment.template.skipped) || [];
      await reloadEnvironments();
      say($('env-template-status'), skipped.length ? `Applied. ${skipped.length} left out, listed above.` : 'Applied.');
      $('env-template-select').focus();
    },
  });
}
function syncSwitch(t) {
  const other = $('env-template-select').value !== (t.template ? t.template.id : 'none');
  $('env-template-switch-btn').disabled = !other;
  $('env-template-switch-btn').classList.toggle('btn-primary', other);
}
$('env-template-select').addEventListener('change', () => { const t = pageEnvironment(); if (t) syncSwitch(t); });
$('env-template-switch-btn').addEventListener('click', async () => {
  const t = pageEnvironment();
  if (!t) return;
  const value = $('env-template-select').value;
  const chosen = templates.find((x) => x.id === value);
  if (!await confirmDialog(switchConfirm(value === 'none' ? null : chosen ? chosen.name || chosen.id : value))) return;
  const button = $('env-template-switch-btn');
  button.disabled = true;
  say($('env-template-status'), 'Switching…');
  try {
    const { environment } = await api('PATCH', `/api/host/environments/${encodeURIComponent(t.slug)}`, { template: value });
    if (environment.template && environment.template.offerOpen && environment.offer) openOffers.set(t.slug, { name: environment.template.name || environment.template.id, offer: environment.offer });
    await reloadEnvironments();
    say($('env-template-status'), environment.template ? `Switched to ${environment.template.name || environment.template.id}.` : 'Switched to no template.');
    ($('env-offer').querySelector('input:not(:disabled)') || $('env-template-select')).focus();
  } catch (err) {
    button.disabled = false;
    say($('env-template-status'), err.message, true); // the server's own sentence
  }
});
$('env-offer-review').addEventListener('click', async () => {
  const t = pageEnvironment();
  if (!t) return;
  try {
    const { template, offer } = await api('GET', `/api/host/environments/${encodeURIComponent(t.slug)}/template`);
    if (offer) openOffers.set(t.slug, { name: template.name || template.id, offer });
    await reloadEnvironments();
    $('env-offer').querySelector('input:not(:disabled), button')?.focus();
  } catch (err) { say($('env-template-status'), err.message, true); }
});

// Owners and two-step: the reset of an owner's second factor, by login (the console never learns an environment's keys),
// asked first; and the owners who have no password yet (plan-first-password.md, Decision 4), a row each with "New
// first-password link". The list names only their logins; the link itself is made when the button is pressed and shown once.
function renderOwners(t) {
  $('owner-reset').hidden = Boolean(t.refused); // nothing inside it can be reached until a good backup is restored
  renderFirstPassword(PAGE, t.refused ? [] : t.awaitingFirstPassword);
}
$('owner-reset').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = $('owner-reset');
  const login = form.elements.login.value.trim();
  if (!login) return;
  const done = await confirmDialog({
    title: `Reset ${login}'s second factor?`,
    message: `${login} signs in with the password alone next time, then sets up an authenticator app again.`,
    action: 'Reset',
    kind: 'destructive',
    run: () => api('DELETE', `/api/host/environments/${encodeURIComponent(page.slug)}/owners/${encodeURIComponent(login)}/mfa`),
  });
  if (!done) return;
  form.reset();
  say($('owner-reset-status'), `${login}'s second factor is reset.`);
});
function renderFirstPassword(card, logins) {
  const list = Array.isArray(logins) ? logins : [];
  const box = slot(card, 'first-password');
  box.hidden = !list.length;
  slot(box, 'first-password-rows').replaceChildren(...list.map((login) => {
    const row = document.createElement('div');
    row.className = 'row';
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = `${login} has no password yet.`;
    const button = document.createElement('button');
    button.className = 'btn btn-small';
    button.type = 'button';
    button.dataset.action = 'first-password';
    button.dataset.login = login;
    button.textContent = 'New first-password link';
    row.append(hint, button);
    return row;
  }));
}
// The link just made, in its read-only field until Close; nothing else keeps it.
function showFirstPasswordLink(card, login, url) {
  const made = slot(card, 'first-password-made');
  made.dataset.login = login;
  slot(made, 'first-password-label').textContent = `Link for ${login}`;
  const field = slot(made, 'first-password-url');
  field.value = url;
  made.hidden = false;
  field.focus();
  field.select();
}
function closeFirstPasswordLink(card, refocus = true) {
  const made = slot(card, 'first-password-made');
  if (made.hidden) return;
  const login = made.dataset.login;
  slot(made, 'first-password-url').value = '';
  delete made.dataset.login;
  made.hidden = true;
  say(slot(card, 'first-password-status'), '');
  const back = [...card.querySelectorAll('[data-action="first-password"]')].find((b) => b.dataset.login === login);
  if (back && refocus) back.focus();
}
async function copyFirstPasswordLink(card) {
  const field = slot(card, 'first-password-url');
  const status = slot(card, 'first-password-status');
  try {
    await navigator.clipboard.writeText(field.value);
  } catch {
    field.focus();
    field.select();
    if (!document.execCommand('copy')) { say(status, 'Copy did not work here. The link is selected: copy it by hand.', true); return; }
  }
  say(status, 'copied');
}
PAGE.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !e.target.closest('[data-slot="first-password-made"]')) return;
  e.preventDefault();
  closeFirstPasswordLink(PAGE);
});
PAGE.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  if (b.dataset.action === 'first-password-copy') { copyFirstPasswordLink(PAGE); return; }
  if (b.dataset.action === 'first-password-close') { closeFirstPasswordLink(PAGE); return; }
  if (b.dataset.action !== 'first-password') return;
  const login = b.dataset.login;
  const status = slot(PAGE, 'first-password-status');
  b.disabled = true;
  try {
    const { url } = await api('POST', `/api/host/environments/${encodeURIComponent(page.slug)}/owners/${encodeURIComponent(login)}/first-password`);
    say(status, '');
    showFirstPasswordLink(PAGE, login, url);
  } catch (err) { say(status, err.message, true); }
  b.disabled = false;
});

// Backups: a download, and a restore from a zip, asked first since it replaces all its data.
$('env-backup').addEventListener('click', () => backupEnvironment(page.slug, $('env-backup'), $('env-status')));
$('env-restore-file').addEventListener('change', () => { $('env-restore').disabled = !$('env-restore-file').files.length; });
$('env-restore').addEventListener('click', async () => {
  const t = pageEnvironment();
  const file = $('env-restore-file').files[0];
  if (!t || !file) return;
  let answer = null;
  const done = await confirmDialog({
    title: `Restore ${t.name || t.slug} from ${file.name}?`,
    message: 'Everything in it now is replaced by the backup. This cannot be undone.',
    action: 'Restore',
    kind: 'destructive',
    run: async () => { answer = await api('POST', `/api/host/environments/${encodeURIComponent(t.slug)}/restore`, file, 'application/zip'); },
  });
  if (!done) return;
  $('env-restore-file').value = '';
  $('env-restore').disabled = true;
  await reloadEnvironments();
  if (answer && answer.refused) say($('env-status'), `${t.slug} was restored, but still won't open: ${(refusedCopy().words[answer.refused.reason] || refusedCopy().words.failed).replace(/^Won't open: /, '')} Try an older backup.`, true);
  else say($('env-status'), `${t.slug} was restored from ${file.name}.`);
  $('env-status').focus();
});

// Danger zone: Suspend or Resume, and Delete, each asked first.
function renderDanger(t) {
  const resume = t.status === 'suspended';
  $('env-suspend-title').textContent = resume ? 'Resume' : 'Suspend';
  $('env-suspend-text').textContent = resume ? 'People can open it again.' : 'No one can open it until you resume it. Nothing is removed.';
  $('env-suspend').textContent = resume ? 'Resume' : 'Suspend';
}
$('env-suspend').addEventListener('click', () => { const t = pageEnvironment(); if (t) suspendOrResume(t, $('env-status')); });
$('env-delete').addEventListener('click', () => { const t = pageEnvironment(); if (t) deleteEnvironment(t, $('env-status')); });

// A template's modules install in the background after the create answers, so what it left out is known a moment
// later: while an environment's template reads as not applied yet, look again a few times, then stop.
let templateLooks = 0;
let templateTimer = null;
function followTemplates() {
  clearTimeout(templateTimer);
  // A switch's offer (offerOpen) waits for the host, not for the server: nothing to follow.
  if (!environments.some((t) => t.template && !t.template.appliedAt && !t.template.offerOpen)) { templateLooks = 0; return; }
  if (++templateLooks > 5) return;
  templateTimer = setTimeout(async () => {
    // Never redraw under someone's hands (an offer open, or the page being used): look again later instead.
    if (!$('env-offer').hidden || (!PAGE.hidden && PAGE.contains(document.activeElement) && document.activeElement !== document.body)) { followTemplates(); return; }
    try {
      environments = (await api('GET', '/api/host/environments')).environments;
      renderEnvironments();
      followTemplates();
    } catch (err) {
      // the next full load says what is wrong
    }
  }, 1500);
}

// The host admins: a row each with whether their two-step sign-in is on. Never the last one, and never yourself, is removed.
function renderAdmins() {
  const admins = settings.hostAdmins || [];
  const me = hostMe && hostMe.admin ? hostMe.admin.key : '';
  $('admins').innerHTML = admins.map((a) => `<tr data-key="${escapeHtml(a.key)}"><th scope="row">${escapeHtml(a.login)}${a.key === me ? '<span class="sdk-table-sub">You</span>' : ''}</th>`
    + `<td><span class="sdk-status"${a.mfaEnrolled ? ' data-tone="ok"' : ''}>${a.mfaEnrolled ? 'Two-step on' : 'Two-step off'}</span></td>`
    + `<td class="hc-more-cell">${a.key === me || admins.length < 2 ? '' : `<button class="btn btn-small btn-danger" type="button" data-action="remove-admin" aria-label="Remove ${escapeHtml(a.login)}">Remove</button>`}</td></tr>`).join('');
}

// --- creating one ----------------------------------------------------------------------------------------------
// The create form's Plan (the catalog; none chosen means no caps and every module, as before) and Template (None, then
// each template with its description; hidden when the host has none).
function renderCreateChoices() {
  const plan = $('new-plan');
  const was = plan.value;
  plan.replaceChildren(new Option('No caps, every module', ''), ...PLAN_ORDER(settings.plans).map((id) => new Option(settings.plans[id].name || id, id)));
  plan.value = settings.plans && settings.plans[was] ? was : '';
  const box = $('new-template');
  const offered = templates.filter((t) => !t.hidden); // a hidden template makes no new environments
  box.hidden = !offered.length;
  const options = slot(box, 'options');
  const chosen = box.querySelector('input:checked')?.value || '';
  const option = (id, name, description) => `<label class="sdk-choice-row sdk-choice-boxed"><input type="radio" name="new-template" value="${escapeHtml(id)}"${id === chosen ? ' checked' : ''}><span class="sdk-choice-text"><span class="sdk-choice-label">${escapeHtml(name)}</span><span class="sdk-choice-desc">${escapeHtml(description)}</span></span></label>`;
  options.innerHTML = option('', 'None', 'Start plain: the usual words and settings.')
    + offered.map((t) => option(t.id, t.name || t.id, t.description || '')).join('');
  if (!options.querySelector('input:checked')) options.querySelector('input').checked = true;
}
// New environment is its own view (#environments/new); leaving it empties the form (a reset also masks its password again,
// brand.js), so it never comes back with an old value showing.
$('create-toggle').addEventListener('click', () => go('environments/new'));
$('create-cancel').addEventListener('click', () => go('environments'));
$('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say($('create-error'), '');
  try {
    await api('POST', '/api/host/environments', {
      slug: $('new-slug').value.trim().toLowerCase(),
      name: $('new-name').value.trim(),
      ...($('new-plan').value && settings.plans[$('new-plan').value] ? { plan: { name: $('new-plan').value, ...settings.plans[$('new-plan').value].caps } } : {}),
      ...($('new-template').querySelector('input:checked')?.value ? { template: $('new-template').querySelector('input:checked').value } : {}),
      owner: { login: $('new-owner-login').value.trim(), displayName: $('new-owner-name').value.trim(), password: $('new-owner-password').value },
    });
    const slug = $('new-slug').value.trim().toLowerCase();
    $('create-form').reset();
    await load();
    go(`environments/${slug}`);
  } catch (err) { say($('create-error'), err.message, true); }
});

// --- the sections and the address ------------------------------------------------------------------------------------
// The left navigation's five sections (plan-host-console.md, "Navigation"): one shows at a time, named after the # so a
// reload and the Back button come back to it. Environments is the default, being what a host admin comes for.
const SECTIONS = ['environments', 'templates', 'modules', 'plans', 'server'];
function readAddress() {
  const [section, ...rest] = decodeURIComponent(location.hash.slice(1)).split('/');
  return SECTIONS.includes(section) ? { section, rest } : { section: 'environments', rest: [] };
}
function go(address) { if (location.hash !== `#${address}`) location.hash = address; else showAddress(); }
function showAddress({ focus = false } = {}) {
  const { section, rest } = readAddress();
  for (const el of document.querySelectorAll('.hc-section')) el.hidden = el.dataset.section !== section;
  for (const b of $('hc-nav').querySelectorAll('[data-section]')) {
    if (b.dataset.section === section) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  // On a phone the navigation is a strip wider than the page: bring the current one into it, the page left as it is.
  const strip = $('hc-nav');
  const on = strip.querySelector('[aria-current="page"]');
  if (on && strip.scrollWidth > strip.clientWidth) {
    const t = on.getBoundingClientRect();
    const sb = strip.getBoundingClientRect();
    if (t.left < sb.left) strip.scrollLeft += t.left - sb.left;
    else if (t.right > sb.right) strip.scrollLeft += t.right - sb.right;
  }
  showView(section, rest);
  if (focus) document.querySelector(`.hc-section[data-section="${section}"]:not([hidden]) .hc-view:not([hidden]) .hc-title, .hc-section[data-section="${section}"]:not([hidden]) > .hc-head .hc-title`)?.focus({ preventScroll: true });
}
// Within a section, which view: filled in by the sections that have more than one.
function showView(section, rest) {
  if (section !== 'environments') return;
  const [first] = rest;
  const view = !first ? 'list' : first === 'new' ? 'new' : 'one';
  $('environments-list').hidden = view !== 'list';
  if ($('environment-new').hidden && view === 'new') { $('create-form').reset(); say($('create-error'), ''); }
  $('environment-new').hidden = view !== 'new';
  $('environment-page').hidden = view !== 'one';
  if (view === 'one') showEnvironment(first, rest[1]);
  else page.slug = '';
  if (view === 'list') swipeCue();
}
// A Back to Environments button (any [data-go]).
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) { go(b.dataset.go); document.querySelector('.hc-section:not([hidden]) .hc-view:not([hidden]) .hc-title')?.focus({ preventScroll: true }); } });
$('hc-nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-section]');
  if (!b) return;
  go(b.dataset.section);
  document.querySelector(`.hc-section[data-section="${b.dataset.section}"] .hc-title`)?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
window.addEventListener('hashchange', () => showAddress());
if (location.hash.slice(1) && !SECTIONS.includes(location.hash.slice(1).split('/')[0])) history.replaceState(null, '', '#environments');
showAddress();

// A jump list (the Server's parts): the part comes into view and takes the keyboard focus.
function jumpTo(id) {
  const part = $(id);
  if (!part || part.hidden) return;
  part.scrollIntoView({ block: 'start' });
  part.focus({ preventScroll: true });
}
$('server-jump').addEventListener('click', (e) => { const b = e.target.closest('[data-part]'); if (b) jumpTo(b.dataset.part); });

// --- Modules: the modules this host ships, read only (installing and updating come later) ----------------------------
function renderModules() {
  const BUILT_IN = ['conference', 'chat'];
  const rows = (settings.modules || []).map((m) => `<tr><th scope="row">${escapeHtml(m.name || m.id)}<span class="sdk-table-sub">${escapeHtml(m.id)}</span></th><td class="sdk-table-dim">${BUILT_IN.includes(m.id) ? 'Built in' : 'Bundled'}</td></tr>`);
  $('module-rows').innerHTML = rows.length ? rows.join('') : '<tr class="sdk-table-empty"><td colspan="2">No modules are listed.</td></tr>';
}

// --- the plans catalog ----------------------------------------------------------------------------------------------
// One row per plan (free first and never removed); Save plans sends the whole catalog (PUT /api/host/plans).
function planRow(id, plan) {
  const row = clone('tpl-plan-row');
  const f = row.querySelector.bind(row);
  f('[name="id"]').value = id;
  f('[name="id"]').readOnly = id === 'free';
  f('[name="name"]').value = plan.name || id;
  const c = plan.caps || {};
  f('[name="members"]').value = c.members || '';
  f('[name="storageGb"]').value = c.storageBytes ? String(c.storageBytes / 1e9) : '';
  f('[name="aiCallsPerMonth"]').value = c.aiCallsPerMonth ?? '';
  f('[name="calls"]').value = c.calls || '';
  f('[name="modules"]').value = Array.isArray(c.modules) ? c.modules.join(' ') : 'all';
  if (id === 'free') f('[data-action="plan-remove"]').disabled = true;
  return row;
}
function renderPlans() {
  const box = $('plans-editor');
  const plans = settings.plans && Object.keys(settings.plans).length ? settings.plans : { free: { name: 'Free', caps: {} } };
  box.replaceChildren(...PLAN_ORDER(plans).map((id) => planRow(id, plans[id])));
}
$('plan-add').addEventListener('click', () => { $('plans-editor').appendChild(planRow('', { name: '', caps: {} })); $('plans-editor').lastElementChild.querySelector('[name="id"]').focus(); });
$('plans-editor').addEventListener('click', (e) => {
  const b = e.target.closest('[data-action="plan-remove"]');
  if (b && !b.disabled) b.closest('.plan-row').remove();
});
$('plans-save').addEventListener('click', async () => {
  // The rows are not a form, so each is checked here: the first field the browser rejects (an id that is not lower-case
  // letters, digits and hyphens, a cap under its minimum) says why and nothing is saved. A new row left without an id is
  // skipped, as before.
  for (const row of $('plans-editor').querySelectorAll('.plan-row')) {
    if (!row.querySelector('[name="id"]').value.trim()) continue;
    if (!row.querySelector('[name="name"]').value.trim()) { say($('plans-status'), 'Give the plan a name.', true); row.querySelector('[name="name"]').focus(); return; }
    const bad = [...row.querySelectorAll('input')].find((i) => !i.checkValidity());
    if (bad) { bad.reportValidity(); bad.focus(); return; }
  }
  const plans = {};
  for (const row of $('plans-editor').querySelectorAll('.plan-row')) {
    const v = (name) => row.querySelector(`[name="${name}"]`).value.trim();
    const id = v('id').toLowerCase();
    if (!id) continue;
    const num = (name) => (v(name) === '' ? null : Number(v(name)));
    const mods = v('modules');
    plans[id] = {
      name: v('name'),
      caps: {
        modules: !mods || mods === 'all' ? 'all' : mods.split(/[\s,]+/).filter(Boolean),
        members: num('members'),
        storageBytes: v('storageGb') === '' ? null : Math.round(Number(v('storageGb')) * 1e9),
        aiCallsPerMonth: num('aiCallsPerMonth'),
        calls: num('calls'),
      },
    };
  }
  if (!plans.free) plans.free = { name: 'Free', caps: { modules: 'all', members: null, storageBytes: null, aiCallsPerMonth: null, calls: null } };
  try {
    await api('PUT', '/api/host/plans', plans); // the body is the catalog itself
    say($('plans-status'), 'saved');
    await load();
  } catch (err) { say($('plans-status'), err.message, true); }
});

// --- the host admins -------------------------------------------------------------------------------------------
$('admin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/host/admins', { login: $('admin-login').value.trim(), password: $('admin-password').value });
    $('admin-form').reset();
    say($('admins-status'), 'added');
    await load();
  } catch (err) { say($('admins-status'), err.message, true); }
});
$('admins').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action="remove-admin"]');
  if (!b) return;
  const row = b.closest('tr');
  const login = row.querySelector('th').firstChild.textContent;
  if (!await confirmDialog({ title: `Remove ${login}?`, message: 'They can no longer sign in to the host console.', action: 'Remove', kind: 'destructive' })) return;
  try {
    await api('DELETE', `/api/host/admins/${encodeURIComponent(row.dataset.key)}`);
    say($('admins-status'), `${login} removed`);
    await load();
  } catch (err) { say($('admins-status'), err.message, true); }
});

// --- signing in and out ---------------------------------------------------------------------------------------
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say($('login-error'), '');
  try {
    const res = await api('POST', '/api/host/login', { login: $('login-name').value.trim(), password: $('login-password').value });
    $('login-password').value = '';
    // The second step: a code, or enrolment first for a host admin who must have one and has none yet.
    if (res && res.mfaRequired) {
      $('login-form').hidden = true;
      if (res.enrol) {
        $('host-enrol').hidden = false;
        mountEnrolment($('host-enrol-block'), { start: '/api/host/me/mfa/start', enable: '/api/host/me/mfa/enable', onDone: async () => { $('host-enrol').hidden = true; $('login-form').hidden = false; await load(); } });
      } else {
        $('host-verify').hidden = false;
        $('host-code').focus();
      }
      return;
    }
    await load();
  } catch (err) { say($('login-error'), err.message, true); }
});
$('host-verify').addEventListener('submit', async (e) => {
  e.preventDefault();
  say($('host-verify-error'), '');
  try {
    await api('POST', '/api/host/login/verify', { code: $('host-code').value.trim(), remember: $('host-remember').checked });
    $('host-code').value = '';
    $('host-verify').hidden = true;
    $('login-form').hidden = false;
    await load();
  } catch (err) { say($('host-verify-error'), err.message, true); }
});
$('host-verify-back').addEventListener('click', () => { $('host-verify').hidden = true; $('login-form').hidden = false; });

// The host admin's own second factor (Server): hidden when the server does not offer two-step sign-in, and under
// the admin lockout bypass no code is asked and their own reset (the password) is offered, with a banner until it is off.
function renderHostMfa() {
  const me = hostMe || {};
  const offered = me.mfaOffered !== false;
  $('host-mfa-panel').hidden = !offered;
  if (!offered) return;
  const on = Boolean(me.mfaEnrolled);
  $('host-mfa-state').textContent = on ? (me.mfaBypass ? 'on, bypassed' : 'on') : 'off';
  if (on && !me.mfaBypass) $('host-mfa-state').dataset.tone = 'ok'; else delete $('host-mfa-state').dataset.tone;
  $('host-mfa-on').hidden = on;
  $('host-mfa-off').hidden = !on || me.mfaRequired || me.mfaBypass;
  $('host-mfa-reset').hidden = !on || !me.mfaBypass;
  if (me.mfaBypass && !document.querySelector('.sdk-banner-wide[data-mfa-bypass]')) {
    const b = document.createElement('div');
    b.className = 'sdk-banner sdk-banner-wide';
    b.dataset.kind = 'warn';
    b.dataset.mfaBypass = '1';
    b.setAttribute('role', 'status');
    b.innerHTML = '<span class="sdk-banner-icon" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></span><span class="sdk-banner-text"></span>';
    b.querySelector('.sdk-banner-text').textContent = 'The admin lockout bypass is on: host admins are not asked for their two-step code. Reset your factor under Server if you need to, then turn ADMIN_MFA_LOCKOUT_BYPASS off on the server.';
    const topbar = document.querySelector('.topbar');
    if (topbar) topbar.after(b); else document.body.prepend(b);
  }
}
$('host-mfa-reset').addEventListener('click', () => {
  mountDisable($('host-mfa-block'), { disable: '/api/host/me/mfa/reset', label: 'Reset', password: true, onDone: async () => { say($('host-mfa-status'), 'reset'); await load(); } });
});
$('host-mfa-on').addEventListener('click', () => {
  if (!$('host-mfa-block').hidden) return;
  mountEnrolment($('host-mfa-block'), { start: '/api/host/me/mfa/start', enable: '/api/host/me/mfa/enable', onDone: async () => { say($('host-mfa-status'), 'on'); await load(); } });
});
$('host-mfa-off').addEventListener('click', () => {
  mountDisable($('host-mfa-block'), { disable: '/api/host/me/mfa/disable', onDone: async () => { say($('host-mfa-status'), 'off'); await load(); } });
});
$('host-logout').addEventListener('click', async () => {
  try { await api('POST', '/api/host/logout'); } catch (err) { /* the cookie is gone either way */ }
  await load();
});

renderTopbar({ location: '', themeSwitch: false });
await loadBranding();
// The console is the product's own door, so its bar wears the product's lockup (the mark and the product's name), not
// any environment's name and icon. The console has no /api/branding: the name is /api/product's (PRODUCT_NAME).
const brandHome = document.querySelector('.topbar .brand-home');
if (brandHome) {
  const product = await fetch('/api/product').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  brandHome.replaceChildren(productLockup(product.name || ''));
  brandHome.href = '/';
  brandHome.title = 'Host console';
}
await load();
