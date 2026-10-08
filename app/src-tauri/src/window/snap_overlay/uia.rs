//! The Snap Layouts overlay's UI Automation provider (ARCHITECTURE.md section 10.5). The overlay window covers the
//! HTML Maximize button, so UI Automation hit tests there reach the overlay, not WebView2. This provider makes the
//! overlay the Maximize button for Narrator, Voice Access, and Magnifier. It's a Button named "Maximize" or
//! "Restore" with the Invoke pattern, outside the tab order like a native caption button. Its bounding rectangle,
//! and whether it's enabled and on screen, come from the window through the host provider.
//!
//! UI Automation calls a server-side provider without `ProviderOptions_UseComThreading` on the thread that owns
//! the window, but the shared name is behind a mutex anyway, so any thread may read it.

use std::{
    ffi::c_void,
    sync::{Arc, Mutex, PoisonError},
};

use windows::{
    core::{implement, Error, IUnknown, IUnknownImpl, Interface, Result, HRESULT},
    Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        System::Variant::VARIANT,
        UI::{
            Accessibility::{
                IInvokeProvider, IInvokeProvider_Impl, IRawElementProviderSimple, IRawElementProviderSimple_Impl,
                ProviderOptions, ProviderOptions_ServerSideProvider, UIA_AutomationIdPropertyId,
                UIA_ButtonControlTypeId, UIA_ControlTypePropertyId, UIA_HasKeyboardFocusPropertyId,
                UIA_InvokePatternId, UIA_IsKeyboardFocusablePropertyId, UIA_NamePropertyId, UiaHostProviderFromHwnd,
                UIA_E_ELEMENTNOTAVAILABLE, UIA_PATTERN_ID, UIA_PROPERTY_ID,
            },
            WindowsAndMessaging::PostMessageW,
        },
    },
};

/// The provider's automation id for tests and scripts. It stays the same in every language.
pub const AUTOMATION_ID: &str = "OpenNote.SnapLayouts.Maximize";

/// The button's current name. The overlay and its provider share it.
#[derive(Debug, Default)]
pub struct SharedName(Mutex<String>);

impl SharedName {
    pub fn get(&self) -> String {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// Sets the name, and returns the old one when it changed.
    pub fn set(&self, name: &str) -> Option<String> {
        let mut current = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        (*current != name).then(|| std::mem::replace(&mut *current, name.to_owned()))
    }
}

#[implement(IRawElementProviderSimple, IInvokeProvider)]
pub struct MaximizeProvider {
    /// The overlay window, as an integer so the provider stays `Send`.
    hwnd: isize,
    /// The message that makes the overlay maximize or restore the main window on its own thread.
    invoke_message: u32,
    name: Arc<SharedName>,
}

impl MaximizeProvider {
    pub fn create(hwnd: HWND, invoke_message: u32, name: Arc<SharedName>) -> IRawElementProviderSimple {
        MaximizeProvider {
            hwnd: hwnd.0 as isize,
            invoke_message,
            name,
        }
        .into()
    }
}

impl MaximizeProvider_Impl {
    fn hwnd(&self) -> HWND {
        HWND(self.hwnd as *mut c_void)
    }
}

impl IRawElementProviderSimple_Impl for MaximizeProvider_Impl {
    fn ProviderOptions(&self) -> Result<ProviderOptions> {
        Ok(ProviderOptions_ServerSideProvider)
    }

    fn GetPatternProvider(&self, pattern: UIA_PATTERN_ID) -> Result<IUnknown> {
        if pattern == UIA_InvokePatternId {
            self.to_interface::<IInvokeProvider>().cast()
        } else {
            // S_OK with no provider: the element doesn't support the pattern.
            Err(Error::empty())
        }
    }

    fn GetPropertyValue(&self, property: UIA_PROPERTY_ID) -> Result<VARIANT> {
        Ok(if property == UIA_ControlTypePropertyId {
            VARIANT::from(UIA_ButtonControlTypeId.0)
        } else if property == UIA_NamePropertyId {
            VARIANT::from(self.name.get().as_str())
        } else if property == UIA_AutomationIdPropertyId {
            VARIANT::from(AUTOMATION_ID)
        } else if property == UIA_IsKeyboardFocusablePropertyId || property == UIA_HasKeyboardFocusPropertyId {
            VARIANT::from(false)
        } else {
            // An empty value: the host provider or UI Automation's default answers.
            VARIANT::default()
        })
    }

    fn HostRawElementProvider(&self) -> Result<IRawElementProviderSimple> {
        // SAFETY: UI Automation checks the handle; a destroyed window gives an error, not undefined behavior.
        unsafe { UiaHostProviderFromHwnd(self.hwnd()) }
    }
}

impl IInvokeProvider_Impl for MaximizeProvider_Impl {
    /// Returns at once, as Invoke must, and lets the overlay act on its own thread.
    fn Invoke(&self) -> Result<()> {
        // SAFETY: posting to a window handle never dereferences it; a destroyed window makes the call fail.
        unsafe { PostMessageW(Some(self.hwnd()), self.invoke_message, WPARAM(0), LPARAM(0)) }
            .map_err(|_| Error::from(HRESULT(UIA_E_ELEMENTNOTAVAILABLE.cast_signed())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_a_name_change_once() {
        let name = SharedName::default();
        assert_eq!(name.set("Maximize"), Some(String::new()));
        assert_eq!(name.set("Maximize"), None);
        assert_eq!(name.set("Restore"), Some("Maximize".to_owned()));
        assert_eq!(name.get(), "Restore");
    }

    #[test]
    fn describes_a_button_that_invokes() {
        let name = Arc::new(SharedName::default());
        name.set("Maximize");
        let provider = MaximizeProvider::create(HWND::default(), 0, name);
        // SAFETY: plain COM calls on a provider this test owns.
        unsafe {
            let control_type = provider.GetPropertyValue(UIA_ControlTypePropertyId).unwrap();
            assert_eq!(i32::try_from(&control_type).unwrap(), UIA_ButtonControlTypeId.0);
            let label = provider.GetPropertyValue(UIA_NamePropertyId).unwrap();
            assert_eq!(label.to_string(), "Maximize");
            let focusable = provider.GetPropertyValue(UIA_IsKeyboardFocusablePropertyId).unwrap();
            assert!(!bool::try_from(&focusable).unwrap());
            assert!(provider
                .GetPatternProvider(UIA_InvokePatternId)
                .unwrap()
                .cast::<IInvokeProvider>()
                .is_ok());
            assert!(provider.GetPropertyValue(UIA_PROPERTY_ID(0)).unwrap().is_empty());
        }
    }
}
