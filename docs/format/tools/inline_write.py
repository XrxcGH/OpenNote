"""Writes neutral inlines as canonical Markdown 2 (spec 7.6, 7.7, 7.10, 7.11, and 7.12), as the interface's
writer does: marks nest in a fixed order, delimiters fall back to tags, and text is escaped as one line."""

from __future__ import annotations

import re
import unicodedata

from inline_read import char_class, read_inline
from inline_tags import SPAN_ONE, is_control, kind, shows_on_spaces, sort_marks
from markdown_text import WHITE_SPACE

# Writing: neutral inlines to canonical Markdown (spec 7.6, 7.7, 7.10, 7.11, 7.12).
ATOM = ""
NOTE = ""
DELIMITERS = {"strong": "**", "emphasis": "*", "strike": "~~", "highlight": "=="}
SIMPLE_TAGS = {"strong": "strong", "emphasis": "em", "strike": "del", "underline": "u", "highlight": "mark"}
SIMPLE_TAGS.update({"sub": "sub", "sup": "sup"})
SPAN_ATTR = {kind_: attr for attr, (kind_, _) in SPAN_ONE.items()}


def open_tag(mark: object) -> str:
    if isinstance(mark, str):
        return f"<{SIMPLE_TAGS[mark]}>"
    k, v = next(iter(mark.items()))
    if k == "foreign":
        return v
    if k == "underline":
        attrs = ([f'data-line="{v["line"]}"'] if "line" in v else []) + (
            [f'data-line-color="{v["color"]}"'] if "color" in v else []
        )
        return "<u " + " ".join(attrs) + ">"
    if k == "strike":
        return '<del data-line="double">'
    if k == "highlight":
        return f'<mark data-color="{v}">'
    if k == "box":
        extra = f' data-box-color="{v["color"]}"' if "color" in v else ""
        return f'<span data-box="{v["style"]}"{extra}>'
    return f'<span {SPAN_ATTR[k]}="{v}">'


def close_tag(mark: object) -> str:
    if isinstance(mark, str):
        return f"</{SIMPLE_TAGS[mark]}>"
    k = kind(mark)
    if k == "foreign":
        return "</" + re.match(r"<([a-z]+)", mark["foreign"]).group(1) + ">"
    return {"underline": "</u>", "strike": "</del>", "highlight": "</mark>"}.get(k, "</span>")


def has_delimiter(mark: object) -> bool:
    return isinstance(mark, str) and mark in DELIMITERS


def leaves_of(content: list[dict]) -> list[dict]:
    leaves: list[dict] = []
    for node in content:
        if "text" in node:
            leaf = {"kind": "text", "text": node["text"], "marks": list(node["marks"])}
        elif "hardBreak" in node:
            leaf = {"kind": "break", "marks": []}
        else:
            leaf = {"kind": "note", "id": node["footnote"], "marks": list(node.get("marks", []))}
        last = leaves[-1] if leaves else None
        if last and last["kind"] == leaf["kind"] == "text" and last["marks"] == leaf["marks"]:
            last["text"] += leaf["text"]
        else:
            leaves.append(leaf)
    return leaves


def is_code(leaf: dict | None) -> bool:
    return bool(leaf) and leaf["kind"] == "text" and "code" in leaf["marks"]


def wrapping(leaf: dict | None) -> list:
    return [] if not leaf else [m for m in sort_marks(leaf["marks"]) if m != "code"]


def peel(leaf: dict, mark: object, side: str) -> list[dict] | None:
    if leaf["kind"] == "note":
        return None
    rest = [m for m in leaf["marks"] if m != mark]
    if leaf["kind"] == "break":
        return [{"kind": "break", "marks": rest}]
    if shows_on_spaces(mark):
        return None
    text = leaf["text"]
    core = text.lstrip("".join(WHITE_SPACE)) if side == "start" else text.rstrip("".join(WHITE_SPACE))
    if core == text:
        return None
    edge = text[: len(text) - len(core)] if side == "start" else text[len(core) :]
    spaces = {"kind": "text", "text": edge, "marks": rest}
    if not core:
        return [spaces]
    middle = {"kind": "text", "text": core, "marks": leaf["marks"]}
    return [spaces, middle] if side == "start" else [middle, spaces]


def trim_edges(leaves: list[dict]) -> list[dict]:
    """R-WS-1 to R-WS-3: whitespace and breaks at a range's edges move outside it, except where marks show on spaces."""
    while True:
        for i, leaf in enumerate(leaves):
            if is_code(leaf):
                continue
            changed = None
            for mark in wrapping(leaf):
                before = i > 0 and mark in leaves[i - 1]["marks"]
                after = i + 1 < len(leaves) and mark in leaves[i + 1]["marks"]
                for side, edge in (("start", not before), ("end", not after)):
                    peeled = peel(leaf, mark, side) if edge else None
                    if peeled:
                        changed = leaves[:i] + peeled + leaves[i + 1 :]
                        break
                if changed:
                    break
            if changed:
                leaves = changed
                break
        else:
            return merge_leaves(leaves)


