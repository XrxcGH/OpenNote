//! Writes a spike's results, with a description of the machine they came from, as JSON.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::Graphics::Gdi::{EnumDisplaySettingsW, DEVMODEW, ENUM_CURRENT_SETTINGS};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};
use windows::Win32::UI::HiDpi::GetDpiForSystem;

use super::Result;

/// The machine a measurement ran on. Latency depends heavily on the screen and the WebView2 version.
#[derive(Clone, Debug, Serialize)]
pub struct Machine {
    pub model: String,
    pub windows: String,
    pub webview2: String,
    pub refresh_hz: u32,
    pub scale_percent: u32,
    pub logical_processors: usize,
}

pub fn machine() -> Machine {
    let bios = r"HARDWARE\DESCRIPTION\System\BIOS";
    let current = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let windows = format!(
        "{} {} (build {}.{})",
        registry_string(current, "ProductName").unwrap_or_default(),
        registry_string(current, "DisplayVersion").unwrap_or_default(),
        registry_string(current, "CurrentBuild").unwrap_or_default(),
        registry_dword(current, "UBR").unwrap_or_default(),
    );
    Machine {
        model: registry_string(bios, "SystemProductName").unwrap_or_else(|| "unknown".into()),
        windows,
        webview2: webview2_version().unwrap_or_else(|| "not installed".into()),
        refresh_hz: refresh_rate(),
        scale_percent: unsafe { GetDpiForSystem() } * 100 / 96,
        logical_processors: std::thread::available_parallelism().map_or(0, |count| count.get()),
    }
}

/// Writes `{ spike, date, machine, results }` to `path`, creating its folder, and prints where it went.
pub fn write(path: &Path, spike: &str, results: Value) -> Result<()> {
    let document = serde_json::json!({
        "spike": spike,
        "date": today(),
        "machine": machine(),
        "results": results,
    });
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)?;
    }
    std::fs::write(path, format!("{}\n", serde_json::to_string_pretty(&document)?))?;
    println!("Wrote the {spike} results to {}", path.display());
    Ok(())
}

/// Today's date in UTC as YYYY-MM-DD.
pub fn today() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let (year, month, day) = civil_from_days((seconds / 86_400) as i64);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Converts days since 1970-01-01 to a calendar date (Howard Hinnant's civil_from_days algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn refresh_rate() -> u32 {
    let mut mode = DEVMODEW {
        dmSize: size_of::<DEVMODEW>() as u16,
        ..Default::default()
    };
    let found = unsafe { EnumDisplaySettingsW(PCWSTR::null(), ENUM_CURRENT_SETTINGS, &mut mode) };
    if found.as_bool() {
        mode.dmDisplayFrequency
    } else {
        0
    }
}

fn webview2_version() -> Option<String> {
    let mut version = PWSTR::null();
    unsafe { GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut version) }.ok()?;
    (!version.is_null()).then(|| webview2_com::take_pwstr(version))
}

fn registry_string(key: &str, name: &str) -> Option<String> {
    let mut buffer = [0u16; 256];
    let mut size = (buffer.len() * 2) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            &HSTRING::from(key),
            &HSTRING::from(name),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    status.is_ok().then(|| {
        let length = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
        String::from_utf16_lossy(&buffer[..length])
    })
}

fn registry_dword(key: &str, name: &str) -> Option<u32> {
    let mut value = 0u32;
    let mut size = size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            &HSTRING::from(key),
            &HSTRING::from(name),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
    };
    status.is_ok().then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_days_to_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_726), (2026, 9, 30));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }

    #[test]
    fn describes_the_machine() {
        let machine = machine();
        assert!(machine.windows.contains("build"));
        assert!(machine.logical_processors > 0);
        assert!(machine.scale_percent >= 100);
    }
}
