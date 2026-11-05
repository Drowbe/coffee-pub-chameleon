// Light or dark before the first paint (GitHub #62). Loaded as a plain, blocking script in <head>, ahead of
// /theme.css, so a page never flashes the other mode: the light or dark this browser last picked (the header's
// switch, public/theme-mode.js) goes on <html data-theme-mode>. Nothing picked: no attribute, and /theme.css's
// default shows (the signed-in person's own mode, else the environment's). An external file, not an inline
// script, so a page's content security policy never has to allow inline code.
// A guest link's page (and a window it popped out) shows the environment's default mode only (plan-primary-nav.md,
// decision 5), so the remembered one is not read there.
try {
  const guest = location.pathname.startsWith('/guest/') || new URLSearchParams(location.search).has('guest');
  const mode = guest ? null : localStorage.getItem('app.themeMode');
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.themeMode = mode;
} catch {
  // no storage: the default mode shows
}

// A phone (640px and narrower) is the top page's width, not a frame's: a module's page in a docked column of a desktop window is
// narrow too. The bars' buttons are drawn 44px on a phone (system.css, the moduleframe block), so every page, framed or not,
// follows the top page's width through <html data-phone> (GitHub #394).
try {
  const top = window.top;
  const query = top.matchMedia('(max-width: 640px)');
  const mark = () => document.documentElement.toggleAttribute('data-phone', query.matches);
  mark();
  query.addEventListener('change', mark);
} catch {
  // the top page is not ours to read: the page's own width decides, as for any page
  const query = window.matchMedia('(max-width: 640px)');
  const mark = () => document.documentElement.toggleAttribute('data-phone', query.matches);
  mark();
  query.addEventListener('change', mark);
}
