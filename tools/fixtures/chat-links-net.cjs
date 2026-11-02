// Loaded into the throwaway server by tools/check-chat-links.mjs (node --require), never by the app itself. It lets
// the real page reader (server/link-preview.js, its address guard untouched) reach a local stand-in page:
//
// - a name under page.example.com resolves to 93.184.215.14 (a public address the guard lets through; the documentation ranges such as TEST-NET-3 are refused);
// - a name under intranet.example.com resolves to 10.0.0.5, which the guard must refuse;
// - an HTTP request the reader sends to either name, after the guard has passed it, goes to the stand-in on
//   127.0.0.1:CHECK_STUB_PORT instead. So a request that wrongly got past the guard for intranet.example.com would
//   reach the stand-in, and the check would see it.
//
// Nothing else is touched: every other name resolves and connects as usual.
'use strict';

const dns = require('dns');
const http = require('http');

const port = Number(process.env.CHECK_STUB_PORT);
const ANSWERS = [
  [/(^|\.)page\.example\.com$/i, '93.184.215.14'],
  [/(^|\.)intranet\.example\.com$/i, '10.0.0.5'],
];
const answerFor = (host) => ANSWERS.find(([re]) => re.test(String(host || '')))?.[1] || null;

const lookup = dns.promises.lookup.bind(dns.promises);
dns.promises.lookup = async (host, options) => {
  const address = answerFor(host);
  if (!address) return lookup(host, options);
  const list = [{ address, family: 4 }];
  return options && options.all ? list : list[0];
};

const request = http.request;
http.request = function standIn(options, ...rest) {
  if (port && options && typeof options === 'object' && !(options instanceof URL) && answerFor(options.hostname)) {
    const headers = { ...(options.headers || {}), host: options.hostname };
    return request.call(this, { ...options, hostname: '127.0.0.1', port, lookup: undefined, headers }, ...rest);
  }
  return request.call(this, options, ...rest);
};
