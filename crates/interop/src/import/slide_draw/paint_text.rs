use super::*;

impl<'c, R: Read + Seek> Painter<'c, '_, R> {
    /// What a shape's text takes from the shapes it inherits from and from the master's text styles.
    pub(super) fn text_defaults(&self, ph: Option<&Placeholder>, inherited: &[&Element]) -> TextDefaults {
        let mut defaults = TextDefaults::default();
        let style_name = match ph.map(|p| p.kind.as_str()) {
            Some("title" | "ctrTitle") => "p:titlestyle",
            Some("body" | "obj" | "subTitle") => "p:bodystyle",
            _ => "p:otherstyle",
        };
        defaults.bullets = style_name == "p:bodystyle" && ph.is_some_and(|p| p.kind != "subTitle");
        let mut sources: Vec<&Element> = Vec::new();
        for shape in inherited {
            if let Some(list) = shape.first("p:txbody").and_then(|t| t.first("a:lststyle")) {
                sources.push(list);
            }
        }
        if let Some(styles) = self
            .ctx
            .master
            .and_then(|m| m.root.first("p:txstyles"))
            .and_then(|s| s.first(style_name))
        {
            sources.push(styles);
        }
        defaults.levels = (1..=9)
            .map(|level| {
                let name = format!("a:lvl{level}ppr");
                let mut style = LevelStyle::default();
                for source in &sources {
                    let Some(p) = source.first(&name) else { continue };
                    style.align = style.align.or_else(|| p.attr("algn").map(str::to_owned));
                    style.margin = style.margin.or_else(|| pt(p.attr("marl")));
                    style.indent = style.indent.or_else(|| pt(p.attr("indent")));
                    if style.bullet.is_none() {
                        if p.first("a:bunone").is_some() {
                            style.bullet = Some(None);
                        } else if let Some(c) = p.first("a:buchar").and_then(|b| b.attr("char")) {
                            style.bullet = Some(Some(c.chars().take(1).collect()));
                        }
                    }
                    if let Some(run) = p.first("a:defrpr") {
                        style.size = style.size.or_else(|| emu(run.attr("sz")).map(|s| s / 100.0));
                        style.bold = style.bold.or_else(|| run.attr("b").map(truthy));
                        style.color = style
                            .color
                            .or_else(|| run.first("a:solidfill").and_then(|f| self.ctx.color_of(f, None)));
                        style.font = style.font.clone().or_else(|| {
                            run.first("a:latin")
                                .and_then(|l| l.attr("typeface"))
                                .and_then(|t| self.typeface(t))
                        });
                    }
                }
                style
            })
            .collect();
        for shape in inherited {
            let Some(body) = shape.first("p:txbody").and_then(|t| t.first("a:bodypr")) else {
                continue;
            };
            defaults.anchor = defaults
                .anchor
                .clone()
                .or_else(|| body.attr("anchor").map(str::to_owned));
            for (slot, key) in defaults.insets.iter_mut().zip(["lins", "tins", "rins", "bins"]) {
                *slot = slot.or_else(|| pt(body.attr(key)));
            }
        }
        if style_name == "p:titlestyle" {
            defaults.font = self.ctx.theme.major.clone();
        }
        defaults
    }

    /// A font name, with the theme's `+mj-lt` and `+mn-lt` read as its two fonts.
    pub(super) fn typeface(&self, name: &str) -> Option<String> {
        match name {
            "+mj-lt" => self.ctx.theme.major.clone(),
            "+mn-lt" => self.ctx.theme.minor.clone(),
            other if other.starts_with('+') => None,
            other => font_name(other),
        }
    }

    // checks-disable-next-line modifiability: paragraph layout keeps its running position in one place
    pub(super) fn text(&mut self, body: &Element, xfrm: &Xfrm, defaults: &TextDefaults, font_color: Option<Rgba>) {
        let props = body.first("a:bodypr");
        let inset = |i: usize, key: &str, fallback: f64| {
            props
                .and_then(|p| pt(p.attr(key)))
                .or(defaults.insets[i])
                .unwrap_or(fallback)
        };
        let (left, top, right, bottom) = (
            inset(0, "lins", 7.2),
            inset(1, "tins", 3.6),
            inset(2, "rins", 7.2),
            inset(3, "bins", 3.6),
        );
        let anchor = props
            .and_then(|p| p.attr("anchor"))
            .map(str::to_owned)
            .or_else(|| defaults.anchor.clone())
            .unwrap_or_else(|| "t".to_owned());
        let wrap = props.and_then(|p| p.attr("wrap")) != Some("none");
        let scale = props
            .and_then(|p| p.first("a:normautofit"))
            .and_then(|a| emu(a.attr("fontscale")))
            .map_or(1.0, |s| (s / 100_000.0).clamp(0.1, 1.0));
        let r = xfrm.rect;
        let width = (r.w - left - right).max(1.0);
        let mut lines: Vec<TextLine> = Vec::new();
        let mut auto_numbers = [0usize; 9];
        for p in body.elements("a:p") {
            let pp = p.first("a:ppr");
            let level = pp
                .and_then(|p| p.attr("lvl"))
                .and_then(|l| l.parse::<usize>().ok())
                .unwrap_or(0)
                .min(8);
            let style = defaults.levels.get(level).cloned().unwrap_or_default();
            let align = pp
                .and_then(|p| p.attr("algn"))
                .map(str::to_owned)
                .or_else(|| style.align.clone())
                .or_else(|| defaults.align.clone())
                .unwrap_or_else(|| "l".to_owned());
            let base_size = style.size.or(defaults.size).unwrap_or(18.0) * scale;
            let base = RunStyle {
                size: base_size,
                color: style
                    .color
                    .or(font_color)
                    .or(defaults.color)
                    .or_else(|| self.ctx.scheme("tx1"))
                    .unwrap_or(Rgba::BLACK),
                font: style
                    .font
                    .clone()
                    .or_else(|| defaults.font.clone())
                    .or_else(|| self.ctx.theme.minor.clone()),
                bold: style.bold.or(defaults.bold).unwrap_or(false),
                italic: false,
                underline: false,
                strike: false,
            };
            let mut runs: Vec<(String, RunStyle)> = Vec::new();
            for run in p.kids() {
                match run.name.as_str() {
                    "a:r" | "a:fld" => {
                        let Some(t) = run.first("a:t") else { continue };
                        runs.push((t.all_text(), self.run_style(run.first("a:rpr"), &base, scale)));
                    }
                    "a:br" => runs.push(("\n".to_owned(), base.clone())),
                    _ => {}
                }
            }
            let empty_size = p
                .first("a:endpararpr")
                .and_then(|e| emu(e.attr("sz")))
                .map_or(base_size, |s| s / 100.0 * scale);
            let bullet = if pp.is_some_and(|p| p.first("a:bunone").is_some()) {
                None
            } else if let Some(c) = pp.and_then(|p| p.first("a:buchar")).and_then(|b| b.attr("char")) {
                Some(c.chars().take(1).collect::<String>())
            } else if pp.and_then(|p| p.first("a:buautonum")).is_some() {
                auto_numbers[level] += 1;
                Some(format!("{}.", auto_numbers[level]))
            } else {
                match &style.bullet {
                    Some(b) => b.clone(),
                    None => defaults.bullets.then(|| "\u{2022}".to_owned()),
                }
            };
            let has_text = runs.iter().any(|(t, _)| !t.trim().is_empty());
            let margin = pp
                .and_then(|p| pt(p.attr("marl")))
                .or(style.margin)
                .unwrap_or(if bullet.is_some() {
                    27.0 + 27.0 * level as f64
                } else {
                    0.0
                });
            let indent = pp
                .and_then(|p| pt(p.attr("indent")))
                .or(style.indent)
                .unwrap_or(if bullet.is_some() { -27.0 } else { 0.0 });
            let space_before = pp
                .and_then(|p| p.first("a:spcbef"))
                .and_then(|s| s.first("a:spcpts"))
                .and_then(|s| emu(s.attr("val")))
                .map_or(0.0, |v| v / 100.0);
            let mut paragraph = layout_paragraph(&runs, width - margin.max(0.0), wrap, empty_size);
            if let (Some(first), Some(bullet)) = (paragraph.first_mut(), bullet.filter(|_| has_text)) {
                first.bullet = Some((bullet, (margin + indent).max(0.0), base.clone()));
            }
            if let Some(first) = paragraph.first_mut() {
                first.space_before = space_before;
            }
            for line in &mut paragraph {
                line.align.clone_from(&align);
                line.margin = margin.max(0.0);
            }
            lines.extend(paragraph);
            if lines.len() > MAX_LINES {
                lines.truncate(MAX_LINES);
                break;
            }
        }
        if lines.iter().all(|l| l.runs.iter().all(|(t, _)| t.trim().is_empty())) {
            return;
        }
        let total: f64 = lines.iter().map(|l| l.height + l.space_before).sum();
        let mut y = match anchor.as_str() {
            "ctr" => r.y + top + ((r.h - top - bottom) - total) / 2.0,
            "b" => r.y + r.h - bottom - total,
            _ => r.y + top,
        };
        let rot = rotation(xfrm);
        let _ = write!(
            self.body,
            "<g{}>",
            if rot.is_empty() {
                String::new()
            } else {
                format!(r#" transform="{}""#, rot.trim_end())
            }
        );
        for line in &lines {
            y += line.space_before;
            let baseline = y + line.height * 0.8;
            if let Some((bullet, at, style)) = &line.bullet {
                let _ = write!(
                    self.body,
                    r#"<text x="{}" y="{}"{}>{}</text>"#,
                    num(r.x + left + at),
                    num(baseline),
                    style.attrs(),
                    esc(bullet)
                );
            }
            let (x, anchor_attr) = match line.align.as_str() {
                "ctr" => (
                    r.x + left + line.margin + (width - line.margin) / 2.0,
                    r#" text-anchor="middle""#,
                ),
                "r" => (r.x + r.w - right, r#" text-anchor="end""#),
                _ => (r.x + left + line.margin, ""),
            };
            if line.runs.iter().any(|(t, _)| !t.is_empty()) {
                let _ = write!(
                    self.body,
                    r#"<text x="{}" y="{}"{anchor_attr} xml:space="preserve">"#,
                    num(x),
                    num(baseline)
                );
                for (text, style) in &line.runs {
                    let _ = write!(self.body, "<tspan{}>{}</tspan>", style.attrs(), esc(text));
                }
                self.body.push_str("</text>");
            }
            y += line.height;
        }
        self.body.push_str("</g>");
    }

    pub(super) fn run_style(&self, props: Option<&Element>, base: &RunStyle, scale: f64) -> RunStyle {
        let mut style = base.clone();
        let Some(p) = props else { return style };
        if let Some(size) = emu(p.attr("sz")) {
            style.size = (size / 100.0 * scale).clamp(1.0, 400.0);
        }
        if let Some(b) = p.attr("b") {
            style.bold = truthy(b);
        }
        style.italic = p.attr("i").is_some_and(truthy);
        style.underline = p.attr("u").is_some_and(|u| u != "none");
        style.strike = p.attr("strike").is_some_and(|s| s != "noStrike");
        if let Some(color) = p.first("a:solidfill").and_then(|f| self.ctx.color_of(f, None)) {
            style.color = color;
        }
        if let Some(font) = p
            .first("a:latin")
            .and_then(|l| l.attr("typeface"))
            .and_then(|t| self.typeface(t))
        {
            style.font = Some(font);
        }
        style
    }
}

/// A placeholder's type, such as `title` or `body`, and its index.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Placeholder {
    pub(super) kind: String,
    pub(super) idx: Option<String>,
}

