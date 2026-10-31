//! The macOS menu bar (ADR 0055). The main window sends `menu.set` with one menu per command category, built from
//! the command registry (`app/src/commands/appMenu.ts`). This module wraps them in the menus a Mac app needs: the
//! app menu (About, Settings, Services, Hide, Quit), Edit with the system's Undo, Cut, Copy, Paste, and Select All
//! for text fields, and Window. A pick sends a `menu` event with the command's id, which the interface runs.
//!
//! The menu is built on every system, so its code compiles and is checked everywhere, but only macOS installs it:
//! Windows and Linux keep their own window frames without a menu bar.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder},
    AppHandle, Runtime,
};

use super::{arg, emit};
use crate::ipc::{IpcError, IpcResult};

/// Menu item ids that carry a command start with this, so the system's own items are told apart.
const COMMAND_PREFIX: &str = "command:";
/// The category whose commands join the system's Edit menu.
const EDITING: &str = "editing";
/// More items than any menu should hold; a larger spec is a mistake, not a menu.
const MAX_ITEMS: usize = 2000;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub label: String,
    pub accelerator: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub category: String,
    pub title: String,
    pub items: Vec<Item>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Spec {
    pub app_items: Vec<Item>,
    pub groups: Vec<Group>,
}

/// The menu item id for a command.
pub fn item_id(command: &str) -> String {
    format!("{COMMAND_PREFIX}{command}")
}

/// The command a menu item runs, or None for the system's own items.
pub fn command_of(item_id: &str) -> Option<&str> {
    item_id
        .strip_prefix(COMMAND_PREFIX)
        .filter(|command| is_command_id(command))
}

/// A command id has the form `group.name`, like `app.settings`.
fn is_command_id(id: &str) -> bool {
    let valid = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    id.split_once('.')
        .is_some_and(|(group, name)| valid(group) && valid(name))
}

/// Checks a spec before any of it reaches the menu.
pub fn validate(spec: &Spec) -> IpcResult<()> {
    let items = spec
        .app_items
        .iter()
        .chain(spec.groups.iter().flat_map(|group| &group.items));
    let mut count = 0;
    for item in items {
        count += 1;
        if !is_command_id(&item.id) {
            return Err(IpcError::invalid("spec", &format!("{} isn't a command id", item.id)));
        }
        if item.label.trim().is_empty() {
            return Err(IpcError::invalid("spec", &format!("{} has no label", item.id)));
        }
    }
    if count > MAX_ITEMS {
        return Err(IpcError::invalid("spec", "the menu has too many items"));
    }
    if spec.groups.iter().any(|group| group.title.trim().is_empty()) {
        return Err(IpcError::invalid("spec", "a menu has no title"));
    }
    Ok(())
}

/// One command item. A key equivalent the menu can't read leaves the item without one rather than without the item.
fn command_item<R: Runtime>(app: &AppHandle<R>, item: &Item) -> tauri::Result<MenuItem<R>> {
    let id = item_id(&item.id);
    if let Some(accelerator) = item.accelerator.as_deref() {
        if let Ok(built) = MenuItem::with_id(app, &id, &item.label, true, Some(accelerator)) {
            return Ok(built);
        }
        ::log::debug!("The menu can't show {accelerator} for {}", item.id);
    }
    MenuItem::with_id(app, &id, &item.label, true, None::<&str>)
}

fn with_items<'a, R: Runtime>(
    app: &AppHandle<R>,
    mut builder: SubmenuBuilder<'a, R, AppHandle<R>>,
    items: &[Item],
) -> tauri::Result<SubmenuBuilder<'a, R, AppHandle<R>>> {
    for item in items {
        builder = builder.item(&command_item(app, item)?);
    }
    Ok(builder)
}

