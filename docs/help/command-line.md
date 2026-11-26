# The opennote command

`opennote` adds to and searches your notes from a terminal or a script. It works only through OpenNote's local API, so it can do no more than you allow in **Settings, then App permissions**.

## Set it up

1. In OpenNote, open **Settings, then App permissions** and turn on **Let apps on this PC connect**.
2. Install the command. OpenNote puts `opennote.exe` in the folder it was installed to. On a Mac or Linux it puts `opennote` in `~/.local/bin` each time it starts. First-time setup asks whether to add it to PATH when it adds OpenNote to the Start menu. You can change that later in App permissions with **Add the opennote command to PATH**, so you can type `opennote` from any folder.
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
| `opennote inspect PAGE` | Shows a page's parts, headings, word count, and latest page history, to check a change. |
| `opennote render PAGE [--out FILE]` | Saves the page's handwriting and drawings as a PNG (text isn't drawn). |
| `opennote export SECTION [--out FOLDER]` | Saves each page of a section as a Markdown file. |
| `opennote commands` | Lists every command and whether the tool's access lets it run. |
| `opennote backup` | Backs up every notebook to the backup folder set in OpenNote. |
| `opennote connect` | Asks OpenNote for access now. |
| `opennote disconnect` | Forgets this tool's key. Revoke it in App permissions to end its access. |
| `opennote mcp` | Runs the assistant connection described in [the local API help](local-api.md). |

Add `--json` to print OpenNote's answers as JSON. Section and page IDs come from `notebooks` and `pages`. Add `--author "TEXT"` to `new`, `append`, or `daily` to say who made the change; page history shows it after the tool's name.

## Which folders it uses

The command reads a `--file` only from the current folder, and writes `export` and `render` files only into the current folder, unless you name other folders with `--read-root FOLDER` and `--write-root FOLDER` (each can be given more than once). Links and shortcuts are followed before the check. Network folders (`\\server\share`), device paths, names Windows keeps for devices (such as `CON` or `NUL.txt`), and data streams (`file.md:hidden`) are always refused. The message says which folder to allow. This is new in beta 5: a script that read or wrote files outside the current folder before now needs `--read-root` or `--write-root`.

## Exit codes

0 done, 1 failed, 2 wrong arguments, 3 OpenNote isn't reachable, 4 no access.

## Locked sections

A locked section is never read, searched, exported, or backed up in the clear through this command, however it is asked.
