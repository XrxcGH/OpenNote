//! The Windows parts of updating (ARCHITECTURE.md sections 18.4 and 18.5): background mode for the worker thread,
//! which lowers its CPU and disk priority, and the connection cost behind the `updates.meteredCheck` flag.

use opennote_updater::NetworkCost;

/// Puts the calling thread in Windows background mode, so checks and downloads never slow the app down.
pub fn enter_background_mode() {
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN};
        // SAFETY: GetCurrentThread returns a pseudo handle for this thread, which needs no closing, and
        // SetThreadPriority only reads it.
        let result = unsafe { SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN) };
        if let Err(error) = result {
            log::warn!("The updater thread couldn't enter background mode: {error}");
        }
    }
}

/// The connection cost Windows reports for the internet connection.
#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsNetworkCost;

impl NetworkCost for WindowsNetworkCost {
    /// True on a fixed or variable data plan, while roaming, or over the plan's limit. An unknown cost isn't
    /// metered, so a failure never stops updates.
    fn is_metered(&self) -> bool {
        #[cfg(windows)]
        {
            use windows::Networking::Connectivity::{NetworkCostType, NetworkInformation};
            let Ok(cost) = NetworkInformation::GetInternetConnectionProfile().and_then(|p| p.GetConnectionCost())
            else {
                return false;
            };
            let kind = cost.NetworkCostType().unwrap_or(NetworkCostType::Unknown);
            let limited = kind == NetworkCostType::Fixed || kind == NetworkCostType::Variable;
            limited || cost.Roaming().unwrap_or(false) || cost.OverDataLimit().unwrap_or(false)
        }
        #[cfg(not(windows))]
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_mode_and_the_connection_cost_never_fail() {
        std::thread::spawn(|| {
            enter_background_mode();
            let _ = WindowsNetworkCost.is_metered();
        })
        .join()
        .expect("the thread finishes");
    }
}
