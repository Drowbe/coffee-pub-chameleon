# Calendar

**Audience:** a player or game master using the Calendar module in a Coffee Pub Chameleon environment, and an owner setting it up.

The Calendar keeps sessions and events. There is one for the whole environment, and one for each space. An event can remind people before it starts. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (owner)

1. On the Modules tab, choose **Install** beside Calendar under **Available with this server**, then **Approve and enable** (when a newer version comes with a server update, choose **Update** on its card instead; see [Modules](userguide-modules.md)). The Calendar asks to add two permissions to the Roles tab and to run reminders.
2. Once enabled it is on in every space; there is no switch per space.
3. On the Roles tab, under **Module: Calendar**, choose who can **See the calendar** and who can **Add and change events**. By default everyone can see it, members and moderators can edit, and guests can see but not edit.

## Calendar sharing (owner)

Whether people may take the Calendar's events into their own calendar app, and bring their own calendars in, is set on the Calendar's configuration page. Owners and the admin can do this; anyone else who opens the page sees "Only owners can change this."

1. Open Manage on the **Modules** tab and choose **Module Configuration** on the Calendar's card. (The Environment tab also links here: "Calendar sharing is set in Calendar's configuration.")
2. Under **Calendar sharing**, flip the switches you want. Each saves as you flip it.
   - **Private addresses**: "Lets each person add this environment's events, or one space's, to their own calendar app with a private address." Off, every address stops working, without being deleted. See "In your own calendar app" below.
   - **Other calendars and busy times**: "Lets each person see their own calendars beside these events, only to them, and share when they are busy with a space's members, never what they are doing." Off, those calendars are hidden, without being deleted. See "Your other calendars" below. Sharing busy times is not built yet.
   - **Published calendar**: "One address with every space's events, for anyone you give it to." See "The published calendar (owner)" below.
3. Under **Top bar**, **Show in the top bar** puts **Global Calendar** in the profile menu of everyone who may see the Calendar; see "Top bar" in [Manage](userguide-environment-settings.md).

All three switches are off in a new environment, except that an environment made from the Travel template (version 5 or later) starts with **Private addresses** and **Other calendars and busy times** on. In an environment where an owner never set **Other calendars and busy times**, it follows **Private addresses**, as the single **Calendar feeds** switch did before, so nothing changes until you set it.

A switch that waits for an update to the Calendar is shown off and greyed, its line reading "Approve Calendar's update in Manage > Modules first.", with **Go to Modules** after it, to approve the update there. While the Calendar itself is off, the section says "Calendar is off, so none of these work until it is on." Names in these lines are the ones your environment uses.

## The published calendar (owner)

One address with every space's events, for anyone you give it to: a page for the whole environment, outside sign-in. Anyone with the address can read every event in it, without signing in, so hand it out as you choose. Owners and the admin set it up on the Calendar's configuration page; members never see it on their profile.

1. Under **Calendar sharing**, switch on **Published calendar**. The line under the switches reads "No address yet."
2. Choose **Make an address**. The address is shown once, with **Copy**, and the warning: "Copy it now. It will not be shown again. Give it to whoever should have it; anyone with the address can read every event in it, without signing in. Google can take 8 to 24 hours to show a change."
3. Give it to whoever should have it. They add it to Google Calendar (**Other calendars**, **From URL**) or Apple Calendar (**File**, **New Calendar Subscription**) as a private address is added; see "Your calendar in a calendar app" in [Accounts, roles and permissions](userguide-accounts.md).

Afterwards the line reads "Made <date>. Last read <time ago>." (or "Not read yet."). **New address** replaces it, so the old one stops working for everyone who has it; **Turn off** stops it. Both ask first. Turning the **Published calendar** switch off stops the address at once too, and hides this part of the page; the address is kept and works again when the switch goes back on.

It holds the environment's own events and the events of every space where the Calendar is on, in the calendar app under the environment's name, each event's description naming its space. The Lobby is never in it, and asides hold no modules. Never anyone's other calendars. While the Calendar itself is off, the address answers an empty calendar.

