use super::*;

pub(super) fn target_missing(fill: Option<&Element>) -> bool {
    fill.and_then(|f| f.first("a:blip")).is_some()
}

pub(super) fn has_fill(props: &Element) -> bool {
    props.kids().any(|k| {
        matches!(
            k.name.as_str(),
            "a:nofill" | "a:solidfill" | "a:gradfill" | "a:blipfill" | "a:pattfill" | "a:grpfill"
        )
    })
}

pub(super) fn stroke_attrs(line: &Line) -> String {
    let mut out = format!(r#" stroke="{}" stroke-width="{}""#, line.color.css(), num(line.width));
    if let Some(o) = line.color.opacity() {
        let _ = write!(out, r#" stroke-opacity="{o}""#);
    }
    if let Some(dash) = line.dash {
        let scaled: Vec<String> = dash
            .split(' ')
            .filter_map(|d| d.parse::<f64>().ok())
            .map(|d| num(d * line.width.max(0.75)))
            .collect();
        let _ = write!(out, r#" stroke-dasharray="{}""#, scaled.join(" "));
    }
    out
}

/// The rotation of a shape about its middle, as an SVG transform with a trailing space, or nothing.
pub(super) fn rotation(xfrm: &Xfrm) -> String {
    if xfrm.rot.abs() < 0.001 {
        return String::new();
    }
    let r = xfrm.rect;
    format!(
        "rotate({} {} {}) ",
        num(xfrm.rot),
        num(r.x + r.w / 2.0),
        num(r.y + r.h / 2.0)
    )
}

/// The ` transform="…"` attribute of a shape's outline: its rotation and flips, or nothing.
pub(super) fn shape_transform(xfrm: &Xfrm) -> String {
    let mut t = rotation(xfrm);
    if xfrm.flip_h || xfrm.flip_v {
        let r = xfrm.rect;
        let (cx, cy) = (r.x + r.w / 2.0, r.y + r.h / 2.0);
        let _ = write!(
            t,
            "translate({} {}) scale({} {}) translate({} {})",
            num(cx),
            num(cy),
            if xfrm.flip_h { -1 } else { 1 },
            if xfrm.flip_v { -1 } else { 1 },
            num(-cx),
            num(-cy)
        );
    }
    let t = t.trim_end();
    if t.is_empty() {
        String::new()
    } else {
        format!(r#" transform="{t}""#)
    }
}

/// The SVG path of a shape's outline in `r`, and whether it is the shape's own outline (or a rectangle for one
/// OpenNote does not draw).
// checks-disable-next-line modifiability: a table of preset shapes, one short arm each
pub(super) fn geometry_path(geometry: Option<&Element>, r: Rect) -> (String, bool) {
    let Some(g) = geometry else {
        return (rect_path(r), true);
    };
    if g.name == "a:custgeom" {
        return custom_path(g, r).map_or_else(|| (rect_path(r), false), |p| (p, true));
    }
    let adj = |name: &str, default: f64| {
        g.first("a:avlst")
            .and_then(|l| l.elements("a:gd").find(|gd| gd.attr("name") == Some(name)))
            .and_then(|gd| gd.attr("fmla"))
            .and_then(|f| f.strip_prefix("val "))
            .and_then(|v| v.trim().parse::<f64>().ok())
            .map_or(default, |v| v / 100_000.0)
    };
    let (x, y, w, h) = (r.x, r.y, r.w, r.h);
    let ss = w.min(h);
    let poly = |points: &[(f64, f64)]| {
        let mut d = String::new();
        for (i, (px, py)) in points.iter().enumerate() {
            let _ = write!(
                d,
                "{}{} {}",
                if i == 0 { "M" } else { "L" },
                num(x + px * w),
                num(y + py * h)
            );
        }
        d.push('Z');
        d
    };
    let prst = g.attr("prst").unwrap_or("rect");
    let path = match prst {
        "rect" | "flowChartProcess" | "snip1Rect" => rect_path(r),
        "roundRect" | "flowChartAlternateProcess" => {
            let rad = (adj("adj", 0.16667) * ss).min(w / 2.0).min(h / 2.0);
            format!(
                "M{} {}H{}A{r} {r} 0 0 1 {} {}V{}A{r} {r} 0 0 1 {} {}H{}A{r} {r} 0 0 1 {} {}V{}A{r} {r} 0 0 1 {} {}Z",
                num(x + rad),
                num(y),
                num(x + w - rad),
                num(x + w),
                num(y + rad),
                num(y + h - rad),
                num(x + w - rad),
                num(y + h),
                num(x + rad),
                num(x),
                num(y + h - rad),
                num(y + rad),
                num(x + rad),
                num(y),
                r = num(rad)
            )
        }
        "ellipse" | "flowChartConnector" => format!(
            "M{} {}A{} {} 0 1 0 {} {}A{} {} 0 1 0 {} {}Z",
            num(x),
            num(y + h / 2.0),
            num(w / 2.0),
            num(h / 2.0),
            num(x + w),
            num(y + h / 2.0),
            num(w / 2.0),
            num(h / 2.0),
            num(x),
            num(y + h / 2.0)
        ),
        "triangle" | "flowChartExtract" => {
            let apex = adj("adj", 0.5);
            poly(&[(apex, 0.0), (1.0, 1.0), (0.0, 1.0)])
        }
        "rtTriangle" => poly(&[(0.0, 0.0), (1.0, 1.0), (0.0, 1.0)]),
        "diamond" | "flowChartDecision" => poly(&[(0.5, 0.0), (1.0, 0.5), (0.5, 1.0), (0.0, 0.5)]),
        "parallelogram" | "flowChartInputOutput" => {
            let a = (adj("adj", 0.25) * ss / w).min(1.0);
            poly(&[(a, 0.0), (1.0, 0.0), (1.0 - a, 1.0), (0.0, 1.0)])
        }
        "trapezoid" => {
            let a = (adj("adj", 0.25) * ss / w).min(0.5);
            poly(&[(a, 0.0), (1.0 - a, 0.0), (1.0, 1.0), (0.0, 1.0)])
        }
        "homePlate" => {
            let a = (adj("adj", 0.5) * ss / w).min(1.0);
            poly(&[(0.0, 0.0), (1.0 - a, 0.0), (1.0, 0.5), (1.0 - a, 1.0), (0.0, 1.0)])
        }
        "pentagon" => poly(&[(0.5, 0.0), (1.0, 0.38), (0.81, 1.0), (0.19, 1.0), (0.0, 0.38)]),
        "hexagon" => {
            let a = (adj("adj", 0.25) * ss / w).min(0.5);
            poly(&[
                (a, 0.0),
                (1.0 - a, 0.0),
                (1.0, 0.5),
                (1.0 - a, 1.0),
                (a, 1.0),
                (0.0, 0.5),
            ])
        }
        "octagon" => {
            let a = adj("adj", 0.29289) * ss;
            let (ax, ay) = (a / w, a / h);
            poly(&[
                (ax, 0.0),
                (1.0 - ax, 0.0),
                (1.0, ay),
                (1.0, 1.0 - ay),
                (1.0 - ax, 1.0),
                (ax, 1.0),
                (0.0, 1.0 - ay),
                (0.0, ay),
            ])
        }
        "chevron" => {
            let a = (adj("adj", 0.5) * ss / w).min(1.0);
            poly(&[
                (0.0, 0.0),
                (1.0 - a, 0.0),
                (1.0, 0.5),
                (1.0 - a, 1.0),
                (0.0, 1.0),
                (a, 0.5),
            ])
        }
        "rightArrow" | "leftArrow" => {
            let shaft = adj("adj1", 0.5);
            let head = (adj("adj2", 0.5) * ss / w).min(1.0);
            let (t, b) = (0.5 - shaft / 2.0, 0.5 + shaft / 2.0);
            let pts = [
                (0.0, t),
                (1.0 - head, t),
                (1.0 - head, 0.0),
                (1.0, 0.5),
                (1.0 - head, 1.0),
                (1.0 - head, b),
                (0.0, b),
            ];
            if prst == "leftArrow" {
                poly(&pts.map(|(px, py)| (1.0 - px, py)))
            } else {
                poly(&pts)
            }
        }
        "upArrow" | "downArrow" => {
            let shaft = adj("adj1", 0.5);
            let head = (adj("adj2", 0.5) * ss / h).min(1.0);
            let (l, rr) = (0.5 - shaft / 2.0, 0.5 + shaft / 2.0);
            let pts = [
                (l, 1.0),
                (l, head),
                (0.0, head),
                (0.5, 0.0),
                (1.0, head),
                (rr, head),
                (rr, 1.0),
            ];
            if prst == "downArrow" {
                poly(&pts.map(|(px, py)| (px, 1.0 - py)))
            } else {
                poly(&pts)
            }
        }
        "plus" | "mathPlus" => {
            let a = (adj("adj", 0.25) * ss).min(w / 2.0).min(h / 2.0);
            let (ax, ay) = (a / w, a / h);
            poly(&[
                (ax, 0.0),
                (1.0 - ax, 0.0),
                (1.0 - ax, ay),
                (1.0, ay),
                (1.0, 1.0 - ay),
                (1.0 - ax, 1.0 - ay),
                (1.0 - ax, 1.0),
                (ax, 1.0),
                (ax, 1.0 - ay),
                (0.0, 1.0 - ay),
                (0.0, ay),
                (ax, ay),
            ])
        }
        "star5" => {
            let mut pts = Vec::new();
            for i in 0..10 {
                let angle = std::f64::consts::PI * (i as f64) / 5.0 - std::f64::consts::FRAC_PI_2;
                let radius = if i % 2 == 0 { 0.5 } else { 0.19 };
                pts.push((0.5 + radius * angle.cos(), 0.5 + radius * angle.sin()));
            }
            poly(&pts)
        }
        "line" | "straightConnector1" | "bentConnector2" | "bentConnector3" | "curvedConnector3" => {
            format!("M{} {}L{} {}", num(x), num(y), num(x + w), num(y + h))
        }
        _ => return (rect_path(r), false),
    };
    (path, true)
}

pub(super) fn rect_path(r: Rect) -> String {
    format!(
        "M{} {}H{}V{}H{}Z",
        num(r.x),
        num(r.y),
        num(r.x + r.w),
        num(r.y + r.h),
        num(r.x)
    )
}

/// A custom outline's paths, scaled from each path's own size into `r`. Arcs are drawn as straight lines.
pub(super) fn custom_path(g: &Element, r: Rect) -> Option<String> {
    let list = g.first("a:pathlst")?;
    let mut d = String::new();
    for path in list.elements("a:path").take(64) {
        let pw = emu(path.attr("w")).filter(|v| *v > 0.0).unwrap_or(r.w * EMU_PER_PT);
        let ph = emu(path.attr("h")).filter(|v| *v > 0.0).unwrap_or(r.h * EMU_PER_PT);
        let point = |p: &Element| -> Option<(f64, f64)> {
            Some((r.x + emu(p.attr("x"))? / pw * r.w, r.y + emu(p.attr("y"))? / ph * r.h))
        };
        for cmd in path.kids().take(4_000) {
            let pts: Vec<(f64, f64)> = cmd.elements("a:pt").filter_map(point).collect();
            match (cmd.name.as_str(), pts.as_slice()) {
                ("a:moveto", [p, ..]) => {
                    let _ = write!(d, "M{} {}", num(p.0), num(p.1));
                }
                ("a:lnto", [p, ..]) => {
                    let _ = write!(d, "L{} {}", num(p.0), num(p.1));
                }
                ("a:cubicbezto", [a, b, c, ..]) => {
                    let _ = write!(
                        d,
                        "C{} {} {} {} {} {}",
                        num(a.0),
                        num(a.1),
                        num(b.0),
                        num(b.1),
                        num(c.0),
                        num(c.1)
                    );
                }
                ("a:quadbezto", [a, b, ..]) => {
                    let _ = write!(d, "Q{} {} {} {}", num(a.0), num(a.1), num(b.0), num(b.1));
                }
                ("a:close", _) => d.push('Z'),
                _ => {}
            }
        }
    }
    (!d.is_empty() && d.starts_with('M')).then_some(d)
}
