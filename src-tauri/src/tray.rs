//! Оболочка виджета: иконка в области уведомлений, автозапуск при входе
//! в Windows и глобальная горячая клавиша показать/скрыть.
//!
//! Всё, что нужно от `lib.rs`, — три подключения плагинов, вызов [`setup`]
//! в `.setup(...)` и [`on_window_event`] в `.on_window_event(...)`.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::plugin::TauriPlugin;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, Runtime, Window, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Метка главного окна — та же, что в `tauri.conf.json`.
const MAIN_WINDOW: &str = "main";

/// Аргумент, который плагин автозапуска дописывает в команду запуска.
/// По его наличию отличаем старт вместе с Windows от запуска руками.
pub const AUTOSTART_ARG: &str = "--autostart";

/// Идентификаторы пунктов меню трея.
const ID_SHOW: &str = "show";
const ID_AUTOSTART: &str = "autostart";
const ID_QUIT: &str = "quit";

/// Иконка трея вшита в бинарник на этапе компиляции: путь считается от
/// `Cargo.toml`, а не от рабочей папки, поэтому не зависит от места запуска.
const TRAY_ICON: tauri::image::Image<'_> = tauri::include_image!("icons/icon.ico");

/// Плагин автозапуска. На Windows пишет значение в
/// `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
/// Сам автозапуск здесь НЕ включается — только даётся возможность его включить.
pub fn autostart_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![AUTOSTART_ARG]))
}

/// Плагин горячих клавиш. Само сочетание регистрируется в [`setup`],
/// чтобы занятую другой программой клавишу можно было пережить без падения.
pub fn global_shortcut_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new().build()
}

/// Приложение подняли вместе с Windows, а не руками?
pub fn started_by_autostart() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_ARG)
}

/// Показать окно и отдать ему фокус.
fn show_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Спрятать окно в трей. Приложение продолжает работать.
fn hide_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
}

/// Видимое окно прячем, спрятанное показываем.
fn toggle_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show_window(app);
    }
}

/// Текущее состояние записи в автозапуске. Ошибку считаем за «выключено»:
/// в меню лучше показать снятую галочку, чем уронить приложение.
fn autostart_enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    match app.autolaunch().is_enabled() {
        Ok(enabled) => enabled,
        Err(error) => {
            eprintln!("не удалось прочитать состояние автозапуска: {error}");
            false
        }
    }
}

/// Переключает запись в автозапуске и возвращает состояние, которое
/// получилось на самом деле — по нему выставляется галочка в меню.
fn toggle_autostart<R: Runtime>(app: &AppHandle<R>) -> bool {
    let manager = app.autolaunch();
    let was_enabled = autostart_enabled(app);

    let result = if was_enabled {
        manager.disable()
    } else {
        manager.enable()
    };

    if let Err(error) = result {
        eprintln!("не удалось переключить автозапуск: {error}");
        // запись осталась в прежнем состоянии
        return was_enabled;
    }

    !was_enabled
}

/// Обработчик события окна для `tauri::Builder::on_window_event`.
/// Попытка закрыть окно прячет его в трей: выйти можно только пунктом «Выход».
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == MAIN_WINDOW {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

/// Регистрирует `Ctrl+Shift+D`. Если сочетание занято другой программой,
/// регистрация провалится — это не повод не запускаться.
fn register_shortcut<R: Runtime>(app: &AppHandle<R>) {
    let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyD);

    let result = app.global_shortcut().on_shortcut(toggle, |app, _shortcut, event| {
        // без проверки состояния виджет дёрнется дважды: на нажатие и на отпускание
        if event.state() == ShortcutState::Pressed {
            toggle_window(app);
        }
    });

    if let Err(error) = result {
        eprintln!("горячая клавиша Ctrl+Shift+D недоступна (занята другой программой?): {error}");
    }
}

/// Точка входа: иконка в трее, меню, горячая клавиша и решение,
/// показывать ли окно на старте.
pub fn setup<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let handle = app.handle().clone();

    let show_item = MenuItem::with_id(app, ID_SHOW, "Показать", true, None::<&str>)?;
    let autostart_item = CheckMenuItem::with_id(
        app,
        ID_AUTOSTART,
        "Автозапуск",
        true,
        autostart_enabled(&handle),
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, ID_QUIT, "Выход", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&show_item, &autostart_item, &separator, &quit_item],
    )?;

    // клон нужен, чтобы обработчик меню мог поправить галочку после переключения
    let autostart_checkbox = autostart_item.clone();

    TrayIconBuilder::with_id("tray")
        .icon(TRAY_ICON)
        .tooltip("Custom")
        .menu(&menu)
        // меню — только на правую кнопку, левая переключает окно
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            ID_SHOW => show_window(app),
            ID_AUTOSTART => {
                let enabled = toggle_autostart(app);
                // галочку ставим по факту, а не по нажатию: запись могла не примениться
                if let Err(error) = autostart_checkbox.set_checked(enabled) {
                    eprintln!("не удалось обновить галочку автозапуска: {error}");
                }
            }
            ID_QUIT => app.exit(0),
            other => eprintln!("неизвестный пункт меню трея: {other}"),
        })
        .on_tray_icon_event(|tray, event| {
            // реагируем на отпускание: так себя ведут остальные значки в трее
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    register_shortcut(&handle);

    // При автозапуске окно не показываем: машина слабая, виджет ждёт в трее,
    // пока пользователь сам его не вызовет. В остальных случаях окно
    // создано скрытым (`"visible": false` в tauri.conf.json) и поднимается тут.
    if started_by_autostart() {
        hide_window(&handle);
    } else {
        show_window(&handle);
    }

    Ok(())
}
