"""The parts of OpenNote Markdown (spec 7) the reference reader needs: escaping text, and rewriting links.

Like the Rust core, it doesn't parse Markdown. It escapes the text it writes, as spec 7.6 says, and scans for
link destinations outside fenced code and code spans, so `page.md` can point other tools at the right files.
"""

from __future__ import annotations

import unicodedata

# Characters with the Unicode White_Space property, which Rust's `char::is_whitespace` uses.
WHITE_SPACE = set("\t\n\x0b\x0c\r \x85\xa0") | {
    chr(c) for c in (0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, *range(0x2000, 0x200B))
}


def is_word(c: str | None) -> bool:
    """Whether a character is a letter or a digit: Unicode categories L and N."""
    return c is not None and unicodedata.category(c)[0] in "LN"


def is_control(c: str) -> bool:
    return unicodedata.category(c) == "Cc"


def is_reference(rest: str) -> bool:
    """Whether the text after a `&` makes a character reference: `#`, then ASCII letters or digits, then `;`."""
    rest = rest[1:] if rest.startswith("#") else rest
    name = 0
    while name < len(rest) and rest[name].isascii() and rest[name].isalnum():
        name += 1
    return name > 0 and rest[name : name + 1] == ";"


def escape_char(c: str, first: bool, last: bool, context: tuple[str | None, str | None, str, bool]) -> str:
    """One character, escaped as the table of spec 7.6 says.

    The context is the character before, the one after, the text after, and whether the character follows 1 to
    9 digits that begin a paragraph line.
    """
    before, after, rest, digits = context
    if c == "\0":
        return chr(0xFFFD)
    if c == "\t":
        return "&#9;"
    if c == " " and (first or last):
        return "&#32;"
    escaped = (
        c in "\\`*~$[]{<|"
        or (c == "_" and not (is_word(before) and is_word(after)))
        or (c == "=" and (first or before == "=" or after == "="))
        or (c == "&" and is_reference(rest))
        or (c == "#" and (before is None or before in WHITE_SPACE))
        or (c in ">-+" and first)
        or (c in ".)" and digits)
    )
    return "\\" + c if escaped else c


def escape_text(text: str, at_line_start: bool) -> str:
    """Escapes text as spec 7.6 requires. A line break becomes a hard break, and starts a paragraph line."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    out, line_start, leading = [], at_line_start, (0 if at_line_start else None)
    for i, c in enumerate(text):
        if c == "\n":
            out.append("\\\n")
            line_start, leading = True, 0
            continue
        first, line_start = line_start, False
        digits_before = leading or 0
        leading = leading + 1 if leading is not None and "0" <= c <= "9" else None
        before = text[i - 1] if i > 0 else None
        after = text[i + 1] if i + 1 < len(text) else None
        last = after is None or after == "\n"
        digits = 1 <= digits_before <= 9 and leading is None
        out.append(escape_char(c, first, last, (before, after, text[i + 1 :], digits)))
    return "".join(out)


def write_destination(destination: str) -> str:
    """A link destination, bare when it can be, otherwise between `<` and `>` (spec 7.5)."""
    unsafe = any(c in WHITE_SPACE or is_control(c) or c in "()<>\\" for c in destination)
    if destination and not unsafe:
        return destination
    return "<" + "".join("\\" + c if c in "<>\\" else c for c in destination) + ">"


def skip_code_span(line: str, at: int) -> int:
    """Where scanning goes on after the backticks at `at`: after the code span, or after the backticks."""
    run = len(line[at:]) - len(line[at:].lstrip("`"))
    i = at + run
    while i < len(line):
        length = len(line[i:]) - len(line[i:].lstrip("`"))
        if length == run:
            return i + length
        i += max(length, 1)
    return at + run


def angle_destination(line: str, at: int) -> tuple[int, int, str] | None:
    """A destination between `<` and `>`, starting at `at`."""
    text, i = [], at + 1
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            text.append(line[i + 1])
            i += 2
        elif c == ">":
            return at, i + 1, "".join(text)
        elif c in "<\n":
            return None
        else:
            text.append(c)
            i += 1
    return None


def destination(line: str, at: int) -> tuple[int, int, str] | None:
    """The destination after `](`: its span in the line, and its text without backslash escapes."""
    while at < len(line) and line[at] in " \t":
        at += 1
    if line[at : at + 1] == "<":
        return angle_destination(line, at)
    text, i, depth = [], at, 0
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            text.append(line[i + 1])
            i += 2
            continue
        if (c == ")" and depth == 0) or c in WHITE_SPACE or is_control(c):
            return at, i, "".join(text)
        depth += 1 if c == "(" else -1 if c == ")" else 0
        text.append(c)
        i += 1
    return None


def is_autolink(inner: str) -> bool:
    """Whether the text between `<` and `>` is an autolink: a scheme of 2 to 32 characters, then no spaces."""
    scheme = inner.split(":", 1)[0] if ":" in inner else ""
    ok = 2 <= len(scheme) <= 32 and scheme[0].isascii() and scheme[0].isalpha()
    ok = ok and all(c.isascii() and (c.isalnum() or c in "+.-") for c in scheme)
    return ok and not any(c in WHITE_SPACE or is_control(c) or c == "<" for c in inner)


def rewrite_line(line: str, rewrite) -> str:
    """Rewrites the inline link destinations of one line, outside code spans."""
    out, copied, i, opened = [], 0, 0, 0
    while i < len(line):
        c = line[i]
        if c == "\\":
            i += 2
        elif c == "`":
            i = skip_code_span(line, i)
        elif c == "[":
            opened, i = opened + 1, i + 1
        elif c == "]" and opened and line[i + 1 : i + 2] == "(":
            opened -= 1
            found = destination(line, i + 2)
            if found is None:
                i += 2
                continue
            start, end, text = found
            target = rewrite(text)
            if target is not None:
                out.append(line[copied:start] + write_destination(target))
                copied = end
            i = end
        elif c == "]":
            opened, i = max(opened - 1, 0), i + 1
        elif c == "<":
            close = line.find(">", i + 1)
            i = close + 1 if close > 0 and is_autolink(line[i + 1 : close]) else i + 1
        else:
            i += 1
    return "".join(out) + line[copied:]


def rewrite_links(markdown: str, rewrite) -> str:
    """Rewrites link destinations outside fenced code. `rewrite` returns a new destination, or None."""
    out, fence = [], None
    lines = markdown.split("\n")
    for n, line in enumerate(lines):
        line += "\n" if n + 1 < len(lines) else ""
        content = line.lstrip(" >\t")
        mark = content[:1]
        run = len(content) - len(content.lstrip(mark)) if mark in ("`", "~") else 0
        if run >= 3:
            if fence is None:
                fence = (mark, run)
            elif mark == fence[0] and run >= fence[1]:
                fence = None
            out.append(line)
        else:
            out.append(line if fence else rewrite_line(line, rewrite))
    return "".join(out)
