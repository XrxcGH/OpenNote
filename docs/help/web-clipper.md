# The web clipper and mail add-ins

The OpenNote Web Clipper saves a web page into your notes from Edge, Chrome, or Firefox. The Outlook add-in and a Gmail button in the clipper do the same for an email. They talk only to OpenNote on this PC, through the local API, and can do no more than you allow in **Settings, then App permissions**.

## Pair the clipper

1. In OpenNote, open **Settings, then App permissions** and turn on **Let apps on this PC connect**.
2. Choose **Pair a browser extension**, pick what it may do, and read the code OpenNote shows.
3. Open the clipper in your browser, type the port and the code OpenNote shows, and choose **Pair**. A code works once and expires after five minutes.

OpenNote must be open while you clip. To stop a pairing, choose **Revoke** next to it in App permissions, or **Forget this pairing** in the clipper.

## Clip a page

Open the clipper from the toolbar and pick one of three ways to clip:

- **Full page** saves the page. Text you selected is quoted first.
- **Clean article** leaves out menus, sidebars, and comments, and keeps the text and pictures.
- **Region screenshot** lets you drag over part of the page and saves it as a picture.

Pick a title and the section the page goes into, then choose **Clip**. The new page keeps the source address as a link. If OpenNote isn't open, the clipper offers to open it with an `opennote://clip` link instead.

## Save an email

In Outlook, open the OpenNote task pane on a message and choose a section. In Gmail, open the clipper on a message and choose **This email**. The page holds the message text and its attachments, with a link back to the message.

Store listings for the extension and the add-ins are the owner's step. Until they are published, load them from the `extensions` folder in developer mode.
