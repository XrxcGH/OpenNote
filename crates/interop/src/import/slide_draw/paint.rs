use super::*;

impl<'c, R: Read + Seek> Painter<'c, '_, R> {
    pub(super) fn background(&mut self, slide: &Element, slide_rels: &Rels, slide_dir: &str) {
        let ctx: &'c Context<'c> = self.ctx;
        let chain = [
            Some((slide, slide_rels, slide_dir)),
            ctx.layout.map(|l| (&l.root, &l.rels, l.dir.as_str())),
            ctx.master.map(|m| (&m.root, &m.rels, m.dir.as_str())),
        ];
        for (root, rels, dir) in chain.into_iter().flatten() {
            let Some(bg) = root.first("p:csld").and_then(|c| c.first("p:bg")) else {
                continue;
            };
            let fill = if let Some(pr) = bg.first("p:bgpr") {
                self.fill_of(pr, Some(rels), dir)
            } else if let Some(r) = bg.first("p:bgref") {
                let color = self.ctx.color_of(r, None);
                let idx = emu(r.attr("idx")).unwrap_or(0.0) as usize;
                // Theme background styles start at 1001. The first is a solid fill of the placeholder color.
                let style = idx.checked_sub(1001).and_then(|i| self.ctx.theme.fills.get(i)).cloned();
                match style {
                    Some(style) => {
                        let mut holder = Element::default();
                        holder.children.push(super::super::xmltree::Node::Element(style));
                        self.fill_with(&holder, None, "", color)
                    }
                    None => color.map_or(Fill::None, Fill::Solid),
                }
            } else {
                Fill::None
            };
            let rect = Rect {
                x: 0.0,
                y: 0.0,
                w: self.size.0,
                h: self.size.1,
            };
            let paint = self.paint(&fill, rect);
            if let Some(paint) = paint {
                let _ = write!(self.body, r#"<rect width="100%" height="100%"{paint}/>"#);
            }
            return;
        }
        let white = self.ctx.scheme("bg1").unwrap_or(Rgba::WHITE);
        let _ = write!(
            self.body,
            r#"<rect width="100%" height="100%" fill="{}"/>"#,
            white.css()
        );
    }

    /// The shapes of a master or layout that are not placeholders: bars, logos, and lines on every slide.
    pub(super) fn template_shapes(&mut self, template: &Template) {
        let Some(tree) = template.root.first("p:csld").and_then(|c| c.first("p:sptree")) else {
            return;
        };
        let (rels, dir) = (template.rels.clone(), template.dir.clone());
        self.tree(tree, &rels, &dir, false, 0);
    }

    /// Draws a shape tree. Placeholders are drawn only on the slide itself.
    pub(super) fn tree(&mut self, tree: &Element, rels: &Rels, dir: &str, placeholders: bool, depth: usize) {
        if depth > MAX_DEPTH {
            self.missed.limits += 1;
            return;
        }
        for shape in tree.kids() {
            if self.shapes >= MAX_SHAPES || self.body.len() > MAX_SVG_BYTES {
                self.missed.limits += 1;
                continue;
            }
            let hidden = shape
                .kids()
                .find(|k| k.name.starts_with("p:nv"))
                .and_then(|nv| nv.first("p:cnvpr"))
                .and_then(|c| c.attr("hidden"))
                .is_some_and(truthy);
            if hidden {
                continue;
            }
            let ph = placeholder_of(shape);
            if ph.is_some() && !placeholders {
                continue;
            }
            match shape.name.as_str() {
                "p:sp" | "p:cxnsp" => {
                    self.shapes += 1;
                    self.shape(shape, ph.as_ref(), rels, dir);
                }
                "p:pic" => {
                    self.shapes += 1;
                    self.picture(shape, ph.as_ref(), rels, dir);
                }
                "p:graphicframe" => {
                    self.shapes += 1;
                    self.frame(shape, rels, dir);
                }
                "p:grpsp" => self.group(shape, rels, dir, placeholders, depth),
                "mc:alternatecontent" => {
                    if let Some(fallback) = shape.first("mc:fallback") {
                        self.tree(fallback, rels, dir, placeholders, depth + 1);
                    }
                }
                "p:contentpart" => self.missed.charts += 1,
                _ => {}
            }
        }
    }

    pub(super) fn group(&mut self, group: &Element, rels: &Rels, dir: &str, placeholders: bool, depth: usize) {
        let xfrm = group.first("p:grpsppr").and_then(|p| p.first("a:xfrm"));
        let mut transform = String::new();
        if let Some(x) = xfrm {
            if let Some(outer) = read_xfrm(x) {
                let child_off = x.first("a:choff");
                let child_ext = x.first("a:chext");
                let cx = child_off.and_then(|o| pt(o.attr("x"))).unwrap_or(outer.rect.x);
                let cy = child_off.and_then(|o| pt(o.attr("y"))).unwrap_or(outer.rect.y);
                let cw = child_ext
                    .and_then(|e| pt(e.attr("cx")))
                    .filter(|w| *w > 0.0)
                    .unwrap_or(outer.rect.w);
                let ch = child_ext
                    .and_then(|e| pt(e.attr("cy")))
                    .filter(|h| *h > 0.0)
                    .unwrap_or(outer.rect.h);
                let sx = if cw > 0.0 { outer.rect.w / cw } else { 1.0 };
                let sy = if ch > 0.0 { outer.rect.h / ch } else { 1.0 };
                let r = outer.rect;
                transform = format!(
                    "{}translate({} {}) scale({} {}) translate({} {})",
                    rotation(&outer),
                    num(r.x),
                    num(r.y),
                    num(sx),
                    num(sy),
                    num(-cx),
                    num(-cy)
                );
            }
        }
        let _ = write!(self.body, r#"<g transform="{transform}">"#);
        self.tree(group, rels, dir, placeholders, depth + 1);
        self.body.push_str("</g>");
    }

    /// The fill of a shape's properties.
    pub(super) fn fill_of(&mut self, props: &Element, rels: Option<&Rels>, dir: &str) -> Fill {
        self.fill_with(props, rels, dir, None)
    }

    pub(super) fn fill_with(
        &mut self,
        props: &Element,
        rels: Option<&Rels>,
        dir: &str,
        placeholder: Option<Rgba>,
    ) -> Fill {
        for f in props.kids() {
            match f.name.as_str() {
                "a:nofill" => return Fill::None,
                "a:solidfill" => {
                    return self.ctx.color_of(f, placeholder).map_or(Fill::None, Fill::Solid);
                }
                "a:gradfill" => {
                    let mut stops: Vec<(f64, Rgba)> = f
                        .first("a:gslst")
                        .map(|list| {
                            list.elements("a:gs")
                                .filter_map(|gs| {
                                    let pos = emu(gs.attr("pos")).unwrap_or(0.0) / 100_000.0;
                                    Some((pos.clamp(0.0, 1.0), self.ctx.color_of(gs, placeholder)?))
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    stops.sort_by(|a, b| a.0.total_cmp(&b.0));
                    stops.truncate(16);
                    let angle = f
                        .first("a:lin")
                        .and_then(|l| emu(l.attr("ang")))
                        .map_or(90.0, |a| a / 60_000.0);
                    let round = f.first("a:path").is_some();
                    return match stops.len() {
                        0 => Fill::None,
                        1 => Fill::Solid(stops[0].1),
                        _ => Fill::Gradient(stops, angle, round),
                    };
                }
                "a:blipfill" => {
                    let target = f
                        .first("a:blip")
                        .and_then(|b| b.attr("r:embed"))
                        .and_then(|id| rels?.get(id))
                        .filter(|(_, external)| !external)
                        .map(|(t, _)| resolve(dir, t));
                    return target.map_or(Fill::None, Fill::Picture);
                }
                "a:pattfill" => {
                    let color = f.first("a:fgclr").and_then(|c| self.ctx.color_of(c, placeholder));
                    return color.map_or(Fill::None, Fill::Solid);
                }
                "a:grpfill" => return Fill::None,
                _ => {}
            }
        }
        placeholder.map_or(Fill::None, Fill::Solid)
    }

    /// The SVG attributes that paint a fill over `rect`, or `None` for no fill.
    pub(super) fn paint(&mut self, fill: &Fill, rect: Rect) -> Option<String> {
        match fill {
            Fill::None => None,
            Fill::Solid(color) => Some(match color.opacity() {
                Some(o) => format!(r#" fill="{}" fill-opacity="{o}""#, color.css()),
                None => format!(r#" fill="{}""#, color.css()),
            }),
            Fill::Gradient(stops, angle, round) => {
                let id = self.defs.id("g");
                let mut stops_svg = String::new();
                for (offset, color) in stops {
                    let _ = write!(
                        stops_svg,
                        r#"<stop offset="{}" stop-color="{}"{}/>"#,
                        num(*offset),
                        color.css(),
                        color
                            .opacity()
                            .map(|o| format!(r#" stop-opacity="{o}""#))
                            .unwrap_or_default()
                    );
                }
                if *round {
                    let _ = write!(
                        self.defs.other,
                        r#"<radialGradient id="{id}">{stops_svg}</radialGradient>"#
                    );
                } else {
                    let (s, c) = angle.to_radians().sin_cos();
                    let _ = write!(
                        self.defs.other,
                        r#"<linearGradient id="{id}" x1="{}" y1="{}" x2="{}" y2="{}">{stops_svg}</linearGradient>"#,
                        num(0.5 - c / 2.0),
                        num(0.5 - s / 2.0),
                        num(0.5 + c / 2.0),
                        num(0.5 + s / 2.0)
                    );
                }
                Some(format!(r#" fill="url(#{id})""#))
            }
            Fill::Picture(part) => {
                let image = self.image(part)?;
                let id = self.defs.id("p");
                let _ = write!(
                    self.defs.other,
                    // checks-disable-next-line length: one SVG element, kept whole so it reads as the markup it writes
                    r##"<pattern id="{id}" patternUnits="userSpaceOnUse" x="{}" y="{}" width="{}" height="{}"><use href="#{image}" transform="scale({} {})"/></pattern>"##,
                    num(rect.x),
                    num(rect.y),
                    num(rect.w),
                    num(rect.h),
                    num(rect.w),
                    num(rect.h)
                );
                Some(format!(r#" fill="url(#{id})""#))
            }
        }
    }

    /// Adds a picture part to the drawing once. Returns its ID, or `None` when it can't be shown.
    pub(super) fn image(&mut self, part: &str) -> Option<String> {
        if let Some(found) = self.defs.by_part.get(part) {
            return found.map(|i| self.defs.images[i].0.clone());
        }
        let ext = part.rsplit_once('.').map_or("", |(_, e)| e).to_ascii_lowercase();
        // A chart or clip art saved as EMF or WMF is drawn into an SVG picture first (the metafile reader).
        let metafile = is_metafile_extension(&ext);
        let mime = if metafile {
            "image/svg+xml"
        } else {
            mime_from_extension(&ext)
        };
        let shown = matches!(
            mime,
            "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp"
        );
        let budget = MAX_SVG_BYTES.saturating_sub(self.body.len() + self.defs.other.len());
        let bytes = if shown {
            self.parts.bytes(part)
        } else if metafile {
            self.parts.bytes(part).and_then(|bytes| metafile_to_svg(&bytes))
        } else {
            None
        };
        let url = bytes
            .filter(|b| b.len() / 3 * 4 < budget.saturating_sub(self.defs.images.iter().map(|i| i.1.len()).sum()))
            .map(|b| format!("data:{mime};base64,{}", STANDARD.encode(b)));
        let Some(url) = url else {
            self.defs.by_part.insert(part.to_owned(), None);
            self.missed.pictures += 1;
            return None;
        };
        let id = format!("i{}", self.defs.images.len() + 1);
        self.defs.images.push((id.clone(), url));
        self.defs
            .by_part
            .insert(part.to_owned(), Some(self.defs.images.len() - 1));
        Some(id)
    }

    /// The shape on the layout, or else the master, that a placeholder takes its place and look from.
    pub(super) fn inherited(&self, ph: &Placeholder) -> Vec<&'c Element> {
        let ctx: &'c Context<'c> = self.ctx;
        let mut out = Vec::new();
        for template in [ctx.layout, ctx.master].into_iter().flatten() {
            let Some(tree) = template.root.first("p:csld").and_then(|c| c.first("p:sptree")) else {
                continue;
            };
            let mut all = Vec::new();
            flatten(tree, &mut all, 0);
            let by_idx = ph.idx.as_ref().and_then(|idx| {
                all.iter()
                    .copied()
                    .find(|s| placeholder_of(s).is_some_and(|p| p.idx.as_ref() == Some(idx) && p.kind == ph.kind))
            });
            let by_type = || {
                all.iter()
                    .copied()
                    .find(|s| placeholder_of(s).is_some_and(|p| p.kind == ph.kind || same_family(&p.kind, &ph.kind)))
            };
            if let Some(found) = by_idx.or_else(by_type) {
                out.push(found);
            }
        }
        out
    }

    pub(super) fn shape(&mut self, shape: &Element, ph: Option<&Placeholder>, rels: &Rels, dir: &str) {
        let props = shape.first("p:sppr");
        let inherited = ph.map(|p| self.inherited(p)).unwrap_or_default();
        let xfrm = props.and_then(|p| p.first("a:xfrm")).and_then(read_xfrm).or_else(|| {
            inherited
                .iter()
                .find_map(|s| s.first("p:sppr").and_then(|p| p.first("a:xfrm")).and_then(read_xfrm))
        });
        let Some(xfrm) = xfrm else {
            return;
        };
        let style = shape.first("p:style");
        let ctx: &'c Context<'c> = self.ctx;
        let style_color = |name: &str| style.and_then(|s| s.first(name)).map(|r| (r, ctx.color_of(r, None)));
        let fill = match props {
            Some(p) if has_fill(p) => self.fill_of(p, Some(rels), dir),
            _ => match style_color("a:fillref") {
                Some((r, color)) if emu(r.attr("idx")).unwrap_or(0.0) > 0.0 => color.map_or(Fill::None, Fill::Solid),
                _ => inherited
                    .iter()
                    .find_map(|s| s.first("p:sppr").filter(|p| has_fill(p)))
                    .map_or(Fill::None, |p| self.fill_of(p, None, "")),
            },
        };
        let line = self.line(props, style, shape.name == "p:cxnsp");
        if props.is_some_and(|p| p.first("a:effectlst").is_some_and(|e| e.kids().next().is_some()))
            || props.is_some_and(|p| p.first("a:scene3d").is_some() || p.first("a:sp3d").is_some())
        {
            self.missed.effects += 1;
        }
        let geometry = props.and_then(|p| p.first("a:prstgeom").or_else(|| p.first("a:custgeom")));
        let (path, known) = geometry_path(geometry, xfrm.rect);
        if !known {
            self.missed.geometry += 1;
        }
        let paint = self.paint(&fill, xfrm.rect);
        let has_line = line.is_some();
        if paint.is_some() || has_line {
            let stroke = line.as_ref().map(stroke_attrs).unwrap_or_default();
            let _ = write!(
                self.body,
                r#"<path d="{path}"{}{stroke}{}/>"#,
                paint.unwrap_or_else(|| r#" fill="none""#.to_owned()),
                shape_transform(&xfrm)
            );
            if let Some(line) = line.filter(|l| l.head || l.tail) {
                self.arrows(&xfrm, &line);
            }
        }
        if let Some(text) = shape.first("p:txbody") {
            let defaults = self.text_defaults(ph, &inherited);
            let font_color = style_color("a:fontref").and_then(|(_, c)| c);
            self.text(text, &xfrm, &defaults, font_color);
        }
    }

    pub(super) fn line(&self, props: Option<&Element>, style: Option<&Element>, connector: bool) -> Option<Line> {
        let ln = props.and_then(|p| p.first("a:ln"));
        let style_ref = style.and_then(|s| s.first("a:lnref"));
        let style_idx = style_ref.and_then(|r| emu(r.attr("idx"))).unwrap_or(0.0) as usize;
        if ln.is_some_and(|l| l.first("a:nofill").is_some()) {
            return None;
        }
        let color = ln
            .and_then(|l| l.first("a:solidfill"))
            .and_then(|f| self.ctx.color_of(f, None))
            .or_else(|| {
                (style_idx > 0)
                    .then(|| style_ref.and_then(|r| self.ctx.color_of(r, None)))
                    .flatten()
            })
            .or_else(|| connector.then_some(Rgba::BLACK))?;
        let width = ln
            .and_then(|l| pt(l.attr("w")))
            .or_else(|| {
                style_idx
                    .checked_sub(1)
                    .and_then(|i| self.ctx.theme.lines.get(i).copied())
            })
            .unwrap_or(0.75)
            .clamp(0.0, 200.0);
        let dash = ln
            .and_then(|l| l.first("a:prstdash"))
            .and_then(|d| d.attr("val"))
            .and_then(|v| match v {
                "solid" => None,
                "dot" | "sysDot" => Some("1 2"),
                "dash" | "sysDash" => Some("4 3"),
                "lgDash" => Some("8 3"),
                "dashDot" | "sysDashDot" => Some("4 3 1 3"),
                _ => Some("4 3"),
            });
        let arrow = |name: &str| {
            ln.and_then(|l| l.first(name))
                .and_then(|e| e.attr("type"))
                .is_some_and(|t| t != "none")
        };
        Some(Line {
            color,
            width,
            dash,
            head: arrow("a:headend"),
            tail: arrow("a:tailend"),
        })
    }

    /// Arrowheads of a straight line, drawn as triangles at its ends.
    pub(super) fn arrows(&mut self, xfrm: &Xfrm, line: &Line) {
        let r = xfrm.rect;
        let (mut x1, mut y1, mut x2, mut y2) = (r.x, r.y, r.x + r.w, r.y + r.h);
        if xfrm.flip_h {
            std::mem::swap(&mut x1, &mut x2);
        }
        if xfrm.flip_v {
            std::mem::swap(&mut y1, &mut y2);
        }
        let size = (line.width * 3.0).max(4.0);
        let mut head = |tip: (f64, f64), from: (f64, f64)| {
            let (dx, dy) = (tip.0 - from.0, tip.1 - from.1);
            let len = (dx * dx + dy * dy).sqrt();
            if len < 0.01 {
                return;
            }
            let (ux, uy) = (dx / len, dy / len);
            let base = (tip.0 - ux * size, tip.1 - uy * size);
            let (px, py) = (-uy * size / 2.0, ux * size / 2.0);
            let _ = write!(
                self.body,
                r#"<path d="M{} {}L{} {}L{} {}Z" fill="{}"{}/>"#,
                num(tip.0),
                num(tip.1),
                num(base.0 + px),
                num(base.1 + py),
                num(base.0 - px),
                num(base.1 - py),
                line.color.css(),
                rotation(xfrm)
                    .is_empty()
                    .then(String::new)
                    .unwrap_or_else(|| format!(r#" transform="{}""#, rotation(xfrm).trim_end()))
            );
        };
        if line.tail {
            head((x2, y2), (x1, y1));
        }
        if line.head {
            head((x1, y1), (x2, y2));
        }
    }

    pub(super) fn picture(&mut self, pic: &Element, ph: Option<&Placeholder>, rels: &Rels, dir: &str) {
        let props = pic.first("p:sppr");
        let inherited = ph.map(|p| self.inherited(p)).unwrap_or_default();
        let xfrm = props.and_then(|p| p.first("a:xfrm")).and_then(read_xfrm).or_else(|| {
            inherited
                .iter()
                .find_map(|s| s.first("p:sppr").and_then(|p| p.first("a:xfrm")).and_then(read_xfrm))
        });
        let Some(xfrm) = xfrm else { return };
        let is_media = pic.first("p:nvpicpr").and_then(|n| n.first("p:nvpr")).is_some_and(|n| {
            n.kids()
                .any(|k| matches!(k.name.as_str(), "a:videofile" | "a:audiofile" | "p:extlst"))
        });
        if is_media {
            self.missed.media += 1;
        }
        let fill = pic.first("p:blipfill");
        let target = fill
            .and_then(|f| f.first("a:blip"))
            .and_then(|b| b.attr("r:embed"))
            .and_then(|id| rels.get(id))
            .filter(|(_, external)| !external)
            .map(|(t, _)| resolve(dir, t));
        let unlinked = target.is_none();
        let Some(image) = target.and_then(|t| self.image(&t)) else {
            // A part that was found but can't be drawn is already counted by `image`.
            if unlinked && target_missing(fill) {
                self.missed.pictures += 1;
            }
            return;
        };
        let r = xfrm.rect;
        let (sw, sh) = self.size;
        if self.pictures.len() < MAX_PICTURE_BOXES && sw > 0.0 && sh > 0.0 {
            let round = |v: f64| (v.clamp(0.0, 1.0) * 10_000.0).round() / 10_000.0;
            self.pictures
                .push([round(r.x / sw), round(r.y / sh), round(r.w / sw), round(r.h / sh)]);
        }
        // A crop keeps the middle of the picture: the edges it cuts are in thousandths of a percent.
        let crop = fill.and_then(|f| f.first("a:srcrect"));
        let side = |k: &str| crop.and_then(|c| emu(c.attr(k))).unwrap_or(0.0) / 100_000.0;
        let (l, t, rr, b) = (side("l"), side("t"), side("r"), side("b"));
        let vw = (1.0 - l - rr).max(0.001);
        let vh = (1.0 - t - b).max(0.001);
        let clip = self.defs.id("c");
        let geometry = props.and_then(|p| p.first("a:prstgeom"));
        let (path, _) = geometry_path(geometry, r);
        let _ = write!(
            self.defs.other,
            r#"<clipPath id="{clip}"><path d="{path}"/></clipPath>"#
        );
        let _ = write!(
            self.body,
            r##"<g clip-path="url(#{clip})"{}><use href="#{image}" transform="translate({} {}) scale({} {})"/></g>"##,
            shape_transform(&xfrm),
            num(r.x - l / vw * r.w),
            num(r.y - t / vh * r.h),
            num(r.w / vw),
            num(r.h / vh),
        );
        if let Some(line) = self.line(props, pic.first("p:style"), false) {
            let _ = write!(
                self.body,
                r#"<path d="{path}" fill="none"{}{}/>"#,
                stroke_attrs(&line),
                shape_transform(&xfrm)
            );
        }
    }

    pub(super) fn frame(&mut self, frame: &Element, rels: &Rels, dir: &str) {
        let _ = (rels, dir);
        let Some(xfrm) = frame.first("p:xfrm").and_then(read_xfrm) else {
            return;
        };
        let data = frame.first("a:graphic").and_then(|g| g.first("a:graphicdata"));
        match data.and_then(|d| d.first("a:tbl")) {
            Some(table) => self.table(table, xfrm.rect),
            None => self.missed.charts += 1,
        }
    }

    pub(super) fn table(&mut self, table: &Element, at: Rect) {
        let columns: Vec<f64> = table
            .first("a:tblgrid")
            .map(|g| {
                g.elements("a:gridcol")
                    .map(|c| pt(c.attr("w")).unwrap_or(0.0))
                    .collect()
            })
            .unwrap_or_default();
        let props = table.first("a:tblpr");
        let flag = |k: &str| props.and_then(|p| p.attr(k)).is_some_and(truthy);
        let (first_row, banded) = (flag("firstrow"), flag("bandrow"));
        let accent = self.ctx.scheme("accent1").unwrap_or(Rgba::rgb(68, 114, 196));
        let mut y = at.y;
        for (row_index, row) in table.elements("a:tr").enumerate().take(500) {
            let height = pt(row.attr("h")).unwrap_or(20.0);
            let mut x = at.x;
            let mut column = 0;
            for cell in row.elements("a:tc") {
                let span = emu(cell.attr("gridspan")).unwrap_or(1.0).clamp(1.0, 64.0) as usize;
                let width: f64 = columns.iter().skip(column).take(span).sum();
                column += span;
                let merged = cell.attr("hmerge").is_some_and(truthy) || cell.attr("vmerge").is_some_and(truthy);
                let rect = Rect {
                    x,
                    y,
                    w: width,
                    h: height,
                };
                x += width;
                if merged {
                    continue;
                }
                let cell_props = cell.first("a:tcpr");
                let header = first_row && row_index == 0;
                let fill = match cell_props {
                    Some(p) if has_fill(p) => self.fill_of(p, None, ""),
                    _ if header => Fill::Solid(accent),
                    _ if banded && row_index % 2 == usize::from(first_row) => Fill::Solid(tinted(accent, 0.4)),
                    _ => Fill::Solid(tinted(accent, 0.2)),
                };
                let paint = self.paint(&fill, rect).unwrap_or_else(|| r#" fill="none""#.to_owned());
                let _ = write!(
                    self.body,
                    r##"<rect x="{}" y="{}" width="{}" height="{}"{paint} stroke="#ffffff" stroke-width="1"/>"##,
                    num(rect.x),
                    num(rect.y),
                    num(rect.w),
                    num(rect.h)
                );
                if let Some(text) = cell.first("a:txbody") {
                    let defaults = TextDefaults {
                        size: Some(18.0),
                        color: Some(if header { Rgba::WHITE } else { Rgba::BLACK }),
                        bold: header.then_some(true),
                        insets: [Some(7.2), Some(3.6), Some(7.2), Some(3.6)],
                        anchor: cell_props.and_then(|p| p.attr("anchor")).map(str::to_owned),
                        ..TextDefaults::default()
                    };
                    let xfrm = Xfrm {
                        rect,
                        ..Xfrm::default()
                    };
                    self.text(text, &xfrm, &defaults, None);
                }
            }
            y += height;
        }
    }
}
