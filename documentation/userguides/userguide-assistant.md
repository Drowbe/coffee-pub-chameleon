# Assistant

**Audience:** an owner setting up the AI on a Coffee Pub Chameleon server, and anyone asking it questions or bringing in research from another AI.

The AI is asked from Chat now, in its **Assistant** tab or with `/ai`; see [Chat](userguide-chat.md), "Ask the AI". The Assistant tab shows only your own commands and answers. The Assistant module has no window of its own and is not in the Layout menu. A new install leaves it out, even when its template lists it. Where it is installed, it keeps its **Use the assistant** permission, which decides who may use `/ai` and bring in research, and the AI hook; **Ask the assistant** asks in Chat. Research brought in from another AI comes in through Chat too.

## Set it up (owner)

1. Set up the AI itself first: on the Modules tab, **AI service** (none, OpenAI, Anthropic, or another OpenAI-compatible service), a model and a key, then **Approve and enable**. See [Modules](userguide-modules.md).
2. Optional: to limit who may use `/ai` by role, choose **Install** beside Assistant on the Modules tab, then **Approve and enable**. A module that is enabled is on in every space.
3. On the Roles tab, under Module: Assistant, **Use the assistant** no longer decides who may use `/ai`. **Use AI in modules**, under AI, does, for `/ai` and for AI inside other modules (Research's **Suggest tags**) alike. It starts on for moderators and members. Guests never can, and nobody can in a space where **Turn AI off in this space** is ticked.

4. Optional: on the AI configuration page, choose what goes to the AI with a question (**What AI may see**) and read **AI use this month**. Both are described in [Modules](userguide-modules.md), "The AI service". By default the AI is sent the objects a person attaches, related and linked objects, and the person's own earlier questions, and may look this space's objects up while it answers (only those the person could open), never the chat or the list of people, and never another space's objects.

Without the Assistant installed, `/ai` works the same way for anyone signed in whose role may use AI, wherever AI is not turned off.

Under each answer, **AI used:** says what went with the question, so a person can check an answer against what the AI was given; see [Chat](userguide-chat.md), "Ask the AI".

## Keeping an answer

When the AI writes something worth keeping, it appears as an object of its own in the answer: a title, the text (which may use headings, **bold**, lists and links), tags, and where it came from. Asked for several things at once (an itinerary, a few hotel options), it writes one object per thing. **Keep** saves it: an object that is plainly a flight, a hotel, a sight and so on is placed as that kind in the Planner, if the Planner is on here, on the day it names; any other, or without the Planner, is saved as a note in a module that keeps notes, such as Research. If that module is not open, the button shows it is waiting ("Waiting: it is kept when that module is next open"). That counts as kept: it arrives the next time someone opens that module, and it is never sent twice.

## Bring in research from another AI

You can research in another AI (a chat app on your computer or phone, say) and bring the results into Chameleon as objects, kept the same way the Assistant keeps its own answers. Bringing research in uses none of this environment's AI: it works without an AI service set up and without **Use AI in modules**.

Who can: anyone signed in, except guests. Pasting is not AI use, so it works in a space where **Turn AI off in this space** is ticked, and needs neither **Use AI in modules** nor an AI service. It also needs somewhere to keep things: the Planner, or a module that keeps notes such as Research. When you can't, **Bring in research** is not shown.

The steps are in [Chat](userguide-chat.md), "Bring in research from another AI": **Bring in research** in Chat's formatting menu, **Copy instructions for another AI**, paste the answer or choose a `.objects.json` file, **Preview**, then **Keep ticked**. If your browser does not allow copying, the instructions are shown selected instead: select all and copy them. Each object in the preview reads "From another AI: check it before you rely on it", and the confirmation names what is kept (for example "Keep 3 hotels and 2 notes?").

What to know:

- **Where each one goes.** The same as an answer's **Keep**: an object that is plainly a flight, a hotel, a sight and so on goes to Planner as that kind, if Planner is installed; anything else, or everything without Planner, goes to Research as a note. See [Planner](userguide-planner.md) and [Research](userguide-research.md).
- **At most 50 at a time.** Anything past 50 is left out, and the preview says how many ("12 more were left out: at most 50 at a time."). Bring the rest in as a second paste.
- **What could not be read** is named in one line under the preview, for example "2 could not be read: 1 had no title, 1 was not valid JSON." Nothing that could not be read is kept.
- **The kept text ends with the line "External source"**, after the object's text and its links, so you can tell later where it came from. The AI's own answers from `/ai` never get that line.
- **Size.** A paste or file can be up to 256 KB. Each object's text is kept up to 6000 characters; anything longer is cut.
- **Twice is twice.** Bringing the same answer in again keeps it again; nothing spots duplicates.
- If the other AI's answer was copied from its formatted view and lost its `objects` blocks, pasting it usually still works.
- **An older answer is refused.** An answer or file made from instructions copied before 2026-09-30 is refused with "that answer is in an older format: copy the instructions again and ask the AI for a new answer", and nothing in it is brought in. Copy the instructions again and ask for a new answer.

## Research this

Research's object menu has **Research this**: it asks in Chat, privately, "What should I know about <title>?" with that object as context. The answer shows in Chat like any `/ai` answer.

## For module authors

To ask in Chat from a module, use `host.chat.ask({ question, refs })` ([the SDK guide](../api/api-module-sdk.md), "AI"). The Assistant still declares its `askAssistant` action (optional `ref` and `question`, `local`) and carries it out by calling `host.chat.ask`, so an existing caller still works; new code should call `host.chat.ask` itself. A kept object, answered or brought in, is saved through whichever module in the space offers a matching action, found by name and input shape, never by naming a module: an object with a recognised `kind` prefers a suggestion-shaped action (a `title` and a `kind`), which the Planner's `acceptSuggestion` offers; any other object, or without one, falls back to a note-shaped action (a `title` and a `body`), which Research's `saveNote` offers.
