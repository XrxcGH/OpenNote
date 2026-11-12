// checks-disable-file brand-consistency: the test data holds color values to check how they are written
use super::*;
use crate::doc::cell_style::{CellAlign, CellBorders, Pad};

fn cell(text: &str) -> Vec<Inline> {
    vec![Inline::text(text)]
}

#[test]
fn a_merge_writes_colspan_and_rowspan_on_its_anchor_and_omits_the_covered_cells() {
    // B2:C3 of a 3 by 3 table.
    let rows = vec![
        vec![cell("A"), cell("B"), cell("C")],
        vec![cell("d"), cell("e"), cell("")],
        vec![cell("g"), cell(""), cell("")],
    ];
    let merge = Merge {
        top: 1,
        left: 1,
        bottom: 2,
        right: 2,
    };
    let html = table_html(true, &rows, &[], &[merge], &[]);
    assert!(
        html.contains("<tr><td>d</td><td colspan=\"2\" rowspan=\"2\">e</td></tr>"),
        "{html}"
    );
    assert!(html.contains("<tr><td>g</td></tr>"), "{html}");
}

#[test]
fn a_style_writes_fill_border_alignment_and_padding() {
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
            horizontal: Some("center".to_owned()),
            ..CellAlign::default()
        },
        pad: Pad {
            top: Some(3.0),
            right: Some(5.0),
            bottom: Some(3.0),
            left: Some(5.0),
        },
        ..CellStyle::default()
    };
    let html = table_html(false, &[vec![cell("x")]], &[vec![Some(style)]], &[], &[]);
    for want in [
        "background-color:#ffeecc",
        "border-bottom:3px double #112233",
        "vertical-align:middle",
        "text-align:center",
        "padding:3pt 5pt 3pt 5pt",
    ] {
        assert!(html.contains(want), "{want} in {html}");
    }
}

#[test]
fn a_table_without_a_sheet_is_written_as_it_was() {
    let html = table_html(true, &[vec![cell("h")], vec![cell("b")]], &[], &[], &[]);
    assert_eq!(html, "<table>\n<tr><th>h</th></tr>\n<tr><td>b</td></tr>\n</table>\n");
}

#[test]
fn a_font_family_keeps_only_names_and_separators() {
    use crate::doc::cell_style::{CellFont, CellStyle};
    let style = CellStyle {
        font: CellFont {
            family: Some(r"Segoe UI, \22 x url(//e.example/a) {};<b>".to_owned()),
            ..CellFont::default()
        },
        ..CellStyle::default()
    };
    // No backslash, parenthesis, slash, brace, quote, semicolon, or angle bracket survives.
    assert_eq!(super::cell_css(&style), "font-family:Segoe UI, 22 x urle.examplea b");
}
