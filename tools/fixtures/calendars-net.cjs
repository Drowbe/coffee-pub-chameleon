// Loaded into a throwaway server (node --require) or into the check itself by tools/check-external-calendars.mjs,
// never by the app. It lets the real calendar reader (server/link-preview.js's fetchCalendar, its address guard
// untouched) reach a local stand-in serving iCalendar:
//
// - a name under cal.example.com resolves to 93.184.215.14 (a public address the guard lets through; the documentation ranges such as TEST-NET-3 are refused);
// - a name under intranet.example.com resolves to 10.0.0.5, which the guard must refuse;
// - an https request the reader sends to either name, after the guard has passed it, goes as plain http to the stand-in
//   on 127.0.0.1:CHECK_STUB_PORT instead. So a request that wrongly got past the guard for intranet.example.com would
//   reach the stand-in, and the check would see it.
//
// Nothing else is touched: every other name resolves and connects as usual.
'use strict';

const dns = require('dns');
const http = require('http');
const https = require('https');

const ANSWERS = [
  [/(^|\.)cal\.example\.com$/i, '93.184.215.14'],
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

const request = https.request;
https.request = function standIn(options, ...rest) {
  const port = Number(process.env.CHECK_STUB_PORT);
  if (port && options && typeof options === 'object' && !(options instanceof URL) && answerFor(options.hostname)) {
    const headers = { ...(options.headers || {}), host: options.hostname, 'x-asked-over': 'https' };
    return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', port, lookup: undefined, createConnection: undefined, headers }, ...rest);
  }
  return request.call(this, options, ...rest);
};
