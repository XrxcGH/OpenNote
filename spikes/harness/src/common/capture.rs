//! Screen capture with the Desktop Duplication API: watches a small region of the screen and reports
//! the present time of the first frame in which it changes. Frame times use the performance counter
//! (see [`super::clock`]), so the time from injected input to a visible change needs no conversion.
//!
//! The watcher only copies the watched region out of each frame, so it adds little work for the GPU.
//! A full copy of the desktop is kept only when a new baseline is taken, because the region may have
//! moved since the last frame.
//!
//! The ink spike writes this module; the text spike uses it to time key presses the same way.

use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BOX, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
    D3D11_TEXTURE2D_DESC,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_R8G8B8A8_UNORM};
use windows::Win32::Graphics::Dxgi::{
    IDXGIOutput1, IDXGIOutputDuplication, DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
};

use super::Result;
use geometry::Bounds;
pub use geometry::Region;
use output::{create_device, create_texture, find_output, texture_desc};
use pixels::{differs, is_blank, pack_rows, BYTES_PER_PIXEL};

mod geometry;
mod output;
mod pixels;

/// The longest single wait for a frame, so the deadline is checked often.
const MAX_WAIT_MS: u32 = 100;

/// The frame in which the watcher last saw a change.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Frame {
    /// When the desktop image was presented, in performance counter ticks.
    pub present_time: i64,
    /// How many desktop updates the frame combined. Above 1, the change may have been presented up to
    /// that many frames earlier, so the latency is an overestimate.
    pub accumulated_frames: u32,
}

/// Watches one region of the screen for changes.
pub struct ChangeWatcher {
    region: Region,
    monitor: Bounds,
    format: DXGI_FORMAT,
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    output: IDXGIOutput1,
    duplication: IDXGIOutputDuplication,
    /// The frame acquired last, held until the next acquire as the API recommends.
    held: Option<(DXGI_OUTDUPL_FRAME_INFO, ID3D11Texture2D)>,
    /// A copy of the whole desktop image, updated when a baseline is taken.
    desktop: Option<ID3D11Texture2D>,
    /// A CPU-readable texture the size of the region.
    staging: Option<(ID3D11Texture2D, u32, u32)>,
    baseline: Vec<u8>,
    last_change: Frame,
}

impl ChangeWatcher {
    /// Starts watching `region` on the monitor that contains it.
    pub fn new(region: Region) -> Result<ChangeWatcher> {
        let (adapter, output, monitor) = find_output(region)?;
        let (device, context) = create_device(&adapter)?;
        let duplication = unsafe { output.DuplicateOutput(&device) }
            .map_err(|error| format!("Desktop Duplication isn't available: {error}"))?;
        let mut watcher = ChangeWatcher {
            region,
            monitor,
            format: DXGI_FORMAT_B8G8R8A8_UNORM,
            device,
            context,
            output,
            duplication,
            held: None,
            desktop: None,
            staging: None,
            baseline: Vec::new(),
            last_change: Frame::default(),
        };
        watcher.take_first_frame()?;
        Ok(watcher)
    }

    /// The region being watched.
    pub fn region(&self) -> Region {
        self.region
    }

    /// Moves the watched region, keeping the same monitor.
    pub fn set_region(&mut self, region: Region) {
        self.region = region;
    }

    /// The frame of the last change that [`ChangeWatcher::wait_for_change`] reported.
    pub fn last_change(&self) -> Frame {
        self.last_change
    }

    /// True when every pixel of the baseline is within `tolerance` of the first, in every color channel.
    /// A blank region shows that nothing is drawn there yet.
    pub fn baseline_is_blank(&self, tolerance: u8) -> bool {
        is_blank(&self.baseline, tolerance)
    }

    /// Takes the region's current contents as the baseline that later frames are compared with.
    pub fn reset_baseline(&mut self) -> Result<()> {
        self.catch_up()?;
        let desktop = self
            .desktop
            .clone()
            .ok_or("The screen capture has no desktop image yet.")?;
        self.baseline = self.read_region(&desktop)?;
        Ok(())
    }

