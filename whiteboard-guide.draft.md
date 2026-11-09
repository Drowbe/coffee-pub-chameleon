# Whiteboard

**Audience:** members, moderators and owners who draw, plan and sketch together on a space's whiteboard, and anyone who only looks at it.

The Whiteboard is a shared board for a space. Draw on it, put notes, words, shapes, pictures, flowcharts, tables and timers on it, and move them around together. Everyone in the space sees the same board, and what one person changes shows for the others as soon as it is saved. Each space has one board.

Everything on the board is a **block**: a note, a text block, a shape, a line, a drawing, a picture, a connector, a highlight, a timer or a table. Most of what this guide says about blocks works the same for every kind.

Each section below starts with the version of the Whiteboard that brought it, such as _Since 0.1.5_. If your Whiteboard is older, that section does not apply yet.

**Who can:** what each role may do is set on the **Roles** tab under the Whiteboard ([Accounts, roles and permissions](userguide-accounts.md)):

- **See the whiteboard** shows the board. It starts on for members, moderators and guests.
- **Draw on the whiteboard, add pictures and change what is on it** lets you add, change, move and delete blocks. It starts on for members and moderators and off for guests.

An owner always can do both. Someone who can see the board but not change it can still look around, pick blocks, open links, save the board as a picture and print it; see "Who can do what" near the end.

## Set it up (owner)

_Since 0.1.4_

1. On the Modules tab, choose **Install** beside the Whiteboard under **Available with this server**, then **Approve and enable** (see [Modules](userguide-modules.md)).
2. On the Roles tab, under the Whiteboard, choose who can **See the whiteboard** and who can **Draw on the whiteboard, add pictures and change what is on it**.

The server checks both permissions on every save, so the board's buttons are a help, not the only guard.

## Open the whiteboard

_Since 0.1.4_

The Whiteboard is a module like the others: open it from the **Layout** menu, under **Show**, and it opens on the canvas. It works only in a space; anywhere else it says it opens in a space.

The board fills the module. The toolbar above it holds the tools and the menus, the **+** in the title bar adds blocks, and the status line under it says how many blocks there are, how many are selected, the zoom, and **View only** when you can look but not change the board. When the board is empty, a short line in the middle says what to do first.

## Draw and add blocks

_Since 0.1.4_

Pick a tool in the toolbar, then click or drag on the board.

- **Select** (V): pick and move blocks. This is the usual tool.
- **Pen** (P): press and drag to draw. The tool stays on for the next line.
- **Note** (N): click to put a sticky note there, then type its words.
- **Text** (T): click to put words there, then type them. A text block left empty is taken away.
- **Rectangle** (R) and **Ellipse** (O): drag to draw one to size, or click for the usual size.
- **Line** (L) and **Arrow** (A): drag from one end to the other.

After a note, a text block or a shape, the tool goes back to Select. Press **Escape** to go back to Select from any tool.

The **+** in the title bar puts a block in the middle of what is in sight, without choosing a tool: **Add a note**, **Add text** and **Add a rectangle**, and the others later sections name. It is the way to add blocks from the keyboard.

## Pick, move and change blocks

_Since 0.1.4_

With Select:

- Click a block to pick it, and drag it to move it. It is saved once, where you drop it.
- Drag a corner handle to change its size. Hold **Shift** to keep its shape. A text block's corner changes only its width; its words set its height. Drag either end of a line or an arrow to move that end. A drawing has no handles.
- Double-click a note, a text block or a shape to change its words. Double-click a line, an arrow or a drawing to change its colour.
- Right-click a block (or press it long on a touch screen) for what you can do with it: edit, colour, width, layers, delete and more.
- **Delete** or **Backspace**, or the bin button in the toolbar, deletes what is picked.

From the keyboard: **Tab** goes to the board and then to each block in turn, and the block it reaches is picked. **Enter** edits the picked block. The arrow keys move it 10 board units a press, or 1 with **Shift**; a run of presses is saved once, after the last one.

