use serde_json::json;

use super::*;

#[test]
fn settings_defaults_match_phase_5s_schema() {
    let expected = json!({
        "pens": [
            { "id": "p1", "tool": "pen", "color": "ink", "width": 0.5, "pressure": true },
            { "id": "p2", "tool": "pen", "color": "indigo", "width": 0.5, "pressure": true },
            { "id": "p3", "tool": "pen", "color": "brick", "width": 0.5, "pressure": true },
            { "id": "p4", "tool": "pen", "color": "fern", "width": 0.7, "pressure": true },
            { "id": "p5", "tool": "pencil", "color": "walnut", "width": 0.7, "pressure": true },
            { "id": "h1", "tool": "highlighter", "color": "honey", "width": 4.0 },
            { "id": "h2", "tool": "highlighter", "color": "mint", "width": 4.0 }
        ],
        "penSelectsAndTypes": false,
        "handedness": "right",
        "touch": { "draws": false, "palmGraceMs": 500, "twoFingerScrollNearPen": true },
        "eraser": { "mode": "stroke", "size": 4, "erases": "all", "returnToLastTool": false, "showTarget": true },
        "lasso": { "shape": "free", "picks": ["ink", "highlighter", "text", "images", "shapes"], "inside": "mostly" },
        "shapes": { "hold": true, "holdMs": 500, "inkToShape": false },
        "gestures": { "scribbleErase": true, "circleSelect": true, "twoFingerUndo": true, "threeFingerRedo": true },
        "anchorToText": true,
        "zoomBox": { "magnification": 3, "autoAdvance": true },
        "contrastInk": "keepLegible",
        "lowLatency": "auto"
    });
    assert_eq!(
        serde_json::to_value(InkSettings::default()).expect("serializes"),
        expected
    );
}

#[test]
fn device_defaults_match_phase_5s_schema() {
    let expected = json!({
        "pens": {
            "default": {
                "curve": "normal", "customCurve": null, "minWidth": 0.2, "steady": 0,
                "barrel": "lasso", "eraserEnd": "strokeEraser"
            }
        },
        "palette": {
            "wide": { "dock": "float", "x": 0.5, "y": 1.0, "collapsed": false },
            "compact": { "dock": "bottomBar", "collapsed": false },
            "shown": true, "penSeen": false
        },
        "lastTool": "pen", "lastPen": "p2", "zoomBoxOpen": false, "noHoverPen": false
    });
    assert_eq!(
        serde_json::to_value(InkDeviceState::default()).expect("serializes"),
        expected
    );
}

fn failed_field(check: impl FnOnce(&mut Check)) -> Option<String> {
    let mut checks = Check::default();
    check(&mut checks);
    checks.finish().err().and_then(|error| error.field)
}

#[test]
fn checks_widths_colors_and_timings() {
    let mut ink = InkSettings::default();
    assert_eq!(failed_field(|c| ink.check(c)), None);
    ink.pens[0].width = 25.0;
    assert_eq!(failed_field(|c| ink.check(c)).as_deref(), Some("ink.pens"));
    ink.pens[0].width = 0.5;
    ink.pens[0].color = "#F00".into();
    assert_eq!(failed_field(|c| ink.check(c)).as_deref(), Some("ink.pens"));
    ink.pens[0].color = "#2b2521".into();
    ink.pens[1].id = "p1".into();
    assert_eq!(failed_field(|c| ink.check(c)).as_deref(), Some("ink.pens"));
    ink = InkSettings::default();
    ink.touch.palm_grace_ms = 200;
    assert_eq!(failed_field(|c| ink.check(c)).as_deref(), Some("ink.touch.palmGraceMs"));
    ink = InkSettings::default();
    ink.shapes.hold_ms = 2_000;
    assert_eq!(failed_field(|c| ink.check(c)).as_deref(), Some("ink.shapes.holdMs"));
    ink = InkSettings::default();
    ink.pens.clear();
    assert_eq!(failed_field(|c| ink.check(c)).as_deref(), Some("ink.pens"));
}

#[test]
fn highlighters_may_have_alpha_and_pens_may_not() {
    let mut ink = InkSettings::default();
    ink.pens[5].color = "#f2cf4a66".into();
    assert_eq!(failed_field(|c| ink.check(c)), None);
    ink.pens[0].color = "#f2cf4a66".into();
    assert_eq!(failed_field(|c| ink.check(c)).as_deref(), Some("ink.pens"));
}

#[test]
fn a_custom_curve_never_goes_down() {
    assert!(curve_rises([0.33, 0.33, 0.67, 0.67]));
    assert!(curve_rises([0.15, 0.45, 0.5, 0.95]));
    assert!(curve_rises([0.5, 0.05, 0.85, 0.55]));
    assert!(curve_rises([0.2, 1.0, 0.8, 0.0]), "flat in the middle, but never down");
    assert!(
        !curve_rises([0.2, 0.9, 0.8, -0.4]),
        "a control point below the square dips"
    );
    assert!(!curve_rises([0.2, 1.4, 0.8, 0.5]), "outside the square");
    let mut device = InkDeviceState::default();
    if let Some(pen) = device.pens.get_mut("default") {
        pen.custom_curve = Some([0.2, 0.9, 0.8, -0.4]);
    }
    assert_eq!(failed_field(|c| device.check(c)).as_deref(), Some("ink.pens"));
}
