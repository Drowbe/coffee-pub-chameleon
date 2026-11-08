# Chat

**Audience:** anyone in a space on a Coffee Pub Chameleon server who types in Chat: to talk, to ask the AI, to add something to a module, or to bring in research from another AI.

Chat has one box, **Chat or type / for commands...** ("Chat, or / for commands", or just "Chat", when the chat is narrow), and two tabs above the messages: **Discussion** and **Assistant**. The chat is in the column beside the Workspace, in every layout tab (see [The call](userguide-call.md), "The column: the call and the chat, always on"). It is also on Home, where it is the environment's own chat.

- **Discussion** is the conversation everyone in the space sees. Plain text typed there is a message to the space.
- **Assistant** is yours alone: your commands, the AI's answers and what you bring in from another AI. Only you see it. Plain words typed there ask the AI, as `/ai` would.

Text that starts with a command does something else: `/ai` asks the AI privately, and a module's command opens that module's add form. A command typed in Discussion switches you to Assistant first and runs there, so Discussion shows nothing of it. Every command you type shows in Assistant as your own **private** message, with the module's icon and colour. A number on **Discussion** counts what is new there while you are in Assistant, and a dot on **Assistant** marks a new result; both are read out to a screen reader. Formatting, pictures and history are covered in [The call](userguide-call.md), "Chat".

Who can use it: anyone allowed to send messages in the space (set per role on the Roles tab). Commands work only in a space, not in an aside.

## Commands

| Command | What it does | Needs |
| --- | --- | --- |
| `/ai` | Asks the AI, privately | See "Ask the AI" below |
| `/t` | Opens To-do's new task form | [To-do](userguide-todo.md) open |
| `/c` | Opens the Calendar's new event form | [Calendar](userguide-calendar.md) open |
| `/r` | Opens a new Research note, or a link when you type a web address | [Research](userguide-research.md) open |
| `/p` | Opens the Planner's form for the day you name, or the day in view | [Planner](userguide-planner.md) open |
| `/v` | Opens a new poll with your question | [Polls](userguide-polls.md) open |

A module's command opens the same form as its own add button, filled in from what you typed, and saves nothing until you choose **Save**. A date and a time in the text are picked out: `/t book flights by sep 25` makes the task "book flights", due Sep 25. The list comes from the modules on in the space, so a module installed later can add its own.

1. Type `/` on its own, or open the formatting menu (the icons button left of the box) and choose **Commands**.
2. Choose a command. It goes into the box, and the box shows a hint for what to type.
3. Type the rest and press Enter.

What to know:

- **The module must be open.** If it isn't, the text stays in the box and a line under it says so, for example "To-do isn't open". Switch it on from **Layout** in the top bar and press Enter again.
- **An unknown command** stays in the box with "No command /x". Nothing is sent to the space. Text that starts with `/` is never sent as a message.
- **Two modules with the same command** are both listed, each with its module's name. If both are open, the line under the box asks you to choose from the list.

## Ask the AI

Type `/ai` and your question, then press Enter. Your question and the answer appear in the **Assistant** tab marked **private**: nobody else in the space sees them. The answer is from **AI**, in gold. Both are kept for you in this space, after a refresh or on another device, with your other private messages.

To show an answer to everyone, share it (see "Private, public and shared" below). Others then see it in their Discussion from **AI, for <your name>**, with your question above it.

Each answer has:

- **Copy**, which copies its text.
- **Keep**, on each object the answer holds (a hotel, a sight, a note), followed by where it goes: "in Planner", "in Research". Each object shows its title as plain text and, under it, a line of its details ("Southwest 1234 · MDW 12:50 → SJC 15:25 · ABC123"). When more than one module can keep it, "in <module>" is a menu: choosing **Add to <module> as <a kind>** keeps the object there at once. See "Where an object is kept" below. The button then reads **Kept**, or **Waiting** if that module isn't open (the object arrives when someone next opens it), and can't be pressed again. For Polls it reads **Opened in Polls**, since it only opens a form, and you can press it again.

Under each answer, a line starts **AI used:** and says what went to the AI with your question. It names the objects you attached as links that open them, then counts the rest: related objects found by the words of your question, linked objects, earlier questions, chat messages and people (the last two only if the owner allows them). When the AI searched or read objects in this space to answer, the line says **looked up N objects** and links the first few it read. "just your question" means nothing else was sent. A second line may say **Not sent:** and how many objects were from another space or kept out by the owner's setting, **Some objects were left out to fit** when the question was too long for everything to go, or **The answer was cut short** when the AI ran out of room. Where the answer cites an object as [1] or [2, 3], each number is a link that opens that object, whether you attached it, the AI found it as related or it looked it up.

