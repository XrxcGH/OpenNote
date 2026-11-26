// checks-disable-file brand-consistency, length: the test data holds color values to check how they are written
use super::*;

fn border(style: &str) -> Option<CellBorder> {
    Some(CellBorder {
        style: style.to_owned(),
        color: None,
        width: None,
    })
}

#[test]
fn a_fill_exports_as_a_solid_pattern_with_an_opaque_color() {
    let mut sheet = StyleSheet::default();
    let style = CellStyle {
        fill: Some(Fill::Color("#FDE68A".to_owned())),
        ..CellStyle::default()
    };
    assert_eq!(sheet.cell(Some(&style), None, false, false), 1);
    let xml = sheet.xml();
    assert!(
        xml.contains("<patternFill patternType=\"solid\"><fgColor rgb=\"FFFDE68A\"/>"),
        "{xml}"
    );
    assert!(xml.contains("fillId=\"2\"") && xml.contains("applyFill=\"1\""), "{xml}");
}

#[test]
fn a_double_bottom_border_exports_with_its_style() {
    let mut sheet = StyleSheet::default();
    let style = CellStyle {
        border: CellBorders {
            bottom: border("double"),
            ..CellBorders::default()
        },
        ..CellStyle::default()
    };
    sheet.cell(Some(&style), None, false, false);
    let xml = sheet.xml();
    assert!(xml.contains("<bottom style=\"double\">"), "{xml}");
    assert!(xml.contains("<borders count=\"2\">"), "{xml}");
}

#[test]
fn equal_looks_share_one_cell_format_and_formats_get_ids() {
    let mut sheet = StyleSheet::default();
    let bold = CellStyle {
        font: CellFont {
            bold: Some(true),
            ..CellFont::default()
        },
        ..CellStyle::default()
    };
    let a = sheet.cell(Some(&bold), Some("0.00"), false, false);
    let b = sheet.cell(Some(&bold), Some("0.00"), false, false);
    let header = sheet.cell(None, Some("0.00"), true, false);
    assert_eq!(a, b);
    assert_eq!(a, header, "a header is bold the same way");
    // 0.00 is built-in ID 2 (ECMA-376 Part 1, 18.8.30); a date code is custom from 164.
    let date = sheet.cell(None, Some("yyyy-mm-dd"), false, false);
    let xml = sheet.xml();
    assert!(xml.contains("numFmtId=\"2\" fontId=\"1\""), "{xml}");
    assert!(
        xml.contains("<numFmt numFmtId=\"164\" formatCode=\"yyyy-mm-dd\"/>"),
        "{xml}"
    );
    assert_eq!(date, 2);
}

#[test]
fn alignment_maps_names_and_rotation() {
    let mut sheet = StyleSheet::default();
    let style = CellStyle {
        align: CellAlign {
            horizontal: Some("centerAcross".to_owned()),
            vertical: Some("middle".to_owned()),
            rotate: Some(-45),
            indent: Some(2),
            ..CellAlign::default()
        },
        ..CellStyle::default()
    };
    sheet.cell(Some(&style), None, false, false);
    let xml = sheet.xml();
    // Rotation below the line counts from 90 up (ECMA-376 Part 1, 18.8.1): -45 degrees is 135.
    assert!(
        xml.contains(
            "<alignment horizontal=\"centerContinuous\" vertical=\"center\" textRotation=\"135\" indent=\"2\"/>"
        ),
        "{xml}"
    );
}

#[test]
fn a_differential_format_puts_a_solid_fill_in_the_background_color() {
    let mut sheet = StyleSheet::default();
    let style = CellStyle {
        fill: Some(Fill::Color("brick".to_owned())),
        font: CellFont {
            color: Some("#FFFFFF".to_owned()),
            ..CellFont::default()
        },
        ..CellStyle::default()
    };
    assert_eq!(sheet.dxf(&style, None), 0);
    let xml = sheet.xml();
    assert!(
        xml.contains("<dxf><font><color rgb=\"FFFFFFFF\"/></font><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFB0342A\"/><bgColor rgb=\"FFB0342A\"/>"),
        "{xml}"
    );
}

#[test]
fn built_in_ids_follow_the_standard() {
    assert_eq!(numfmt::built_in_id("General"), Some(0));
    assert_eq!(numfmt::built_in_id("#,##0.00"), Some(4));
    assert_eq!(numfmt::built_in_id("0%"), Some(9));
    assert_eq!(numfmt::built_in_id("@"), Some(49));
    // A locale-dependent date ID is never written.
    assert_eq!(numfmt::built_in_id("h:mm"), None);
    assert_eq!(numfmt::built_in_code(14), Some("m/d/yyyy"));
    assert_eq!(numfmt::built_in_code(3), Some("#,##0"));
}