pub(super) fn placeholder_of(shape: &Element) -> Option<Placeholder> {
    let nv = shape.kids().find(|k| k.name.starts_with("p:nv"))?;
    let ph = nv.first("p:nvpr")?.first("p:ph")?;
    Some(Placeholder {
        kind: ph.attr("type").unwrap_or("body").to_owned(),
        idx: ph.attr("idx").map(str::to_owned),
    })
}

/// Placeholder types that stand in for each other: a centered title takes a title's place.
pub(super) fn same_family(a: &str, b: &str) -> bool {
    pub(super) fn family(k: &str) -> &str {
        match k {
            "title" | "ctrTitle" => "title",
            "body" | "obj" | "subTitle" => "body",
            other => other,
        }
    }
    family(a) == family(b)
}

pub(super) fn flatten<'a>(tree: &'a Element, out: &mut Vec<&'a Element>, depth: usize) {
    if depth > MAX_DEPTH {
        return;
    }
    for child in tree.kids() {
        match child.name.as_str() {
            "p:grpsp" => flatten(child, out, depth + 1),
            "p:sp" | "p:pic" => out.push(child),
            _ => {}
        }
    }
}

/// The look of a run of text.
#[derive(Clone, Debug)]
pub(super) struct RunStyle {
    pub(super) size: f64,
    pub(super) color: Rgba,
    pub(super) font: Option<String>,
    pub(super) bold: bool,
    pub(super) italic: bool,
    pub(super) underline: bool,
    pub(super) strike: bool,
}

