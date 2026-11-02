// /theme.css, both modes at once (GitHub #62): the live theme's light set and its dark set, each under its own
// selector on <html>, so a page switches mode by setting one attribute -- no second request, no reload.
//
//   <html data-theme-mode="light">  the light set
//   <html data-theme-mode="dark">   the dark set
//   <html> (no attribute)           the default mode: the signed-in person's own choice, else the environment's
//
// The two selectors never both match, so a color one mode sets (an optional one such as --surface-bar-top) can't leak
// into the other: whatever a set leaves out falls through to public/style.css's own :root and public/sdk/system.css.
//
// A set is one mode of a theme: role name -> #rrggbb (server/store.js THEME_BASE and THEME_OPTIONAL). The key IS the CSS role: a
// key `surface-page` sets `--surface-page`. What the theme does not type is worked out here (public/theme-colour.js: text on the
// accent when the theme's own does not reach 4.5:1, text on each status fill, the accent and the status colours as text, the OK green
// as a mark) and written the same way. The derived roles (cards, fields, hovers, tints...) are formulas in public/sdk/system.css and
// are not written.
const crypto = require('crypto');
const themeColour = require('../public/theme-colour');
const { THEME_BASE, THEME_OPTIONAL } = require('./store');

const MODES = ['light', 'dark'];
const isMode = (mode) => MODES.includes(mode);

// SCAFFOLDING, deleted with the old tokens when their last consumer moves (plan-design-system.md, step 36). The old tokens that a
// file not yet moved onto the roles still reads are defined from the roles in public/style.css, so they follow the theme. Four of
// them have a default that is not the new role's, so a theme that sets the role is written to the old token as well
// (public/theme-colour.js LEGACY).
const { LEGACY } = themeColour;

// The roles written from a pick, after the ones the theme typed.
const PICKED = ['text-on-accent', 'text-accent', 'status-ok-mark', ...themeColour.STATUSES.flatMap((k) => [`status-${k}-text`, `status-${k}-on-fill`])];

// A theme that sets wash-ink tints with a neutral ink, which needs quieter steps than the accent's: selected, today, your own chat
// message, a chosen card or day, and the card head band's shade.
const NEUTRAL_WASH = [['wash-selected', '30%'], ['wash-today', '8%'], ['wash-own', '7%'], ['wash-pick', '12%'], ['card-head-step', '8%']];

// The lines of one set for `mode` (the mode its selector shows, which decides the Auto status fills): the colours the theme typed,
// then the ones picked. A null set writes nothing.
function lines(colors, mode) {
  if (!colors) return [];
  const out = [];
  for (const key of [...THEME_BASE, ...THEME_OPTIONAL]) {
    if (key === 'text-on-accent' || !colors[key]) continue;
    out.push(`  --${key}: ${colors[key]};`);
    if (LEGACY[key]) out.push(`  ${LEGACY[key]}: ${colors[key]};`);
  }
  if (colors['wash-ink']) out.push(...NEUTRAL_WASH.map(([k, v]) => `  --${k}: ${v};`));
  const got = themeColour.resolve(colors, mode);
  if (!got) return out;
  for (const flag of got.flags) out.push(`  /* flagged: ${flag} */`);
  for (const role of PICKED) if (got.picks[role]) out.push(`  --${role}: ${got.picks[role]};`);
  return out;
}

function block(selector, colors, mode) {
  const body = lines(colors, mode);
  return body.length ? `${selector} {\n${body.join('\n')}\n}\n` : '';
}

// sets: { light, dark } (either may be null); defaultMode: which one a page without the attribute shows.
// The default mode's selector is ":not(the other mode)", so it covers the bare <html> too.
function themeCss(sets, defaultMode) {
  const def = isMode(defaultMode) ? defaultMode : 'dark';
  const other = def === 'light' ? 'dark' : 'light';
  return `/* default mode: ${def} */\n`
    + block(`:root:not([data-theme-mode="${other}"])`, sets?.[def], def)
    + block(`:root[data-theme-mode="${other}"]`, sets?.[other], other);
}

// A short fingerprint of what the environment's /theme.css says (not a person's default): changes whenever the
// owner's theme, its colors or the default mode change, so a page can tell a stale stylesheet from a fresh one.
function themeVersion(sets, defaultMode) {
  return crypto.createHash('sha256').update(themeCss(sets, defaultMode)).digest('hex').slice(0, 12);
}

module.exports = { MODES, isMode, themeCss, themeVersion, LEGACY, PICKED };