def merge_leaves(leaves: list[dict]) -> list[dict]:
    out: list[dict] = []
    for leaf in leaves:
        last = out[-1] if out else None
        if last and last["kind"] == leaf["kind"] == "text" and sort_marks(last["marks"]) == sort_marks(leaf["marks"]):
            last["text"] += leaf["text"]
        else:
            out.append(dict(leaf))
    return out


def plan_ranges(leaves: list[dict]) -> tuple[list[dict], list[dict]]:
    boundaries = [{"closes": [], "opens": []} for _ in range(len(leaves) + 1)]
    ranges: list[dict] = []
    stack: list[dict] = []
    for at in range(len(leaves) + 1):
        target = wrapping(leaves[at] if at < len(leaves) else None)
        keep = 0
        while keep < len(stack) and keep < len(target) and stack[keep]["mark"] == target[keep]:
            keep += 1
        for r in reversed(stack[keep:]):
            r["close"] = at
            boundaries[at]["closes"].append(r)
        opened = [{"mark": m, "open": at, "close": -1} for m in target[keep:]]
        boundaries[at]["opens"].extend(opened)
        ranges.extend(opened)
        stack = stack[:keep] + opened
    return ranges, boundaries


def escape_view(chars: list[str], seams_marks: set, seams_high: set) -> list[str]:
    """Spec 7.6 over the text of one inline container, markup left out, as the interface's writer does."""
    out, line_start = [], 0
    for at, ch in enumerate(chars):
        if at > 0 and chars[at - 1] == "\n":
            line_start = at
        if ch == "\n":
            out.append("\n")
            continue
        prev = chars[at - 1] if at > line_start else None
        nxt = chars[at + 1] if at + 1 < len(chars) else None
        first = at == line_start
        if ch in ("(", ":") and prev == NOTE:
            out.append("\\" + ch)
        elif ch in "\\`*~$[]{<|":
            out.append("\\" + ch)
        elif ch == "\t":
            out.append("&#9;")
        elif ch == " ":
            out.append("&#32;" if first or nxt is None or nxt == "\n" else " ")
        elif ch == "_":
            word = prev is not None and nxt is not None and char_word(prev) and char_word(nxt)
            out.append("_" if word and at not in seams_marks and at + 1 not in seams_marks else "\\_")
        elif ch == "=":
            touching = prev == "=" or nxt == "="
            out.append("\\=" if touching or first or at in seams_high or at + 1 in seams_high else "=")
        elif ch == "&":
            out.append("\\&" if re.match(r"&#?[A-Za-z0-9]+;", "".join(chars[at : at + 40])) else "&")
        elif ch == "#":
            out.append("\\#" if first or prev in WHITE_SPACE else "#")
        elif ch in ">-+":
            out.append("\\" + ch if first else ch)
        elif ch in ".)" and 1 <= at - line_start <= 9 and all("0" <= d <= "9" for d in chars[line_start:at]):
            out.append("\\" + ch)
        else:
            out.append(ch)
    return out


def char_word(c: str) -> bool:
    return unicodedata.category(c)[0] in "LN"


def code_span_text(text: str) -> str:
    used = {len(run) for run in re.findall(r"`+", text)}
    size = 1
    while size in used:
        size += 1
    fence = "`" * size
    spaced = text.startswith(" ") and text.endswith(" ") and bool(text.strip())
    padded = text.startswith("`") or text.endswith("`") or spaced
    return f"{fence} {text} {fence}" if padded else f"{fence}{text}{fence}"


def leaf_outputs(leaves: list[dict], boundaries: list[dict]) -> list[str]:
    views = []
    for leaf in leaves:
        if leaf["kind"] == "break":
            views.append(["\n"])
        elif leaf["kind"] == "note":
            views.append([NOTE])
        elif is_code(leaf):
            views.append([ATOM])
        else:
            views.append(list(leaf["text"]))
    starts, total = [], 0
    for view in views:
        starts.append(total)
        total += len(view)
    starts.append(total)
    marks_at, high_at = set(), set()
    for at, b in enumerate(boundaries):
        if b["closes"] or b["opens"]:
            marks_at.add(starts[at])
        if any(r["mark"] == "highlight" for r in b["closes"] + b["opens"]):
            high_at.add(starts[at])
    escaped = escape_view([c for view in views for c in view], marks_at, high_at)
    outputs = []
    for i, leaf in enumerate(leaves):
        if leaf["kind"] == "break":
            outputs.append("\\\n")
        elif leaf["kind"] == "note":
            outputs.append(f"[^{leaf['id']}]")
        elif is_code(leaf):
            outputs.append(code_span_text(leaf["text"]))
        else:
            outputs.append("".join(escaped[starts[i] : starts[i + 1]]))
    return outputs


def edge_class(text: str, side: str) -> str:
    if not text:
        return "ws"
    return char_class(text[0] if side == "first" else text[-1])


