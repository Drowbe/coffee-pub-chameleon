# Creating Themes

**Audience:** an owner who wants an environment in their own colours, and anyone sharing a theme with another
Coffee Pub Chameleon environment.

A theme changes colours only, never the layout. Every page and every module follows it, so one theme recolours the
whole environment. Themes are made on Manage > **Theme**; only owners (and the admin) can change them.

## The seven base colours

Every theme sets these seven. The labels are the ones on Manage > Theme.

- **Page background**: behind everything.
- **Section background**: panels, popovers and the active tab.
- **Border**: outlines and dividers.
- **Text**: the body text.
- **Dim text**: secondary text, such as hints and timestamps.
- **Primary accent**: links, highlights and the main buttons.
- **Text on accent**: text and icons drawn on the primary accent, such as a main button's label.

## The optional colours and Auto

Under **Header, buttons and icons** are thirteen more: **Card background**, **Header background**, **Header text**,
**Branding area background**, **Branding area text**, **Right side background**, **Right side text**, **Icons**, **Icon hover**, **Primary accent hover**, **Secondary accent**, **Text on secondary** and **Secondary
accent hover**. Each starts on **Auto**, which works it out from the base colours, so a theme that never touches
one still looks right. Untick Auto only when you want that one thing to differ, for example a header in your own
brand colour.

The top bar has three areas: the branding area (the logo and the environment's name, on the left), the main part (the spaces, where you are and the layout tabs) in **Header background**, and the right side (the bell and your picture). On **Auto** the branding area and the right side are a shade darker than the header, as they always were. Choose your own when you want the branding area in your brand's colour, say; each has its text colour beside it. In the narrow layout only the branding area keeps its colour. The bar under the top bar (the status strip in a space, and the page bar on other pages) stays one colour, worked out from the header. The status strip's bands, the phase sheet and the tinted days of a phase take their colours from the theme's tints, so they follow a theme with no setting of their own.

## Light and dark

One theme holds both a light and a dark version. People see the environment's default, which **Dark by default**
on Manage > Theme sets, until they choose their own with **Dark mode** in the menu under their picture; their choice then
stays theirs. Guests always see the default.

To make the second version, start from the first and adjust it: change the backgrounds first, then the text so it
stays readable. Keep **Text** readable on both backgrounds, and **Text on accent**
readable on **Primary accent**, in both versions.

## Preview, then Apply

The preview under the colours, with a sample header, shows the result as you change it. Nothing reaches anyone
until you choose **Apply**, which puts the theme and the default mode live on every open page at once.

**Save as new theme** keeps what you made under a new name; **Update** saves changes to the theme you started from.

## Share a theme

A theme can be saved as a file and brought into another environment.

1. To share one, choose it in the chooser and click **Export**. The browser saves `<name>.theme.json`. Any
   theme can be exported, the built-in ones and Strong Coffee included. Export saves the theme as it was last
   saved, not changes still in the editor, so choose **Update** or **Save as new theme** first.
2. To bring one in, click **Import…** and choose the file. It is added as a new theme and chosen in the chooser, so
   you can preview it. It is not applied: click **Apply** when you want to use it.

When the chosen theme has an author, a "Made by ..." line under the buttons shows who made it. Below that, after
an import, a line says what came in, such as "Imported Harbour by Thomas.", and, when anything in the file wasn't
a colour Chameleon knows, "Left out: ...". An import never replaces a theme: if the name is taken, it is added as
"Harbour (2)", then "(3)". A theme file can only hold colours, so importing one can't change anything else.

A file saved as UTF-16, such as one saved by Windows Notepad, imports like any other.

A file that isn't a theme, was made by a newer version of Chameleon, or has neither a complete light nor a complete
dark version is refused, with a sentence saying which. A theme file exported before 2026-09-30 is in an older format
and is refused with "That theme file is in an older format. Export the theme again and import the new file.": export
it again from a current version and import the new file. An environment holds at most 100 themes. At that limit an
import is refused with "This environment has 100 themes, the most it can hold. Delete one to import another."

## Where to start

Strong Coffee is how Chameleon has always looked. Calming Teal and Burnt Orange are the other built-in themes. Choose
one of them, change what you want, and **Save as new theme**.
