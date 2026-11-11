// Deleting a space deletes everything kept for it, in the same environment (GitHub #337). One list, here, so a new
// per-space file is added in one place and tools/check-space-erase.mjs finds it missing.
//
// On disk, per space <id> (all under the environment's data folder):
//   app.json                              the space, each person's entry for it (pictures, permissions, address), invites naming it
//   images/spaces/<id>.<ext>              the space's picture
//   images/<person key>/spaces/<id>/      each person's pictures for it
//   layouts.json                          its shared and personal layouts and favourites
//   chat.json, chat-private.json          its chat history and the private messages (AI threads) in it
//   attention.json, facts.json            what is asking for attention, what each module reported
//   tags.json                             the space's tags (server/tags.js)
//   modules/settings.json                 module settings for the space
//   modules/<module>/data/space-<id>.json         every module's records scoped to it
//   modules/<module>/uploads/space-<id>/          every module's files scoped to it (and their thumbnails)
//   modules/<module>/library/space-<id>.json      a library module's records of the space's files
//   <VAULT_DIR>/<environment>/space-<id>/         those files' bytes and thumbnails (server/vault-store.js)
//   modules/links.json                    links with an end in it
//   modules/bus.json                      events and "send to..." requests in it
//   modules/schedules.json, notifications.json    what was scheduled in it, notifications about it
//   modules/activity.json                 the log lines that name it
// In memory: pending two-person invitations to it, link previews asked for in its chat.
'use strict';

const { StoreError, LOBBY } = require('./store');

// Erases it all, then the space itself. The space's record goes last, so a step that fails leaves the space in place
// to be deleted again (every step does nothing when there is nothing left). Throws with a plain message naming the step
// that failed; never leaves a half-deleted space behind quietly. Answers how many of each thing went.
function eraseSpace(env, id) {
  const { store } = env;
  if (id === LOBBY) throw new StoreError('the Lobby cannot be deleted');
  if (!store.spaceById(id)) throw new StoreError(`no such ${store.word('space')}`, 404);
  const gone = {};
  const mod = store.word('module');
  const steps = [
    [`${mod} data held for an undo`, () => env.moduleHolds.forgetSpace(id)],
    [`${mod} data`, () => env.moduleData.forgetSpace(id)],
    [`${mod} files`, () => env.moduleUploads.forgetSpace(id)],
    ['library files', () => env.vault.forgetSpace(id)],
    [`${mod} links`, () => env.moduleLinks.forgetSpace(id)],
    [`${mod} requests`, () => env.moduleBus.forgetSpace(id)],
    ['schedules and notifications', () => env.moduleHooks.forgetSpace(id)],
    [`${mod} settings`, () => { env.moduleSettings.forgetSpace(id); return 0; }],
    ['chat', () => { env.chatHistory.forgetSpace(id); return 0; }],
    ['attention', () => { env.attention.forgetSpace(id); return 0; }],
    ['facts', () => { env.facts.forgetSpace(id); return 0; }],
    ['tags', () => env.tags.forgetSpace(id)],
    ['activity', () => {
      const scope = `space:${id}`;
      let n = 0;
      for (let i = env.moduleActivity.length - 1; i >= 0; i -= 1) if (env.moduleActivity[i].scope === scope) { env.moduleActivity.splice(i, 1); n += 1; }
      if (n) env.saveActivity();
      return n;
    }],
    ['open invitations', () => {
      for (const [k, v] of env.invites) if (v.spaceId === id) env.invites.delete(k);
      for (const k of env.chatPreviewsAsked.keys()) if (k.startsWith(`${id}:`)) env.chatPreviewsAsked.delete(k);
      return 0;
    }],
  ];
  for (const [what, run] of steps) {
    try {
      gone[what] = run();
    } catch (err) {
      console.error(`Deleting space ${id}: could not remove its ${what}: ${err.stack || err.message}`);
      throw new StoreError(`The ${store.word('space')} was not deleted: its ${what} could not be removed. Try again.`, 500);
    }
  }
  store.removeSpace(id);
  return gone;
}

module.exports = { eraseSpace };