    /// Waits for a frame in which any pixel of the region differs from the baseline by more than
    /// `threshold` in any color channel. Returns that frame's present time in performance counter
    /// ticks, or None if nothing changed within `timeout`.
    pub fn wait_for_change(&mut self, threshold: u8, timeout: Duration) -> Result<Option<i64>> {
        if self.baseline.is_empty() {
            return Err("Take a baseline with reset_baseline before waiting for a change.".into());
        }
        let deadline = Instant::now() + timeout;
        loop {
            let Some(wait) = wait_until(deadline) else {
                return Ok(None);
            };
            let Some((info, frame)) = self.acquire(wait)? else {
                continue;
            };
            // Pointer-only updates leave the desktop image as it was.
            if info.LastPresentTime == 0 {
                continue;
            }
            let pixels = self.read_region(&frame)?;
            if differs(&self.baseline, &pixels, threshold) {
                self.last_change = Frame {
                    present_time: info.LastPresentTime,
                    accumulated_frames: info.AccumulatedFrames,
                };
                return Ok(Some(info.LastPresentTime));
            }
        }
    }

    /// Records every desktop update for `duration`, without reading any pixels. While something on the
    /// screen changes every frame, the gaps between present times show the display's real refresh.
    pub fn collect_presents(&mut self, duration: Duration) -> Result<Vec<Frame>> {
        let deadline = Instant::now() + duration;
        let mut frames = Vec::new();
        loop {
            let Some(wait) = wait_until(deadline) else {
                return Ok(frames);
            };
            if let Some((info, _)) = self.acquire(wait)? {
                if info.LastPresentTime != 0 {
                    frames.push(Frame {
                        present_time: info.LastPresentTime,
                        accumulated_frames: info.AccumulatedFrames,
                    });
                }
            }
        }
    }

    /// Takes the first frame after duplication starts, which always holds the whole desktop.
    fn take_first_frame(&mut self) -> Result<()> {
        self.acquire(1000)?
            .ok_or("The screen capture didn't deliver a first frame within a second.")?;
        self.catch_up()
    }

    /// Copies the held frame and any newer ones into the desktop copy, until no frame is waiting.
    fn catch_up(&mut self) -> Result<()> {
        loop {
            if let Some((info, frame)) = self.held.clone() {
                if info.LastPresentTime != 0 || self.desktop.is_none() {
                    self.copy_desktop(&frame)?;
                }
            }
            if self.acquire(0)?.is_none() {
                return Ok(());
            }
        }
    }

    /// Releases the held frame and acquires the next one. None means no new frame within `wait_ms`.
    fn acquire(&mut self, wait_ms: u32) -> Result<Option<(DXGI_OUTDUPL_FRAME_INFO, ID3D11Texture2D)>> {
        self.release();
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource = None;
        match unsafe { self.duplication.AcquireNextFrame(wait_ms, &mut info, &mut resource) } {
            Ok(()) => {}
            Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(None),
            Err(error) if error.code() == DXGI_ERROR_ACCESS_LOST => return Err(self.recover()),
            Err(error) => return Err(format!("Screen capture failed: {error}").into()),
        }
        let texture: ID3D11Texture2D = match resource.map(|resource| resource.cast()) {
            Some(Ok(texture)) => texture,
            _ => {
                let _ = unsafe { self.duplication.ReleaseFrame() };
                return Err("The captured frame isn't a 2D texture.".into());
            }
        };
        self.held = Some((info, texture.clone()));
        Ok(Some((info, texture)))
    }

    fn release(&mut self) {
        if self.held.take().is_some() {
            let _ = unsafe { self.duplication.ReleaseFrame() };
        }
    }

