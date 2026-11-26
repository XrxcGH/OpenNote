//! What the frame and placement code needs from the window. Tauri's window has it in the app, and tao's own window
//! has it in the tests, which check the flags tao really keeps and the frame Windows really draws.
//!
//! Tao keeps its own record of whether the window is visible and decorated, and it rewrites the window's styles
//! from that record on every change. A window shown or restored through Win32 (`SetWindowPlacement`, `ShowWindow`)
//! behind tao's back stays hidden in that record. Tao then skips the frame refresh that showing does, and its next
//! style change hides the window again. After such a call, show the window through tao too ([`TaoWindow::show`]).

/// The parts of tao's window the frame code uses.
pub trait TaoWindow {
    /// The window's handle.
    #[cfg(windows)]
    fn hwnd(&self) -> tauri::Result<windows::Win32::Foundation::HWND>;
    /// Shows the window through tao, so tao counts it as visible.
    fn show(&self) -> tauri::Result<()>;
    /// Whether tao counts the window as having the native frame.
    fn is_decorated(&self) -> tauri::Result<bool>;
    /// Gives the window the native frame, or takes it away, through tao.
    fn set_decorations(&self, decorated: bool) -> tauri::Result<()>;
}

impl TaoWindow for tauri::WebviewWindow {
    #[cfg(windows)]
    fn hwnd(&self) -> tauri::Result<windows::Win32::Foundation::HWND> {
        tauri::WebviewWindow::hwnd(self)
    }

    fn show(&self) -> tauri::Result<()> {
        tauri::WebviewWindow::show(self)
    }

    fn is_decorated(&self) -> tauri::Result<bool> {
        tauri::WebviewWindow::is_decorated(self)
    }

    fn set_decorations(&self, decorated: bool) -> tauri::Result<()> {
        tauri::WebviewWindow::set_decorations(self, decorated)
    }
}

#[cfg(all(test, windows))]
impl TaoWindow for tao::window::Window {
    fn hwnd(&self) -> tauri::Result<windows::Win32::Foundation::HWND> {
        use tao::platform::windows::WindowExtWindows;
        Ok(windows::Win32::Foundation::HWND(WindowExtWindows::hwnd(self) as *mut _))
    }

    fn show(&self) -> tauri::Result<()> {
        self.set_visible(true);
        Ok(())
    }

    fn is_decorated(&self) -> tauri::Result<bool> {
        Ok(tao::window::Window::is_decorated(self))
    }

    fn set_decorations(&self, decorated: bool) -> tauri::Result<()> {
        tao::window::Window::set_decorations(self, decorated);
        Ok(())
    }
}
