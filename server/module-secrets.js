// The values of a module's `secret` settings (module.json setting type "secret": an API key, say). The value is WRITE-ONLY:
// people set it and clear it, and nothing ever reads it back. It is kept apart from every other module setting, in its own
// file (DATA_DIR/modules/secrets.json, mode 600), sealed with the server's secrets key (AES-256-GCM, as ai.json's key is), so
// that no code path that reads module settings, hands them to a page, lists them, exports them or copies them can reach it:
// this class is the only reader, and only server code that holds the ModuleSettings object can ask for a value
// (ModuleSettings#secret). The file is left out of an owner's copy (environment-export.js) and, in a host's backup of a hosted
// environment, is only ciphertext, useless without host.json's key (which no backup carries).

'use strict';

const fs = require('fs');
const path = require('path');
const auth = require('./auth');

class ModuleSecrets {
  // `secretsKey`: a function returning the 32-byte key, or null where there is none (then nothing can be kept).
  constructor(modulesDir, secretsKey = null) {
    this.file = path.join(modulesDir, 'secrets.json');
    this.secretsKey = typeof secretsKey === 'function' ? secretsKey : null;
    this.data = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) this.data = raw;
    } catch {
      // nothing yet
    }
  }

  canKeep() {
    return Boolean(this.secretsKey);
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch { /* not ours to change */ }
  }

  // What may be said about a secret: { set: true }, or { set: false } (and `unreadable: true` when something is kept that this
  // server cannot open, for example a copy restored onto another host: it has to be entered again). Never the value.
  state(moduleId, key) {
    const sealed = this.data[moduleId] && Object.prototype.hasOwnProperty.call(this.data[moduleId], key) ? this.data[moduleId][key] : null;
    if (typeof sealed !== 'string' || !sealed) return { set: false };
    let plain = null;
    try { plain = this.secretsKey ? auth.decryptSecret(sealed, this.secretsKey()) : null; } catch { plain = null; }
    return plain ? { set: true } : { set: false, unreadable: true };
  }

  // The value, for server code that uses it; null when none is kept or it cannot be opened.
  get(moduleId, key) {
    const sealed = this.data[moduleId] && Object.prototype.hasOwnProperty.call(this.data[moduleId], key) ? this.data[moduleId][key] : null;
    if (typeof sealed !== 'string' || !sealed || !this.secretsKey) return null;
    try { return auth.decryptSecret(sealed, this.secretsKey()) || null; } catch { return null; }
  }

  // Keep a value (a non-empty string), or clear it (''). Answers whether anything changed.
  put(moduleId, key, plain) {
    const had = Boolean(this.data[moduleId] && Object.prototype.hasOwnProperty.call(this.data[moduleId], key));
    if (plain === '') {
      if (!had) return false;
      delete this.data[moduleId][key];
      if (!Object.keys(this.data[moduleId]).length) delete this.data[moduleId];
    } else {
      (this.data[moduleId] ||= Object.create(null))[key] = auth.encryptSecret(plain, this.secretsKey());
    }
    this.save();
    return true;
  }

  forgetModule(moduleId) {
    if (!this.data[moduleId]) return;
    delete this.data[moduleId];
    this.save();
  }
}

module.exports = { ModuleSecrets };
