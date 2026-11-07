# Product screenshots (demo data)

Made from the Demo: Portugal space (seeded by `npm run seed:demo`), signed in as the demo person Mia Alvarez
(moderator), at 1440x900 and 2x unless noted. Each screen is in `-light` and `-dark`. No call is shown: there was
no LiveKit server, so a call could not be run and none was faked. The Maps module was not captured (no map file, so
no tiles).

The app still says "Collaborator" in places (rename to Chameleon not done). **Collaborator is visible in every
file below except the two marked "no".**

| File stem (add -light or -dark, .png) | What it shows | "Collaborator" visible |
|---|---|---|
| chameleon-home | Home: the list of spaces (Demo: Portugal with its people and Enter), who is around, and the module cards on the right | yes (top bar) |
| chameleon-workspace | A space with the canvas showing the Itinerary (Planner) and Calendar modules docked side by side, chat in the column on the left | yes (top bar) |
| chameleon-calendar | The Calendar tab of the space: month grid with the agenda beside it | yes (top bar) |
| chameleon-calendar-todo | The same Calendar tab with its To-do view open beside the month | yes (top bar) |
| chameleon-polls | The Polls module with two open polls and their votes | yes (top bar) |
| chameleon-budget | The Budget module overview: target, spend by category and target left over time | yes (top bar) |
| chameleon-places | The Places module: saved places grouped as food, stays and sights | yes (top bar, and the "Collaborator" scope button in the module) |
| chameleon-research | The Research module: a card grid of notes, links and an AI answer | yes (top bar) |
| chameleon-vault | The Documents module (the Vault): a list of five files (three pictures, a note, a PDF) | yes (top bar) |
| chameleon-chat | The chat column only (cropped, 640x1552): discussion messages, Assistant tab, Start call and the message box | no |
| chameleon-layout-menu | The Layout menu open: Show switches for each module, Arrange (Panel or Window Mode) and Layouts | yes (top bar) |
| chameleon-modules-page | Manage, Modules tab (signed in as the environment's admin, since a moderator has no Manage): the module list with Enabled switches | yes (top bar) |
| chameleon-phone-space | The space at 390x844 on a phone: Itinerary module with the bottom tab bar (Chat, Itinerary, More, Start, Online, Leave) | no |

Notes
- The Documents files are invented pictures, a note and a PDF made for this shot and added through the module's
  Add files.
- Workspace, Places and the others use Panel Mode with only the named modules switched on. To-do is not its own
  column in the canvas: it is the To-do view of the Calendar, so the Planner, Calendar and To-do trio is shown as
  workspace (Planner and Calendar side by side) plus calendar-todo.
- chameleon-home-dark also lists "admin" as online (the admin's browser was open at the same time).
- Count of files: 26.
