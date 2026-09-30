//! Point data (spec 9.4): quantized points as zigzag and LEB128 varints of first-order deltas. Owned by WP1.
//!
//! `testing::gen` has a small independent encoder for generated strokes, which these functions must accept.

use crate::error::InkError;
use crate::model::{BBox, Channels, Point};

/// Encodes points after `out`, and returns their bounding box.
pub fn encode_points(_points: &[Point], _channels: Channels, _out: &mut Vec<u8>) -> Result<BBox, InkError> {
    unimplemented!("WP1: encode_points")
}

/// Decodes exactly `count` points that use up exactly `bytes`.
pub fn decode_points(_bytes: &[u8], _count: u32, _channels: Channels) -> Result<Vec<Point>, InkError> {
    unimplemented!("WP1: decode_points")
}

/// Checks point data without keeping the points: every value in range, and the stored bounding box right.
pub fn check_points(_bytes: &[u8], _count: u32, _channels: Channels, _bbox: &BBox) -> Result<(), InkError> {
    unimplemented!("WP1: check_points")
}
