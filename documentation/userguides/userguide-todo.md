# To-do

**Audience:** a player or game master using the To-do module on a Coffee Pub Chameleon server, and an owner setting it up.

The To-do module keeps a shared task list. There is one for the whole environment and one for each space. A task can have notes, a due date and a reminder. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (owner)

1. On the Modules tab, choose **Install** beside To-do under **Available with this server**, then **Approve and enable** (when a newer version comes with a server update, choose **Update** on its card instead; see [Modules](userguide-modules.md)). It asks to add two permissions to the Roles tab and to run reminders.
2. Once enabled it is on in every space; there is no switch per space.
3. On the Roles tab, under **Module: To-do**, choose who can **See the to-do list** and who can **Add, change and tick off tasks**. By default everyone can see it, members and moderators can edit, and guests can see but not edit.

## The environment's list

On Home, click the **Due soon** card's heading to open the full list. Choose **New todo** at the top of the page for the form with notes and a due date.

- Tick the box to mark a task done. **Open**, **Done** and **All** choose what the list shows. Open tasks are ordered by due date, with undated ones after, and done tasks are listed newest first.
- Click a task's name to change it, or delete it. A due date shows beside the task: Today and Tomorrow in the accent color, and a date in the past in red.
- Under the toolbar the environment's list also shows the lists of every space you belong to that has To-do on. Each is headed by its space's icon and name, and a row of your spaces shows or hides each one. You can tick off and change a space's task here if you may change tasks in that space; otherwise it opens read-only and says "Only people who can add tasks in <space> can change this."
- A new task asks **Where** it goes: the environment's own list (if you may change tasks there) or one of the spaces where you may. It starts empty every time, and **Save** says "Pick a space first." until you choose (in your environment's word for space). A task already saved stays where it is.

## To-do beside Global Calendar

When an owner turns on **Show in the top bar** on the Calendar's configuration page, the To-do is the **To-do** tab on the right of Global Calendar (see [Calendar](userguide-calendar.md), "Global Calendar"). It lists the open tasks from the environment and the spaces chosen under **Trips** (your environment's word for spaces), grouped **Overdue**, **Today**, **This week**, **Later** and **No date**, each with its space's icon, a tick box and its due date. **Open**, **Done** and **All** and **Add task** are at its top; ticking, changing and adding work in place, with **Where** as above. While Global Calendar is on, the To-do's own page and the **Due soon** heading lead to it. In the narrow layout it is the **To-do** tab at the bottom. Tasks with a due date also show on the calendar itself, on their due day (see "On the Calendar" below).

## Due soon on Home

On Home, the Modules column's **Due soon** card lists tasks that are not done and are due within the next week or already overdue, soonest first (up to eight), across every space you are in and the environment's own list. Overdue ones are marked in red, and each shows its space's icon. Click a task to open it. While Global Calendar is on, it opens there on the **To-do** panel (the **To-do** tab in the narrow layout) with the task's editor open; otherwise it opens in its space. The heading opens Global Calendar on its **To-do** panel (the **To-do** tab in the narrow layout) when it is on, and Calendar then keeps that choice; otherwise it opens the full list. From inside a space these open over the space, and you are Away on the call until you go back. Ctrl-click, Cmd-click, Shift-click, a middle click or Ctrl or Cmd with Enter opens it in a new tab instead, leaving home and the call alone. Tasks with no due date are not shown. See [Spaces](userguide-spaces.md).

## Add a task

Choose the **+** in the To-do's titlebar (**Add task**) for a blank task form. To type it instead, use `/t` in Chat while the To-do is open: `/t book flights by sep 25` opens the form with the task "book flights", due Sep 25. A day such as "tomorrow", "fri" or "9/29" works the same way, and anything it does not understand stays in the title. Nothing is saved until you choose **Save**. See [Chat](userguide-chat.md), "Commands".

The form opens in a window over the whole page (the whole screen in the narrow layout), with **Save** and **Cancel** always in view at the bottom and a **Close** button in its corner; closing it after typing asks "Discard your changes?". See [Modules](userguide-modules.md), "Add and edit forms". A task you may only read opens with no buttons and its fields greyed; **Close** or Escape just closes it.

## Open, Done and All