**Leaving a space out.** Every space is in it unless an owner leaves it out: on the space's own page (Manage > **Spaces**, then the space), the **Space** tab has a **Calendar** section with **In the published calendar**, on by default and saved as you flip it. The section shows only while the published calendar is on, and never for the Lobby. See "Add and set up a space" in [Spaces](userguide-spaces.md).

## Global Calendar

When an owner turns on **Show in the top bar** on the Calendar's configuration page (see [Manage](userguide-environment-settings.md), "Top bar"), **Global Calendar** is in the profile menu under your picture, with the Calendar's icon and the name your environment gives it after the word Global. It puts the Calendar and the To-do on one page: your events and tasks from the whole environment and every space you are in. In the narrow layout it is in the top bar's menu, after your spaces. It is separate from the **Calendar** tab of a single space (see "A space's calendar" below).

1. Open your profile menu and choose **Global Calendar**. If you are in a space, it opens over the space: you are marked Away on the call until you go back, and **Back to <space>** returns you. Otherwise it is a page of its own.
2. In the bar under the top bar, the arrows and **Today** are at the left, with the period's title. Next to them choose **Month**, **Week** or **Day**. **Day** is one column of hours with the all-day events above.
3. Click **Trips** (your environment's word for spaces) to choose whose events and tasks show: first the environment's own calendar, by the environment's name, then each of your spaces with its icon. The button says how many are on, such as "Trips (3 of 5)". With nothing on, the page says "Pick at least one in Trips." After the spaces come switches for tasks and polls, such as **Tasks due** and **Polls closing**; see "Tasks due and polls closing" below.
4. Use the arrows and **Today** above the calendar to move around. Click a day to select it.
5. At the far right of the bar, choose **Agenda** for the events from the selected day onward, grouped by day, or **To-do** for the open tasks (see [To-do](userguide-todo.md)). With the To-do off, or not yours to see, only the Agenda shows. Here nothing is listed under the grid: the Agenda is the list, and in the narrow layout it is the **Agenda** tab.

This browser remembers the view, what **Trips** shows and the tab on the right. In the narrow layout the page has three tabs at the bottom, **Calendar**, **Agenda** and **To-do**, and opens on **Day** until you pick another view.

Click an event, in the calendar or the Agenda, to open it in place. **Add event** works as below, and you can change any event in a space where you may add events. A task dragged onto a day sets its due date there, and an event dragged onto the To-do makes a task linked to it.

Global Calendar shows only while the Calendar module is on, an owner has turned it on, and you may see the Calendar for the whole environment. While it shows, the Calendar's and the To-do's own pages, and the **Coming up** and **Due soon** headings on Home, lead to it. Guests never see it.

## The environment's calendar

Without Global Calendar, click the **Coming up** card's heading on Home to open the full calendar. You see a month with each day's events. Use the arrows and **Today** to move around, and the four view buttons (icons; hover for the name) to switch between **Month** (the grid, with that month's events listed under it), **Week** (seven days with their events in full, and that week's events listed under them; the arrows step a week), **Day** (one day's hours, with no list) and **Agenda** (what is coming up).

The environment's calendar also shows the events of every space you belong to that has the Calendar on. Each shows its space's icon (the space's launch-link icon, or the message icon if it has none) before the time and title, and in the list beside the space's name. A row of your spaces under the toolbar shows or hides each space. You can change a space's event here if you may add events in that space; otherwise it opens read-only and says "Only people who can add events in <space> can change this."

## A space's calendar

In a space, the **Calendar** tab in the top bar shows the Calendar and the To-do together for that space (the same page as Global Calendar, for one space: no list of spaces to choose, and no calendars of your own). It fills the Workspace, loads as saved each time you press its tab, and does not set you Away on the call. The call and the chat stay in the column beside it. It shows that space's events, and the environment's events beside them marked **environment**. The environment's events are read-only in a space; change them on the environment's calendar. Its **Month | Week | Day | Agenda** views and its **Agenda | To-do** panel work as described above.

The Calendar can also be switched on as a module from the **Layout** menu, where it appears as **Calendar** (the Calendar and the To-do are one switch), docked as a column or floating, or in a window of its own.

Days inside a dated phase of the space are tinted with the phase's colour (see "Phases" in [Spaces](userguide-spaces.md)). A soft wash fills each such day in the **Month**, **Week** and **Day** views, and the phase's name is shown on its first day and on the first day a view shows; **Day** keeps a phase bar over the all-day events. A space with no phases, a day in none and the environment's own calendar have no tint.

To see this space's events alone in your own calendar app, make an address for the space on your profile's **Calendars** tab; see "Your calendar in a calendar app" in [Accounts, roles and permissions](userguide-accounts.md).

## Settings

On your profile page, under Module settings, **Open on** chooses the view the Calendar opens on: Month, Week, Day or Agenda. If you had chosen Month + list, which is gone, it opens on Month. On a wider screen, Global Calendar opens on the same view when it is Month, Week or Day, and on Month for Agenda, until you pick a view there.

## Coming up on Home

On Home, the Modules column's **Coming up** card lists the next seven days of events, up to eight, across every space you are in that has the Calendar on and the environment's own calendar, each with its space's icon; repeating events show on the days they land on. Click an event to open it. While Global Calendar is on, it opens there on the event, with its editor open; otherwise it opens in its space. Click a day in the small month to open the calendar at that day, and the heading for the full calendar: Global Calendar when it is on, on whichever of **Agenda** and **To-do** you chose last, else the Calendar's own page. From inside a space these open over the space, and you are Away on the call until you go back. Ctrl-click, Cmd-click, Shift-click, a middle click or Ctrl or Cmd with Enter opens it in a new tab instead, leaving Home and the call alone. See [Spaces](userguide-spaces.md).

## Add and change events

If you can edit, choose **Add event** (the **+** in the Calendar's titlebar; at the top of the page in Global Calendar), or click a day in the month. Outside a space, choose **Where** first: the environment's own calendar (if you may add events there) or one of the spaces where you may add events. It starts empty every time, and **Save** says "Pick a space first." until you choose (in your environment's word for space). An event already saved stays where it is; **Where** shows it and can't be changed. In a space the event goes in that space. Give it a title, a date, and a start and end time (or tick **All day**), and add details if you like. Choose **Save**. Click an event to change or delete it; the delete button asks you to click a second time. When something else points at the event (a task, or an object on a plan), it says so first, for example "Used by 1. Really delete?". If two people change the same event at once, the second person is told and can reopen it to see the other change.

The form opens in a window over the whole page (the whole screen in the narrow layout), with **Save** and **Cancel** always in view at the bottom and a **Close** button in its corner; closing it after typing asks "Discard your changes?". The date pickers open inside it. See [Modules](userguide-modules.md), "Add and edit forms". An event you may only read (the environment's, in a space) opens with no buttons and its fields greyed; **Close** or Escape just closes it.

To type an event, use `/c` in Chat while the Calendar is open, and the New event form opens filled in: `/c meet with bob sep 29 at 7pm` gives the title "meet with bob", the day Sep 29 and the time 7:00 PM. Days can be typed as "tomorrow", "fri", "next mon", "sep 29", "29 sep" or "9/29"; times as "7pm", "7:30pm", "19:00", "at 7", "noon" or "midnight". Whatever it does not understand stays in the title, and you can change anything before saving. See [Chat](userguide-chat.md), "Commands".

Events appear for everyone who has the calendar open as soon as they are saved.

## Picking a date

Each date field (start, end and the last day of a repeat) has a calendar button beside it. The same picker is on the To-do's due date and on a poll's closing time. It opens a small month, with the days of the week across the top, so you can see what day a date falls on; choose a day to fill the field, or use the arrows to change month, **Today**, or **Clear** on the optional fields. Typing the date still works, and the day of the week it lands on appears under the field either way. When you are choosing an end date the days between the start and the end are shaded.

## Events that last more than a day

Give an event an **Ends** date, and a time if it is not all day, to make it run over several days: a trip, a convention, a night train. An all-day event's end date is its last day. The event shows on every day it covers in the month, with its time on the first day and an arrow on the days after, and the list shows its whole span, such as "Sep 22 - Sep 25". Leave **Ends** empty for an event on one day, and for a timed event you can give just an end time. A repeating event keeps its length in every repeat. Reminders still go out before the start.

## Linking an event elsewhere

An event can be dragged onto a task in the To-do module, or onto an open task there, to link the task to it. The task then shows the event's name and date, and clicking that link opens the event here. When you open an event that tasks (or anything else) link to, it lists them under **Linked from**, and clicking one opens it. See [To-do](userguide-todo.md).

## Events from a plan

When the space also has the Planner, every object on the plan with a date is an event here too, and the two stay in step. Change its title, day or time here and the plan changes; change it on the plan and it changes here. An event you add here stays on the Calendar only.

Such a copy is marked with the plan object's icon, and its tooltip and form say it is from the plan ("from the Itinerary"). A few things belong to the original, so the form shows them without letting you change them: how long it lasts and **All day**. Ticking **All day** never erases the original's time. A copy with a time is shown in the clock of the trip, as the plan wrote it, not in yours; when that is not your own clock, the event's tooltip says so ("Lisbon time").

To take a copy off the Calendar, open it and choose **Hide**. The form first says "This hides it from the Calendar. The Itinerary keeps it. Hide it?" A hidden copy is gone for good: the object stays on the plan, and the Calendar does not make the copy again, even if the object's day changes. See [Planner](userguide-planner.md), "On the Calendar".

## Dropping something on the calendar

Drag an object from another module (a task, say) onto a day or an event. Anyone may drop on the calendar; what is offered is only what you may do, so someone who can't add events can still set a task's due date. If there is one thing to do with it, it happens; if there are several, a small menu asks which. On a day you can add the object to the calendar as an event on that day, or, for a task, set the task's due date to that day. On an event you can link the task to the event, or set the task's due date to the event's date. The choice you made last time for that kind of object and place is listed first, marked "last used", so a repeat drop is one click. The choices come from what the other modules can do with the object, so a module added later can add more. A short note confirms what was done.

## When an event has passed

Once an event is over, the Calendar tells the modules that follow it, once, with a line such as "Trip day one, Sep 19". A task linked to the event can then tick itself and keep that line in its notes, if you chose that for the link (see [To-do](userguide-todo.md)). It is announced by whoever has the Calendar open first after the event ends, so it waits for someone to open it if nobody has. Repeating events are not announced, and neither is one that ended more than a week ago. Changing an event's date makes it announce again when the new date passes.

## Repeating events

Set **Repeats** to every day, week, 2 weeks, month or year, and optionally an **Until** date. The whole series is one event: changing it changes every occurrence, and deleting it deletes them all. A monthly event stays on its day of the month, or the last day of a shorter month. Repeating events show a small repeat mark in the month and a tag in the list.

## Reminders

Set **Remind people** on an event to send a notification when it starts, 15 minutes before, an hour before, or a day before. Everyone in that space (or everyone in the environment, for one of its events) who is allowed to see the calendar gets a toast, and a number on the Calendar's switch in the **Layout** menu until they open it. A space's event made or changed from the environment's calendar, or from Global Calendar, reminds that space's people. Changing an event moves its reminder, and deleting it cancels the reminder. An event with a reminder time that has already passed gets no reminder. A repeating event reminds people before every occurrence, including while nobody has the calendar open.

## In your own calendar app

If the owner has turned on **Private addresses** (see "Calendar sharing (owner)" above), you can see these events in Google Calendar, Apple Calendar or
Outlook through a private address made on your profile's **Calendars** tab: an **Everything** address with every event you can see, or an address for one space with that space's events alone, as a calendar named after the space. See "Your calendar in a calendar app" in
[Accounts, roles and permissions](userguide-accounts.md). An owner can also publish one calendar with every space's events for anyone to read; see "The published calendar (owner)" above.

## Your other calendars

While the owner has **Other calendars and busy times** on, events from your own other calendars (added on your profile; see "Your other calendars in Chameleon" in
[Accounts, roles and permissions](userguide-accounts.md)) show on the Calendar's own page and on Calendar in the top
bar, for you alone. They look muted and italic, with a coloured edge and a tag naming the calendar; in the narrow layout's month
they are hollow dots. Opening one says "From your <name> calendar. Only you see this." and it can't be changed. Each
calendar has its own entry in the filter, marked "(only you)"; while one is off, the filter's label adds
"· Other calendars (1 of 2)". They never show inside a space (on its canvas, in a window popped out of it, or on
Calendar opened over a call) or in the **Coming up** card, and they refresh every 30 minutes.

## Tasks due and polls closing

When the To-do or Polls is on, the Calendar also shows their tasks and polls as markers: small chips with the module's icon and colour that point back to the task or poll. They are not events, and nothing is copied into the Calendar. You see a marker only for a task or poll you can already see.

- A task with a due date shows on its due day, as its title: in the all-day row in **Week** and **Day**, and on the day in **Month**. In the Agenda it reads **Due**, or **Overdue** once the day has passed, when it is also dimmed. Tick the task done and its marker goes.
- A poll with a closing time shows at that time: "Closes 6:00 PM: Where for dinner?". After the time passes it stays, dimmed: "Closed 6:00 PM: Where for dinner?". A poll someone closes by hand, and a poll with no closing time, has no marker.
- Click a marker to open the task or poll in its own module; hold Ctrl or Cmd to ask for a new tab. A marker can't be dragged, changed or deleted on the Calendar: change the task or the poll itself.

Which markers show follows where you are. A space's Calendar shows that space's tasks and polls. The environment's calendar and Global Calendar show the environment's own and those of every space you are a member of, following the same space switches as the events.

To hide a kind of marker:

1. On Global Calendar, click **Trips** (your environment's word for spaces) and switch off **Tasks due** or **Polls closing**, after the spaces. This browser remembers the choice, and while one is off the button's label adds it, such as "Trips · Tasks due off".
2. On the environment's calendar, click **Tasks due** or **Polls closing** in the row under the toolbar, after the spaces.
3. In a space, choose **Show** in the Calendar's toolbar, then the kind; the menu opens under the button and says **Shown** or **Hidden** beside each. This browser remembers the choice for each space.

A switch appears once the Calendar has shown a marker of that kind, and each is on to begin with. The switches on the environment's calendar are not remembered after you leave the page. Markers never go into your calendar app's feed, and the Calendar sends no reminders for them; the To-do and Polls keep their own.

## Events other modules add

Another module can ask the Calendar to add an event, made from an object (from Calendar 1.23.0), and in Chat **Keep** offers "Add to Calendar as an event" for an event or another object with a day (see [Chat](userguide-chat.md), "Where an object is kept"): an event with a start time becomes a timed event, ending at its end time or after its length (an end time with no day of its own that comes before the start is the next day's, so 22:00 to 01:00 runs past midnight), and anything else is an all-day event on its day. Its title and a short plain description come with it, with anything else it carries as lines such as "Address: 1 Main St". Flights, stays, meals and visits are not added this way: they reach the Calendar through the Planner (see "Events from a plan"). Something without a day is refused: "that needs a day to go on the calendar". A start time is read in the time zone of the browser whose Calendar adds the event, so a 7:00 PM start added from a browser set to another zone lands at a different time. See [api-modules](../api/api-modules.md), "The Calendar's createEvent".

## Limits

An event belongs to one day; an end time later that day is fine, but events that run across midnight are not shown on more than one day. There is no way yet to skip one occurrence of a repeating event or change just that one. Times show in each person's own time zone.
