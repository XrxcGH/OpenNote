//! Finding the monitor to capture, and creating the Direct3D 11 objects that read it.

use windows::core::Interface;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_MODE_ROTATION_IDENTITY, DXGI_MODE_ROTATION_UNSPECIFIED, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1};

use super::geometry::Bounds;
use super::Region;
use crate::common::Result;

/// Finds the adapter and output (monitor) whose desktop rectangle contains the region's center.
/// Duplication must use a device on the adapter that drives the monitor, which matters on laptops
/// with two graphics processors.
pub(super) fn find_output(region: Region) -> Result<(IDXGIAdapter1, IDXGIOutput1, Bounds)> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let (x, y) = region.center();
    let mut index = 0;
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(index) } {
        index += 1;
        let mut output_index = 0;
        while let Ok(output) = unsafe { adapter.EnumOutputs(output_index) } {
            output_index += 1;
            let desc = unsafe { output.GetDesc()? };
            let bounds = Bounds::from(desc.DesktopCoordinates);
            if !bounds.contains(x, y) {
                continue;
            }
            if desc.Rotation != DXGI_MODE_ROTATION_IDENTITY && desc.Rotation != DXGI_MODE_ROTATION_UNSPECIFIED {
                return Err("The monitor is rotated. Measure in landscape without rotation.".into());
            }
            return Ok((adapter, output.cast()?, bounds));
        }
    }
    Err(format!("No monitor contains the point ({x}, {y}).").into())
}

pub(super) fn create_device(adapter: &IDXGIAdapter1) -> Result<(ID3D11Device, ID3D11DeviceContext)> {
    let (mut device, mut context) = (None, None);
    unsafe {
        D3D11CreateDevice(
            adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    match (device, context) {
        (Some(device), Some(context)) => Ok((device, context)),
        _ => Err("Direct3D 11 returned no device.".into()),
    }
}

/// A texture description: CPU-readable staging when `staging`, otherwise a plain GPU copy.
pub(super) fn texture_desc(width: u32, height: u32, format: DXGI_FORMAT, staging: bool) -> D3D11_TEXTURE2D_DESC {
    D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: format,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: if staging {
            D3D11_USAGE_STAGING
        } else {
            D3D11_USAGE_DEFAULT
        },
        BindFlags: 0,
        CPUAccessFlags: if staging { D3D11_CPU_ACCESS_READ.0 as u32 } else { 0 },
        MiscFlags: 0,
    }
}

pub(super) fn create_texture(device: &ID3D11Device, desc: &D3D11_TEXTURE2D_DESC) -> Result<ID3D11Texture2D> {
    let mut texture = None;
    unsafe { device.CreateTexture2D(desc, None, Some(&mut texture))? };
    texture.ok_or_else(|| "Direct3D 11 returned no texture.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;

    #[test]
    fn describes_textures() {
        let staging = texture_desc(24, 24, DXGI_FORMAT_B8G8R8A8_UNORM, true);
        assert_eq!((staging.Usage, staging.CPUAccessFlags), (D3D11_USAGE_STAGING, 0x20000));
        let copy = texture_desc(2400, 1600, DXGI_FORMAT_B8G8R8A8_UNORM, false);
        assert_eq!(
            (copy.Usage, copy.CPUAccessFlags, copy.Width),
            (D3D11_USAGE_DEFAULT, 0, 2400)
        );
    }
}
