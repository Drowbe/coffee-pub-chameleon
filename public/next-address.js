// Where to go after signing in or agreeing: the `next` in the address, kept only when it is a path on this site. It must
// start with one "/" and then neither a second one nor a "\", written out or percent-encoded (a browser reads "//x" and
// "/\x" as another site, and drops tabs and line breaks first, so "/<tab>/x" is "//x"). It is answered as the browser
// resolves it and checked again in that form: "/.//other.site" starts with one "/" as written and resolves to
// "//other.site". Anything else goes to "/". The one function every page uses for `next`: the sign-in page (login.js) and
// its steps (login-step.js). The server's twin is safeNext in server/auth.js; tools/check-auth.mjs runs this from its
// source, and one table of hostile addresses through both.
export function sameSiteNext(raw, origin = location.origin) {
  const text = String(raw || '');
  const oneSlash = /^\/(?![/\\]|%2f|%5c)/i;
  if (text.length > 2000 || /[\u0000-\u001f\u007f]/.test(text) || !oneSlash.test(text)) return '/';
  try {
    const url = new URL(text, origin);
    const to = `${url.pathname}${url.search}${url.hash}`;
    return url.origin === origin && oneSlash.test(to) ? to : '/';
  } catch {
    return '/';
  }
}
