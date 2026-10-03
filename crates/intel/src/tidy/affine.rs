//! A 2D transform and the moves it makes to strokes.

use serde::{Deserialize, Serialize};

use crate::ink::{InkPoint, InkStroke, StrokeKey};

/// A 2D transform. A point `(x, y)` becomes `(a*x + c*y + e, b*x + d*y + f)`, the order the note
/// format uses for a stroke's transform. In JSON it is the array `[a, b, c, d, e, f]`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "[f32; 6]", into = "[f32; 6]")]
pub struct Affine {
    /// Horizontal scale and cosine of the rotation.
    pub a: f32,
    /// Sine of the rotation.
    pub b: f32,
    /// Negative sine of the rotation.
    pub c: f32,
    /// Vertical scale and cosine of the rotation.
    pub d: f32,
    /// Horizontal shift.
    pub e: f32,
    /// Vertical shift.
    pub f: f32,
}

impl Affine {
    /// The transform that changes nothing.
    pub const IDENTITY: Affine = Affine {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    /// Moves by `(dx, dy)`.
    pub fn translate(dx: f32, dy: f32) -> Affine {
        Affine {
            e: dx,
            f: dy,
            ..Affine::IDENTITY
        }
    }

    /// Turns by `radians` about `(cx, cy)`. With y growing downward, a positive angle turns clockwise.
    pub fn rotate_about(radians: f32, cx: f32, cy: f32) -> Affine {
        let (sin, cos) = radians.sin_cos();
        Affine {
            a: cos,
            b: sin,
            c: -sin,
            d: cos,
            e: cx - cos * cx + sin * cy,
            f: cy - sin * cx - cos * cy,
        }
    }

    /// Scales by `(sx, sy)` about `(cx, cy)`.
    pub fn scale_about(sx: f32, sy: f32, cx: f32, cy: f32) -> Affine {
        Affine {
            a: sx,
            b: 0.0,
            c: 0.0,
            d: sy,
            e: cx - sx * cx,
            f: cy - sy * cy,
        }
    }

    /// The transform that applies `self` and then `next`.
    pub fn then(self, next: Affine) -> Affine {
        Affine {
            a: next.a * self.a + next.c * self.b,
            b: next.b * self.a + next.d * self.b,
            c: next.a * self.c + next.c * self.d,
            d: next.b * self.c + next.d * self.d,
            e: next.a * self.e + next.c * self.f + next.e,
            f: next.b * self.e + next.d * self.f + next.f,
        }
    }

    /// Where a point lands.
    pub fn apply(&self, point: InkPoint) -> InkPoint {
        InkPoint {
            x: self.a * point.x + self.c * point.y + self.e,
            y: self.b * point.x + self.d * point.y + self.f,
        }
    }

    /// Whether the transform changes nothing, apart from a shift of at most `tolerance` page units.
    pub fn is_negligible(&self, tolerance: f32) -> bool {
        let close = |x: f32, target: f32| (x - target).abs() <= 1e-4;
        close(self.a, 1.0)
            && close(self.d, 1.0)
            && close(self.b, 0.0)
            && close(self.c, 0.0)
            && self.e.abs() <= tolerance
            && self.f.abs() <= tolerance
    }
}

impl From<[f32; 6]> for Affine {
    fn from([a, b, c, d, e, f]: [f32; 6]) -> Self {
        Affine { a, b, c, d, e, f }
    }
}

impl From<Affine> for [f32; 6] {
    fn from(m: Affine) -> Self {
        [m.a, m.b, m.c, m.d, m.e, m.f]
    }
}

/// The move for one stroke. The caller combines it with the stroke's own transform.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeMove {
    /// The stroke, by the key it was given.
    pub key: StrokeKey,
    /// The change to apply to the stroke's points, in page units.
    pub transform: Affine,
}

impl StrokeMove {
    /// The stroke after the move.
    pub fn apply_to(&self, stroke: &InkStroke) -> InkStroke {
        InkStroke {
            key: stroke.key,
            points: stroke.points.iter().map(|&p| self.transform.apply(p)).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: InkPoint, x: f32, y: f32) -> bool {
        (a.x - x).abs() < 1e-3 && (a.y - y).abs() < 1e-3
    }

    #[test]
    fn a_rotation_keeps_its_center_still_and_turns_other_points() {
        let turn = Affine::rotate_about(std::f32::consts::FRAC_PI_2, 10.0, 10.0);
        assert!(close(turn.apply(InkPoint { x: 10.0, y: 10.0 }), 10.0, 10.0));
        // A quarter turn clockwise on screen sends a point to the right of the center to below it.
        assert!(close(turn.apply(InkPoint { x: 20.0, y: 10.0 }), 10.0, 20.0));
    }

    #[test]
    fn scaling_keeps_its_center_still() {
        let grow = Affine::scale_about(2.0, 2.0, 5.0, 5.0);
        assert!(close(grow.apply(InkPoint { x: 5.0, y: 5.0 }), 5.0, 5.0));
        assert!(close(grow.apply(InkPoint { x: 6.0, y: 7.0 }), 7.0, 9.0));
    }

    #[test]
    fn then_applies_the_first_transform_first() {
        let m = Affine::scale_about(2.0, 2.0, 0.0, 0.0).then(Affine::translate(3.0, 4.0));
        assert!(close(m.apply(InkPoint { x: 1.0, y: 1.0 }), 5.0, 6.0));
        let flipped = Affine::translate(3.0, 4.0).then(Affine::scale_about(2.0, 2.0, 0.0, 0.0));
        assert!(close(flipped.apply(InkPoint { x: 1.0, y: 1.0 }), 8.0, 10.0));
    }

    #[test]
    fn json_is_the_six_number_array_of_the_note_format() {
        let json = serde_json::to_string(&Affine::translate(1.5, -2.0)).unwrap();
        assert_eq!(json, "[1.0,0.0,0.0,1.0,1.5,-2.0]");
        let back: Affine = serde_json::from_str(&json).unwrap();
        assert_eq!(back, Affine::translate(1.5, -2.0));
        assert!(Affine::IDENTITY.is_negligible(0.01));
        assert!(!Affine::translate(1.0, 0.0).is_negligible(0.01));
    }
}
