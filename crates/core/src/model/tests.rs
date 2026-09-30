use super::*;
use crate::model::view::{Layout, PaperSize};

#[test]
fn named_values_keep_unknown_names() {
    assert_eq!(Named::<Layout>::parse("flow"), Named::Known(Layout::Flow));
    let future = Named::<Layout>::parse("columns");
    assert_eq!(future.as_str(), "columns");
    assert_eq!(future.known(), None);
    assert_eq!(future.or(Layout::Freeform), Layout::Freeform);
    assert_eq!(Named::<PaperSize>::default(), Named::Known(PaperSize::Letter));
    assert_eq!(serde_json::to_string(&future).unwrap(), "\"columns\"");
    let back: Named<Layout> = serde_json::from_str("\"freeform\"").unwrap();
    assert_eq!(back, Named::Known(Layout::Freeform));
}

#[test]
fn named_enums_round_trip_every_value() {
    for &layout in Layout::ALL {
        assert_eq!(Layout::from_name(layout.name()), Some(layout));
        let json = serde_json::to_string(&layout).unwrap();
        assert_eq!(serde_json::from_str::<Layout>(&json).unwrap(), layout);
    }
    assert!(serde_json::from_str::<Layout>("\"columns\"").is_err());
}

#[test]
fn colors_parse_and_print() {
    assert_eq!(Color::parse("fern").unwrap(), Color::Palette("fern".into()));
    assert_eq!(Color::parse("#2B2521").unwrap(), Color::Rgb([0x2b, 0x25, 0x21]));
    assert_eq!(Color::parse("#2b2521").unwrap().to_text(), "#2b2521");
    assert_eq!(
        Color::parse("#2b252180").unwrap(),
        Color::Rgba([0x2b, 0x25, 0x21, 0x80])
    );
    assert_eq!(Color::parse("rule").unwrap(), Color::Rule);
    assert_eq!(Color::parse("future-pen2").unwrap().to_text(), "future-pen2");
    for bad in [
        "", "#", "#12345", "#1234567", "#12345g", "Fern", "2fern", "fern!", "#🎨",
    ] {
        assert!(Color::parse(bad).is_err(), "{bad:?}");
    }
    assert!(Color::parse("indigo").unwrap().is_pen());
    assert!(!Color::parse("honey").unwrap().is_pen());
    assert!(!Color::Rgb([0; 3]).is_pen());
}

#[test]
fn colors_serialize_as_text() {
    let color = Color::Rgba([1, 2, 3, 4]);
    assert_eq!(serde_json::to_string(&color).unwrap(), "\"#01020304\"");
    assert_eq!(
        serde_json::from_str::<Color>("\"plum\"").unwrap(),
        Color::Palette("plum".into())
    );
}

#[test]
fn palette_slots_have_brand_names() {
    use crate::model::stroke::palette_slot_name;
    assert_eq!(palette_slot_name(1), Some("ink"));
    assert_eq!(palette_slot_name(7), Some("walnut"));
    assert_eq!(palette_slot_name(32), Some("honey"));
    assert_eq!(palette_slot_name(36), Some("lilac"));
    for custom in [0, 8, 31, 37, 255] {
        assert_eq!(palette_slot_name(custom), None);
    }
}
