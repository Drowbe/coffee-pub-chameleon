// Presence by membership (plan-primary-nav.md, decision 6 and "Phase 2: the online people widget", built as step 3).
// GET /api/presence answers each viewer only what their own spaces let them see of where people are. Pure: the
// route hands in the store's records and LiveKit's participants, so a check can run the rules on their own.
//
// A viewer is one of:
//   { all: true }                     the access key (OBS, Studio): everything, as before;
//   { key, owner }                    a signed-in person; `owner` for owners and the admin, who belong to every
//                                     space and every aside (as `mine` and POST /api/call/join already treat them);
//   { guestSpace }                    a guest, by their guest link's space.
//
// Where a person is, to a viewer:
//   - in a space the viewer belongs to: `space` is its id;
//   - in an aside the viewer belongs to: `space` is the aside's id, `aside: true`;
//   - in an aside from a space the viewer belongs to (its origin): `space` is the origin's id, `aside: true`, never
//     on the call there;
//   - either way `asidePrivate` says whether that aside is a private conversation (never who else is in it);
//   - anywhere else: `space: null`, `elsewhere: true`, never on the call (online, with no place);
//   - a guest is told nothing of people outside their own space: they are left out, or, for that space's members,
//     shown as not online.
'use strict';

function belongsToSpace(viewer, space) {
  if (!space) return false;
  if (viewer.all) return true;
  if (viewer.guestSpace) return space.id === viewer.guestSpace;
  return Boolean(viewer.owner) || (space.members || []).includes(viewer.key);
}

function belongsToAside(viewer, aside) {
  if (!aside) return false;
  if (viewer.all) return true;
  if (viewer.guestSpace) return false;
  return Boolean(viewer.owner) || (aside.members || []).includes(viewer.key);
}

const { mayEnter } = require('./space-access');

const NOWHERE = Object.freeze({ space: null, aside: false, asidePrivate: false, elsewhere: false, inCall: false });
const ELSEWHERE = Object.freeze({ space: null, aside: false, asidePrivate: false, elsewhere: true, inCall: false });

// Where the person with `key`, in the call `p` (a participant from LiveKit, or undefined when in none), is to
// `viewer`. `spaceById` and `asideById` find the records.
function placeFor(viewer, key, p, { spaceById, asideById }) {
  if (!p || !p.space) return NOWHERE;
  const inCall = Boolean(p.inCall);
  const aside = asideById(p.space);
  if (aside) {
    // `asidePrivate` says which kind ("In a private conversation" or "In an aside"), never with whom.
    const asidePrivate = Boolean(aside.private);
    if (viewer.key === key || belongsToAside(viewer, aside)) return { space: aside.id, aside: true, asidePrivate, elsewhere: false, inCall };
    const origin = aside.origin ? spaceById(aside.origin) : null;
    if (origin && belongsToSpace(viewer, origin)) return { space: origin.id, aside: true, asidePrivate, elsewhere: false, inCall: false };
    return ELSEWHERE;
  }
  const space = spaceById(p.space);
  if (space && (viewer.key === key || belongsToSpace(viewer, space))) return { space: space.id, aside: false, asidePrivate: false, elsewhere: false, inCall };
  return ELSEWHERE;
}

// The space the stream hears (activeSpaceId), as the viewer may read it: a place they cannot see, an aside they are
// not in included, reads as null, so the page marks everyone it shows as off stream (the stream is not where they are).
function activeSpaceFor(viewer, id, { spaceById, asideById }) {
  if (!id) return null;
  if (viewer.all) return id;
  const aside = asideById(id);
  if (aside) {
    return belongsToAside(viewer, aside) ? id : null;
  }
  return belongsToSpace(viewer, spaceById(id)) ? id : null;
}

// The users, spaces and asides of GET /api/presence for `viewer`.
//   users, spaces, asides: the store's records; online: key -> participant (LiveKit's, this request);
//   present(key): the page heartbeat; describeUser(u) and describeSpace(space): what the answer carries of each.
function presenceView(viewer, { users, spaces, asides, online, present, describeUser, describeSpace, activeSpace }) {
  const spaceById = (id) => spaces.find((s) => s.id === id) || null;
  const asideById = (id) => asides.find((a) => a.id === id) || null;
  const find = { spaceById, asideById };
  const guestSpace = viewer.guestSpace ? spaceById(viewer.guestSpace) : null;
  const shownUsers = [];
  for (const u of users) {
    const p = online.get(u.key);
    const place = placeFor(viewer, u.key, p, find);
    if (viewer.guestSpace) {
      const here = place.space === viewer.guestSpace;
      const member = Boolean(guestSpace && (guestSpace.members || []).includes(u.key));
      if (!here && !member) continue;
      if (!here) {
        shownUsers.push({ ...describeUser(u), online: false, present: false, ...NOWHERE });
        continue;
      }
    }
    shownUsers.push({ ...describeUser(u), online: Boolean(p), present: Boolean(p) || present(u.key), ...place });
  }
  return {
    users: shownUsers,
    spaces: spaces
      .filter((s) => mayEnter(viewer, s))
      .map((s) => ({ ...describeSpace(s), mine: belongsToSpace(viewer, s) })),
    asides: asides.filter((a) => belongsToAside(viewer, a)).map((a) => ({ ...a, mine: true })),
    activeSpace: activeSpaceFor(viewer, activeSpace, find),
  };
}

module.exports = { belongsToSpace, belongsToAside, placeFor, activeSpaceFor, presenceView };
