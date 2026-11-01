//! The image schemes on the app's builder. Only `opennote-asset` is registered; it serves page assets (section 12.3).
//! Display-size renditions (section 12.6) were dropped after spike S3 showed they save no memory.

use tauri::{Builder, Wry};

pub fn register_image_schemes(builder: Builder<Wry>) -> Builder<Wry> {
    super::protocol::register(builder)
}