## Write words

_Since 0.1.4_

While you edit words, a box sits over the block. **Enter** starts a new line. Click elsewhere, or press **Ctrl+Enter** (**Cmd+Enter** on a Mac), to keep what you typed. **Escape** puts the words back as they were.

## Colours and widths

_Since 0.1.4_

A block has up to three colours, each set on its own: its **Border** (for a line or a drawing, its **Line**), its **Background** and its **Words**. The colours are **Ink** (the theme's text colour), **Yellow**, **Orange**, **Red**, **Pink**, **Purple**, **Blue**, **Teal** and **Green**. They follow the theme, in light and dark mode. Some colours also offer **None** (not drawn), and a note's border offers **Matching** (a little darker than its background).

- **Colour** in the toolbar (the palette) changes the picked blocks. With nothing picked, it sets the colour for new blocks of the tool you have; **Usual** puts back each kind's own colour.
- **Width** in the toolbar sets how wide a line or a border is: **Hairline**, **Thin**, **Medium**, **Thick**, **Heavy** or **Extra heavy**. Each choice shows a sample line.
- Both are in the right-click menu too.

A colour or a width picked on blocks is also kept for the next block you make, as long as the page is open. When the picked blocks differ, no choice is marked.

## Layers

_Since 0.1.4_

Blocks lie on top of each other. Right-click a block and choose, under **Layer**: **Bring to front**, **Forward one layer**, **Back one layer** or **Send to back**. Forward and back step past the next block that overlaps it. A choice that would change nothing is greyed out.

## Zoom

_Since 0.1.4_

**Zoom** in the toolbar has **Zoom in** (+), **Zoom out** (-), **Show everything** (0) and **Actual size**. The zoom goes from 20% to 400%, and the status line shows it. **Show everything** fits the whole board in sight, but never zooms in past 100%. On a touch screen, pinch to zoom. With a mouse, hold **Ctrl** (**Cmd** on a Mac) and turn the wheel; each notch zooms at most 12%. A pinch on a trackpad zooms too.

## Select several blocks

_Since 0.1.5_

- **Shift-click**, **Ctrl-click** or **Cmd-click** a block to add it to what is picked, or to take it out.
- Drag on an empty part of the board to draw a rectangle: every block it touches is picked. With **Shift**, **Ctrl** or **Cmd** held, they are added to what is picked.
- **Ctrl+A** (**Cmd+A**) picks every block. **Select all** is also in the right-click menu of the empty board.
- **Escape** picks nothing.

Drag any picked block and they all move together. Colour, Width, Layer, Delete and the arrow keys work on every picked block you may change. The status line says how many are selected.

On a touch screen, one finger on the empty board moves the board. Turn on **Select many** in the toolbar (touch screens only) to drag a rectangle instead, and to add or take out a block with a tap.

## Copy, cut, paste and duplicate

_Since 0.1.5_

- **Ctrl+C** copies the picked blocks, **Ctrl+X** cuts them and **Ctrl+V** pastes them (**Cmd** on a Mac). **Ctrl+D** (**Cmd+D**) duplicates them at once.
- The same four are in a block's right-click menu, and **Paste** is in the **+**. On the empty board, **Paste here** pastes where you right-clicked.
- Each paste lands a step down and to the right of the last one, so copies never hide each other. After a cut, the first paste lands where the blocks were.
- The copies are new blocks, yours, on top of the others, and are picked once they are there.

The copied blocks are kept by this page only. They go when you close or reload the page, and you cannot paste them into another tab or another space.

## Undo and redo

_Since 0.1.5_

**Undo** and **Redo** are in the toolbar. **Ctrl+Z** undoes; **Ctrl+Shift+Z** or **Ctrl+Y** redoes (**Cmd** on a Mac).

- They undo only your own changes, never someone else's.
- One gesture is one step: a drag, a stroke, a resize, a colour, a paste, a delete of several blocks. A run of arrow-key presses is one step.
- Undo puts back only what your step changed. If someone else has changed the same thing since, their change stays, and the board says "Left a block as it is: someone else changed it since." A block someone else deleted is left out: "Left out a block someone else deleted."
- A deleted block comes back with its connectors.
- The board keeps your last 100 steps, for as long as the page is open. Reloading the page, or the whole board being cleared or put back, empties the list.

## Move the board

_Since 0.1.5_

With any tool:

- Hold the **spacebar** and drag.
- Drag with the middle mouse button.
- Turn the mouse wheel, or scroll with two fingers on a trackpad.
- On a touch screen, drag with one finger on the empty board, or with two fingers anywhere.

Or pick the **Hand** tool (H) in the toolbar and drag anywhere, over blocks too; nothing is picked or moved. Press **H** or the Hand button again to go back to the tool you had.

### Drag with the right mouse button

_Since 0.1.7_

Drag with the right mouse button to move the board, on the empty board or over a block. The block stays where it is and is not picked. A right-click that does not move opens the menu as before.

## Add pictures

_Since 0.1.6_

Put a picture from your computer on the board in one of three ways:

- Paste it (**Ctrl+V** or **Cmd+V**) after copying it elsewhere. It goes where the pointer is over the board, or in the middle of what is in sight.
- Drag picture files onto the board. "Drop to add to the board" shows while you drag, and each picture lands where you let go.
- Choose **Add a picture** in the **+** and pick files.

The board takes JPEG, PNG, WebP and GIF pictures (a GIF becomes a still picture of its first frame). Other files are refused with "Only pictures can go on the board." Each picture is made smaller in your browser first, to at most 2000 pixels on its long edge, and is sent one at a time; a placeholder shows where it will be, and the status line says how many are on their way. Several pictures land a step apart and are picked together.

- A picture is a block: move it, resize it from a corner (it always keeps its shape), give it a border, layer it, copy it.
- Double-click it, press **Enter**, or choose **Describe** in its right-click menu, to give it a short description (one line, up to 300 characters). A screen reader reads it, and it shows as the tooltip.
- Everyone who can see the board sees the pictures.
- Deleting a picture block does not delete the picture's file: an undo brings it back. See "Limits".

## Draw a flowchart

_Since 0.1.8_

The **Flowchart** button in the toolbar holds the **Connector** and the flowchart shapes: **Rectangle**, **Rounded box** (B), **Diamond** (D), **Pill** and **Parallelogram**. Draw the shapes as you draw a rectangle; they hold words the same way. **Add a flowchart shape** in the **+** has them too.

A connector is a line that joins two blocks and follows them when they move or change size.

1. Pick **Connector** (C) in the Flowchart menu.
2. Press on a block and drag to another, then let go. Near the middle of a side, the connector uses that side; elsewhere it uses the side that faces the other block. The blocks show their connection points while you drag.
3. Let go on the empty board for a free end.

Or pick two blocks and choose **Connect them** in the right-click menu, or **Connect the 2 picked blocks** under **Add a flowchart shape** in the **+**.

- Double-click a connector, or press **Enter**, to give it a label (one line).
- Pick a connector and drag either end to attach it somewhere else.
- **Line style and arrowheads** in the toolbar (also in the right-click menu) sets **Elbow** or **Straight**, and the arrowheads at the **End**, the **Start**, **Both** or **None**. With nothing picked, it sets them for new connectors.
- Deleting a block deletes the connectors attached to it, in the same undo step.
- Copying blocks copies the connectors between them. A copied connector whose block is not copied gets a free end there.

Notes, text blocks, shapes, pictures, timers and tables can take a connector. Lines, drawings and other connectors cannot.

## Paint: Fill, Marker and Brush

_Since 0.1.9_

The **Paint** button in the toolbar holds **Fill** (F), the **Pen** (P), the **Marker** (M) and the **Brush**.

- **Fill**: click a block to fill its background with the fill colour. The Fill row in the menu shows that colour; it is Yellow until you pick another with **Colour** while Fill is the tool. Hold **Alt** (**Option** on a Mac) and click a block to take its colour instead. A line, a drawing, a connector or a picture has no background to fill, and the pointer says so. The tool stays on until you pick another.
- **Marker**: a wide stroke you can see through a little, so strokes over each other show.
- **Brush**: a stroke that is thinner at both ends. With a pen, or a finger on a screen that senses pressure, it is wider where you press harder. With a mouse it is even.

Each of the Pen, the Marker and the Brush remembers its own width.

## Add a timer

_Since 0.1.9_

Press the **Timer** button in the toolbar (Y) and click the board, or choose **Add a timer** in the **+**. A timer is a clock face that counts down, and every page shows the same time left.

- **Start**, **Pause** and **Reset** are on the timer. Anyone who may change the board can use them on any timer.
- The length button chooses **1**, **2**, **5**, **10**, **15** or **30** minutes, or **Custom…** for minutes and seconds, from 1 second to 23:59:59. A new length stops the timer and waits.
- At zero it says "Time is up" and pulses gently. Unless you choose **Mute the sound** in the length menu (for you only, in this browser), it plays one short soft tone. Your browser plays no sound until you have clicked or typed on the page.
- Starting, pausing and the end are read out to a screen reader once.
- A copy of a timer is never running.

## Format words

_Since 0.1.10_

The words of notes, text blocks and shapes can have **bold**, *italic*, `code`, lists, headings and links. While you edit them, a small bar over the block has **Bold**, **Italic**, **Code**, **Bulleted list**, **Numbered list**, **Heading** and **Link**. With a keyboard: **Ctrl+B**, **Ctrl+I**, **Ctrl+E** and **Ctrl+K** (**Cmd** on a Mac). You can also type the marks yourself, as in chat.

- **Heading** goes from none to a large, a middle and a small heading, then back to none.
- **Link** asks for the address. Only a web address (http or https) can be a link.

To open a link: **Ctrl-click** it (**Cmd-click** on a Mac), or click it once its block is the one picked, or choose **Open link** in the block's right-click menu. A link always opens in a new tab.

**Text size and alignment** in the toolbar (also in the right-click menu) sets the words' size, **Small**, **Medium**, **Large** or **Huge**, and their alignment, **Left**, **Centre** or **Right**. It changes the picked notes, text blocks, shapes and tables, or, with nothing picked, sets them for new ones.

## Give a note a pointer

_Since 0.1.11_

Right-click a note and choose **Add pointer** to give it a tail. With the note picked, drag the tip of the tail to point at something. The tail moves with the note and keeps its colours. **Remove pointer** takes it away. A screen reader is not told the pointer is there.

## Highlight

_Since 0.1.11_

The **Highlighter** (U) is in the Paint menu. Press and drag over what you want to mark: it lays a see-through band, so the words and shapes under it still read. Hold **Shift** while you drag for a straight band. A highlight is a block of its own: pick it, move it, change its colour or width, delete it. It has its own colour, Yellow until you pick another, so the pen's colour does not carry over.

## Add a table

_Since 0.1.12_

Pick **Table** (G) in the Flowchart menu and click the board for a table of three columns and three rows, or drag to give it a size. **Add a table** in the **+** works too. The first row is a header row.

- Double-click a cell to write in it. **Tab** keeps the words and goes to the next cell (on the last cell, it adds a row first); **Shift+Tab** goes back. **Enter** keeps the words and goes down; **Shift+Enter** starts a new line in the cell. **Escape** puts the words back.
- From the keyboard: pick the table and press **Enter** to show its cells. The arrow keys then move between cells, **Enter** or **F2** edits one, typing a letter starts the cell afresh, **Delete** empties it, and **Escape** goes back to moving the table.
- With the table picked, drag a bar on a line between two columns or two rows to change its size, and press the **+** below the last row or right of the last column to add one. A corner changes the size of every column and row.
- Right-click a cell for **Edit cell**, **Rows and columns** (insert a row above or below, a column left or right, delete the row or the column), **Header row**, and **Cell** (**Clear cell**, **Copy cell text**, **Cut cell text**, **Paste cell text**).
- Cells take the same formatting as notes. Colour sets the cells' background, the **Lines** and the words.
- Paste rows copied from a spreadsheet and they become a new table. Rows and columns past the limits are left out, and the board says so.

If someone else changes the table while you write in a cell, their change stays and your cell's words go into the newest table. If your cell's row or column was deleted meanwhile, the board says what you typed was not kept.

## Save as image and print

_Since 0.1.13_

**Save as image…** is in the title bar's menu and in the right-click menus, for everyone who can see the board, including people who can only look. It asks:

- **What to save**: **Everything**, **What is selected** (greyed out when nothing is picked) or **What is in sight**.
- **Background**: **Board colour** or **Transparent**.
- **Size**: **Normal (1x)** or **Double (2x)**.

It shows the picture's size in pixels before you save, and says when the board is too big for that size and the picture will be made smaller. **Save** saves a PNG to your computer, named after the board, the day and the time, such as "Whiteboard 2026-11-09 1405.png". What is selected takes the connectors between the picked blocks too. The selection frame, the handles and a timer's buttons are not in the picture.

**Print** is in the title bar's menu. It prints the whole board, fitted to the paper, in light colours. **Ctrl+P** (**Cmd+P**) is your browser's own print, not the board's.

## When other people change the board

_Since 0.1.4_

Each block is saved on its own, so two people changing different blocks never get in each other's way. A block is saved whole when you let go of it, and the others see it then; they do not see a drag or a stroke while it goes on. If two people change the same block at the same moment, the last save wins. While you are moving or editing a block, a change to it from someone else waits until you let it go.

If the server asks the board to slow down, it says "Saving a lot at once. The rest is saved in a few seconds." and carries on. A change the server refuses is put back, with "You may not change this whiteboard." or the server's reason.

## Who can do what

_Since 0.1.4_

| | See the whiteboard only | Also Draw on the whiteboard, add pictures and change what is on it |
| --- | --- | --- |
| See the board, move it and zoom | Yes | Yes |
| Pick blocks, open links | Yes | Yes |
| Save as image, Print | Yes | Yes |
| Add, change, move, layer and delete blocks | No | Yes |
| Copy, paste, duplicate, undo and redo | No | Yes |
| Add pictures | No | Yes |
| Use a timer's Start, Pause, Reset and length | No | Yes |

Anyone who may change the board may change or delete any block on it, whoever made it.

## Limits

_Since 0.1.4_

- One board for each space.
- A block can be at most 60 KB as it is saved. A long drawing is thinned to fit.
- Everything the Whiteboard keeps, in all spaces together, can be at most 5 MB. Past that, a change is refused with the server's reason.
- The words of a note, a text block or a shape can be at most 4000 characters. A connector's label is one line of at most 120, and a picture's description one line of at most 300.
- A block can be at most 4000 board units wide or tall.
- The server takes up to 240 saves a minute from one person; past that the board waits and carries on.
- Undo keeps your last 100 steps, on this page only.
- Pictures (_since 0.1.6_): JPEG, PNG, WebP and GIF; each sent as at most 5 MB, and at most 2000 pixels on its long edge. A space can keep at most 500 picture files. A picture's file stays when its block is deleted, and still counts toward the 500. The server takes up to 30 pictures a minute from one person.
- Timers (_since 0.1.9_): from 1 second to 23:59:59.
- Tables (_since 0.1.12_): at most 20 columns, 50 rows and 500 characters a cell.
- Save as image (_since 0.1.13_): at most 16384 pixels on a side and 67,108,864 pixels in all; a bigger picture is made smaller, and the board says so. PNG only.

## Keyboard shortcuts

_Since 0.1.4_

These work while the board has the keyboard (click it, or Tab to it). Key names show in menus and buttons only on a device with a mouse or a trackpad.

| Action | Windows and Linux | Mac | Since |
| --- | --- | --- | --- |
| Select tool | V | V | 0.1.4 |
| Pen | P | P | 0.1.4 |
| Note | N | N | 0.1.4 |
| Text | T | T | 0.1.4 |
| Rectangle | R | R | 0.1.4 |
| Ellipse | O | O | 0.1.4 |
| Line | L | L | 0.1.4 |
| Arrow | A | A | 0.1.4 |
| Back to Select, or pick nothing | Escape | Escape | 0.1.4 |
| Next block | Tab | Tab | 0.1.4 |
| Edit the picked block | Enter | Return | 0.1.4 |
| Move what is picked (10 units; 1 with Shift) | Arrow keys | Arrow keys | 0.1.4 |
| Delete what is picked | Delete or Backspace | Delete | 0.1.4 |
| Forward one layer, back one layer | ] and [ | ] and [ | 0.1.4 |
| Bring to front, send to back | Shift+] and Shift+[ | Shift+] and Shift+[ | 0.1.4 |
| Zoom in, zoom out | + and - | + and - | 0.1.4 |
| Show everything | 0 | 0 | 0.1.4 |
| Keep the words being edited | Ctrl+Enter | Cmd+Return | 0.1.4 |
| Put the words back | Escape | Escape | 0.1.4 |
| Pick every block | Ctrl+A | Cmd+A | 0.1.5 |
| Add to or take out of what is picked | Shift-click or Ctrl-click | Shift-click or Cmd-click | 0.1.5 |
| Copy, cut, paste | Ctrl+C, Ctrl+X, Ctrl+V | Cmd+C, Cmd+X, Cmd+V | 0.1.5 |
| Duplicate | Ctrl+D | Cmd+D | 0.1.5 |
| Undo | Ctrl+Z | Cmd+Z | 0.1.5 |
| Redo | Ctrl+Shift+Z or Ctrl+Y | Cmd+Shift+Z or Cmd+Y | 0.1.5 |
| Hand tool, on and off | H | H | 0.1.5 |
| Move the board | Hold Space and drag | Hold Space and drag | 0.1.5 |
| Zoom with the wheel | Ctrl+wheel | Cmd+wheel, or pinch on the trackpad | 0.1.5 |
| Connector | C | C | 0.1.8 |
| Rounded box | B | B | 0.1.8 |
| Diamond | D | D | 0.1.8 |
| Fill | F | F | 0.1.9 |
| Take a block's colour with Fill | Alt-click | Option-click | 0.1.9 |
| Marker | M | M | 0.1.9 |
| Timer | Y | Y | 0.1.9 |
| Bold, italic, code, link (while editing words) | Ctrl+B, Ctrl+I, Ctrl+E, Ctrl+K | Cmd+B, Cmd+I, Cmd+E, Cmd+K | 0.1.10 |
| Open a link | Ctrl-click | Cmd-click | 0.1.10 |
| Highlighter | U | U | 0.1.11 |
| Straight highlight | Shift while dragging | Shift while dragging | 0.1.11 |
| Table | G | G | 0.1.12 |
| Next cell, previous cell (while editing a cell) | Tab, Shift+Tab | Tab, Shift+Tab | 0.1.12 |
| Keep the cell and go down; new line in a cell | Enter; Shift+Enter | Return; Shift+Return | 0.1.12 |
| Edit the active cell | Enter or F2 | Return or F2 | 0.1.12 |

The Brush, the Pill and the Parallelogram have no key. Print has no key of the board's own.