    /// Starts a new duplication after the old one was lost, for example on a desktop switch or a
    /// display change. The sample being measured is lost, so this returns the error to report.
    fn recover(&mut self) -> super::Error {
        self.held = None;
        self.baseline.clear();
        match unsafe { self.output.DuplicateOutput(&self.device) } {
            Ok(duplication) => {
                self.duplication = duplication;
                "The screen capture was interrupted by a desktop switch or display change.".into()
            }
            Err(error) => format!("The screen capture was lost and couldn't restart: {error}").into(),
        }
    }

    fn copy_desktop(&mut self, frame: &ID3D11Texture2D) -> Result<()> {
        if self.desktop.is_none() {
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { frame.GetDesc(&mut desc) };
            if desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM && desc.Format != DXGI_FORMAT_R8G8B8A8_UNORM {
                return Err(format!("The desktop uses pixel format {:?}, not 8-bit BGRA.", desc.Format).into());
            }
            self.format = desc.Format;
            let copy = texture_desc(desc.Width, desc.Height, desc.Format, false);
            self.desktop = Some(create_texture(&self.device, &copy)?);
        }
        if let Some(desktop) = &self.desktop {
            unsafe { self.context.CopyResource(desktop, frame) };
        }
        Ok(())
    }

    /// Copies the region out of `source` and returns its pixels, 4 bytes each, row after row.
    fn read_region(&mut self, source: &ID3D11Texture2D) -> Result<Vec<u8>> {
        let local = self
            .region
            .relative_to(self.monitor)
            .ok_or_else(|| format!("{:?} isn't inside the captured monitor.", self.region))?;
        let staging = self.staging_texture(local.width, local.height)?;
        let area = D3D11_BOX {
            left: local.x as u32,
            top: local.y as u32,
            front: 0,
            right: local.x as u32 + local.width,
            bottom: local.y as u32 + local.height,
            back: 1,
        };
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            self.context
                .CopySubresourceRegion(&staging, 0, 0, 0, 0, source, 0, Some(&area));
            self.context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
        }
        let row_bytes = local.width as usize * BYTES_PER_PIXEL;
        let pitch = mapped.RowPitch as usize;
        let length = pitch * (local.height as usize - 1) + row_bytes;
        // Safety: a mapped texture of this size holds at least `length` bytes until Unmap.
        let bytes = unsafe { std::slice::from_raw_parts(mapped.pData as *const u8, length) };
        let pixels = pack_rows(bytes, pitch, row_bytes, local.height as usize);
        unsafe { self.context.Unmap(&staging, 0) };
        Ok(pixels)
    }

    fn staging_texture(&mut self, width: u32, height: u32) -> Result<ID3D11Texture2D> {
        if let Some((texture, w, h)) = &self.staging {
            if (*w, *h) == (width, height) {
                return Ok(texture.clone());
            }
        }
        let texture = create_texture(&self.device, &texture_desc(width, height, self.format, true))?;
        self.staging = Some((texture.clone(), width, height));
        Ok(texture)
    }
}

impl Drop for ChangeWatcher {
    fn drop(&mut self) {
        self.release();
    }
}

/// How long to wait for the next frame, in milliseconds (at most `MAX_WAIT_MS`), or None once
/// `deadline` has passed.
fn wait_until(deadline: Instant) -> Option<u32> {
    let left = deadline.saturating_duration_since(Instant::now());
    let milliseconds = u32::try_from(left.as_millis()).unwrap_or(MAX_WAIT_MS);
    (!left.is_zero()).then_some(milliseconds.clamp(1, MAX_WAIT_MS))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stops_waiting_at_the_deadline() {
        assert_eq!(wait_until(Instant::now()), None);
        let soon = wait_until(Instant::now() + Duration::from_millis(40)).unwrap();
        assert!((30..=40).contains(&soon), "{soon} ms");
        assert_eq!(wait_until(Instant::now() + Duration::from_secs(5)), Some(MAX_WAIT_MS));
    }
}