The AI can look things up only when the owner allows it (**Let AI look things up**, in **What AI may see**), and only in this space, and only objects you could open yourself. If an answer takes a few seconds, the note under the box changes from "Asking the AI..." to "Looking things up...". It may search and read up to 8 times and take up to two minutes; if it cannot finish, Chat says so ("The AI didn't finish its answer." or "The AI service took too long to answer. Try again in a moment."). Looking things up is still one question: it uses one of your six a minute. It cannot change anything.

When you share an answer with the space, others see it with their own **looked up N objects**: only the objects that person can open are counted and linked, so the number can differ from yours.

To ask about something you already have, drag it onto Chat while `/ai` is in the box; the line under the box says how many objects the question will use. Dropped objects show as chips under the box and go with one question. You may leave the question empty: with an object attached, Chat asks "What should I know about <its title>?" for you. Research's **Research this** and a drop menu's **Ask the assistant** do the same for one object.

Who can: anyone signed in, except guests, whose role has **Use AI in modules** (on for moderators and members unless an owner turned it off), in a space where **Turn AI off in this space** is not ticked, and who can chat there. The owner must have set up an AI service first; see [Assistant](userguide-assistant.md). When you can't, Chat says why before you type, in one sentence: guests can't use AI, your role can't use AI, AI is turned off in this space, you are not in this space, your role can't chat here, AI is not set up here, or this environment has used its AI allowance for the month.

A question is 3 to 1,000 characters. A longer one is refused, not cut, with "A question is at most 1,000 characters; this one is N." Only objects from this space go to the AI: an object from another space is left out and the **AI used:** line says so. The AI also sees what the owner allows (see [Modules](userguide-modules.md), "The AI service"), and never what you could not open yourself. Your question carries your time zone, so "today" and "this week" are yours. You can ask six times a minute; a question that fails before the AI service did any work is not counted.

## Private, public and shared

Every message has a **private**, **public** or **shared** badge in its header. A message is public when you type it plainly in Discussion, and private when it is a command or an AI answer. Only you see your private messages; not even an owner or the admin sees them. They are in your **Assistant** tab, and public ones are in **Discussion**.

1. To show one of your private messages to the space, open its **⋮** menu and choose **Share**. The menu says "Everyone in this space sees it in Discussion". Or click the badge and choose **Make public**.
2. To take it back, click its badge and choose **Make private**.

The message itself moves: nobody gets a copy. A command or an AI answer you shared shows in everyone's Discussion and stays in your Assistant too, marked **shared**. Made private again, it disappears from their chat. Only the person who wrote a message can change it, and guests can't. Pictures are always public and not kept.

With nothing in Assistant it says "Your commands, AI answers and what you bring in show here. Only you see them." The tab you were on is remembered for this space until you close the browser tab.

## Links

When Research is on in the space, the first link in an ordinary message gets a box under it: the page's picture,
its title (which is the link), up to three lines of its description, the site's name and **Keep**. The box has
Research's colour on its left edge and icon. If the owner turned off Research's **Fetch link previews**, the box is one
plain line, the icon, the site and **Keep**, and nothing is fetched. Pictures come only through this server, never
straight from the other site.

**Keep** saves the link into Research, credited to you; it arrives when Research is next open. Everyone sees
"Kept by <name>" at once. A link can be kept once. You
see **Keep** only if you may add to Research, which by default leaves out guests. A private message keeps its box for
you alone.

## Send a message to a module

Any message in a space's chat can be sent to a module that can take it: a picture to Research, a message to the To-do as a task, a link to Research, an AI answer's objects to the Planner.

1. Open the message's **⋮** menu and choose **Send to...**. It is there only when something on in this space can take that message, and only places you may add to are listed.
2. Choose a place. It is sent at once, and the line under the box says how it went.

What the places look like:

- **One thing:** "<module> as <what>", such as **Research as an image**, **To-do as a task**, **Research as a link** or **Polls as a poll**.
- **A day in the message:** also **Calendar as an event** and **Planner as an event**, and **To-do as a task** gets that day as its due date. Without a day, the Calendar and the Planner aren't offered. Chat reads a day only from words that are clearly a date, and never from quoted lines (those starting with `>`): "on Friday", "next Friday", "Friday", "Nov 14", "14 November", "on 12/10", "12/10 at 7pm", "2026-11-14", "tomorrow". It ignores "today" and "tonight", and a short weekday such as "sat" unless it follows "on", "next" or "this". A date already past this year means next year's.
- **An AI answer with several objects:** one entry per module with how many it takes, such as **Planner (3)**, and a hint like "2 flights, 1 stay; 1 left out" for what that module can't take. Polls opens one form at a time, so for several polls its entry opens the first ("Opens the first of 3") and the note adds "The other 2: use each one's own Keep."
- The place you last used for that kind of message (a picture, a link, words, an AI answer's objects) comes first, marked **Last used**, in this browser.
- On a private message, each entry's hint says "Everyone in this <space> will see it": sending puts what it says where the space can see it.
- A module that opens a form (Polls) must be open: its entry says "Open Polls first", and choosing it sends nothing ("Polls isn't open."). When the form opens, Polls is brought forward, and in the narrow layout it replaces Chat in view. Nothing is saved until you choose **Start poll**.

What the line under the box says:

- "Added to Research as a note." with anything the module adds, such as the Planner's note about a date outside the plan;
- "Research is adding it." while it is under way (a **Keep** button reads **Adding**);
- "Waiting for Polls to open it." while a form is on its way, then "Opened in Polls." (and Polls is brought forward) or "Polls isn't open." Chat keeps watching for up to 70 seconds;
- "Waiting: it is added when To-do is next open." when the module isn't open anywhere;
- "Research couldn't add that: <the reason>.";
- "Sent to <module>." when how it went can't be read (for a guest, say).

**Keep** and **Keep ticked** in an AI answer or the import preview use the same words. The line is read out by screen readers. You can ask for up to 60 things a minute from Chat (sends, keeps and commands together); past that, "too many requests in a minute, slow down".

**Pictures.** A picture is sent into the module's own pictures (Research's, for this space) first, as you, and then added. A GIF, or any picture that isn't a JPEG, PNG or WebP, is sent as a JPEG of its first frame. Pictures in a call aren't kept, so **Send to...** is offered for a picture only while your page still holds it: not after a refresh, and not for a picture sent before you joined. A picture that can't be sent reads "That picture can't be sent to Research." If the module refuses it, the uploaded picture is removed again, unless it is already a photo there; if the module is never opened within seven days, it is removed then.


## Clear messages

Chat's menu (the **⋮** in its header) reads **Save the chat**, **Clear…** and, for moderators, owners and the admin,
**Delete the chat**.

1. Choose **Clear…**. It lists what you can clear, each with how many: **Chat messages**, **AI**, one line for each
   module's command messages (with its name, icon and colour, or its command, such as "/t", if the module is gone),
   and **All of them**. The counts include both tabs.
2. Choose one.
   - A member clears only their own: for example "Clear your 12 AI messages?". Confirm it.
   - A moderator, an owner or the admin chooses **Clear yours (n)** or **Clear everyone's (n)**. Everyone's says
     "Private messages of others stay.": it takes every public message of that type, and your own private ones,
     never anyone else's private messages.
3. Clearing **Chat messages** or **All of them** also takes the pictures on your screen.

When someone clears everyone's messages, the others in the space see one line saying so, for example "Mo cleared the
AI messages.". It isn't kept.

**Clear…** shows in a space, not an aside, to signed-in people, when there is something to clear. Guests never see
it. **Delete the chat** removes every message, for everyone, private ones too.

Chat keeps the space's last 500 public messages and each person's last 200 private ones, none older than 30 days.

## Colours

Each module has a colour, and it shows in three places: on the messages its command made, on the module's icon in its titlebar, and on its line in the **Layout** menu. The AI is gold, Research blue, the To-do green, the Calendar red, the Planner teal, Polls purple, Places orange and Maps pink. Plain messages have none.

## Bring in research from another AI

You can research in another AI and bring what it finds into Chameleon as objects. This uses none of the environment's AI.

1. Open the formatting menu and choose **Bring in research** (it switches you to the **Assistant** tab). It shows only to people who may use `/ai` here (the same rule as "Ask the AI", with or without an AI service set up), and only where some module on in the space can keep an object (the Planner, Research, the To-do and so on).
2. Choose **Copy instructions for another AI**, paste them into the other AI, then ask your question.
3. Paste its whole answer into **Paste the whole answer here** and choose **Preview**, or choose **Choose a file** and pick its `.objects.json` file.
4. A preview marked **Brought in** lists each object with a tick, its title, a line of its details and **Keep in <module>**. Untick any you don't want.
5. To send an object somewhere else, open the "in <module>" menu beside its **Keep** and choose **Add to <module> as <a kind>**. This only chooses the place; nothing is kept yet.
6. A flight, train, bus, ferry, car, stay, meal, visit, event or task with no day shows **No day** and a date field, when something here could keep it with a day. Click **No day** or the field and fill it in, or leave it empty to keep the object with no day. With more than one such object, **Same day for all** at the bottom fills every empty one; it never changes a day you picked yourself.
7. Choose **Keep ticked** and confirm. Each ticked object goes to the place its row shows, and the confirm names them: "Keep 3 flights and 2 stays in Planner, 1 task in To-do?". It also says what it leaves out:
   - a poll, which opens a form: "2 polls open a form each in Polls: use each one's own Keep.";
   - one whose module must be open and isn't: "2 polls need Polls open.";
   - one nothing here can keep: "1 can't be kept here."

   You can also keep one object at a time with its own **Keep**.

