"""Reads one inline container of Markdown 2 into the neutral tree of the fixtures, and finds its readable text
(spec 7.9 to 7.13). It reads every canonical string and the hostile inputs of the fixtures, but it is not a full
CommonMark parser."""

from __future__ import annotations

import html.entities
import re
import unicodedata

from inline_tags import (
    CLOSE_TAG, MAX_DEPTH, RAW_CLOSE, RAW_OPEN, V1_SIMPLE, V1_SIMPLE_MARKS, is_control, known_mark, parse_open_tag,
    sort_marks,
)  # fmt: skip
from markdown_text import WHITE_SPACE

# Reading: one inline container to the neutral tree.
FOOTNOTE = re.compile(r"\[\^([0-7][0-9a-hjkmnp-tv-z]{25})\]")
ENTITY = re.compile(r"&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});")
ASCII_PUNCT = set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")


def char_class(c: str | None) -> str:
    if c is None or c in WHITE_SPACE:
        return "ws"
    if c in ASCII_PUNCT or unicodedata.category(c)[0] in "PS":
        return "punct"
    return "other"


def flanking(prev: str | None, nxt: str | None) -> tuple[bool, bool]:
    before, after = char_class(prev), char_class(nxt)
    left = after != "ws" and (after != "punct" or before != "other")
    right = before != "ws" and (before != "punct" or after != "other")
    return left, right


def decode_entity(found: re.Match) -> str | None:
    body = found.group(1)
    if body.startswith("#"):
        code = int(body[2:], 16) if body[1:2] in "xX" else int(body[1:])
        return chr(code) if 0 < code <= 0x10FFFF and not 0xD800 <= code <= 0xDFFF else "�"
    return html.entities.html5.get(body + ";")


def code_span(text: str, at: int) -> tuple[str, int] | None:
    run = len(text[at:]) - len(text[at:].lstrip("`"))
    i = at + run
    while i < len(text):
        if text[i] != "`":
            i += 1
            continue
        length = len(text[i:]) - len(text[i:].lstrip("`"))
        if length == run:
            body = text[at + run : i].replace("\n", " ")
            if len(body) >= 2 and body[0] == " " and body[-1] == " " and body.strip(" "):
                body = body[1:-1]
            return body, i + length
        i += length
    return None


def link_destination(text: str, at: int) -> tuple[str, int] | None:
    """The destination of `](...)` whose `(` is at `at`, and where the link ends."""
    i = at + 1
    if text[i : i + 1] == "<":
        out, i = [], i + 1
        while i < len(text) and text[i] not in "<>\n":
            if text[i] == "\\" and i + 1 < len(text) and text[i + 1] in ASCII_PUNCT:
                i += 1
            out.append(text[i])
            i += 1
        return ("".join(out), i + 2) if text[i : i + 2] == ">)" else None
    out, depth = [], 0
    while i < len(text):
        c = text[i]
        if c == "\\" and i + 1 < len(text) and text[i + 1] in ASCII_PUNCT:
            out.append(text[i + 1])
            i += 2
            continue
        if c == ")" and depth == 0:
            return "".join(out), i + 1
        if c in WHITE_SPACE or is_control(c):
            return None
        depth += 1 if c == "(" else -1 if c == ")" else 0
        out.append(c)
        i += 1
    return None


def tokenize(text: str) -> list[list]:
    """Flat events: text, break, code, footnote, html, delim, link brackets."""
    events: list[list] = []
    brackets: list[int] = []
    i = 0

    def add_text(s: str) -> None:
        if events and events[-1][0] == "text":
            events[-1][1] += s
        else:
            events.append(["text", s])

    while i < len(text):
        c = text[i]
        if c == "\\" and text[i + 1 : i + 2] == "\n":
            events.append(["break"])
            i += 2
        elif c == "\\" and i + 1 < len(text) and text[i + 1] in ASCII_PUNCT:
            add_text(text[i + 1])
            i += 2
        elif c == "&" and (found := ENTITY.match(text, i)) and (decoded := decode_entity(found)) is not None:
            add_text(decoded)
            i = found.end()
        elif c == "`":
            span = code_span(text, i)
            if span is None:
                run = len(text[i:]) - len(text[i:].lstrip("`"))
                add_text("`" * run)
                i += run
            else:
                events.append(["code", span[0]])
                i = span[1]
        elif c == "<" and (found := RAW_OPEN.match(text, i) or RAW_CLOSE.match(text, i)):
            events.append(["html", found.group(0)])
            i = found.end()
        elif c == "[" and (found := FOOTNOTE.match(text, i)) and text[found.end() : found.end() + 1] != "(":
            events.append(["footnote", found.group(1)])
            i = found.end()
        elif c == "[":
            brackets.append(len(events))
            events.append(["lbracket"])
            i += 1
        elif c == "]" and brackets and text[i + 1 : i + 2] == "(" and (dest := link_destination(text, i + 1)):
            opener = brackets.pop()
            events[opener] = ["link_open", dest[0]]
            events.append(["link_close"])
            i = dest[1]
        elif c in "*~=":
            run = len(text[i:]) - len(text[i:].lstrip(c))
            prev = text[i - 1] if i > 0 else None
            nxt = text[i + run] if i + run < len(text) else None
            left, right = flanking(prev, nxt)
            if c == "=":
                left, right = char_class(nxt) != "ws", char_class(prev) != "ws"
            events.append(["delim", c, run, left, right, run])
            i += run
        else:
            add_text(c)
            i += 1
    for at in brackets:
        events[at] = ["text", "["]
    return events


