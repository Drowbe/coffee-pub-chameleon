// This month's AI use, for the owner (Manage's AI service tab): GET /api/ai/usage. Tokens by kind of request, by person and by
// space; calls by kind; the asks that were refused, by reason; the service's failures; the answers cut short; and the last
// calls as records. A record holds counts and ids, never a question or an answer.
import { word, escapeHtml as esc } from '/brand.js';

const num = (v) => Number(v || 0).toLocaleString('en-US');
const TEMPLATE_WORDS = { ask: 'Questions', summarise: 'Summaries', tags: 'Tags', paste: 'Copied prompts' };
const OUTCOME_WORDS = { answered: 'Answered', refused: 'Refused', error: 'Failed' };

// A template's name as the record keeps it ('ask@1') in plain words, without its version.
export function templateWord(name) {
  const base = String(name || '').split('@')[0];
  return TEMPLATE_WORDS[base] || (base ? base[0].toUpperCase() + base.slice(1) : 'Other');
}
// Why an ask was refused, in plain words, in this environment's.
export function reasonWord(reason) {
  const map = {
    guest: `${word('guest', { many: true, cap: true })} cannot use AI`,
    role: "The person's role cannot use AI",
    'space-off': `AI turned off in the ${word('space')}`,
    member: `Not in the ${word('space')}`,
    chat: `The role cannot chat in the ${word('space')}`,
    module: `The role cannot do that in the ${word('module')}`,
    'not-set-up': 'AI not set up',
    allowance: 'Allowance used up',
    limit: 'Too many asks in a minute',
  };
  return map[reason] || String(reason || 'Other');
}
// What went wrong at the service, in plain words.
export function errorWord(kind) {
  const k = String(kind || '');
  if (k === 'status-401' || k === 'status-403') return 'The service refused the key';
  if (k === 'status-429') return 'The service was too busy';
  if (/^status-5/.test(k)) return 'The service failed';
  if (/^status-4/.test(k)) return 'The service refused the request';
  if (k === 'unreadable') return 'An answer that could not be read';
  if (k === 'filter') return 'The service would not answer';
  if (k === 'timeout') return 'The service took too long';
  return k && k !== 'error' ? k : 'Something went wrong';
}

const table = (head, rows, empty, text = 1) => (rows.length
  ? `<div class="sdk-table-wrap"><table class="sdk-table"><thead><tr>${head.map((h, i) => `<th scope="col"${i >= text ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td${i >= text ? ' class="num"' : ''}>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`
  : `<p class="hint">${esc(empty)}</p>`);

// Draws the report into `box`. `people`: [{ key, displayName }], `spaces`: [{ id, name }], to give names for the keys.
export function drawAiUse(box, report, { people = [], spaces = [] } = {}) {
  const r = report || {};
  const u = r.usage || {};
  const personName = (key) => { const p = people.find((x) => x.key === key); return p ? (p.displayName || p.key) : key; };
  const spaceName = (id) => { const s = spaces.find((x) => x.id === id); return s ? s.name : id; };
  const byTokens = (map, name) => Object.entries(map || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [name(k), num(v)]);
  const templates = Object.entries(u.byTemplate || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [templateWord(k), num((r.callsByTemplate || {})[k]), num(v)]);
  const refusals = Object.entries(r.refusals || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [reasonWord(k), num(v)]);
  const errors = Object.entries(r.errors || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [errorWord(k), num(v)]);
  const recent = Array.isArray(r.recent) ? r.recent : [];
  const when = (at) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const recordRows = recent.map((c) => [
    when(c.at),
    c.person ? personName(c.person) : '',
    c.space ? spaceName(c.space) : '',
    templateWord(c.template),
    `${OUTCOME_WORDS[c.outcome] || c.outcome || ''}${c.outcome === 'refused' && c.reason ? `: ${reasonWord(c.reason)}` : c.outcome === 'error' ? `: ${errorWord(c.error)}` : ''}${c.cut ? ', cut short' : ''}`,
    num((c.tokensIn || 0) + (c.tokensOut || 0)),
    c.ms ? `${(c.ms / 1000).toFixed(1)} s` : '',
  ]);
  box.innerHTML = `
    <p class="hint" id="ai-use-total">${esc(num(u.tokens))} tokens in ${esc(num(u.calls))} ${u.calls === 1 ? 'call' : 'calls'} this month${u.monthlyTokens ? `, of ${esc(num(u.monthlyTokens))} allowed` : ''}. Answers cut short: ${esc(num(r.cutShort))}.</p>
    <h3>By kind of request</h3>${table(['Kind', 'Calls', 'Tokens'], templates, 'Nothing asked yet this month.')}
    <h3>By person</h3>${table(['Person', 'Tokens'], byTokens(u.byPerson, personName), 'Nobody has asked yet this month.')}
    <h3>By ${esc(word('space'))}</h3>${table([word('space', { cap: true }), 'Tokens'], byTokens(u.bySpace, spaceName), `No ${word('space')} has asked yet this month.`)}
    <h3>Refused</h3>${table(['Why', 'Asks'], refusals, 'Nothing was refused this month.')}
    <h3>Failed at the service</h3>${table(['What', 'Asks'], errors, 'Nothing failed this month.')}
    <h3>The last ${recent.length === 1 ? 'call' : `${recent.length || 50} calls`}</h3>
    ${table(['When', 'Person', word('space', { cap: true }), 'Kind', 'What happened', 'Tokens', 'Time'], recordRows, 'No calls yet.', 5)}`;
}
