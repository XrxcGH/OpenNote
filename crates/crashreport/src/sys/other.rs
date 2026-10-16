use crate::report::RawFrame;

/// The operating system and processor, such as `linux x86_64`.
pub fn os_description() -> String {
    format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
}

/// The stack as code offsets. Only Windows gives them.
pub fn capture_frames() -> Vec<RawFrame> {
    Vec::new()
}

/// The module and offset of a code address. Only Windows gives them.
pub fn frame_for(_address: usize) -> RawFrame {
    RawFrame::default()
}

/// Handles exceptions that nothing else handled. Only Windows has them, so this does nothing and returns
/// `false`.
pub fn install_exception_filter(_callback: fn(u32, usize)) -> bool {
    false
}
