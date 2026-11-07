'use strict';

// The product's name, from configuration (PRODUCT_NAME). Sentences a person reads use this; identifiers never do
// (file formats, fenced blocks, stored keys are named by kind: plan-kind-names.md).
// PRODUCT_NAME holds the FULL name (titles, sign-in, first mentions, About); shortProductName() is the form for where only
// the name fits and for running text. DEFAULT_PRODUCT_NAME is the only place the default is written; server/index.js defaults PRODUCT_NAME from it.
const DEFAULT_PRODUCT_NAME = 'Coffee Pub Chameleon';

function productName() {
  const name = typeof process.env.PRODUCT_NAME === 'string' ? process.env.PRODUCT_NAME.trim() : '';
  return name || DEFAULT_PRODUCT_NAME;
}

// The short form: the full name without a leading "Coffee Pub " (one space, any letter case). A name without that prefix,
// such as a branded "Travel Pub", is its own short form (the default's short form is its last word).
function shortProductName() {
  const full = productName();
  const short = full.replace(/^coffee pub /i, '').trim();
  return short || full;
}

// The product's name as it can go in a request header: HTTP header values take only Latin-1, and a user-agent's product
// is one word, so only printable ASCII is kept (anything else, an en dash, CJK, an emoji, is dropped), each run of
// spaces becomes one hyphen, and the default stands in when nothing is left ("Kollab – Mesa" -> "Kollab-Mesa",
// "Pub 🍺" -> "Pub", "協作" -> the default).
function headerProductName() {
  const kept = productName().replace(/[^\x20-\x7e]/g, '').trim().replace(/\s+/g, '-');
  return kept || DEFAULT_PRODUCT_NAME;
}

// The user-agent the server sends when it fetches from elsewhere: "<product>/<version>", and, when `contact` is given,
// " (+<contact>)" after it so the service can identify and reach whoever runs the app. Always sendable, whatever
// PRODUCT_NAME is (headerProductName).
function userAgent({ contact = null } = {}) {
  const version = require('../package.json').version;
  return `${headerProductName()}/${version}${contact ? ` (+${contact})` : ''}`;
}

// The repository's address, which the geocoder's user-agent carries (the repository's name is out of scope for the
// kind names, plan-kind-names.md decision 3).
const REPOSITORY_URL = 'https://github.com/Drowbe/coffee-pub-collaborator';

module.exports = { DEFAULT_PRODUCT_NAME, productName, shortProductName, headerProductName, userAgent, REPOSITORY_URL };
