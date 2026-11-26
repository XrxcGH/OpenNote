"""Reads one inline container of Markdown 2 into the neutral tree of the fixtures, and finds its readable text
(spec 7.9 to 7.13). It reads every canonical string and the hostile inputs of the fixtures, but it is not a full
CommonMark parser."""

from __future__ import annotations

import bisect
import functools
import html.entities
import re
import unicodedata

from inline_tags import (
    CLOSE_TAG, MAX_DEPTH, RAW_CLOSE, RAW_OPEN, V1_SIMPLE, V1_SIMPLE_MARKS, is_control, kind, known_mark,
    parse_open_tag, sort_marks,
)  # fmt: skip
from markdown_text import WHITE_SPACE

# Reading: one inline container to the neutral tree.
FOOTNOTE = re.compile(r"\[\^([0-7][0-9a-hjkmnp-tv-z]{25})\]")
ENTITY = re.compile(r"&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});")
ASCII_PUNCT = set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
# Characters that start nothing, so a run of them reads as one piece of text.
PLAIN = re.compile(r"[^\\&`<\[\]*~=]+")
ESCAPE_OR_PAREN = re.compile(r"\\[!-/:-@\[-`{-~]|[()]")
UNESCAPE = re.compile(r"\\([!-/:-@\[-`{-~])")
RUNS = {c: re.compile(re.escape(c) + "+") for c in "`*~="}
SPACE_OR_CONTROL = re.compile("[\x00-\x20\x7f-\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]")


@functools.lru_cache(maxsize=4096)
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


def run_length(text: str, at: int, c: str) -> int:
    """How many times `c` repeats from `at`, read without copying the rest of the text."""
    found = RUNS[c].match(text, at)
    return found.end() - at if found else 0


def backtick_runs(text: str) -> dict[int, list[int]]:
    """Where each whole run of backticks starts, by its length, so a code span finds its closer in one lookup."""
    runs: dict[int, list[int]] = {}
    for found in re.finditer("`+", text):
        runs.setdefault(len(found.group()), []).append(found.start())
    return runs


def code_span(text: str, at: int, runs: dict[int, list[int]]) -> tuple[str, int] | None:
    """The code span whose opening run starts at `at`, closed by the next run of the same length (CommonMark 6.1)."""
    run = run_length(text, at, "`")
    starts = runs.get(run, [])
    found = bisect.bisect_left(starts, at + run)
    if found == len(starts):
        return None
    i = starts[found]
    body = text[at + run : i].replace("\n", " ")
    if len(body) >= 2 and body[0] == " " and body[-1] == " " and body.strip(" "):
        body = body[1:-1]
    return body, i + run


def link_destination(text: str, at: int, dests: Destinations) -> tuple[str, int] | None:
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
    found = dests.close(i)
    return (UNESCAPE.sub(r"\1", text[i:found]), found + 1) if found is not None else None


class Destinations:
    """Where each bare link destination of one text ends (CommonMark 6.3): at the first `)` outside its balanced
    parentheses, unless a space or control comes first. Worked out once for the whole text, so a text of many open
    links does not scan the rest of the text once per link."""

    def __init__(self, text: str) -> None:
        # An escape starts nowhere inside another, so the escapes found from the start of the text are the ones
        # found from just after any `(`.
        self.parens: list[int] = []
        level, levels, closes = 0, [], []
        for found in ESCAPE_OR_PAREN.finditer(text):
            c = found.group()
            if len(c) == 1:
                self.parens.append(found.start())
                levels.append(level)
                closes.append(c == ")")
                level += 1 if c == "(" else -1
        # first[e]: the first `)` from paren e on that leaves the level paren e starts at.
        self.first: list[int | None] = [None] * len(levels)
        later: dict[int, int] = {}
        for e in range(len(levels) - 1, -1, -1):
            if closes[e]:
                later[levels[e]] = self.parens[e]
            self.first[e] = later.get(levels[e])
        self.stops = [found.start() for found in SPACE_OR_CONTROL.finditer(text)]

    def close(self, start: int) -> int | None:
        e = bisect.bisect_left(self.parens, start)
        end = self.first[e] if e < len(self.parens) else None
        if end is None:
            return None
        stop = bisect.bisect_left(self.stops, start)
        return end if stop == len(self.stops) or self.stops[stop] > end else None


