"""Reads an OpenNote notebook with only the Python standard library (spec Appendix B.6). Owned by WP1.

It turns a notebook into Markdown and SVG files. That shows the specification is enough to read a notebook
without OpenNote's code. Run it as `python read_opennote.py <notebook folder> <output folder>`. It writes
`index.md` and `README.md`, and `page.md` and `ink.svg` for each page, in the same folders as the notebook.

The reader follows these choices, which the spec leaves to the writer. A link to a page in the same section
becomes `../<page ID>/page.md`, and a link to a page in another section `../../<section ID>/<page ID>/page.md`.
Times in front matter are copied as the file writes them. Segment files that are missing are skipped, and
blocks whose data breaks the spec are not checked here.
"""

from __future__ import annotations

import sys
from pathlib import Path

from ink_segments import decode_segment, replay
from ink_svg import render_ink_svg
from markdown_text import escape_text, rewrite_links, write_destination
from readable_text import is_floating, one_line, quoted, read_json, seal, strip

NEWER_VERSION_LINE = "*This part of the page needs a newer version of OpenNote.*"
README_MARK = "<!-- Written by OpenNote. OpenNote only rewrites this file while this line is here. -->"


# Pages ---------------------------------------------------------------------------------------------------------


def load_strokes(page_dir: Path, page: dict) -> dict[str, dict]:
    """The page's live strokes, from the segments that are there."""
    record_lists = []
    for entry in page.get("ink", {}).get("segments", []):
        path = page_dir / "ink" / f"{entry['id']}.onk"
        if path.is_file():
            record_lists.append(decode_segment(path.read_bytes(), entry, page["id"])["records"])
    return replay(record_lists)


def reading_order(page: dict) -> list[dict]:
    """The blocks in reading order (spec 6.2): `readingOrder` first, then flowing blocks, then floating rows."""
    blocks = sorted(page.get("blocks", []), key=lambda b: (b["order"], b["id"]))
    by_id = {b["id"]: b for b in blocks}
    out, seen = [], set()
    for block_id in page.get("readingOrder", []):
        if block_id in by_id and block_id not in seen:
            seen.add(block_id)
            out.append(by_id[block_id])
    rest = [b for b in blocks if b["id"] not in seen]
    out += [b for b in rest if not is_floating(b)]
    pos = lambda b: (b["frame"]["x"], b["frame"]["y"])  # noqa: E731
    floating = sorted((b for b in rest if is_floating(b)), key=lambda b: (pos(b)[1], pos(b)[0], b["order"], b["id"]))
    start = 0
    while start < len(floating):
        top = pos(floating[start])[1]
        end = start
        while end < len(floating) and pos(floating[end])[1] - top <= 8:
            end += 1
        out += sorted(floating[start:end], key=lambda b: (pos(b)[0], pos(b)[1], b["order"], b["id"]))
        start = end
    return out


def inline_text(text: str) -> str:
    return escape_text(strip(one_line(text)), False)


def asset_destination(page: dict, asset: str) -> str:
    entry = page.get("assets", {}).get(asset)
    return write_destination(f"assets/{entry['file']}") if entry else f"asset:{asset}"


def table_cell(markdown: str) -> str:
    """A cell for a GFM table: hard breaks become `<br>`, and a `|` not escaped yet gets a backslash."""
    text = markdown.replace("\\\n", "<br>").replace("\n", " ")
    out, escaped = [], False
    for c in text:
        if c == "|" and not escaped:
            out.append("\\")
        escaped = c == "\\" and not escaped
        out.append(c)
    return "".join(out)


def render_table(data: dict, rewrite) -> str | None:
    columns = data.get("columns", [])
    if not columns:
        return None
    rows = data.get("rows", [])

    def cells(row: dict) -> list[str]:
        found = row.get("cells", {})
        texts = [found[c["id"]]["markdown"] if c["id"] in found else None for c in columns]
        return ["" if text is None else table_cell(rewrite_links(text, rewrite)) for text in texts]

    header, body = (cells(rows[0]), rows[1:]) if data.get("header") and rows else ([""] * len(columns), rows)
    lines = [header, ["---"] * len(columns)] + [cells(row) for row in body]
    return "\n".join("| " + " | ".join(line) + " |" for line in lines)