In a space, three icons in the To-do's titlebar, before the module's own buttons and set off by a pipe, choose what the list shows: the empty square for the tasks still open (its tooltip says how many), the ticked square for done tasks, and the list icon for all of them. On the environment's page, which has no titlebar to put them in, they stay as buttons at the top of the page.

## Link a task to an event or a poll

A task can point at a Calendar event or a poll, so the task shows what it is for: "Book flights" next to the retreat's dates, or next to the poll that is deciding where to go. Open a task, then in **Linked** type in the box to search your events and polls and choose one, or drag an event from the Calendar (or a poll's question from Polls) onto a task in the list (not onto the open form: while a form is open, the page behind it waits). The link shows on the task with the object's name and date, and the object is looked up each time, so it stays current. Click a link to open the object where it lives: its module opens beside the To-do (or its page) and shows the event or poll. The object shows the link back too: an event, or a poll, lists the tasks linked to it. If the object has been deleted, or you cannot see it, the link reads "Not available". A link works with whatever a module shares, including modules added to your environment later. A task can have up to five links.

An admin approves the To-do's links when enabling it, and they show only what you can already see in the Calendar and Polls.

## Following a linked object

Under each link in the task's editor, a line says what the linked object can report and asks what the task should do about it. For a poll closing, or a Calendar event having passed, you can choose **Tick this**, **Add the result to the notes**, **Tick this and add the result**, **Use the result as the title**, or **Link what it picked**. The result is a line such as "Where to stay: Hotel Nova". It is added to the notes once however often the poll announces it, and the task is only changed by choices you made. **Calendar: Add it to the calendar** (and the same for any other module that offers to do something) asks that module to act on the result: for a poll whose options have dates, the winning date goes on the Calendar as an event named for the poll and its winner. Only actions the result can fill in are offered, and it happens once however many people have the list open. An admin approves that the To-do may ask other modules for things. **Link what it picked** links the task to the object the winning poll option points at (see [Polls](userguide-polls.md)). What is offered depends on what the linked object reports, so a module added later brings its own choices. Tasks that were set to tick themselves before this keep doing that.

Other modules can also ask the To-do to link a task or set its due date, or, from To-do 1.14.0, to add a task made from an object: due on a task's own day, with a time it gives kept in the notes as "Due at 3:00 PM", and anything else it carries as lines in the notes. Any other kind of object becomes a task named after it, with no due date. In Chat, **Keep** on a task in an AI answer, or in research brought in from another AI, keeps it here by default ("in To-do"); see [Chat](userguide-chat.md), "Where an object is kept". See [api-modules](../api/api-modules.md), "To-do's createTask". Dropping a task on a Calendar day or event offers exactly that. See [Calendar](userguide-calendar.md).

An admin approves what the To-do may hear from other modules when enabling it (and, for a module that asks others to do things, what it may ask for).

## In a space

In a space the To-do is part of the **Calendar**: with the Calendar on, the two are one module, so the **Calendar** tab in the top bar and the **Calendar** switch in the **Layout** menu show the tasks on its **To-do** panel (see [Calendar](userguide-calendar.md), "A space's calendar"). Only when the Calendar is off does **To-do** have a switch of its own, opening as a column on the Workspace, floating over it, or in a window of its own, from the buttons on its titlebar. It shows that space's list; the environment's list is on the To-do's own page.

## On the Calendar

When the Calendar is on, a task with a due date shows on the Calendar on its due day, as a marker with the To-do's icon and colour and the task's title: in the all-day row in Week and Day, on the day in Month, and in the Agenda as **Due**, or **Overdue** (dimmed) once the day has passed. It is not a Calendar event and is not copied there. Click it to open the task here. Ticking the task done takes it off the Calendar, and changing its due date moves it. Anyone who can see the task can see its marker; the Calendar's **Tasks due** switch hides them all. See [Calendar](userguide-calendar.md), "Tasks due and polls closing".

## Reminders

Set **Remind people at 9:00 that day** on a task with a due date to send a notification at 9:00 on that day. Everyone in that space (or everyone in the environment, for one of its tasks) who is allowed to see the list gets a toast, a count on the bell in the top bar, and a number on the **Due soon** card's heading and on To-do's switch in the **Layout** menu until they open it or the bell. A space's task set from the environment's list, or from Calendar, reminds that space's people. Ticking a task done, changing its date or deleting it cancels the reminder. A due date whose 9:00 has already passed sends no reminder.
