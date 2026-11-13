// Who may enter a space (plan-access-bundle.md, step 3). The one rule: every route and list that has to know whether a
// person may enter a space asks mayEnter, and nothing else decides it. Pure: no store, no request.
//
// A viewer is one of (the shape server/presence-view.js already uses):
//   { all: true }                     the access key (OBS, Studio): every space, as before;
//   { key, owner }                    a signed-in person; `owner` for owners and the admin;
//   { guestSpace }                    a link guest, by their guest link's space id;
//   { doorGuest: true, doorOn, granted } a guest who came through the guest door (server/guest-door.js): let into a space whose
//                                     entry is 'guests' while the door is on (`doorOn`: the host's switch; there is no owner
//                                     switch, each space opens itself), and never the Lobby.
//   a person's viewer may carry `moderates`: the ids of the spaces they moderate (a member ticked as moderator there).
// A space's `entry` is 'invited' (absent), 'accounts' (anyone with an account here) or 'guests' (the same for an
// account and for a door guest while the door is on).
// A space may be `closed` (for set up; absent = open). A closed space is entered only by owners, the admin, its
// moderators and the access key; everyone else, its members included, is refused by this same rule. The Lobby is never closed.
'use strict';

const ENTRIES = ['invited', 'accounts', 'guests'];

const entryOf = (space) => (space && ENTRIES.includes(space.entry) ? space.entry : 'invited');

// Whether the viewer is in the space's member list (the Lobby holds everyone, so its list has them).
function isMember(viewer, space) {
  return Boolean(viewer && space && viewer.key && (space.members || []).includes(viewer.key));
}

// Whether the space is closed for set up.
const isClosed = (space) => Boolean(space && space.closed === true && !space.isLobby && space.id !== 'lobby');

// Whether `viewer` may enter `space`: owner rights; a member; any account when the space is open to accounts or to
// guests; a link guest of that very space; the access key. A closed space: owners, the admin, its moderators, the access key.
function mayEnter(viewer, space) {
  if (!viewer || !space) return false;
  if (viewer.all) return true;
  if (isClosed(space)) return Boolean(viewer.key && (viewer.owner || (Array.isArray(viewer.moderates) && viewer.moderates.includes(space.id) && isMember(viewer, space))));
  return mayEnterOpen(viewer, space);
}

// The rule for a space that is open. Only mayEnter and closedFor call it.
function mayEnterOpen(viewer, space) {
  if (viewer.all) return true;
  if (viewer.guestSpace) return space.id === viewer.guestSpace;
  if (viewer.doorGuest) {
    if (viewer.doorOn !== true || space.isLobby || space.id === 'lobby') return false;
    return entryOf(space) === 'guests' || (Array.isArray(viewer.granted) && viewer.granted.includes(space.id));
  }
  if (!viewer.key) return false;
  if (viewer.owner || space.isLobby || space.id === 'lobby') return true;
  return isMember(viewer, space) || entryOf(space) !== 'invited';
}

// Whether `viewer` is refused only because the space is closed: it would let them in if it were open. Such a person is
// told it is closed (and sees it on Home as closed); anyone else is told nothing, as for an id that does not exist.
const closedFor = (viewer, space) => Boolean(viewer && space && isClosed(space) && !mayEnter(viewer, space) && mayEnterOpen(viewer, { ...space, closed: false }));

// What a person who is only refused because the space is closed is told of it: its id, name, picture flag and description.
const closedView = (space) => ({ id: space.id, name: space.name, description: space.description || '', hasImage: Boolean(space.hasImage), entry: entryOf(space), members: [], isLobby: false, closed: true });

// Whether `viewer` may ask to enter `space`: it has request access on, is not the Lobby, and the viewer is a signed-in
// person (not the access key, not a link guest) or a door guest while the door is on, and may not enter it already.
function mayRequest(viewer, space) {
  if (!viewer || !space || viewer.all || viewer.guestSpace) return false;
  if (isClosed(space) || space.requestAccess !== true || space.isLobby || space.id === 'lobby') return false;
  if (viewer.doorGuest ? viewer.doorOn !== true : !viewer.key) return false;
  return !mayEnter(viewer, space);
}

// A space a person may only ask to enter, as they are told of it: its id, name, picture flag and description, and
// nothing else (no people, no counts, no phases). `request` is their own request's state: 'request' (may ask) or 'pending'.
function requestView(space, pending = false) {
  return { id: space.id, name: space.name, description: space.description || '', hasImage: Boolean(space.hasImage), request: pending ? 'pending' : 'request' };
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

module.exports = { ENTRIES, entryOf, isMember, isClosed, closedFor, closedView, mayEnter, mayRequest, requestView, enterable, openSpaceView };