def render_block(block: dict, page: dict, rewrite) -> str | None:
    """One block of `page.md` (spec 11.1)."""
    data, kind = block["data"], block["type"]
    if kind == "text":
        return rewrite_links(data["markdown"], rewrite)
    if kind == "image":
        alt = "" if data.get("decorative") else inline_text(data.get("alt", ""))
        return f"![{alt}]({asset_destination(page, data['asset'])})"
    if kind == "file":
        entry = page.get("assets", {}).get(data["asset"])
        name = entry["name"] if entry else data["asset"]
        return f"[{inline_text(name)}]({asset_destination(page, data['asset'])})"
    if kind == "table":
        return render_table(data, rewrite)
    if kind == "ink":
        text = inline_text(data.get("alt", ""))
        drawing = data.get("role") == "drawing" and not data.get("decorative") and text
        return f"*{text}*" if drawing else None
    fallback = strip((block.get("fallback") or {}).get("markdown", ""))
    return rewrite_links(fallback, rewrite) if fallback else NEWER_VERSION_LINE


def render_page_md(page: dict, strokes: dict, page_md) -> str:
    """`page.md` (spec 11.1). `page_md` gives the relative path to another page's `page.md`, or None."""

    def rewrite(destination: str) -> str | None:
        if destination.startswith("opennote:page/"):
            return page_md(destination[len("opennote:page/") :].split("#", 1)[0].lower())
        if destination.startswith("asset:") and destination[6:].lower() in page.get("assets", {}):
            return "assets/" + page["assets"][destination[6:].lower()]["file"]
        return None

    lines = ["---", f"title: {quoted(page['title'])}"]
    if page.get("tags"):
        lines.append("tags: [" + ", ".join(quoted(t) for t in page["tags"]) + "]")
    lines += [f'created: "{page["created"]}"', f'modified: "{page["modified"]}"', "opennote:"]
    lines += [f'  page: "{page["id"]}"', f'  revision: "{page["revision"]["id"]}"', "  format: 1"]
    lines += ['  checksum: "crc32:00000000"', "---", ""]
    parts = [f"# {escape_text(one_line(page['title']), True)}"] if one_line(page["title"]) else []
    counted = any(b["type"] == "ink" and b["data"].get("strokeCount", 0) > 0 for b in page.get("blocks", []))
    if strokes or counted:
        parts.append("![Handwriting on this page](ink.svg)")
    parts += [p for p in (render_block(b, page, rewrite) for b in reading_order(page)) if p]
    text = "\n".join(lines)
    if parts:
        text += "\n" + "\n\n".join(parts).replace("\0", chr(0xFFFD)) + "\n"
    return seal(text)


# The notebook --------------------------------------------------------------------------------------------------


def page_levels(entries: list[dict]) -> list[tuple[dict, int]]:
    """Page entries in display order with their levels (spec 4.4), as the Rust core orders them."""
    index = {e["id"]: i for i, e in enumerate(entries)}
    parents = [index.get(e.get("parent")) for e in entries]
    parents = [p if p != i else None for i, p in enumerate(parents)]
    children: dict = {}
    for i, parent in enumerate(parents):
        children.setdefault(parent, []).append(i)
    for kids in children.values():
        kids.sort(key=lambda i: (entries[i]["order"], entries[i]["id"]))
    out, visited = [], set()

    def walk(roots):
        stack = [(i, 0) for i in reversed(roots)]
        while stack:
            i, level = stack.pop()
            if i in visited:
                continue
            visited.add(i)
            out.append((entries[i], min(level, 2)))
            stack += [(k, level + 1) for k in reversed(children.get(i, []))]

    walk(children.get(None, []))
    for i in sorted(range(len(entries)), key=lambda i: (entries[i]["order"], entries[i]["id"])):
        if i not in visited:
            chain, current = [], i
            while current is not None and current not in chain:
                chain.append(current)
                current = parents[current]
            loop = chain[chain.index(current) :] if current is not None else chain
            walk([min(loop, key=lambda j: (entries[j]["order"], entries[j]["id"]))])
    return out


def heading_text(title: str) -> str:
    title = one_line(title)
    return escape_text(title, True) if title else "Untitled"