/// The whole menu bar for a spec.
pub fn build<R: Runtime>(app: &AppHandle<R>, spec: &Spec) -> tauri::Result<Menu<R>> {
    let name = app.package_info().name.clone();
    let mut app_menu = SubmenuBuilder::new(app, &name).about(None).separator();
    app_menu = with_items(app, app_menu, &spec.app_items)?;
    let app_menu = app_menu
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit();

    let editing = spec.groups.iter().find(|group| group.category == EDITING);
    let edit_title = editing.map_or("Edit", |group| group.title.as_str());
    let mut edit = SubmenuBuilder::new(app, edit_title)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all();
    if let Some(group) = editing.filter(|group| !group.items.is_empty()) {
        edit = with_items(app, edit.separator(), &group.items)?;
    }

    let menu = Menu::new(app)?;
    menu.append(&app_menu.build()?)?;
    menu.append(&edit.build()?)?;
    for group in spec.groups.iter().filter(|group| group.category != EDITING) {
        let submenu = with_items(app, SubmenuBuilder::new(app, &group.title), &group.items)?;
        menu.append(&submenu.build()?)?;
    }
    let window: Submenu<R> = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;
    menu.append(&window)?;
    Ok(menu)
}

/// Sends a pick of one of the command items to the interface. The system's own items do their own work.
pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    if let Some(command) = command_of(event.id().as_ref()) {
        emit(app, "menu", json!({ "command": command }));
    }
}

/// `menu.set`: builds the menu bar from the spec, and installs it on macOS.
pub fn call(app: &AppHandle, name: &str, args: &Value) -> IpcResult<Value> {
    if name != "menu.set" {
        return Err(IpcError::invalid("name", &format!("{name} isn't a menu call")));
    }
    let spec: Spec = arg(args, "spec")?;
    validate(&spec)?;
    let menu = build(app, &spec).map_err(|error| IpcError::new("io", error.to_string()))?;
    let installed = install(app, menu)?;
    Ok(json!({ "installed": installed }))
}

#[cfg(target_os = "macos")]
fn install(app: &AppHandle, menu: Menu<tauri::Wry>) -> IpcResult<bool> {
    app.set_menu(menu)
        .map_err(|error| IpcError::new("io", error.to_string()))?;
    Ok(true)
}

#[cfg(not(target_os = "macos"))]
fn install(_app: &AppHandle, _menu: Menu<tauri::Wry>) -> IpcResult<bool> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, label: &str) -> Item {
        Item {
            id: id.to_owned(),
            label: label.to_owned(),
            accelerator: None,
        }
    }

    fn spec(items: Vec<Item>) -> Spec {
        Spec {
            app_items: vec![item("app.settings", "Settings")],
            groups: vec![Group {
                category: "view".to_owned(),
                title: "View".to_owned(),
                items,
            }],
        }
    }

    #[test]
    fn a_command_item_id_names_its_command() {
        assert_eq!(item_id("app.settings"), "command:app.settings");
        assert_eq!(command_of("command:app.settings"), Some("app.settings"));
    }

    #[test]
    fn the_systems_own_items_name_no_command() {
        assert_eq!(command_of("quit"), None);
        assert_eq!(command_of("app.settings"), None);
        assert_eq!(command_of("command:"), None);
        assert_eq!(command_of("command:no-dot"), None);
        assert_eq!(command_of("command:a.b c"), None);
    }

    #[test]
    fn reads_the_spec_the_interface_sends() {
        let args = json!({ "spec": {
            "appItems": [{ "id": "app.settings", "label": "Settings", "accelerator": "Cmd+," }],
            "groups": [{ "category": "view", "title": "View", "items": [
                { "id": "view.zoomIn", "label": "Zoom in", "accelerator": null }
            ] }]
        } });
        let spec: Spec = arg(&args, "spec").expect("the spec reads");
        assert_eq!(spec.app_items[0].accelerator.as_deref(), Some("Cmd+,"));
        assert_eq!(spec.groups[0].items[0], item("view.zoomIn", "Zoom in"));
        assert!(validate(&spec).is_ok());
    }

    #[test]
    fn refuses_an_item_that_is_not_a_command() {
        assert!(validate(&spec(vec![item("quit", "Quit")])).is_err());
        assert!(validate(&spec(vec![item("view.zoomIn", "  ")])).is_err());
    }

    #[test]
    fn refuses_a_menu_without_a_title() {
        let mut bad = spec(vec![item("view.zoomIn", "Zoom in")]);
        bad.groups[0].title = String::new();
        assert!(validate(&bad).is_err());
    }

    #[test]
    fn refuses_a_spec_larger_than_any_menu() {
        let items = (0..=MAX_ITEMS)
            .map(|n| item(&format!("view.item{n}"), "Item"))
            .collect();
        assert!(validate(&spec(items)).is_err());
    }
}
