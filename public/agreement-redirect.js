// A request a page makes with fetch() directly (not through api() in /brand.js) can be refused by the agreement gate
// when the texts change while the page is open: 403 { agreementRequired: true }. This wraps window.fetch once, so every
// page that loads it goes to the agreement page and back, as brand.js's api() does. Only this site's own /api/ answers,
// and never on the agreement page itself. The reply is read from a clone, so the page's own read is untouched.
import { sameSiteNext } from '/next-address.js';

if (!window.__agreementRedirect) {
  window.__agreementRedirect = true;
  const plain = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await plain(input, init);
    try {
      if (res.status === 403 && location.pathname !== '/agree' && /^\/api\//.test(new URL(typeof input === 'string' ? input : input.url, location.origin).pathname) && /json/.test(res.headers.get('content-type') || '')) {
        const data = await res.clone().json();
        if (data && data.agreementRequired === true) location.href = `/agree?next=${encodeURIComponent(sameSiteNext(`${location.pathname}${location.search}${location.hash}`))}`;
      }
    } catch { /* leave the answer as it is */ }
    return res;
  };
}