impl RunStyle {
    pub(super) fn attrs(&self) -> String {
        let family = match &self.font {
            Some(font) => format!("{font}, Segoe UI, Arial, sans-serif"),
            None => "Segoe UI, Arial, sans-serif".to_owned(),
        };
        let mut out = format!(
            r#" font-family="{}" font-size="{}" fill="{}""#,
            esc(&family),
            num(self.size),
            self.color.css()
        );
        if let Some(o) = self.color.opacity() {
            let _ = write!(out, r#" fill-opacity="{o}""#);
        }
        if self.bold {
            out.push_str(r#" font-weight="bold""#);
        }
        if self.italic {
            out.push_str(r#" font-style="italic""#);
        }
        match (self.underline, self.strike) {
            (true, true) => out.push_str(r#" text-decoration="underline line-through""#),
            (true, false) => out.push_str(r#" text-decoration="underline""#),
            (false, true) => out.push_str(r#" text-decoration="line-through""#),
            (false, false) => {}
        }
        out
    }

    /// The width of a character, guessed from the font size: wide for CJK, narrow for spaces.
    pub(super) fn advance(&self, c: char) -> f64 {
        let ratio = if c == ' ' {
            0.28
        } else if is_wide(c) {
            1.0
        } else if c.is_uppercase() {
            0.62
        } else if matches!(
            c,
            'i' | 'l' | 'j' | 't' | 'f' | 'r' | '.' | ',' | ';' | ':' | '\'' | '!' | '|'
        ) {
            0.3
        } else if matches!(c, 'm' | 'w') {
            0.78
        } else {
            0.5
        };
        self.size * ratio * if self.bold { 1.06 } else { 1.0 }
    }
}

pub(super) fn is_wide(c: char) -> bool {
    matches!(c as u32, 0x1100..=0x115F | 0x2E80..=0xA4CF | 0xAC00..=0xD7A3 | 0xF900..=0xFAFF | 0xFF00..=0xFF60 | 0xFFE0..=0xFFE6)
}

/// One line of laid-out text.
#[derive(Clone, Debug, Default)]
pub(super) struct TextLine {
    pub(super) runs: Vec<(String, RunStyle)>,
    pub(super) height: f64,
    pub(super) align: String,
    pub(super) margin: f64,
    pub(super) space_before: f64,
    pub(super) bullet: Option<(String, f64, RunStyle)>,
}

/// Breaks a paragraph's runs into lines no wider than `width`, between words where it can.
pub(super) fn layout_paragraph(runs: &[(String, RunStyle)], width: f64, wrap: bool, empty_size: f64) -> Vec<TextLine> {
    let mut lines = Vec::new();
    let mut line = TextLine::default();
    let mut used = 0.0;
    let mut tallest: f64 = 0.0;
    let finish = |line: &mut TextLine, tallest: &mut f64, lines: &mut Vec<TextLine>| {
        let size = if *tallest > 0.0 { *tallest } else { empty_size };
        line.height = size * 1.2;
        lines.push(std::mem::take(line));
        *tallest = 0.0;
    };
    for (text, style) in runs {
        if text == "\n" {
            finish(&mut line, &mut tallest, &mut lines);
            used = 0.0;
            continue;
        }
        // Words keep the space after them, so a line can break after any of them.
        let mut words: Vec<String> = Vec::new();
        let mut current = String::new();
        for c in text.chars() {
            current.push(c);
            if c == ' ' || is_wide(c) {
                words.push(std::mem::take(&mut current));
            }
        }
        if !current.is_empty() {
            words.push(current);
        }
        for word in words {
            let w: f64 = word.chars().map(|c| style.advance(c)).sum();
            let ink = word.trim_end();
            let ink_w: f64 = ink.chars().map(|c| style.advance(c)).sum();
            if wrap && used > 0.0 && used + ink_w > width {
                finish(&mut line, &mut tallest, &mut lines);
                used = 0.0;
                if lines.len() >= MAX_LINES {
                    return lines;
                }
            }
            tallest = tallest.max(style.size);
            used += w;
            match line.runs.last_mut() {
                Some((t, s)) if same_style(s, style) => t.push_str(&word),
                _ => line.runs.push((word, style.clone())),
            }
        }
    }
    finish(&mut line, &mut tallest, &mut lines);
    for line in &mut lines {
        if let Some((t, _)) = line.runs.last_mut() {
            let trimmed = t.trim_end().len();
            t.truncate(trimmed);
        }
    }
    lines
}

pub(super) fn same_style(a: &RunStyle, b: &RunStyle) -> bool {
    (a.size - b.size).abs() < f64::EPSILON
        && a.color == b.color
        && a.font == b.font
        && a.bold == b.bold
        && a.italic == b.italic
        && a.underline == b.underline
        && a.strike == b.strike
}
