// checks-disable-file brand-consistency: the test data holds color values to check how they are written
//! Tables with a sheet: fills, borders, vertical alignment, and merges.

use super::*;
use crate::doc::cell_style::{CellAlign, CellBorder, CellBorders, CellStyle, Fill};
use crate::doc::Inline;
use crate::sheet::Merge;

fn cell(text: &str) -> Vec<Inline> {
    vec![Inline::text(text)]
}

fn styled_document(styles: Vec<Vec<Option<CellStyle>>>, merges: Vec<Merge>) -> String {
    let rows = vec![
        vec![cell("A"), cell("B"), cell("C")],
        vec![cell("d"), cell("e"), cell("")],
        vec![cell("g"), cell(""), cell("")],
    ];
    let table = Block::Table {
        header: true,
        rows,
        cell_styles: styles,
        merges,
        widths: Vec::new(),
    };
    document(vec![Part::Blocks(vec![table])])
}

#[test]
fn a_cell_style_writes_shading_borders_and_vertical_alignment() {
    let bottom = CellBorder {
        style: "double".to_owned(),
        color: Some("#112233".to_owned()),
        width: None,
    };
    let style = CellStyle {
        fill: Some(Fill::Color("#ffeecc".to_owned())),
        border: CellBorders {
            bottom: Some(bottom),
            ..CellBorders::default()
        },
        align: CellAlign {
            vertical: Some("middle".to_owned()),
            ..CellAlign::default()
        },
        ..CellStyle::default()
    };
    let xml = styled_document(vec![vec![], vec![Some(style)]], Vec::new());
    // ECMA-376 17.4.33 (shd), 17.4.66 (tcBorders), and 17.4.84 (vAlign); a double border has w:val "double".
    assert!(
        xml.contains("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"FFEECC\"/>"),
        "{xml}"
    );
    assert!(
        xml.contains("<w:bottom w:val=\"double\" w:sz=\"6\" w:space=\"0\" w:color=\"112233\"/>"),
        "{xml}"
    );
    assert!(xml.contains("<w:vAlign w:val=\"center\"/>"), "{xml}");
}

#[test]
fn a_merge_writes_a_grid_span_and_a_vertical_merge() {
    // B2:C3: the anchor spans two columns and starts a vertical merge; the cell below continues it.
    let merge = Merge {
        top: 1,
        left: 1,
        bottom: 2,
        right: 2,
    };
    let xml = styled_document(Vec::new(), vec![merge]);
    assert!(
        xml.contains("<w:gridSpan w:val=\"2\"/><w:vMerge w:val=\"restart\"/>"),
        "{xml}"
    );
    assert!(xml.contains("<w:gridSpan w:val=\"2\"/><w:vMerge/>"), "{xml}");
    // Row 2 has the first cell and the anchor; row 3 has the first cell and the continuation.
    let rows: Vec<&str> = xml.split("<w:tr>").skip(1).collect();
    assert_eq!(rows[1].matches("<w:tc>").count(), 2, "{xml}");
    assert_eq!(rows[2].matches("<w:tc>").count(), 2, "{xml}");
}