def process_delimiters(events: list[list]) -> None:
    """CommonMark's emphasis rule for `*`, and pairs of 2 for `~~` and `==`, in place."""
    stack: list[int] = []
    for index, event in enumerate(events):
        if event[0] != "delim":
            continue
        char, _, can_open, can_close, _ = event[1:]
        while can_close and event[2] > 0:
            match = None
            for s in range(len(stack) - 1, -1, -1):
                opener = events[stack[s]]
                if opener[1] != char or opener[2] == 0:
                    continue
                if char == "*" and (opener[4] or can_open) and (opener[5] + event[5]) % 3 == 0:
                    if opener[5] % 3 != 0 or event[5] % 3 != 0:
                        continue
                if char != "*" and (opener[2] < 2 or event[2] < 2):
                    continue
                match = s
                break
            if match is None:
                break
            opener = events[stack[match]]
            use = 2 if opener[2] >= 2 and event[2] >= 2 else 1
            name = {"*": "strong" if use == 2 else "emphasis", "~": "strike", "=": "highlight"}[char]
            opener.append(("open", name, use))
            event.append(("close", name, use))
            opener[2] -= use
            event[2] -= use
            del stack[match + 1 :]
        if can_open and event[2] > 0:
            stack.append(index)


def expand(events: list[list]) -> list[list]:
    """Turns paired delimiters into mark events, and the rest of each run into text."""
    out: list[list] = []
    for event in events:
        if event[0] != "delim":
            out.append(event)
            continue
        char, left = event[1], event[2]
        pairs = event[6:]
        closes = [p for p in pairs if p[0] == "close"]
        opens = [p for p in pairs if p[0] == "open"]
        out.extend(["mark_close", p[1]] for p in closes)
        if left:
            out.append(["text", char * left])
        out.extend(["mark_open", p[1]] for p in reversed(opens))
    return out


def pair_tags(events: list[list]) -> None:
    """Pairs tags with a stack (R-INL-6): a closing tag closes the innermost open tag of the same name."""
    stack: list[tuple[int, str, object]] = []
    pairs: list[tuple[int, int]] = []
    for index, event in enumerate(events):
        if event[0] != "html":
            continue
        raw = event[1]
        if raw in V1_SIMPLE:
            stack.append((index, V1_SIMPLE[raw], V1_SIMPLE_MARKS[V1_SIMPLE[raw]]))
            continue
        parsed = parse_open_tag(raw)
        if parsed:
            mark = known_mark(*parsed)
            stack.append((index, parsed[0], mark if mark is not None else {"foreign": raw}))
            continue
        closing = CLOSE_TAG.fullmatch(raw)
        if closing and stack and stack[-1][1] == closing.group(1):
            open_index, _, mark = stack.pop()
            events[open_index] = ["tag_open", mark, raw_of(events[open_index]), index]
            events[index] = ["tag_close", open_index, raw]
            pairs.append((open_index, index))
    depth_limit(events, pairs)
    for index, event in enumerate(events):
        if event[0] == "html":
            events[index] = ["text", event[1]]


def raw_of(event: list) -> str:
    return event[1]


def depth_limit(events: list[list], pairs: list[tuple[int, int]]) -> None:
    """A pair inside more than 31 other pairs is literal text (R-INL-12)."""
    for open_index, close_index in pairs:
        depth = sum(1 for o, c in pairs if o <= open_index and c >= close_index)
        if depth > MAX_DEPTH:
            events[open_index] = ["html", events[open_index][2]]
            events[close_index] = ["html", events[close_index][2]]


def read_inline(text: str) -> list[dict]:
    """One inline container of canonical OpenNote Markdown 2 as neutral inlines."""
    events = tokenize(text)
    process_delimiters(events)
    events = expand(events)
    pair_tags(events)
    content: list[dict] = []
    active: list[tuple[object, object]] = []

    def marks() -> list:
        return sort_marks([mark for _, mark in active])

    def add(node: dict) -> None:
        last = content[-1] if content else None
        if "text" in node and last and "text" in last and last["marks"] == node["marks"]:
            last["text"] += node["text"]
        elif "text" not in node or node["text"]:
            content.append(node)

    for index, event in enumerate(events):
        tag = event[0]
        if tag == "text":
            add({"text": event[1], "marks": marks()})
        elif tag == "code":
            add({"text": event[1], "marks": marks() + ["code"]})
        elif tag == "break":
            content.append({"hardBreak": True})
        elif tag == "footnote":
            content.append({"footnote": event[1], "marks": marks()})
        elif tag == "link_open":
            active.append((("link", index), {"link": event[1]}))
        elif tag == "link_close":
            drop(active, lambda key: key[0] == "link")
        elif tag == "mark_open":
            active.append((("delim", event[1], index), event[1]))
        elif tag == "mark_close":
            drop(active, lambda key, name=event[1]: key[0] == "delim" and key[1] == name)
        elif tag == "tag_open":
            active.append((("tag", index), event[1]))
        elif tag == "tag_close":
            drop(active, lambda key, at=event[1]: key == ("tag", at))
    return content


def drop(active: list, match) -> None:
    for at in range(len(active) - 1, -1, -1):
        if match(active[at][0]):
            del active[at]
            return


def plain_text(content: list[dict]) -> str:
    """Readable text (R-TXT-1): the text of every run, with marks and tags dropped and hard breaks as line feeds."""
    out = []
    for node in content:
        if "text" in node:
            out.append(node["text"])
        elif "hardBreak" in node:
            out.append("\n")
    return "".join(out)


def readable_text(markdown: str) -> str:
    """The readable text of inline Markdown: paragraphs joined by a blank line."""
    return "\n\n".join(plain_text(read_inline(part)) for part in markdown.split("\n\n"))


def read_paragraphs(markdown: str) -> list[dict]:
    return [{"type": "paragraph", "content": read_inline(part)} for part in markdown.split("\n\n")]
