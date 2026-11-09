# Planner

**Audience:** a player or game master planning a trip with the Planner module on a Coffee Pub Chameleon server, and an owner setting it up.

The Planner module plans one trip for a space, day by day. In an environment set up from the Travel template it is shown as the **Itinerary**, and its window is named for that, not for the trip. The space's Calendar events, to-dos and polls that fall on the trip's days join the plan, and the module adds what a trip needs on top: stops, stays, journeys and notes. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (owner)

1. On the Modules tab, choose **Install** beside Planner under **Available with this server**, then **Approve and enable**. It asks to add two permissions to the Roles tab, to link to other modules' objects and to ask other modules to do things.
2. Once enabled it is on in every space; there is no switch per space.
3. On the Roles tab, under **Module: Planner**, choose who can **See the trip** and who can **Plan the trip**. By default everyone can see it, members and moderators can plan, and guests can see but not plan. **Clear the whole trip** decides who may use **Clear** on the Planner's menu (see "Clear the whole plan" below); it is on for moderators and off for members, and an owner always may.
4. Optionally, under the Planner's settings (**Module Configuration** on its card), turn off **Suggest flights from earlier trips**. It is on by default: "Fill a flight from the same flight number saved before on this server. Flights saved here also help others; turn this off to keep them out." Off, the flight form has no **Look up a flight** row, and nothing saved here is kept for others. See "Look up a flight" below.

## The plan

Every space has one plan from the start; there is nothing to create. Open the Planner in a space and the plan is there, named after the space. With nothing on it yet it reads "Nothing on the plan yet. Add something below.", and anyone who can plan the trip can add to it straight away. No dates are needed.

The plan takes its name from the space.

