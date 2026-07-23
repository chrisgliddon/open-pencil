use serde::Deserialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle};

#[cfg(target_os = "macos")]
use tauri::menu::PredefinedMenuItem;

#[derive(Deserialize)]
struct MenuGroup {
    label: String,
    items: Vec<MenuEntry>,
}

#[derive(Deserialize, Clone)]
struct MenuEntry {
    #[serde(default)]
    r#type: Option<String>,
    id: Option<String>,
    label: Option<String>,
    accelerator: Option<String>,
    #[serde(default)]
    sub: Vec<MenuEntry>,
}

#[derive(Deserialize, Clone)]
pub struct RecentFile {
    path: String,
    name: String,
}

fn build_submenu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
    items: &[MenuEntry],
) -> tauri::Result<Submenu<R>> {
    let mut builder = SubmenuBuilder::new(app, label);

    for entry in items {
        if entry.r#type.as_deref() == Some("separator") {
            builder = builder.separator();
            continue;
        }

        let label = entry.label.as_deref().unwrap_or_default();
        // `open-recent` is always a submenu, even when empty: the frontend
        // rebuilds it with the persisted recent files right after launch, and
        // an empty leaf would flash momentarily and emit a no-op event.
        if !entry.sub.is_empty() || entry.id.as_deref() == Some("open-recent") {
            let submenu = build_submenu(app, label, &entry.sub)?;
            builder = builder.item(&submenu);
            continue;
        }

        let mut item = MenuItemBuilder::new(label);
        if let Some(id) = &entry.id {
            item = item.id(id);
        }
        if let Some(accelerator) = &entry.accelerator {
            item = item.accelerator(accelerator);
        }
        builder = builder.item(&item.build(app)?);
    }

    builder.build()
}

// Build the "Open Recent" submenu entries from the persisted recent-files
// list. Each entry emits a `menu-event` with id `recent:<path>` so the
// frontend can re-open that path. Trailing separator + a "Clear Recently
// Opened" item (`clear-recent-files`) lets the user reset the list.
fn recent_submenu_items(recents: &[RecentFile]) -> Vec<MenuEntry> {
    let mut items: Vec<MenuEntry> = recents
        .iter()
        .map(|file| MenuEntry {
            r#type: None,
            id: Some(format!("recent:{}", file.path)),
            label: Some(file.name.clone()),
            accelerator: None,
            sub: Vec::new(),
        })
        .collect();

    if !recents.is_empty() {
        items.push(MenuEntry {
            r#type: Some("separator".to_string()),
            id: None,
            label: None,
            accelerator: None,
            sub: Vec::new(),
        });
        items.push(MenuEntry {
            r#type: None,
            id: Some("clear-recent-files".to_string()),
            label: Some("Clear Recently Opened".to_string()),
            accelerator: None,
            sub: Vec::new(),
        });
    } else {
        // Disabled-looking placeholder so the submenu isn't empty/confusing.
        items.push(MenuEntry {
            r#type: None,
            id: Some("open-recent-empty".to_string()),
            label: Some("No Recent Files".to_string()),
            accelerator: None,
            sub: Vec::new(),
        });
    }

    items
}

// Inject the recents into the File group's `open-recent` submenu, then build
// every group. The static `menu.json` carries the rest of the menu structure.
fn build_schema_menus_with_recents<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    recents: Option<&[RecentFile]>,
) -> tauri::Result<Vec<Submenu<R>>> {
    let mut groups: Vec<MenuGroup> = serde_json::from_str(include_str!("../generated/menu.json"))?;
    if let Some(recents) = recents {
        let recent_items = recent_submenu_items(recents);
        for group in groups.iter_mut() {
            for entry in group.items.iter_mut() {
                if entry.id.as_deref() == Some("open-recent") {
                    entry.sub = recent_items.clone();
                }
            }
        }
    }
    groups
        .iter()
        .map(|group| build_submenu(app, &group.label, &group.items))
        .collect()
}

fn install_menu_from_handle<R: tauri::Runtime>(app: &AppHandle<R>, recents: Option<&[RecentFile]>) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, "OpenPencil")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About OpenPencil"),
            None,
        )?)
        .item(
            &MenuItemBuilder::new("Check for Updates…")
                .id("check-updates")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let mut builder = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        builder = builder.item(&app_menu);
    }

    for menu in &build_schema_menus_with_recents(app, recents)? {
        builder = builder.item(menu);
    }

    app.set_menu(builder.build()?)?;
    Ok(())
}

pub fn install_app_menu<R: tauri::Runtime>(app: &mut tauri::App<R>) -> tauri::Result<()> {
    install_menu_from_handle(&app.handle().clone(), None)
}

/// Rebuild the app menu with an updated "Open Recent" submenu. Invoked from
/// the frontend whenever the persisted recent-files list changes.
#[tauri::command]
pub fn rebuild_recent_files_menu(
    app: AppHandle,
    recents: Vec<RecentFile>,
) -> tauri::Result<()> {
    install_menu_from_handle(&app, Some(&recents))
}