Pasting an answer straight into the Chat box works too: when it holds objects, **Bring in N objects** appears beside Send and opens the same preview.

What the instructions ask the other AI for:

- **Only what can be kept here.** They name the kinds of object the modules on in this environment can take (flights, stays, restaurants, tasks and so on), each with the details worth writing down, such as a flight's airline, number, airports, times and booking reference. Turn a module off and its kinds drop out the next time you copy them.
- **A whole itinerary, one object per leg.** Each flight, train, stay, meal, visit and event is its own object, with its own date and times; a return flight is separate.
- **Dates as given, never guessed.** The AI is told to copy dates from what you gave it and, if one is missing, to ask you before it answers. If you don't know, it leaves the date out. `/ai` can't stop to ask, so it leaves the date out and says which dates it still needs.
- **Times in the local time where things happen**, on the 24-hour clock, with no time zone: a 12:50 departure from Chicago stays 12:50.

Instructions copied since 2026-09-30 still work, but copy them again to get these. With every bundled module on, they name every kind: flights, trains, buses, ferries, cars, stays, restaurants, cafes, bars, sights, museums, tours, shows, events, tasks, polls, notes and links. Each kind is named only while a module that takes it is on (tasks with the To-do, polls with Polls, and so on).

### Where an object is kept

**Keep**, in an AI answer and in the **Brought in** preview, offers every module on in this space that can take that kind of object and that you may add to. A module that only takes an object with a day, such as the Calendar, is left out for one without a day. The first choice is:

1. the place you last chose for that kind of object, in this browser (marked **Last used** in the menu);
2. otherwise, a module that takes that kind by name. When several do, the most specialised comes first, the one that takes the fewest kinds: a note goes to Research before the Planner, an event with a day to the Calendar, a flight to the Planner, a task to the To-do, a poll to Polls, a link to Research. One exception: an event whose title reads as travel goes to the Planner first; the Calendar is still in the menu. A title reads as travel when it names a tour, an excursion, a shuttle, a flight, a train, a ferry, a cruise, a bus, a taxi, a boat trip, a day trip, a road trip, a rental car or car hire, or an airport pickup or drop-off; a coach counts in "Coach to Oxford", and a transfer in "Airport transfer" or "Transfer to the hotel". "Bank transfer due" stays with the Calendar. A few titles count as travel when they aren't, such as "Flight of stairs" or "Train the trainer": choose the Calendar once and it becomes the first choice for events in this browser;
3. otherwise, a module that takes any object: Research first, as a note, so an object with no kind, or a link with no address, goes to Research. A module that only opens a form, such as Polls, is never the first choice for a kind it doesn't name.

With Research off, notes and events still go to the Planner.

**Each object keeps the place it shows.** The place is settled when the object is first drawn, and then only you change it, from its menu. If that place stops being allowed (a module turned off, say), the object moves to the next one: its own **Keep** then says "Planner can't take this now. It goes in Research: press Keep again.", and **Keep ticked**'s confirm starts "2 have a new place: the one before is no longer allowed."

Keep runs one at a time. Once an object is **Kept** or **Waiting**, its button stays off, its place shows as plain words with no menu, and its day field is off (**Same day for all** skips it). **Keep ticked (n)** counts only the objects it would send. The preview uses the modules on in the space when it is drawn.

What each module does with it:

- **Planner:** fills a flight, a stay, a meal or a visit's own fields, and puts anything it has no field for into Notes as a line such as "Cabin: 4B"; see [Planner](userguide-planner.md), "What other modules bring".
- **Research:** a note, with the details as lines after its text ("Starts: 2026-11-14 19:00"), and its tags, day and place on the map kept; a link is saved as a link. See [Research](userguide-research.md), "Links from Chat".
- **To-do:** a task, due on its day; **Calendar:** an event on its day, timed when it has a start time.
- **Polls:** opens the New poll form filled in, on your own open Polls; nothing is saved until you choose **Start poll**. If Polls isn't open, Keep says "Polls isn't open." and the menu shows "Open Polls first".

An answer or file written from instructions copied before 2026-09-30 is in an older format and is refused, with nothing brought in: "that answer is in an older format: copy the instructions again and ask the AI for a new answer" (or "... for a new file"). Copy the instructions again, give them to the AI and ask it for a new answer. Pasted into the Chat box, such an answer offers no **Bring in** button. The limits (50 objects at a time, 256 KB, the "External source" line) are in [Assistant](userguide-assistant.md), "Bring in research from another AI".
