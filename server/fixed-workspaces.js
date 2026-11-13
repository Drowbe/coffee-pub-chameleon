// The schema of the Fixed Workspaces (documentation/plans/plan-workspaces.md, decisions 33 to 35, step 12): one list, in
// our software, saying which module settings appear on each Fixed Workspace's Modules tab in Set up. A module cannot add
// a switch here by itself (not through its manifest) and no page draws its own: adding one later is one line below.
//
// The keys are the ids of the Fixed Workspaces (every system layout but `workspace`, which is the Customizable
// Workspace and has no entry); each value lists, in order, { module, setting }: a module's id and the key of one of its
// own settings. The setting must exist in that module's manifest and be a boolean, and the module must be one that can
// be on (tools/check-fixed-workspaces.mjs fails when any of it is not so). The switch itself is the module's ordinary
// setting: it reads and writes through the module settings routes as always and keeps its own `needsModule`.
// server/index.js (fixedSettingsFor) decides, per viewer, which of these are answered in GET /api/spaces/:id/layouts.
//
// Today only Calendar offers one: the To-do list's `inCalendar` ("Show in the Calendar"). Map, Conference, Whiteboards
// and Documents offer none: there is nothing you would want to run next to them.
'use strict';

const FIXED_WORKSPACE_SETTINGS = Object.freeze({
  calendar: Object.freeze([Object.freeze({ module: 'todo', setting: 'inCalendar' })]),
  map: Object.freeze([]),
  conference: Object.freeze([]),
  whiteboard: Object.freeze([]),
  documents: Object.freeze([]),
});

module.exports = { FIXED_WORKSPACE_SETTINGS };