def section_parts(section: dict, level: int) -> list[str]:
    parts = [f"{'#' * min(level, 6)} {heading_text(section['title'])}"]
    if "encryption" in section:
        return parts
    lines = []
    for entry, depth in page_levels(section.get("pages", [])):
        title = strip(one_line(entry["title"]))
        text = escape_text(title, False) if title else "Untitled"
        path = write_destination(f"{section['id']}/{entry['id']}/page.md")
        lines.append(f"{'  ' * depth}- [{text}]({path})")
    return parts + (["\n".join(lines)] if lines else [])


def render_index_md(notebook: dict, sections: list[dict]) -> str:
    """`index.md` (spec 11.4): groups and sections as headings, and pages as nested lists."""
    groups = notebook.get("groups", [])
    key = lambda item: (item["order"], item["id"])  # noqa: E731

    def children(parent):
        items = [("group", g) for g in groups if g.get("parent") == parent]
        items += [("section", s) for s in sections if s.get("group") == parent]
        return sorted(items, key=lambda item: key(item[1]))

    parts, seen = [f"# {heading_text(notebook['title'])}"], set()

    def visit(roots):
        stack = [(item, 2) for item in reversed(roots)]
        while stack:
            (kind, item), level = stack.pop()
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            if kind == "section":
                parts.extend(section_parts(item, level))
                continue
            parts.append(f"{'#' * min(level, 6)} {heading_text(item['title'])}")
            stack += [(child, level + 1) for child in reversed(children(item["id"]))]

    visit(children(None))
    visit([("group", g) for g in sorted(groups, key=key) if g["id"] not in seen])
    visit([("section", s) for s in sorted(sections, key=key) if s["id"] not in seen])
    head = f'---\nopennote:\n  kind: "notebook-index"\n  notebook: {quoted(notebook["id"])}\n  format: 1\n'
    return seal(head + '  checksum: "crc32:00000000"\n---\n\n' + "\n\n".join(parts) + "\n")


def render_readme(title: str) -> str:
    """The notebook's `README.md` (spec 11.4)."""
    return (
        f"# {heading_text(title) if strip(one_line(title)) else 'Untitled'}\n\n"
        "This folder is a notebook made with OpenNote, an open-source note app. You can read all of it without "
        "OpenNote.\n\n"
        "- Open index.md for a list of every page.\n"
        "- Each page folder has page.md, a readable copy of the page, and ink.svg, a picture of its handwriting. "
        "Pictures and attachments are in its assets folder.\n"
        "- page.json holds the full page. The format is described in .opennote/FORMAT.md.\n\n"
        f"{README_MARK}\n"
    )


def read_notebook(root: Path) -> dict[str, str]:
    """Every readable copy of a notebook, by its path in the notebook folder."""
    notebook = read_json(root / "notebook.json")
    sections = [read_json(d / "section.json") for d in sorted(root.iterdir()) if (d / "section.json").is_file()]
    section_of = {entry["id"]: s["id"] for s in sections for entry in s.get("pages", [])}

    def links_from(page_id: str):
        def page_md(target: str) -> str | None:
            if target not in section_of:
                return None
            if section_of[target] == section_of[page_id]:
                return f"../{target}/page.md"
            return f"../../{section_of[target]}/{target}/page.md"

        return page_md

    out = {"index.md": render_index_md(notebook, sections), "README.md": render_readme(notebook["title"])}
    for section in (s for s in sections if "encryption" not in s):
        for entry in section.get("pages", []):
            page_dir = root / section["id"] / entry["id"]
            if not (page_dir / "page.json").is_file():
                continue
            page = read_json(page_dir / "page.json")
            strokes = load_strokes(page_dir, page)
            base = f"{section['id']}/{entry['id']}"
            out[f"{base}/page.md"] = render_page_md(page, strokes, links_from(page["id"]))
            if strokes:
                out[f"{base}/ink.svg"] = render_ink_svg(page, strokes)
    return out


def main(argv: list[str]) -> int:
    """Reads the notebook folder in argv[1] and writes readable files into the folder in argv[2]."""
    if len(argv) != 3:
        print("usage: read_opennote.py <notebook folder> <output folder>", file=sys.stderr)
        return 2
    for path, text in read_notebook(Path(argv[1])).items():
        target = Path(argv[2]) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text.encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