def tokenize(text: str, spans: dict | None = None) -> list[list]:
    """Flat events: text, break, code, footnote, html, delim, link brackets. `spans`, when given, maps the `id` of
    each html and footnote event to where it sits in `text`."""
    events: list[list] = []
    brackets: list[int] = []
    # Text collects in pieces and joins once per event, so a long text costs its length and not its square.
    pieces: list[str] = []
    runs: dict[int, list[int]] | None = None
    dests: Destinations | None = None
    i = 0

    def flush() -> None:
        if pieces:
            events.append(["text", "".join(pieces)])
            pieces.clear()

    def push(event: list) -> None:
        flush()
        events.append(event)

    add_text = pieces.append
    while i < len(text):
        c = text[i]
        if c not in "\\&`<[]*~=" and (found := PLAIN.match(text, i)):
            add_text(found.group())
            i = found.end()
        elif c in "*~=":
            run = run_length(text, i, c)
            prev = text[i - 1] if i > 0 else None
            nxt = text[i + run] if i + run < len(text) else None
            left, right = flanking(prev, nxt)
            if c == "=":
                left, right = char_class(nxt) != "ws", char_class(prev) != "ws"
            push(["delim", c, run, left, right, run])
            i += run
        elif c == "\\" and text[i + 1 : i + 2] == "\n":
            push(["break"])
            i += 2
        elif c == "\\" and i + 1 < len(text) and text[i + 1] in ASCII_PUNCT:
            add_text(text[i + 1])
            i += 2
        elif c == "&" and (found := ENTITY.match(text, i)) and (decoded := decode_entity(found)) is not None:
            add_text(decoded)
            i = found.end()
        elif c == "`":
            runs = backtick_runs(text) if runs is None else runs
            span = code_span(text, i, runs)
            if span is None:
                run = run_length(text, i, "`")
                add_text("`" * run)
                i += run
            else:
                push(["code", span[0]])
                i = span[1]
        elif c == "<" and (found := RAW_OPEN.match(text, i) or RAW_CLOSE.match(text, i)):
            push(["html", found.group(0)])
            if spans is not None:
                spans[id(events[-1])] = (i, found.end())
            i = found.end()
        elif c == "[" and (found := FOOTNOTE.match(text, i)) and text[found.end() : found.end() + 1] != "(":
            push(["footnote", found.group(1)])
            if spans is not None:
                spans[id(events[-1])] = (i, found.end())
            i = found.end()
        elif c == "[":
            push(["lbracket"])
            brackets.append(len(events) - 1)
            i += 1
        elif c == "]" and brackets and text[i + 1 : i + 2] == "(":
            dests = Destinations(text) if dests is None else dests
            if not (dest := link_destination(text, i + 1, dests)):
                add_text(c)
                i += 1
                continue
            opener = brackets.pop()
            events[opener] = ["link_open", dest[0]]
            push(["link_close"])
            i = dest[1]
        else:
            add_text(c)
            i += 1
    flush()
    for at in brackets:
        events[at] = ["text", "["]
    return events


def process_delimiters(events: list[list]) -> None:
    """CommonMark's emphasis rule for `*`, and pairs of 2 for `~~` and `==`, in place. Like CommonMark's
    openers_bottom, `bottom` keeps, for each kind of closer, the event below which no opener can match it, so no
    closer looks at the same openers twice and a long run of unmatched delimiters reads in linear time."""
    stack: list[int] = []
    bottom: dict[tuple, int] = {}
    for index, event in enumerate(events):
        if event[0] != "delim":
            continue
        char, _, can_open, can_close, _ = event[1:]
        # Whether an opener matches depends on the closer only through these (the rule of 3 for `*`).
        key = (char, event[5] % 3, can_open) if char == "*" else (char,)
        while can_close and event[2] > 0:
            if char != "*" and event[2] < 2:
                break
            match = None
            for s in range(len(stack) - 1, -1, -1):
                if stack[s] < bottom.get(key, 0):
                    break
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
                bottom[key] = index
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
        if len(event) < 8:
            # No pair or one, the common cases, without building lists.
            pair = event[6] if len(event) == 7 else ("", "")
            if pair[0] == "close":
                out.append(["mark_close", pair[1]])
            if left:
                out.append(["text", char * left])
            if pair[0] == "open":
                out.append(["mark_open", pair[1]])
            continue
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
    """A pair inside more than 31 other pairs is literal text (R-INL-12). Stack pairs nest, so one pass that counts
    the pairs open at each opening tag finds every depth in linear time."""
    close_of = dict(pairs)
    closes = set(close_of.values())
    depth = 0
    for index in range(len(events)):
        if index in close_of:
            depth += 1
            if depth > MAX_DEPTH:
                close_index = close_of[index]
                events[index] = ["html", events[index][2]]
                events[close_index] = ["html", events[close_index][2]]
        elif index in closes:
            depth -= 1


