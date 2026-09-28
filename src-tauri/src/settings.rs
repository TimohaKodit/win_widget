//! Настройки приложения: один JSON-файл в папке конфигурации.
//!
//! Путь даёт сам Tauri (`app_config_dir()`), руками `%APPDATA%` не собираем —
//! иначе при смене идентификатора приложения или на другой машине путь разойдётся.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

/// Имя файла внутри папки конфигурации приложения.
const FILE: &str = "settings.json";

/// Пользовательские настройки.
///
/// `#[serde(default)]` на всей структуре — обязателен: файл, записанный старой
/// версией приложения, не содержит новых полей, и чтение не должно падать.
/// Неизвестные поля serde тоже молча пропускает, поэтому файл от более новой
/// версии читается без ошибки (лишние поля при следующей записи пропадут).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Порог 5-часового окна в токенах, заданный вручную.
    /// `None` — калибровать автоматически по отказам в логах.
    pub window_budget: Option<u64>,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("не найдена папка настроек: {e}"))?;
    Ok(dir.join(FILE))
}

/// Читает настройки, никогда не падая: нет файла, нет прав, битый JSON —
/// всё это значит «настроек нет», то есть значения по умолчанию.
/// Нужна и командам, и `claude.rs`, поэтому не `#[tauri::command]`.
pub fn load(app: &tauri::AppHandle) -> Settings {
    let path = match settings_path(app) {
        Ok(path) => path,
        Err(_) => return Settings::default(),
    };
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Settings::default(),
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    Ok(load(&app))
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    // при первом запуске папки ещё нет
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("не создать {}: {e}", dir.display()))?;
    }

    let body = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("не собрать настройки: {e}"))?;
    std::fs::write(&path, body).map_err(|e| format!("не записать {}: {e}", path.display()))?;
    Ok(())
}
