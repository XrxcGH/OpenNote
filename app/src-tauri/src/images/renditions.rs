//! The image schemes on the app's builder. `opennote-asset` serves page assets (section 12.3). Display-size
//! renditions behind `page.imageRenditions` (section 12.6) wait for spike S3: the flag is off in every channel, and
//! until the spike asks for them nothing more is registered.

use tauri::{Builder, Wry};

pub fn register_renditions(builder: Builder<Wry>) -> Builder<Wry> {
    super::protocol::register(builder)
}
