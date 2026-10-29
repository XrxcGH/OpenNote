use super::*;

impl Rgba {
    pub(super) const BLACK: Rgba = Rgba::rgb(0, 0, 0);
    pub(super) const WHITE: Rgba = Rgba::rgb(255, 255, 255);

    pub(super) const fn rgb(r: u8, g: u8, b: u8) -> Rgba {
        Rgba {
            r: r as f64,
            g: g as f64,
            b: b as f64,
            a: 1.0,
        }
    }

    pub(super) fn hex(text: &str) -> Option<Rgba> {
        let t = text.trim();
        if t.len() != 6 || !t.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let byte = |i: usize| u8::from_str_radix(&t[i..i + 2], 16).ok();
        Some(Rgba::rgb(byte(0)?, byte(2)?, byte(4)?))
    }

    pub(super) fn css(self) -> String {
        let c = |v: f64| v.round().clamp(0.0, 255.0) as u8;
        format!("#{:02x}{:02x}{:02x}", c(self.r), c(self.g), c(self.b))
    }

    /// The `-opacity` attribute's value, or `None` when the color is opaque.
    pub(super) fn opacity(self) -> Option<String> {
        (self.a < 0.999).then(|| num(self.a.clamp(0.0, 1.0)))
    }

    pub(super) fn to_hsl(self) -> (f64, f64, f64) {
        let (r, g, b) = (self.r / 255.0, self.g / 255.0, self.b / 255.0);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let l = (max + min) / 2.0;
        if (max - min).abs() < f64::EPSILON {
            return (0.0, 0.0, l);
        }
        let d = max - min;
        let s = if l > 0.5 {
            d / (2.0 - max - min)
        } else {
            d / (max + min)
        };
        let h = if (max - r).abs() < f64::EPSILON {
            (g - b) / d + if g < b { 6.0 } else { 0.0 }
        } else if (max - g).abs() < f64::EPSILON {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        (h / 6.0, s, l)
    }

    pub(super) fn from_hsl(h: f64, s: f64, l: f64, a: f64) -> Rgba {
        let l = l.clamp(0.0, 1.0);
        if s <= 0.0 {
            return Rgba {
                r: l * 255.0,
                g: l * 255.0,
                b: l * 255.0,
                a,
            };
        }
        let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
        let p = 2.0 * l - q;
        let hue = |mut t: f64| {
            if t < 0.0 {
                t += 1.0;
            }
            if t > 1.0 {
                t -= 1.0;
            }
            if t < 1.0 / 6.0 {
                p + (q - p) * 6.0 * t
            } else if t < 0.5 {
                q
            } else if t < 2.0 / 3.0 {
                p + (q - p) * (2.0 / 3.0 - t) * 6.0
            } else {
                p
            }
        };
        Rgba {
            r: hue(h + 1.0 / 3.0) * 255.0,
            g: hue(h) * 255.0,
            b: hue(h - 1.0 / 3.0) * 255.0,
            a,
        }
    }
}

/// Applies color changes such as `lumMod`, `tint`, and `alpha` in the order the file lists them.
pub(super) fn modify(mut color: Rgba, c: &Element) -> Rgba {
    for m in c.kids() {
        let Some(v) = emu(m.attr("val")).map(|v| v / 100_000.0) else {
            continue;
        };
        match m.name.as_str() {
            "a:lummod" | "a:lumoff" => {
                let (h, s, l) = color.to_hsl();
                let l = if m.name == "a:lummod" { l * v } else { l + v };
                color = Rgba::from_hsl(h, s, l, color.a);
            }
            "a:tint" => {
                let mix = |x: f64| x + (255.0 - x) * (1.0 - v);
                color = Rgba {
                    r: mix(color.r),
                    g: mix(color.g),
                    b: mix(color.b),
                    a: color.a,
                };
            }
            "a:shade" => {
                color = Rgba {
                    r: color.r * v,
                    g: color.g * v,
                    b: color.b * v,
                    a: color.a,
                };
            }
            "a:alpha" => color.a = v.clamp(0.0, 1.0),
            _ => {}
        }
    }
    color
}

pub(super) fn preset_color(name: &str) -> Option<Rgba> {
    Some(match name.to_ascii_lowercase().as_str() {
        "black" => Rgba::BLACK,
        "white" => Rgba::WHITE,
        "red" => Rgba::rgb(255, 0, 0),
        "green" => Rgba::rgb(0, 128, 0),
        "blue" => Rgba::rgb(0, 0, 255),
        "yellow" => Rgba::rgb(255, 255, 0),
        "gray" | "grey" => Rgba::rgb(128, 128, 128),
        "orange" => Rgba::rgb(255, 165, 0),
        "purple" => Rgba::rgb(128, 0, 128),
        "darkblue" => Rgba::rgb(0, 0, 139),
        "darkred" => Rgba::rgb(139, 0, 0),
        "lightgray" | "lightgrey" => Rgba::rgb(211, 211, 211),
        _ => return None,
    })
}

pub(super) fn tinted(color: Rgba, amount: f64) -> Rgba {
    let mix = |x: f64| x * amount + 255.0 * (1.0 - amount);
    Rgba {
        r: mix(color.r),
        g: mix(color.g),
        b: mix(color.b),
        a: 1.0,
    }
}
