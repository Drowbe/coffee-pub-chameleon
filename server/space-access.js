// Who may enter a space (plan-access-bundle.md, step 3). The one rule: every route and list that has to know whether a
// person may enter a space asks mayEnter, and nothing else decides it. Pure: no store, no request.
//
// A viewer is one of (the shape server/presence-view.js already uses):
//   { all: true }                     the access key (OBS, Studio): every space, as before;
//   { key, owner }                    a signed-in person; `owner` for owners and the admin;
//   { guestSpace }                    a link guest, by their guest link's space id;
//   { doorGuest: true, doorOn }       a guest who came through the guest door (server/guest-door.js): let into a space whose
//                                     entry is 'guests' while the door is on (`doorOn`: the host's switch and the owner's
//                                     both), and never the Lobby.
// A space's `entry` is 'invited' (absent), 'accounts' (anyone with an account here) or 'guests' (the same for an
// account and for a door guest while the door is on).
'use strict';

const ENTRIES = ['invited', 'accounts', 'guests'];

const entryOf = (space) => (space && ENTRIES.includes(space.entry) ? space.entry : 'invited');

// Whether the viewer is in the space's member list (the Lobby holds everyone, so its list has them).
function isMember(viewer, space) {
  return Boolean(viewer && space && viewer.key && (space.members || []).includes(viewer.key));
}

// Whether `viewer` may enter `space`: owner rights; a member; any account when the space is open to accounts or to
// guests; a link guest of that very space; the access key.
function mayEnter(viewer, space) {
  if (!viewer || !space) return false;
  if (viewer.all) return true;
  if (viewer.guestSpace) return space.id === viewer.guestSpace;
  if (viewer.doorGuest) return viewer.doorOn === true && !space.isLobby && space.id !== 'lobby' && entryOf(space) === 'guests';
  if (!viewer.key) return false;
  if (viewer.owner || space.isLobby || space.id === 'lobby') return true;
  return isMember(viewer, space) || entryOf(space) !== 'invited';
}

// The spaces `viewer` may enter, in the order given.
const enterable = (viewer, spaces) => spaces.filter((s) => mayEnter(viewer, s));

// A space as a person who may enter it but is not in it yet is told of it: what the lists show, never its people.
function openSpaceView(space) {
  return {
    id: space.id,
    name: space.name,
    description: space.description,
    hasImage: Boolean(space.hasImage),
    entry: entryOf(space),
    members: [],
    isLobby: false,
  };
}

module.exports = { ENTRIES, entryOf, isMember, mayEnter, enterable, openSpaceView };