def decide_styles(ranges: list[dict], boundaries: list[dict], outputs: list[str]) -> dict[int, str]:
    styles = {id(r): ("delim" if has_delimiter(r["mark"]) else "tag") for r in ranges}

    def star(r: dict) -> bool:
        return r["mark"] in ("strong", "emphasis") and styles[id(r)] == "delim"

    def neighbor(seq: list[dict], at: int, step: int, fallback: str) -> str:
        joins = star(seq[at])
        i = at + step
        while 0 <= i < len(seq):
            if not (joins and star(seq[i])):
                return "punct"
            i += step
        return fallback

    def sides(r: dict, opening: bool) -> tuple[str, str]:
        at = r["open"] if opening else r["close"]
        b = boundaries[at]
        seq = b["closes"] + b["opens"]
        index = len(b["closes"]) + b["opens"].index(r) if opening else b["closes"].index(r)
        before = edge_class(outputs[at - 1], "last") if at > 0 else "ws"
        after = edge_class(outputs[at], "first") if at < len(outputs) else "ws"
        return neighbor(seq, index, -1, before), neighbor(seq, index, 1, after)

    def works(r: dict) -> bool:
        op, opn = sides(r, True)
        cp, cn = sides(r, False)
        if r["mark"] == "highlight":
            return opn != "ws" and cp != "ws"
        joins = r["mark"] in ("strong", "emphasis") and any(star(x) for x in boundaries[r["open"]]["closes"])
        can_open = opn != "ws" and (opn != "punct" or op != "other")
        can_close = cp != "ws" and (cp != "punct" or cn != "other")
        return not joins and can_open and can_close

    changed = True
    while changed:
        changed = False
        for r in ranges:
            if styles[id(r)] == "delim" and not works(r):
                styles[id(r)] = "tag"
                changed = True
    return styles


def render(boundaries: list[dict], outputs: list[str], styles: dict[int, str]) -> str:
    text = ""
    for at, b in enumerate(boundaries):
        for r in b["closes"]:
            mark = r["mark"]
            if kind(mark) == "link":
                text += "](" + write_dest(mark["link"]) + ")"
            else:
                text += DELIMITERS[mark] if styles.get(id(r)) == "delim" else close_tag(mark)
        for r in b["opens"]:
            mark = r["mark"]
            if kind(mark) == "link":
                text = bare_bang(text) + "["
            else:
                text += DELIMITERS[mark] if styles.get(id(r)) == "delim" else open_tag(mark)
        if at < len(outputs):
            out = outputs[at]
            text = (bare_bang(text) if out.startswith("[^") else text) + out
    return text


def bare_bang(text: str) -> str:
    """A `!` right before a link or a footnote reference is escaped, or it would read as an image (spec 7.6)."""
    slashes = len(text[:-1]) - len(text[:-1].rstrip("\\"))
    return text[:-1] + "\\!" if text.endswith("!") and slashes % 2 == 0 else text


def write_dest(dest: str) -> str:
    bare = dest and not any(c in WHITE_SPACE or is_control(c) or c in "()<>\\" for c in dest)
    body = dest if bare else re.sub(r"[<>\\]", lambda m: "\\" + m.group(0), dest)
    body = re.sub(r"&(?=#?[A-Za-z0-9]+;)", "\\&", body)
    return body if bare else f"<{body}>"


def write_inline(content: list[dict]) -> str:
    """Neutral inlines as canonical Markdown. Falls back to tags where delimiters would read back differently."""
    leaves = trim_edges(leaves_of(content))
    while leaves and leaves[0]["kind"] == "break":
        leaves.pop(0)
    while leaves and leaves[-1]["kind"] == "break":
        leaves.pop()
    ranges, boundaries = plan_ranges(leaves)
    outputs = leaf_outputs(leaves, boundaries)
    styles = decide_styles(ranges, boundaries, outputs)
    text = render(boundaries, outputs, styles)
    if "delim" not in styles.values() or normalize(read_inline(text)) == normalize(content_of(leaves)):
        return text
    return render(boundaries, outputs, {})


def content_of(leaves: list[dict]) -> list[dict]:
    out = []
    for leaf in leaves:
        if leaf["kind"] == "text":
            out.append({"text": leaf["text"], "marks": sort_marks(leaf["marks"])})
        elif leaf["kind"] == "break":
            out.append({"hardBreak": True})
        else:
            out.append({"footnote": leaf["id"], "marks": sort_marks(leaf["marks"])})
    return out


def normalize(content: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for node in content:
        node = dict(node)
        if "marks" in node:
            node["marks"] = sort_marks(node["marks"])
        last = merged[-1] if merged else None
        if last and "text" in node and "text" in last and last["marks"] == node["marks"]:
            last["text"] += node["text"]
        else:
            merged.append(node)
    return merged


def write_paragraphs(document: list[dict]) -> str:
    return "\n\n".join(write_inline(block["content"]) for block in document)
