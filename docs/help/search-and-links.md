# Search and links

Find any word you wrote, and connect pages to each other.

![The search panel with a result, the matched word in bold, and a preview](../screens/search-light.png)

## Search

Press Ctrl+Shift+F to open the search panel. A word you typed a minute ago is found. Add `in:` to limit a search to one notebook.

Text inside pictures is searchable too, after you turn on Search text in pictures. See [on-device intelligence](on-device-intelligence.md).

Press Ctrl+O to jump to a page by name. Press Ctrl+K to search pages and commands together.
Search leaves out archived pages unless you turn on Include archived. When a match is inside a heading, the result says "In" and the heading. Look in can narrow a search to Recording transcripts or Descriptions and text in images (the words in a picture are searched with its description).

## Link pages

- Type `[[` and pick a page to link to it.
- Right-click a paragraph and choose Copy link to link to that paragraph.
- Links that start with `opennote://` open a page from another app.
- Links keep working when you rename or move a page.

![The linked pages pane, listing the page that links here](../screens/backlinks-light.png)

Open a page and look at its linked pages pane to see every page that links to it.

## Tags and properties

Type `#todo` followed by a space or punctuation, and the tag is listed in the Tags pane and found by search. Code, numbers like `#1`, words like `C#`, and web addresses are left alone. Press Ctrl+Z right after to keep it as plain text. To stop typed #words becoming tags, turn off "Turn typed #words into tags" in Settings, then Editing. Tag a single line to see just those lines together. Pages can also carry properties, and a collection shows the pages that match.

## Daily notes and the map

- Press Ctrl+K and choose Daily note to open today's page.
- The calendar lists your daily notes.
- The graph view and Connections list show how pages link.
- The canvas of cards lays pages out as cards you can arrange.

## Replace everywhere

Press Ctrl+K and choose Replace in all notebooks. You see a preview before anything changes.
Renaming, merging, or deleting a tag and Replace in all notebooks each end with an Undo on the message. Press Ctrl+Z right after, before you type in a page, and it puts back every page the change touched, except pages you have edited since.

Search and links are built and have been checked by automated tests only.

## Pin sections and color pages

Right-click a section and choose Pin section to keep it at the top of its notebook. Right-click a page and choose Color to mark it with a colored dot. Both stay with the notebook.

A link or a search result that points inside a folded heading or list item opens the fold first, so you land on the words and not on a closed section.

## Linking mentions

In the linked pages pane, Link all shows every place the title appears without a link. Uncheck any that should stay plain text, then choose Link. One Undo puts them all back.

## Collections inside a page

Type / and choose Insert a live collection, or use the Insert tab. Pick the pages of this section or a collection you saved. The block shows them as a list, table, board, calendar, or gallery and updates as your notes change.
