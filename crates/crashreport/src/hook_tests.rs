use super::*;

#[test]
fn an_exception_becomes_a_code_and_code_offsets() {
    let stack = vec![RawFrame {
        module: Some("ntdll.dll".into()),
        offset: Some(0x99),
        ..RawFrame::default()
    }];
    let capture = exception_capture(0xC000_0005, 0, stack);
    assert_eq!(capture.kind, Kind::Exception);
    assert_eq!(capture.exception_code, Some(0xC000_0005));
    assert!(capture.message.is_none() && capture.location.is_none() && capture.backtrace.is_empty());
    // The address itself comes first, then the stack.
    assert_eq!(capture.frames.len(), 2);
    assert_eq!(capture.frames[1].offset, Some(0x99));
}

#[test]
fn nothing_is_saved_before_install() {
    // This test binary never installs the hooks, so a turn is never given out.
    assert!(Turn::begin().is_none());
    assert!(!is_enabled());
    assert!(store().is_none());
    set_enabled(true);
    add_private("anything");
    assert!(!is_enabled());
}
