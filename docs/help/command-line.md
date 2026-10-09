# The opennote command

`opennote` adds to and searches your notes from a terminal or a script. It works only through OpenNote's local API, so it can do no more than you allow in **Settings, then App permissions**.

## Set it up

1. In OpenNote, open **Settings, then App permissions** and turn on **Let apps on this PC connect**.
2. Install the command. OpenNote puts `opennote.exe` in the folder it was installed to. In App permissions, choose **Add the opennote command to PATH** if you want to type `opennote` from any folder.
3. Run any command. The first one asks for access in the OpenNote window. The tool starts read-only on the notebooks you pick there. To let it add or change notes, choose **Read and add to notes** for it in App permissions.

OpenNote must be open while you use the command.

## Commands

| Command | What it does |
| --- | --- |
| `opennote notebooks` | Lists the notebooks and sections the tool may use. |
| `opennote pages SECTION` | Lists the pages in a section. |
| `opennote read PAGE` | Prints a page as Markdown. |
| `opennote search WORDS` | Searches pages. Locked sections are never searched. |
| `opennote new SECTION TITLE [TEXT]` | Adds a page. The text comes from `TEXT`, `--file FILE`, or standard input. |
| `opennote append PAGE [TEXT]` | Adds text to the end of a page. |
| `opennote daily [TEXT]` | Adds text to today's daily note. |
| `opennote export SECTION [--out FOLDER]` | Saves each page of a section as a Markdown file. |
| `opennote backup` | Backs up every notebook to the backup folder set in OpenNote. |
| `opennote connect` | Asks OpenNote for access now. |
| `opennote disconnect` | Forgets this tool's key. Revoke it in App permissions to end its access. |
| `opennote mcp` | Runs the assistant connection described in [the local API help](local-api.md). |

Add `--json` to print OpenNote's answers as JSON. Section and page IDs come from `notebooks` and `pages`.

## Exit codes

0 done, 1 failed, 2 wrong arguments, 3 OpenNote isn't reachable, 4 no access.

## Locked sections

A locked section is never read, searched, exported, or backed up in the clear through this command, however it is asked.
