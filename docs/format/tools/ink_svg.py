"""`ink.svg` (spec 11.3) for the reference reader, with the layout rules documented in the Rust core.

The rules the spec leaves open are in crates/core/src/format/readable/svg.rs. Paths are in page coordinates.
Floating blocks sit at their frame. Flowing blocks stack below the floating content, 24 units apart.
"""

from __future__ import annotations

from readable_text import fixed, is_floating, one_line, quoted, seal


def page_points(stroke: dict) -> list[tuple[float, float]]:
    """A stroke's points in its ink block's coordinates, after its transform."""
    points = [(p[0] / 64.0, p[1] / 64.0) for p in stroke["points"]]
    if stroke["transform"] is None:
        return points
    a, b, c, d, e, f = stroke["transform"]
    return [(a * x + c * y + e, b * x + d * y + f) for x, y in points]


def ink_groups(page: dict, strokes: dict) -> list[list[tuple[dict, list]]]:
    """Each ink block's strokes in page coordinates, highlighters first, laid out as `ink.svg` does."""
    blocks = [b for b in sorted(page.get("blocks", []), key=lambda b: (b["order"], b["id"])) if b["type"] == "ink"]
    groups = []
    for block in blocks:
        own = sorted((s for s in strokes.values() if s["block"] == block["id"]), key=lambda s: (s["start"], s["id"]))
        own = [s for s in own if s["style"]["tool"] == 2] + [s for s in own if s["style"]["tool"] != 2]
        groups.append([(s, page_points(s)) for s in own])
    bottom = None
    for block, group in zip(blocks, groups):
        if is_floating(block):
            dx, dy = block["frame"]["x"], block["frame"]["y"]
            group[:] = [(s, [(x + dx, y + dy) for x, y in pts]) for s, pts in group]
            lows = [y for _, pts in group for _, y in pts]
            bottom = max([bottom] + lows) if bottom is not None else (max(lows) if lows else None)
    cursor = 0.0 if bottom is None else bottom + 24.0
    for block, group in zip(blocks, groups):
        if not is_floating(block):
            lowest = max([0.0] + [y for _, pts in group for _, y in pts])
            height = (block.get("frame") or {}).get("h")
            group[:] = [(s, [(x + 0.0, y + cursor) for x, y in pts]) for s, pts in group]
            cursor += (lowest if height is None else height) + 24.0
    return groups


def xml_text(text: str) -> str:
    out = []
    for c in text:
        if c in "&<>":
            out.append({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c])
        elif c != "\t" and (ord(c) < 0x20 or c in (chr(0xFFFE), chr(0xFFFF))):
            out.append(chr(0xFFFD))
        else:
            out.append(c)
    return "".join(out)


def svg_path(stroke: dict, points: list) -> str:
    points = points * 2 if len(points) == 1 else points
    d = "".join(f"{'M' if i == 0 else 'L'}{fixed(x, 1)} {fixed(y, 1)}" for i, (x, y) in enumerate(points))
    r, g, b, a = stroke["style"]["color"]
    opacity = f' stroke-opacity="{fixed(a / 255.0, 2)}"' if a < 255 else ""
    width = fixed(stroke["style"]["width"], 2)
    return (
        f'    <path d="{d}" fill="none" stroke="#{r:02x}{g:02x}{b:02x}"{opacity} stroke-width="{width}" '
        'stroke-linecap="round" stroke-linejoin="round"/>'
    )


def render_ink_svg(page: dict, strokes: dict) -> str:
    """`ink.svg` (spec 11.3), with the layout rules documented in crates/core/src/format/readable/svg.rs."""
    groups = ink_groups(page, strokes)
    xs = [x for g in groups for _, pts in g for x, _ in pts] or [0.0]
    ys = [y for g in groups for _, pts in g for _, y in pts] or [0.0]
    view = [fixed(min(xs) - 8.0, 1), fixed(min(ys) - 8.0, 1)]
    view += [fixed(max(xs) - min(xs) + 16.0, 1), fixed(max(ys) - min(ys) + 16.0, 1)]
    comment = f'{{"page": {quoted(page["id"])}, "revision": {quoted(page["revision"]["id"])}, "format": 1, '
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', f'<!-- opennote: {comment}"checksum": "crc32:00000000"}} -->']
    lines.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="{" ".join(view)}" '
        f'width="{view[2]}" height="{view[3]}">'
    )
    title = one_line(page["title"])
    lines.append(f"  <title>{xml_text('Handwriting: ' + title if title else 'Handwriting')}</title>")
    for group in groups:
        lines += ["  <g>"] + [svg_path(s, pts) for s, pts in group] + ["  </g>"] if group else ["  <g/>"]
    return seal("\n".join(lines + ["</svg>", ""]))
