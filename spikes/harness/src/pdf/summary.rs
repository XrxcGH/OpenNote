//! One line per variant, paper, and export route, pulled from the detailed fidelity results: the numbers an
//! architecture decision record (ADR) quotes.

use std::collections::BTreeMap;

use serde_json::{json, Value};

/// Summarizes the fidelity results, one entry per export.
pub fn summary(fidelity: &[Value]) -> Vec<Value> {
    fidelity
        .iter()
        .flat_map(|paper| {
            let exports = paper["exports"].as_array().cloned().unwrap_or_default();
            exports.into_iter().map(move |export| export_line(paper, &export))
        })
        .collect()
}

fn export_line(paper: &Value, export: &Value) -> Value {
    let pages = export["page_comparisons"].as_array().cloned().unwrap_or_default();
    let largest = |read: &dyn Fn(&Value) -> f64| pages.iter().map(read).fold(0.0, f64::max);
    let total = |read: &dyn Fn(&Value) -> f64| pages.iter().map(read).sum::<f64>();
    let number = |value: &Value| value.as_f64().unwrap_or(0.0);
    let offsets = |page: &Value| {
        let offset = &page["offset_px"];
        ["x", "y", "left", "right", "top", "bottom"]
            .map(|key| number(&offset[key]).abs())
            .into_iter()
            .fold(0.0, f64::max)
    };
    let with_ink = total(&|page| number(&page["tiles"]["with_ink"]));
    let within = total(&|page| number(&page["tiles"]["within_1px"]));
    json!({
        "variant": paper["variant"],
        "paper": paper["paper"],
        "route": export["route"],
        "pages": export["pages"],
        "page_count_matches": export["page_count_matches"],
        "page_size_pt": export["page_size_pt"][0],
        "max_offset_px": largest(&offsets),
        "max_tile_shift_px": largest(&|page| number(&page["tiles"]["max_shift_px"])),
        "tiles_within_1px": if with_ink > 0.0 { within / with_ink } else { 0.0 },
        "worst_ink_mismatch_within_1px": largest(&|page| number(&page["ink_mismatch"]["within_1px"])),
        "worst_mean_abs_diff": largest(&|page| number(&page["pixels"]["mean_abs_diff"])),
        "pen_strokes": total(&|page| number(&page["vector_ink"]["strokes"])),
        "pen_strokes_as_paths": total(&|page| number(&page["vector_ink"]["found_as_paths"])),
        "images_drawn": export["images_drawn"],
        "fonts_by_embedding": font_counts(&export["fonts"]),
    })
}

fn font_counts(fonts: &Value) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for font in fonts.as_array().into_iter().flatten() {
        let embedding = font["embedding"].as_str().unwrap_or("unknown").to_string();
        *counts.entry(embedding).or_default() += 1;
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_the_worst_page_of_each_export() {
        let page = |shift: f64, inked: f64| {
            json!({
                "offset_px": { "x": shift, "y": -2.0 * shift },
                "tiles": { "with_ink": inked, "within_1px": inked - 1.0, "max_shift_px": shift },
                "ink_mismatch": { "within_1px": shift / 100.0 },
                "pixels": { "mean_abs_diff": 1.0 },
                "vector_ink": { "strokes": 3, "found_as_paths": 3 },
            })
        };
        let embeddings = ["FontFile2", "Type 3 glyph procedures", "FontFile2"];
        let fonts: Vec<Value> = embeddings.iter().map(|kind| json!({ "embedding": kind })).collect();
        let export = json!({ "route": "r", "fonts": fonts, "page_comparisons": [page(0.5, 10.0), page(2.0, 10.0)] });
        let fidelity = [json!({ "variant": "baseline", "paper": "letter", "exports": [export] })];
        let lines = summary(&fidelity);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["max_offset_px"], 4.0);
        assert_eq!(lines[0]["max_tile_shift_px"], 2.0);
        assert_eq!(lines[0]["tiles_within_1px"], 0.9);
        assert_eq!(lines[0]["pen_strokes_as_paths"], 6.0);
        assert_eq!(lines[0]["fonts_by_embedding"]["FontFile2"], 2);
    }
}
