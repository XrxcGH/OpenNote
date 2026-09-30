//! Pixel helpers for the screen watcher. They are pure functions, so the tests cover them without a
//! screen.

/// Bytes per pixel in the 8-bit BGRA or RGBA desktop image.
pub(super) const BYTES_PER_PIXEL: usize = 4;

/// Copies `rows` rows of `row_bytes` each out of a buffer whose rows start `pitch` bytes apart.
pub(super) fn pack_rows(bytes: &[u8], pitch: usize, row_bytes: usize, rows: usize) -> Vec<u8> {
    let mut packed = Vec::with_capacity(row_bytes * rows);
    for row in 0..rows {
        let start = row * pitch;
        packed.extend_from_slice(&bytes[start..start + row_bytes]);
    }
    packed
}

/// True when any color channel of any pixel differs by more than `threshold`. Alpha is ignored,
/// because the desktop image doesn't use it. Buffers of different sizes always differ.
pub(super) fn differs(baseline: &[u8], current: &[u8], threshold: u8) -> bool {
    if baseline.len() != current.len() {
        return true;
    }
    let (before, after) = (
        baseline.as_chunks::<BYTES_PER_PIXEL>().0,
        current.as_chunks::<BYTES_PER_PIXEL>().0,
    );
    before
        .iter()
        .zip(after)
        .any(|(old, new)| (0..3).any(|channel| old[channel].abs_diff(new[channel]) > threshold))
}

/// True when the pixels are not empty and all within `tolerance` of the first one.
pub(super) fn is_blank(pixels: &[u8], tolerance: u8) -> bool {
    let pixels = pixels.as_chunks::<BYTES_PER_PIXEL>().0;
    let Some(first) = pixels.first() else {
        return false;
    };
    pixels.iter().all(|pixel| !differs(first, pixel, tolerance))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_padded_rows() {
        // Two rows of one pixel each, with 4 bytes of padding after every row.
        let bytes = [1, 2, 3, 4, 0, 0, 0, 0, 5, 6, 7, 8];
        assert_eq!(pack_rows(&bytes, 8, 4, 2), vec![1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn compares_pixels_with_a_threshold() {
        let paper = [246, 252, 255, 255, 246, 252, 255, 255];
        let mut inked = paper;
        inked[4] = 33;
        assert!(differs(&paper, &inked, 40));
        let mut noise = paper;
        noise[1] = 240;
        assert!(!differs(&paper, &noise, 40));
        let mut alpha = paper;
        alpha[3] = 0;
        assert!(!differs(&paper, &alpha, 0));
        assert!(differs(&paper, &paper[..4], 40));
    }

    #[test]
    fn tells_a_blank_region_from_one_with_ink() {
        let mut pixels = vec![246, 252, 255, 255, 247, 251, 255, 255];
        assert!(is_blank(&pixels, 8));
        pixels[4] = 40;
        assert!(!is_blank(&pixels, 8));
        assert!(!is_blank(&[], 8));
    }
}