- **With phases** (the environment's template lists them; Travel does), the trip's dates are the space's, not the Planner's own, and so is its currency: there is no form and no pen in the titlebar. Set the dates in the status strip's phase sheet or on the **Phases** tab of **Set up** (see "Phases" in [Spaces](userguide-spaces.md)). The main phase's dates (Trip, in Travel) are the trip's first and last day. The currency is the one chosen with the budget in **Set up**.
- **Without phases:** **Edit dates** (the pen in the titlebar) opens a form with **First day** and **Last day**, both optional, and the **Currency**. A currency set on the budget in **Set up** is used instead of this one. A name, a place and notes saved on a plan earlier are kept but can no longer be edited.

The days appear once the trip has a first day or anything on it has a date: one list from top to bottom, from the earliest date to the latest, with a strip of days at the top to jump to one and each day's heading staying in view as you scroll.

## How a day reads

- **The time column.** An object with a time shows it at the left of its card as three lines: when it starts, when it ends and, in brackets, how long it is (for example `8:00 PM`, `→ 9:30 PM` and `(1 h 30 min)`, in the environment's 12-hour or 24-hour clock). An end after midnight is followed by ` +1`. With no end time only the start shows, and a length without an end shows as `(1 h)` alone. In a narrow Planner the same words run on one line above the card, such as `7:40 AM → 10:35 AM`, or `10:00 AM → 11:00 AM (1 h)` with a length.
- **The + between days.** The small **+** that adds something between two days sits midway between them.
- **Phase bars.** In a space with phases, each phase's start and end is a bar the full width of the days, 32 pixels high, in the phase's colour. It shows a flag for a start or a chequered flag for an end, the phase's name with "starts" or "ends" and, at the right, the date.
- **From the Calendar.** An object another module holds, such as one from the Calendar, is a card whose small capital label above the title reads "from Calendar" (the module's name), as other cards show their kind.
- **A narrow Planner.** Any Planner pane narrower than 720 pixels uses the narrow layout: a small window, a pane docked beside other modules and a phone all behave the same, and a tablet held upright gets it too, because the module's own width decides, not the device. In the narrow layout each day's **Add** button shows only its **+**, and buttons and taps are 44 pixels tall. In a docked column about 256 pixels wide the day's heading puts its title and its buttons on the first row, with the summary under the title.

## Phases

When the environment's template has phases, the dates live on the space and every module reads the same ones: the Planner, the Calendar and the status strip (see "The status strip" and "Phases" in [Spaces](userguide-spaces.md)). The line under the plan's name says which phase the trip is in:

- "Planning · 12 days to go" before the main phase, counting down to its start once that is set.
- "Trip · day 3 of 9" during the main phase, once it has a start and an end.
- The label alone otherwise, such as "Booking".

Each phase has a colour. A day inside a dated phase has a soft wash of it on its heading, and the phase's name is shown beside the date, as a small tag, on every day inside it, whichever phase it is. Only the days of the **Trip** phase are numbered ("Day 3 of 9"); a day dated in another phase shows its date and its phase tag. Each phase is also marked above the day it starts and below the day it ends (see "Markers, extra days and empty days"). The wash is a fill, never a coloured border.

A phase begins on its own **Start**, or else the day after the phase before it ends. The first phase begins on the day the space was created. The current phase is the last one that has begun, and the first one until then.

A plan made before the dates moved to the space keeps its objects. The dates it held itself are no longer read, and are dropped the next time it is saved.

## Unscheduled

Something added with no date goes under **Unscheduled**, above the days. With phases, **Unscheduled** is a default phase of its own: an **Unscheduled** group comes first, for an object with no phase, one whose phase is no longer in the list, and, unless it has a phase of its own that is listed, one dated outside the plan, and the real phases follow in order. Without phases the list is flat. A new object starts in the **Unscheduled** group: in the form, **When** has an **Unscheduled** button, and **Phase** (shown only then) lists **Unscheduled** first and starts on it; choose a phase there to move the object into it. **Unscheduled** is not a bar of the status strip, not in the date strip and not in the phase settings. Give it a date and it moves to that day. Opening its form and saving leaves it here; it does not move to "Before the first day".

A plan can be at most 60 days long, so an object dated further than that from the rest of the plan can't go on its day. When one arrives from somewhere else (kept from Chat, or added by another module), it goes here instead, with "Dated <day>, outside the plan" at the top of its notes, and the Planner says so: "<title> is dated <day>, outside the plan's 60 days, so it is under Unscheduled." Its row reads "Dated <day>, outside the plan", and in its form **When** keeps that day as a choice of its own ("<day>, outside the plan"), so saving doesn't lose it. To put it on the plan, give it a day within the 60, or change the trip's dates under **Edit trip**.

The same limit holds for a stay's check-out and a journey's arrival. When an object arrives on a day the plan can show but its check-out, or its arrival on the ticket, would take the plan past 60 days, the object goes on its own day and that date goes into its notes instead, as "Check out: 2027-01-30 10:00" or "Arrives: 2027-01-30 15:25". The Planner says so: "<title>: its check-out, <day>, is outside the plan's 60 days, so it is in its notes." An object saved with such a date before Planner 0.12.0, which showed nowhere, now shows here too.

## Add to a day

- **The + in the titlebar** is the Planner's add button. It opens a menu: **Travel** (a flyout of the journey kinds), **Add a stay**, **Eat and drink** and **See and do** (flyouts), and **Add a note**. What you pick opens the form with that kind already chosen, on the day in view. Markers are not in this menu; they are in a day's menu (below).
- **Each day has its own Add button**, beside its **⋮** menu in the day's heading. It opens the same menu for that day.
- **An empty day** reads "Nothing planned yet. Click to add." ("Tap to add." on a touch screen). Click or tap it, or press Enter on it, and it opens the day's menu; what you pick opens the form with that day already filled in. Only people who can plan the trip see the invitation; anyone else sees "Nothing planned yet." A day that already has something on it does not open the menu from its blank space: add to it with its **Add**, the **+** between days, or the titlebar's **+**.
- **A day's ⋮ menu** has **Move all to…** and **Clear this day** (see "Move or clear a whole day" below). On a day, the menu for adding also has **Mark the day** (**Travel day**, **Free day** and other types, added at once) and **Add at a time**, for the time blocks under "Markers, extra days and empty days".
- To type instead, use `/p` in Chat while the Planner is open: `/p lunch at the pier at 1pm` opens the form with the title "lunch at the pier" at 13:00 on the day in view, and a day of the trip in what you type (`/p museum oct 3 at 2pm`) puts it on that day. Nothing is added until you save. See [Chat](userguide-chat.md), "Commands".
- The form opens in a window over the whole page, wider than the other modules' forms so the fields have room (the whole screen in the narrow layout), with **Save** and **Cancel** always in view at the bottom and a **Close** button in its corner; closing it after typing asks "Discard your changes?". **Edit dates** opens the same kind of window, narrower. After you save a new object, you are on it: its row's menu on a day, or its **Edit** button in a list. See [Modules](userguide-modules.md), "Add and edit forms".
- In the form, first say what it is. **What is it**, the one field at the top, shows the chosen kind's icon in its colour and its name. Click it, press Down or just start typing, and the list opens with the kinds in groups: **Getting there** (a **Flight**, **Train**, **Ferry**, **Bus**, **Car** (a rental), **Taxi**, **Ride share** or **Shuttle**), **Stay**, **Eat and drink** (a **Restaurant**, **Café** or **Bar**), **See and do** (a **Sight**, **Museum**, **Tour** or **Show**), **Markers** (see "Markers, extra days and empty days" below) and **Other** (a **Note**). Once you have chosen something in this browser, **Recent** comes first with your last few. Typing narrows the list as you go: "fl" leaves **Flight**, and a plain word works too ("plane" finds **Flight**, "coffee" finds **Café**); when nothing fits, the list says "Nothing matches"; kinds whose name starts with what you typed come first. If a marker type an owner has since removed is what an object was saved as, the field is empty and reads "Unknown kind"; saving keeps what it was unless you choose another kind. Up and Down move through the list, Enter or Tab chooses, and Escape closes the list and leaves the form open. In the narrow layout the list opens as a sheet over the lower half of the screen. A new object starts on the kind you chose last in this browser (**Sight** the first time), with this field focused so you can type at once; an object you open again starts on its own kind, and so does one added from a day's "..." or the **+** between days, with the cursor in **Title**. The fields you need then appear, named for what you chose:
  - A **flight**: **Departure day**, **Departure time**, **Flight time**, **Airline**, **Flight number**, **Departure airport** and **Arrival airport** (the codes), **Departs from** and **Arrives at**, **Departure terminal**, **Departure gate**, **Seat**, **Class** and **Arrival on the ticket**.
  - A **train**: the same departure day, time and **Travel time**, **Train company**, **Train number**, **Departs from**, **Arrives at**, **Platform**, **Coach**, **Seat**, **Class** and **Arrival on the ticket**. A **ferry** or **bus** has the departure day and time, the travel time, where it departs from and arrives at, **Seat** and **Arrival on the ticket**; a **shuttle** the same without those last two.
  - A **car**: **Pick-up day**, **Pick-up time**, **Rental company**, **Drop-off day** and where you pick it up and drop it off. **Drop-off day** lists the days after pick-up with how many days the car is kept ("Oct 12 · 3 days"), and reads "Not set" until you choose one; before a pick-up day it says "Choose the pick-up day first". It agrees with **How long** and the end time: choosing a drop-off day sets the length from the end time (or clears it when there is no end time), and typing a length or an end time moves the drop-off day to the day it ends on. The Calendar's copy of a car ends on the drop-off day. A **taxi** or **ride share**: **Pick-up time**, **Travel time**, **Pick up at** and **Drop off at**.
  - A stop (a sight, a meal and the like) has **Place**: type the name as before, or choose **Pick from Places** to link a place the space keeps (it then reads **Pick another**). A linked place shows as a chip on the card that opens it; a place that is gone, or that you may not see, is not shown as a link and the name you typed shows as before. **Save as a place** makes a place in Places from the name you typed, **Open in maps** shows it on the map, and **Unlink** keeps the name and drops the link. Nothing is linked until you **Save** the stop.
  - A **stay**: **Check in** (the day) and **Check-in time**, **Check out** (any date after check-in, even after the trip's last day) and **Check-out time**, the address, **Room** and guests.
  - A meal: its party size and the name it is booked under. A sight, museum, tour or show: its number of tickets (and a show its entry).

  **When**, the time and **How long** sit in one row that wraps on a narrow window; a note and a stay have no **How long**.

  Every kind takes a day, a time and a length where they make sense, a booking reference, a cost and who paid, notes and the people it belongs to. A length is entered as hours and minutes, up to 7 days (168 hours), and shown as "8 h 15 min"; anything longer is refused with "A length can be at most 7 days (168 hours)." The same limit applies to a return leg and to how long it takes from the stop before, under **Getting to this stop**. Once a journey has a time and a length, the form shows when it arrives: "Arrives" and the time, with "the next day" or "+2 days" when it lands on a later day (time zones are not taken into account).

  **Arrival on the ticket** (flights, trains, ferries and buses) is for a journey across time zones: enter the arrival day and time exactly as the ticket gives them, in the local time where it lands. When it is set, the plan shows that arrival instead of working it out, the flight time (or travel time) stays as you gave it, and the form's worked-out "Arrives" line is hidden. A flight that lands on an earlier day across the date line says "the day before". Leave it empty to have the arrival worked out from the departure and the length. It can be at most 7 days after the departure and at most a day before; anything else is refused with "The arrival on the ticket can be at most 7 days after it leaves, and at most a day before." Move the journey to another day (drag it, use **Move to another day…**, change its day in the form, or drop it on a day) and the arrival moves by the same number of days. A journey that is unscheduled keeps its arrival as a time and a number of days after it leaves; give it a day again (in the form, picking a day under **When** fills **Arrival on the ticket**) and the arrival is dated from that day. The cards say the same in full, and in a day's time column a later-day arrival has its own line ("→ 10:00 AM", then "the next day" or "+2 days"). Each kind has its own card in the day, in its own colour, so you can tell a flight from a dinner at a glance; a flight's and a train's card say **Departs** and **Arrives** over their two ends.
- **A round trip.** For any journey except a rental car, turn on **Round trip** in the form. A **Return** section opens with the return's own day (**Return day**, the trip's last day to start with), time, length, its own **Arrival on the ticket** (flights, trains, ferries and buses; the same rule as the outbound's, refused with "The return's arrival on the ticket can be at most 7 days after it leaves, and at most a day before.", and it follows **Return day** when that changes), ends (filled in from the outbound, swapped), number and seat, and an optional **Return title** (left empty, it is named for you, such as "Return: Flight to London"). The booking reference, cost and payer are entered once, on the outbound, and cover both legs ("The reference, cost and payer cover both legs."). Each leg sits on its own day: the outbound's card says "Round trip · Return" and the return's day, and the return's card says "Round trip · Outbound" and the outbound's day, with the outbound's booking reference. A return dated before its outbound is allowed, and its card says "Return is before the outbound". Editing either leg opens both. Turning **Round trip** off on an existing pair asks first (**Remove the return leg** or **Keep it**), and the return is deleted when you save. **Delete** on either leg asks: **Delete both legs**, **Delete only this leg**, or **Cancel**; deleting only the outbound keeps the return, with the booking details. If a second return was ever saved by mistake, the form offers **Delete the second one**.
- **Getting to a stop.** Under **Getting to this stop**, choose how you get there (walk, drive, transit, bike, taxi or ride share) and how long it takes from the stop before, in hours and minutes. A line between the two cards then shows the mode and the time, and the day's heading adds up the time spent getting around.
- **Choosing the day.** **When**, and a round trip's **Return day** and a stay's **Check out**, are a date field with two buttons beside it. Type or pick a date in the field; with phases it reaches every day of the space's timeline, not only the plan's own, and a line under it names the phase that day is in. **Pick from the list** opens the days grouped by phase (a heading per phase for a short list, a flyout per phase for a long one; without phases, per month), with **Unscheduled** as a group of its own. **Unscheduled** takes the day off (it reads **Not set** on a stay's **Check out**, which is only a date after check-in).
- **Between days.** Not everything has a day yet. Anything can sit *between* two days instead of in one: an idea near the first day, a few more near the tenth, a poll between two days to decide where to go. Objects before the first day are the ideas with no place yet. Drop anything on the gap between two days (it opens up while you drag), choose a place under **Unscheduled** in the list of days ("Before the first day", "Between Oct 16 and Oct 17", "After the last day"), pick one in the form's **Where**, or add straight there with its **+**. **Move to unscheduled** in an object's menu takes it off its day. Between days an object keeps its order by hand and shows no time; on a day it goes by time.

Objects with no time come first in a day, in the order you put them; objects with a time follow, by time. An object from another module takes the time that object has (a Calendar event's start), so it sorts among the timed ones. Between two timed objects a small line shows the gap, such as "45 min".

## Look up a flight

The Planner can fill in a flight from its number when someone on this server has saved the same flight before, in any trip. Anyone who can plan the trip can use it, while the owner leaves **Suggest flights from earlier trips** on.

1. Add a flight (choose **Flight** under **What is it**), or open one.
2. At the top of the form, under **Look up a flight**, enter the **Flight number** (such as WN 2483) and the **Day it leaves**. They start as the form's own flight number and departure day, when it has them.
3. Choose **Find**, or press Enter in either box.

- **One flight found:** the form is filled at once, and the row says "Filled in from a flight saved here before. Check it against your booking." It fills **Departure day**, **Departure time**, **Flight time**, **Arrival on the ticket**, **Airline**, **Flight number**, both airports' codes and names, and **Departure terminal** when it is known, replacing what was there. The title is filled only when it is empty. The gate, seat, class, booking reference, cost, who paid, the people and the notes are never touched. A second lookup replaces what the first filled, and empties a terminal the first filled when the new flight has none; anything you typed or changed yourself is left as it is. Nothing is saved until you choose **Save**.
- **Several found:** a list headed "Which one?" shows each, such as "MDW 12:50 to SJC 15:25", with "flies on this day of the week" or when it was last seen ("last seen Oct 2026"). Those that fly on that day of the week come first. Choose one to fill the form.
- **Nothing found:** "No flight WN 2483 saved here yet. Fill it in, and it will be suggested next time."
- A number that can't be a flight number: "Enter the airline code and number, like WN 2483." No day: "Choose the day it leaves." If the lookup fails: "Flight lookup isn't working right now. Fill it in by hand."

**The return.** With **Round trip** on, the **Return** section has its own row, **Look up the return flight**, whose day starts from **Return day**. It fills the return's day, time, flight time, its **Arrival on the ticket**, number and both airports. The return's airline is the outbound's, and the return has no terminal field.

**The flight number is saved tidy.** A flight's number is saved as the airline code and the number with one space, in capitals: "wn2483" and "WN 2483" both become "WN 2483". A number that isn't in that form (such as "Southwest 2483") is saved as you typed it. Other journeys keep their number as typed.

**A flight nobody has saved yet** can't be looked up. Fill it in by hand, or, if you have the booking confirmation and the AI service is set up, paste it into Chat and ask `/ai`, or use **Bring in research**: the flight is kept here with its fields filled (see "What other modules bring" below, and "Bring in research from another AI" in [Chat](userguide-chat.md)).

**An airport code fills its name.** In any flight form, type an airport code such as MDW in **Departure airport** or **Arrival airport** (or the return's) and leave the box: when its name box is empty and the code is a known airport, the name is filled, such as "Chicago Midway". A four-letter code such as KMDW is looked up too: the name is filled when its box is empty, and the code box then shows the three-letter code, MDW, the one the cards and the lookup use. This works even with **Suggest flights from earlier trips** off.

**What is shared.** When you save a flight with a number, both airport codes and a departure time, while the setting is on, this server keeps its schedule: the airline, the number, the two airports, the local departure and arrival times, the flight time, the departure terminal and the days of the week it flies. That is what a later lookup suggests, to anyone on this server (on a server with several environments, to all of them). A flight that leaves more than 400 days ahead, or more than 3 years ago, is not kept. It never keeps who saved it, which trip or environment it came from, anyone's name, the airport names you typed, the seat, class, booking reference, cost, who paid, the people, the notes, the title or the gate. Turning the setting off keeps this environment's flights out, and also stops its lookups; it is one choice for the whole environment, and a flight it keeps out is not suggested through any other module there either. The admin can forget a flight or clear them all (see "The flight schedule" in [Modules](userguide-modules.md)).

## Markers, extra days and empty days

- **Markers** are drawn for you, not objects, and sit on the main timeline between the days. With phases, every boundary in the status strip's dates is a marker, and every phase has its own: "<Phase> starts" where a phase begins and "<Phase> ends" where one with an end finishes, in that phase's colour. Where one phase ends as the next begins, the two markers sit one after the other; they are never merged into one. They are the bar's dates, so they move when the bar does, and the trip's own start and end are the main phase's (the days it covers have their own colour). With no phases there are four: **Planning starts** and **Planning ends** on the plan's first and last day, and **Trip starts** above the day of the first booked object and **Trip ends** below the day the last one ends: for a journey, the day it arrives. When that is after the plan's last day, **Trip ends** shows the date (such as "Oct 8") over the time. The days the trip covers have their own colour. Booked means a journey, a stay, or anything with a booking reference; with none of those, the first and last object with a time. With no objects there are no trip markers. Markers cannot be edited, moved or removed, and do not count as something planned.
- **Time blocks** are the other kind of marker: things that happen inside a day and have no place, such as free time, rest, a buffer, a meet-up or a leave-by time. Add one by choosing its type under **Markers** in the form's **What is it** and a day under **When** (a label is optional; the type names it), with a time, a length (not for a meet-up or leave-by) and a note. They are drawn as the same coloured pill, sit among the day's objects in time order, and are edited, moved and removed like any object. They are not stops and do not count in the day's summary. A marker with **no time** marks the whole day instead -- **Travel day** and **Free day** are two more types made for that -- and shows as a tag in the day's header; the day's "..." has a **Mark the day** group that adds one in a click, and clicking the tag opens its menu.
- **More on a card.** What a card's face has no room for -- the note, who is going, the booking reference, the terminal or platform, the room, the cost and who paid -- folds under it behind a **More** line. Open it and it stays open while you work.
- **Markers between the days** are markers that live only in the gap between two days ("lunch break", "travel day"). Add one with the small **+** that appears where two days meet, before the first day and after the last, or from a hidden-days badge; the same + adds anything else there too. Or, in the form, choose the type under **Markers** and a place between days under **When**: each marker type is one entry there, and **When** decides whether it goes inside a day (with a time and a length) or between days (no time), so a marker never has "Unscheduled". It has a type, an optional label and a note, and no time. Its menu (the three dots) can change its type, move it up or down along the gap, move it to another place between days and remove it; you can also drag it by its pill. They are not in any day, so they do not count as something planned.
- **Marker types** (their label, icon and colour) are a list in the Planner's Module Configuration on the Modules tab. The four automatic ones can be changed but not removed; time-block types can be added, changed, reordered and removed.
- **Add days before** (above the first day) and **Add days after** (below the last) move the plan's first or last date by 1 to 30 days, the same as changing the dates under **Edit dates**. A plan can be at most 60 days long, and the page says so when you ask for more. The trip needs a first day first ("Set the first day before adding days."; with phases, "Set when the trip starts first."). Objects and trip markers stay where they were; the planning markers move with the new ends. With phases there is no **Add days before**, since the first day is the main phase's start in the space's timeline; **Add days after** moves the main phase's end, and the phases after it move by the same number of days.
- **The dates grow to fit.** Once the trip has a first day, when you add an object on a date outside the trip, or move one there, the trip's first or last day moves out to cover it: a date before the first day, a date after the last day, a stay's **Check out**, or the day a journey arrives. With phases only the main phase's end moves later, and the phases after it move by the same number of days. It never moves in again; take days off under **Edit dates**, or change the phase dates. This holds for the form, research brought in with **Keep** ticked, or an object kept or changed from the Assistant. An object with no day does not move the dates, and neither does an object in a phase other than the main one.
- The eye button in the toolbar hides days with nothing on them (a stay that covers the night counts), with a small badge where a run of them was: it shows how many days are hidden, and its + adds a time block on the first of them or shows the days again. It is remembered for you in this browser and is off by default. If every day is empty, nothing is hidden.

## Move things

- On a computer, drag an object by the line beside its card, or by the card itself, to another place in its day or to another day. While you drag, the list scrolls by itself when the pointer is near its top or bottom edge, faster the nearer you are to the edge; it does not scroll anywhere else, and it scrolls more slowly if your system asks for reduced motion. An object with no time goes where you drop it among the day's untimed objects. An object with a time keeps it when it moves to another day, and dropped between two others on the same day it takes the end of the object before it as its time (nothing changes if that one has no time).
- Anywhere, including the narrow layout, open the object's menu (the three dots): **Edit**, **Move up** and **Move down**, **Move to another day…**, **Move to unscheduled** and **Delete**.
  - **Move up** and **Move down** swap an object with its neighbour on the same day, for an object with no time. For an object with a time they read **30 minutes earlier** and **30 minutes later**, and change the time by half an hour. Either way the object stays on its day.
  - **Move to another day…** opens the list of days, grouped by phase, with an **Unscheduled** group ("Unscheduled", "Before the first day", "Between Oct 16 and Oct 17", "After the last day") and, last, **Pick a date…**, which opens a date field under the button; choose **Move** or press Enter to move it.
  - **Move to unscheduled** takes an object off its day. It is not offered for an object that has no day already.

## Clear the whole plan

The Planner's menu in its titlebar has **Clear**, in red, for people with **Clear the whole trip** (moderators and owners, unless the roles are changed). It is offered only while the plan holds something, and not while a clear can still be undone.

1. Open the Planner's menu in its titlebar and choose **Clear**.
2. The window reads "Clear <name>?", "Everything <name> holds here goes, for everyone. You can undo it for 30 seconds, until you leave this page." Type the module's name to confirm, then choose **Clear**.
3. A note reads "Cleared <name>." with **Undo**. Choose **Undo** within the time (30 seconds unless the server's operator set another) and everything comes back as it was, with who added it and when. After that it is gone for good, along with the files and Calendar copies that went with it. The **Undo** note belongs to the page you cleared from: if you close or reload it, the note is gone and so is the chance to undo.

If something new was saved in the same place meanwhile, **Undo** keeps the new thing and says how many could not come back. Clearing the same module again before the time is over is refused with the seconds left. A module can be cleared only a few times a minute, and one person only three of those; past that the dialog stays open and says "was cleared too often just now", with the seconds to wait.

## Move or clear a whole day

A day's **⋮** menu has two entries for everything on the day at once. Only people who can plan the trip see them.

- **Move all to…** opens a small window headed "Move all from <day>". Pick **Move to** a day. Switch on **Also move every
  day after this one by the same amount** to shift the later days with it, keeping the gaps between them. The window says
  what will happen before you choose **Move**, for example "Move 3 stops on 4 days, 2 days later." A day that already has
  something keeps it; the moved stops go after. Objects from other modules move on the plan only; each keeps its own
  date where it lives. With the later days on, moving the first day of a plan with no phases also moves the plan's first and last day.
- **Clear this day** asks "Take 3 stops off <day>? They stay in the Planner, with no date." Choose **Unschedule** or
  **Keep**. The stops go under **Unscheduled** with their details; nothing is deleted. It is greyed out when the day
  has nothing to take off. Objects from other modules stay, because they follow their own date.

## What other modules bring

- Something from the Calendar, To-do or Polls that is dated on a trip day appears under that day as a suggestion, with an **Add** button that puts it on the plan. An added object shows where it comes from and has an **Open** button that takes you to it. It is read only here: change it where it lives.
- An added object keeps up with the one it points at. A new title shows on the plan, and when that object moves to another day, it moves with it, provided it was on the object's old day. To keep it where it is, open it and tick **Keep on this day**. Dragging it to a day other than its object's day ticks that for you; dragging it back to the object's day clears it. When the object is deleted, it leaves the plan too.
- Drag an object from another module onto a day to put it on that day.
- Another module can ask Planner to add something: a closed poll's winner can go onto the plan as a stop.
- An object kept from an AI answer in Chat that is marked as a flight, a train, a bus, a ferry, a car, a hotel, a restaurant, a cafe, a bar, a sight, a museum, a tour or a show is kept here by default as that proper kind of object, on the day and at the time it names, not just a plain note. That holds for `/ai` answers and for research brought in from another AI (see [Chat](userguide-chat.md)). The booking's own fields are filled in from what the AI wrote:
  - a flight, train, bus or ferry: the airline or operator, the number, where it leaves from and arrives at (a flight's airports with their codes), the departure, the arrival as on the ticket (**Arrival on the ticket**), the length, the terminal and gate, platform and coach, seat, class and booking reference;
  - a car: the rental company, pick-up and drop-off, the pick-up time and, from the drop-off time, the length;
  - a stay: check-in and check-out (days and times), room type, guests, address and booking reference;
  - a restaurant, cafe or bar: the time, the length (or the end time), address, party size, the name it is booked under and booking reference;
  - a sight, museum, tour or show: the time, the length, address, tickets and booking reference.

  Anything that has no field of its own goes into **Notes**, after the text, as a line such as "Cabin: 4B". So does an arrival more than 7 days after the departure or more than a day before it ("Arrives: …"). Titles and fields lose any Markdown or HTML; the notes keep their formatting. The links follow, and research brought in ends with the line "External source". An object dated more than 60 days from the rest of the plan goes under **Unscheduled** (see above).
- Events and notes can be kept here too: choose **Add to Planner as an event** (or **as a note**) from the menu beside **Keep** in Chat, They come here by default only when no more specialised module takes them (Research for a note, the Calendar for an event with a day). An event becomes a stop at its time; a note, a note. See [Chat](userguide-chat.md), "Where an object is kept".
- An object's **Notes** hold up to 8000 characters.
- Objects other modules link to a stop show under it.

## On the Calendar

When the space has the Calendar on, every object on the plan with a date is on the Calendar too, and the two stay in step. Objects added from another module (see above) are not copied.

- Give an object a date and it appears on the Calendar on that day: at its time, in your time zone, or as an all-day event if it has no time. A stay without a time runs to its **Check out** day.
- Change the title, the day or the time on either side, and the other side changes too.
- Clear the object's date and it leaves the Calendar and stays on the plan. Delete the object and its event goes too.
- Delete the event on the Calendar and the object stays on the plan with its date. Give it another day and it is back on the Calendar.
- An event added on the Calendar stays on the Calendar only.
- An object that already had a date before this came in appears on the Calendar the next time the server starts, once. If it has a time, the time is read in the server's time zone.

## Attach files to a stay or a journey

A stay, and a flight, train, ferry, bus, rental car, taxi, ride share or shuttle, can carry files kept in the space's [Vault](userguide-vault.md): the booking confirmation, a ticket as a PDF, a photo of the room. The files stay in the Vault; the Planner links to them, so nothing is copied.

**Who can:** anyone who can edit the Planner, when the Vault is on in the space and the Planner is approved to link to its files (an owner does this when enabling the Planner). Without the Vault the **Attachments** row is hidden, unless the stay or journey already has files, which can then be seen and unlinked.

1. Open the stay or journey to edit it, and find **Attachments**.
2. Choose **Add file**. A window lists the space's files with a search box; tick one or several, then choose **Pick**.
3. The files show as chips with their type, name and size. Choose **Unlink** beside a chip to take a file off. **Add file** is disabled at 10 files ("A stay can have up to 10 files." or "A journey can have up to 10 files.").
4. Choose **Save**. The files are linked when you save, not before.

On the card, the files show as chips under the facts. Choose a chip to open the file in a window over the canvas, with **Previous** and **Next** to walk that stay's or journey's files when it has several. A chip reads **File removed** when someone removed the file from the Vault, **File missing** when its content is gone from the server, and **Not available to you** when you may not see it. For the first two, anyone who can edit sees **Remove link** to take the chip off. The chips change by themselves when someone renames or removes a file, without a reload.

In the Vault, the file's **Where it is used** names the stay or journey, and removing the file asks first.

## Deleting something others use

**Delete** asks you to click a second time. In the object's editor and in its menu (the three dots), when something else points at the object (a task, or its event on the Calendar), the button says so first, for example "Used by 1. Really delete?".

## Bookings

The **Bookings** view lists the stays and journeys in date order, each with its dates (a stay as a range from its check-in day to its check-out day, with how many nights; a round trip as one row with both days and the route both ways, such as "LHR ⇄ JFK"), where, and its booking reference, and an **Open** button to edit it: everything you need at the front desk or the airport, in one place.

## Trip dates and time zone

The trip's own form (**Edit dates**, or **Edit time zone and currency** when the space has phases, because then the dates are the phase bar's) has **Time zone**: "Where the trip is. Its copies on the calendar use it." Choose a zone from the list, or **Each person's own time zone** (the first choice, and the default) to read every time in the viewer's own zone. A trip with a zone shows the Calendar's copies of its timed stops in that zone. Changing it writes each timed stop again, so its Calendar copy moves; if some could not be written the form says how many.

Time fields in the Planner and the Calendar follow the environment's clock setting (12 or 24 hours), not the browser's.

## Money

**While Budget is on in the space, the Planner gives way to it.** The **Money** view and the **Spent** chip on the status strip are hidden, and Budget lists the Planner's priced bookings itself (see [Budget](userguide-budget.md), "Costs from other modules"). Nothing is deleted: the **Cost** and **Paid by** fields stay on each booking, and the view and the chip return when Budget is turned off.

The view starts with **Total**, the sum of every cost on the trip, paid or not, and **Paid so far**, what has been paid ("€300 of €800 · €500 not paid yet"). The status line shows the same total. A guest sees **Money** only when an owner turned on **Guests can see costs and booking codes** in Set up.

Give a stop, stay or journey a **Cost** and who **Paid by**. The people ticked under **Whose is it** share it; when nobody is ticked, everyone in the space does. Costs are worded in the budget's currency (chosen in **Set up**), else the trip's **Currency** from **Edit dates** (a space without phases), else the environment's. In the list, **Default (<the environment's currency>)** first, which follows Manage's setting, then the common currencies and all the others by name. A trip saved earlier with a code typed by hand (even in lower case, or one not on the list) still shows it. A round trip's cost is counted once. The **Money** view shows the total, what each person paid and their share, who is owed and who owes, and the fewest payments that settle everything ("Bob pays Ann 175.00"), then the list of costs. Odd cents are handed out, so nothing is lost.

## Following a poll

An object from another module that reports how it turned out (a poll that closes) can be followed: in its menu choose **Follow its result**. When it closes, the result appears on the object, and if the result has a day (a poll whose options are dates) a stop with the result is added on that day; if it has an object it chose, that object joins the plan.

## Linking a task to a stop

Drag a stop, or any object, out of Planner by pressing its body (not its grip) and moving: drop it on a task in the To-do to link the task to it, and the stop shows the task under it. In the other direction, drop something from another module on an object and choose from what can be done with it, or drop it on a day to put it there.

## Decisions

The **Decisions** view lists what is waiting on someone, grouped by the kind of thing it is: **Polls to vote on** (each with a **Vote** button), **Tasks due before the trip** (a task not done with a due day before the trip starts, or already past, with **Open**), then anything else linked to the trip that is not done. In each group the soonest is first and the most overdue at the top; undated ones come last. The view's tab reads "Decisions (3 open)" while there are any. With none, it reads "Nothing is waiting on anyone. Open polls and tasks due before the trip appear here." Polls and tasks are found by asking for every one, not only the newest 50.

## Linked from

An object's details (its card, opened) list **Linked from** when other modules' objects point at it, such as a task or a poll: the titles of what links to it, separated by commas. Deleting such an object says "Used by 2. Really delete?" first.

## When two people edit at once

Changes show up for everyone straight away. If someone changes an object while you have it open and you then save, the object shows "Someone changed this while you were editing" with **Use theirs** and **Keep mine**.

## On Home

The Planner has no card on Home any more: the **Trips** card was removed in Planner 0.11.0. A summary of each space's plan on its card on Home is planned ([plan-dashboard](../plans/plan-dashboard.md), phase 5).
