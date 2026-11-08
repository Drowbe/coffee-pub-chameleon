# Research

**Audience:** a player or game master keeping notes, links and photos with the Research module on a Coffee Pub Chameleon server, and an owner setting it up.

The Research module keeps what a group finds out while it plans: a note, a link with the part that mattered, a photo with a caption. Each one is a card you can tag, search, link from other modules (drag it onto a day of a plan) and, when it has a place or a date, show on the map or on its day. It is not only for travel: a house purchase or a project has the same shape. Install and enable it first; see [Modules](userguide-modules.md).

## Set it up (owner)

1. On the Modules tab, choose **Install** beside Research, then **Approve and enable**. It asks to link to other modules' objects. Research can use the AI service but does not need it: it works with the AI service off.
2. Once enabled it is on in every space; there is no switch per space.
3. On the Roles tab, under **Module: Research**, choose who can **See research**, who can **Add, change and remove research**, and who can **Remove photos other people added** to a space. By default everyone can see it, members and moderators can edit, guests can see but not edit, and only owners can remove another person's photo. Version 0.2.10 adds that last permission, so updating to it waits for an owner's approval once.
4. **Well-known tags (optional).** Under Research's settings (**Module Configuration**), add tags with a colour each. A tag on the list wears its colour on every card; any other tag stays plain.
5. **Suggest tags (optional).** In the dialog, this button asks the AI for tags; it appears only when the AI is set up on the Modules tab and the Roles tab lets the person use it ("Use AI in modules", on for moderators and members unless an owner turns it off; a guest never can). See [Modules](userguide-modules.md). To have a whole conversation with the AI, with research as context, use `/ai` in Chat (see [Chat](userguide-chat.md)).
6. **Fetch link previews (on unless you turn it off).** When someone adds a link, this server reads that page and fills in an empty title or description, and the link shows the page's picture and description. The request goes from this server to the address the person typed. To stop it, open Research's settings (**Module Configuration**) and turn off **Fetch link previews**; nothing is fetched after that, and it stays off. The server never reads a private or local network address, whatever this setting says.

## Add things

- The **+** in Research's titlebar holds **Note**, **Link** and **Photo**. To type instead, use `/r` in Chat while Research is open: a web address opens a link filled in, and anything else starts a note with what you typed as its title. See [Chat](userguide-chat.md), "Commands".
- **Link** asks for the address first, then the title. Unless the owner turned off **Fetch link previews**, the page is read once the address is typed: an empty title or description is filled in, and the page's picture shows beside them. A link's menu has **Refresh link**, which reads the page again.
- **Photo** adds photos: in the narrow layout it offers the camera or the photo library. Several photos queue one row each. The page shrinks each picture to about 2000 pixels and makes a small thumbnail before it uploads, so large phone photos are fine.
- **A photo's position.** If a photo carries the place it was taken, Research asks whether to keep it. It is left out unless you choose **Keep it**, so a shared photo cannot give away a home address by accident. A photo taken on a known day shows on that day.
- In the dialog, give the object a title, add tags (words separated by commas; the ones already used are suggested), and for a note or a link an optional place (coordinates or a map link) and date.
- The dialog opens in a window over the whole page (the whole screen in the narrow layout), with **Save** and **Cancel** always in view at the bottom and a **Close** button in its corner; closing it after typing asks "Discard your changes?" (what a link preview filled in does not count as your typing). See [Modules](userguide-modules.md), "Add and edit forms". Something you may only read opens with no buttons and its fields greyed; **Close** or Escape just closes it.

## Read and edit a card

Click a card to open it where it is and read all of it; click it again to close it. Enter or Space on a focused card does the same. A link or button inside the card does its own thing. To change a card, press the **pen** on it (it reads **View** when you may only read), double-click it, or press Shift and Enter on it. The edit window opens as described above.

## Mine and this space

**Mine** is your own research: only you see it, and it follows you into every space. **This space** is what the space shares. Beside that switch, **Cards** or **List**: cards pack together like masonry (a short card never leaves a hole under it, and the columns follow the module's width), a list is one line per object. Your choice is remembered. An object's menu has **Copy to This space** or **Copy to Mine**, which copies it and leaves the original where it is (photos stay where they were added). Guests have only the space's.

## Find things

The search box matches the title, the text, the site and the tags. The row under it filters by kind (notes, links, photos, answers). Tags are chosen from the **Tags** button in the toolbar: it lists every tag in use with how many objects carry it; pick one and it appears beside the kinds as a filter, with an x to drop it. Pick several to narrow further (an object must carry all of them), and **Clear tags** at the top of the menu drops them all.

## Research this

A card's menu has **Research this** (not on a photo), which asks in Chat, privately, what you should know about that object, with the object as context; see [Chat](userguide-chat.md), "Ask the AI". It shows only to people who may use AI here. An object in the answer that you **Keep** is saved back here as an ordinary note. Research brought in from another AI through Chat lands here too, as a note, when it is not marked as a kind the Planner takes (a flight, a hotel, a sight and so on), or when the Planner is not installed; its text ends with the line "External source". See [Assistant](userguide-assistant.md), "Bring in research from another AI". An object saved before this changed may still show as an **Answer**, with the question that made it; nothing new is saved that way now.

## Links from Chat

While Research is on in a space, a link in a chat message gets a preview box with **Keep** (see [Chat](userguide-chat.md), "Links"). Keep saves the link here, with its title and description, credited to whoever pressed it; so is anything kept from an AI answer.

An object kept here from an AI answer, or from research brought in from another AI, becomes a note (a link becomes a link). Research is where a note goes when no other module takes it by name, and you can choose it for any object from the menu beside **Keep**; see [Chat](userguide-chat.md), "Where an object is kept". Its text keeps its formatting, and anything it carries beyond that, such as a start time or an address, follows as lines like "Starts: 2026-11-14 19:00" and "Address: 1 Main St". The note keeps the object's tags and day, its place on the map when the object has one (otherwise a "Place:" line), and an icon to match; its links follow, and research brought in ends with "External source". A note kept from `/ai` has your question after its text, as "Asked:" and the question. Only people who may add to Research see **Keep**, which leaves out guests by default. **Fetch link previews** (above) decides whether Chat's boxes show the page's title, picture and description, or one plain line.

## For module authors

Research provides three actions (see [the SDK guide](api-module-sdk.md)): `saveNote` (`title`, optional `body`, `tags` and `ref`), `saveLink` (`url`, a `text` field so a link up to 500 characters is kept whole, optional `title`, `excerpt` and `ref`) and, from 0.3.0, `savePhoto` (a picture already uploaded to Research), so any module can offer "Save to research" on something without knowing Research is there. From 0.3.0 each also takes a whole object: `saveNote` any kind or a message's words, `saveLink` a link, `savePhoto` a picture. A photo saved this way reuses the picture's thumbnail if it has one, and otherwise gets one only when the Research page that carries the request out belongs to the person who uploaded the picture, an owner or an admin; on anyone else's page the photo is still saved, and its card shows the whole picture. The details are in [api-modules](../api/api-modules.md), "Research's saveNote, saveLink and savePhoto". Its objects are pointers of kind `note`, `link`, `photo` and `answer`, and their summaries carry the object's words as `text`.
