# The local API and app permissions

Programs on your PC can work with your notes through OpenNote's local API, but only as far as you allow. The `opennote` command, an AI assistant, the web clipper, the mail add-ins, and your own scripts all use it. Nothing on the network can reach it.

## Turn it on or off

Open Settings, then **App permissions**. **Let apps on this PC connect** turns the API on or off. When it is off, OpenNote doesn't listen at all, and every app stops at once. In beta builds it starts on, with no apps connected.

## When an app asks to connect

The first time a program asks to connect, OpenNote asks you: **Let "name" connect to OpenNote?** The name is the one the program gave itself, so allow it only if you started it. **Don't allow** has the focus, and Escape also means no. If nobody answers in two minutes, the answer is no.

If you allow it, you choose:

- **What it can do.** **Read notes** is the default. **Read and add to notes** lets it add pages and add to pages.
- **Notebooks.** The notebook you have open is picked for you. You can pick others, or **Every notebook**.

Locked sections are never shared with any app, whatever you pick. An app sees a locked section's name, and nothing inside it.

## When an app wants to change notes

Before an app adds a page, adds to a page, or starts a backup, OpenNote asks: **Allow this change?** Choose **Allow once**, **Always allow for this app**, or **Don't allow**. You can turn the question back on in App permissions with **Ask me before each change**.

Each change an app makes is a step in page history, named "Added via" or "Changed via" and the app's name, so you can see it and restore the page from before it.

## See and change what each app may do

App permissions lists each connected app with when it connected and when it was last used. Change **What it can do** or **Notebooks** at any time. **Revoke** removes the app's access at once; your notes stay as they are.

## The access log

The **Access log** lists every time an app read, added, or was refused, with the page or section by title. It never holds note text or keys, and it stays on your PC, in `api-access.log` in OpenNote's log folder, up to about 3 MB. **Clear the log** empties it; the apps keep their access.

## Pair the web clipper or a mail add-in

A browser extension or a mail add-in pairs with a code instead of a question. In App permissions, choose **Make a pairing code**, then type the code into the extension or add-in. A code works once, for 10 minutes, and five wrong tries end it. A paired clipper or add-in can see notebook and section names, so you can pick where to save, and can add new pages. It can't read your notes.

## Connect an AI assistant (MCP)

`opennote mcp` runs a Model Context Protocol server on standard input and output, with the tools `list_notebooks`, `search`, `read_page`, `create_page`, and `append_to_page`. In App permissions, choose **Copy MCP config** and paste it into the assistant's settings. Each assistant gets its own access, read-only to start. Adding or changing a page asks in OpenNote first, and every call is in the access log. Locked sections are never offered to an assistant.

## Outgoing webhooks

A webhook tells another service, such as Zapier or Power Automate, when a page is created or changed, or a tag is added. In App permissions, add the web address (it must start with `https://`), pick the notebooks it covers, and copy its signing secret. Each delivery carries a signature of its body (HMAC-SHA256), so the receiver can check it came from OpenNote. A delivery that fails is tried again a few times, waiting longer each time. Deliveries are in the access log, and the payload names the page but holds no note text.

## How it keeps your notes safe

- OpenNote listens only on `127.0.0.1` (this PC) and on a named pipe that only your own Windows account can open.
- A web page can't use the API. A request from a web page, or one addressed to any name but this PC, is refused.
- Each app has its own key. OpenNote keeps only a fingerprint of it, in Windows Credential Manager, so the key can't be read back from OpenNote.
- Before the `opennote` command sends its key, it checks that the program answering is really OpenNote.

## For script writers

OpenNote writes where it listens to `api-endpoint.json` in its local data folder (`%LOCALAPPDATA%\OpenNote`). Send each request to `http://127.0.0.1:<port>/v1/...` with the header `Authorization: Bearer <your key>`. The `opennote` command does all of this for you; see [the command-line tool](command-line.md).

| Request | What it does | Needs |
|---|---|---|
| `POST /v1/pair` with `{"name": "...", "kind": "app"}` | Asks you, then returns the app's key once | Your approval |
| `GET /v1/notebooks` | The notebooks the app may use | Any access |
| `GET /v1/notebooks/{id}/sections` | Their sections, with locked ones marked | Any access |
| `GET /v1/sections/{id}/pages` | The pages in a section | Read |
| `GET /v1/pages/{id}` (add `?format=md` for Markdown only) | A page as Markdown | Read |
| `GET /v1/search?q=words` | Search, without locked sections | Read |
| `GET /v1/sections/{id}/export` | Every page of a section as Markdown | Read |
| `POST /v1/sections/{id}/pages` with `{"title": "...", "markdown": "..."}` | Adds a page | Add pages |
| `POST /v1/pages/{id}/append` with `{"markdown": "..."}` | Adds to the end of a page | Read and add |
| `POST /v1/daily` with `{"markdown": "..."}` | Adds to today's daily note | Read and add |
| `POST /v1/backup` | Runs a backup now | Read and add, every notebook |

A refused request gets a short reason, such as `locked`, `notInGrant`, or `declined`.