def read_inline(text: str) -> list[dict]:
    """One inline container of canonical OpenNote Markdown 2 as neutral inlines."""
    events = tokenize(text)
    process_delimiters(events)
    events = expand(events)
    pair_tags(events)
    content: list[dict] = []
    # The open marks by kind, outermost first, so the marks of a run cost the number of kinds and not the depth.
    # Comments and foreign marks may repeat (R-MRK-28) and come only from tags, which nest at most 32 deep.
    by_kind: dict[str, list[tuple[object, object]]] = {}
    many: list[tuple[object, object]] = []
    cached: list[list] = []

    def marks() -> list:
        # R-MRK-28: one value of each kind per run, the innermost; comments and foreign marks may repeat.
        if not cached:
            cached.append(sort_marks([m for _, m in many] + [open_[-1][1] for open_ in by_kind.values() if open_]))
        return cached[0]

    def opened(mark: object) -> list[tuple[object, object]]:
        k = kind(mark)
        if k in ("comment", "foreign"):
            return many
        return by_kind.setdefault("sub" if k == "sup" else k, [])

    def open_mark(key: tuple, mark: object) -> None:
        opened(mark).append((key, mark))
        cached.clear()

    def close_mark(key: tuple, mark: object) -> None:
        # The innermost open mark with this key. Each kind keeps its marks in the order they opened.
        open_ = opened(mark)
        for at in range(len(open_) - 1, -1, -1):
            if open_[at][0] == key:
                del open_[at]
                cached.clear()
                return

    # Text runs collect their pieces and join once, so a long run costs its length and not its square.
    parts: list[list[str]] = []

    def add(node: dict) -> None:
        last = content[-1] if content else None
        if "text" in node and last and "text" in last and last["marks"] == node["marks"]:
            parts[-1].append(node["text"])
        elif "text" not in node or node["text"]:
            content.append(node)
            parts.append([node["text"]] if "text" in node else [])

    for index, event in enumerate(events):
        tag = event[0]
        if tag == "text":
            if cached and content and "text" in content[-1] and content[-1]["marks"] is cached[0]:
                parts[-1].append(event[1])  # The same marks as the run before, so the same run.
            else:
                add({"text": event[1], "marks": marks()})
        elif tag == "code":
            add({"text": event[1], "marks": marks() + ["code"]})
        elif tag == "break" and content:
            # R-WS-2: a hard break with nothing before it in its paragraph is dropped, as CommonMark reads none.
            add({"hardBreak": True})
        elif tag == "footnote":
            add({"footnote": event[1], "marks": list(marks())})
        elif tag == "link_open":
            open_mark(("link",), {"link": event[1]})
        elif tag == "link_close":
            close_mark(("link",), {"link": ""})
        elif tag == "mark_open":
            open_mark(("delim", event[1]), event[1])
        elif tag == "mark_close":
            close_mark(("delim", event[1]), event[1])
        elif tag == "tag_open":
            open_mark(("tag", index), event[1])
        elif tag == "tag_close":
            close_mark(("tag", event[1]), events[event[1]][1])
    for node, pieces in zip(content, parts):
        if "text" in node:
            node["text"] = "".join(pieces)
    return content


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


# The readable copy: Markdown with the tags of version 2 dropped (spec 11.1).


def dropped_spans(text: str) -> list[tuple[int, int]]:
    """Where the paired tags of section 7.9, the paired foreign tags, and the footnote references of one inline
    container sit. The tags of section 7.4 and literal tags are not among them."""
    spans: dict[int, tuple[int, int]] = {}
    events = tokenize(text, spans)
    process_delimiters(events)
    events = expand(events)
    where = {index: spans[id(event)] for index, event in enumerate(events) if id(event) in spans}
    pair_tags(events)
    found = []
    for index, event in enumerate(events):
        if event[0] == "tag_open" and event[2] not in V1_SIMPLE:
            found += [where[index], where[event[3]]]
        elif event[0] == "footnote":
            found.append(where[index])
    return sorted(found)


def drop_tags(text: str) -> str:
    out, at = [], 0
    for start, end in dropped_spans(text):
        out.append(text[at:start])
        at = end
    return "".join(out) + text[at:]


def readable_markdown(markdown: str) -> str:
    """The Markdown of a text block or cell of a version 2 page as `page.md` writes it (spec 11.1): each paragraph
    drops what readable text drops (R-TXT-1) and keeps the rest of its Markdown as it is. Fenced code stays."""
    out: list[str] = []
    group: list[str] = []
    fence = False

    def flush() -> None:
        if group:
            out.append(drop_tags("\n".join(group)))
            group.clear()

    for line in markdown.split("\n"):
        inner = line.lstrip(" >")
        if inner.startswith("```"):
            flush()
            out.append(line)
            fence = not fence
        elif fence or not inner.strip():
            flush()
            out.append(line)
        else:
            group.append(line)
    flush()
    return "\n".join(out)
