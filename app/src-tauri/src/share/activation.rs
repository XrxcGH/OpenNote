//! Reads a "Share to OpenNote" launch from Windows. Only an exe with package identity (the sparse package in
//! packaging/msix) can be a share target, so an exe without one returns at once. The share operation is reported
//! complete as soon as its data is read, so the share sheet closes even if the app then takes a moment to start.

use windows::{
    core::{Interface, HSTRING},
    ApplicationModel::{
        Activation::{ActivationKind, ShareTargetActivatedEventArgs},
        AppInstance,
        DataTransfer::{DataPackageView, StandardDataFormats},
    },
    Storage::{FileIO, StorageFile, Streams::DataReader},
    Win32::{Foundation::APPMODEL_ERROR_NO_PACKAGE, Storage::Packaging::Appx::GetCurrentPackageFullName},
};

use super::{Shared, SharedFile, MAX_FILE, MAX_FILES};

/// Whether this process runs with package identity.
fn has_identity() -> bool {
    let mut length = 0u32;
    // SAFETY: asks only for the length; a null buffer with length 0 is the documented way to do that.
    let result = unsafe { GetCurrentPackageFullName(&mut length, None) };
    result != APPMODEL_ERROR_NO_PACKAGE
}

/// What was shared, when this launch is a share. None for any other launch.
pub fn read() -> Option<Shared> {
    if !has_identity() {
        return None;
    }
    let args = AppInstance::GetActivatedEventArgs().ok()?;
    if args.Kind().ok()? != ActivationKind::ShareTarget {
        return None;
    }
    let share: ShareTargetActivatedEventArgs = args.cast().ok()?;
    let operation = share.ShareOperation().ok()?;
    let shared = operation.Data().ok().map(|data| read_data(&data)).unwrap_or_default();
    if let Err(error) = operation.ReportCompleted() {
        log::warn!("Couldn't tell Windows the share was received: {error}");
    }
    Some(shared)
}

fn has(data: &DataPackageView, format: windows::core::Result<HSTRING>) -> bool {
    format.and_then(|format| data.Contains(&format)).unwrap_or(false)
}

fn read_data(data: &DataPackageView) -> Shared {
    let mut shared = Shared::default();
    if has(data, StandardDataFormats::Text()) {
        shared.text = data
            .GetTextAsync()
            .and_then(|task| task.join())
            .ok()
            .map(|text| text.to_string());
    }
    if has(data, StandardDataFormats::WebLink()) {
        shared.uri = data
            .GetWebLinkAsync()
            .and_then(|task| task.join())
            .and_then(|uri| uri.AbsoluteUri())
            .ok()
            .map(|uri| uri.to_string());
    }
    if has(data, StandardDataFormats::Bitmap()) {
        match read_bitmap(data) {
            Ok(Some(file)) => shared.files.push(file),
            Ok(None) => shared.skipped.push("Shared picture".to_owned()),
            Err(error) => log::warn!("Couldn't read a shared picture: {error}"),
        }
    }
    if has(data, StandardDataFormats::StorageItems()) {
        if let Ok(items) = data.GetStorageItemsAsync().and_then(|task| task.join()) {
            for item in items {
                let Ok(file) = item.cast::<StorageFile>() else {
                    // A folder: only files are added.
                    if let Ok(name) = item.Name() {
                        shared.skipped.push(name.to_string());
                    }
                    continue;
                };
                let name = file.Name().map(|name| name.to_string()).unwrap_or_default();
                if shared.files.len() == MAX_FILES {
                    shared.skipped.push(name);
                    continue;
                }
                match read_file(&file) {
                    Ok(Some(bytes)) => shared.files.push(SharedFile {
                        mime: file.ContentType().map(|mime| mime.to_string()).unwrap_or_default(),
                        name,
                        bytes,
                    }),
                    Ok(None) => shared.skipped.push(name),
                    Err(error) => log::warn!("Couldn't read a shared file: {error}"),
                }
            }
        }
    }
    shared
}

/// The picture, or None when it is larger than a file may be.
fn read_bitmap(data: &DataPackageView) -> windows::core::Result<Option<SharedFile>> {
    let reference = data.GetBitmapAsync()?.join()?;
    let stream = reference.OpenReadAsync()?.join()?;
    let size = stream.Size()?;
    if size > MAX_FILE {
        return Ok(None);
    }
    let mime = stream.ContentType().map(|mime| mime.to_string()).unwrap_or_default();
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    let length = u32::try_from(size).unwrap_or(u32::MAX);
    reader.LoadAsync(length)?.join()?;
    let mut bytes = vec![0u8; length as usize];
    reader.ReadBytes(&mut bytes)?;
    let extension = match mime.as_str() {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        _ => "png",
    };
    Ok(Some(SharedFile {
        name: format!("Shared picture.{extension}"),
        mime,
        bytes,
    }))
}

/// The file's bytes, or None when it is larger than a file may be.
fn read_file(file: &StorageFile) -> windows::core::Result<Option<Vec<u8>>> {
    let size = file.GetBasicPropertiesAsync()?.join()?.Size()?;
    if size > MAX_FILE {
        return Ok(None);
    }
    let buffer = FileIO::ReadBufferAsync(file)?.join()?;
    let reader = DataReader::FromBuffer(&buffer)?;
    let mut bytes = vec![0u8; buffer.Length()? as usize];
    reader.ReadBytes(&mut bytes)?;
    Ok(Some(bytes))
}
