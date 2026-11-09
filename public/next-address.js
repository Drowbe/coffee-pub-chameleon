// Where to go after signing in: the `next` in the address, kept only when it is a path on this site. It must start with
// a single "/" (a second "/" or a "\" makes it another site to a browser), and read as an address it must still be this
// origin (a browser drops tabs and line breaks, so "/<tab>/x" is "//x"). Anything else goes to "/". Used by the sign-in
// page (login.js) and its second step (login-step.js); tools/check-auth.mjs runs it from this source.
export function sameSiteNext(raw, origin = location.origin) {
  const text = String(raw || '');
  if (!/^\/(?![/\\])/.test(text)) return '/';
  try {
    const url = new URL(text, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}
