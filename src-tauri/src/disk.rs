use serde::Serialize;
use std::fs;
use std::os::windows::fs::FileTypeExt;
use std::path::{Path, PathBuf};
use sysinfo::Disks;

const GB: f64 = 1024.0 * 1024.0 * 1024.0;

/// Ниже этих порогов место считается кончающимся: либо доля, либо абсолютный остаток.
const CRITICAL_PCT: f64 = 5.0;
const CRITICAL_GB: f64 = 5.0;
const WARN_PCT: f64 = 15.0;
const WARN_GB: f64 = 15.0;

/// От какой системной переменной отсчитывается путь цели.
/// Пути не хранятся строкой целиком: на другой машине буква диска и имя
/// пользователя другие, а переменные среды есть всегда.
enum Root {
    /// `%TEMP%` — временная папка текущего пользователя.
    Temp,
    /// `%SystemRoot%` — обычно `C:\Windows`.
    Windows,
    /// `%LOCALAPPDATA%`
    LocalAppData,
    /// `%USERPROFILE%`
    UserProfile,
}

impl Root {
    /// Имя переменной среды и значение на случай, если её нет.
    fn var(&self) -> (&'static str, Option<&'static str>) {
        match self {
            Root::Temp => ("TEMP", None),
            // SystemRoot есть всегда, но подстраховаться дешевле, чем упасть
            Root::Windows => ("SystemRoot", Some("C:\\Windows")),
            Root::LocalAppData => ("LOCALAPPDATA", None),
            Root::UserProfile => ("USERPROFILE", None),
        }
    }

    /// Для показа в интерфейсе, когда путь не удалось раскрыть.
    fn label(&self) -> &'static str {
        match self {
            Root::Temp => "%TEMP%",
            Root::Windows => "%SystemRoot%",
            Root::LocalAppData => "%LOCALAPPDATA%",
            Root::UserProfile => "%USERPROFILE%",
        }
    }
}

/// Одна папка, содержимое которой разрешено считать и удалять.
struct Target {
    id: &'static str,
    label: &'static str,
    root: Root,
    /// Что дописать к корню; пустая строка — сам корень.
    suffix: &'static str,
}

impl Target {
    /// Абсолютный путь. None — переменная среды не задана, цель недоступна.
    fn path(&self) -> Option<PathBuf> {
        let (var, fallback) = self.root.var();
        let base = std::env::var(var)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| fallback.map(|value| value.to_string()))?;

        let mut path = PathBuf::from(base);
        if !self.suffix.is_empty() {
            path.push(self.suffix);
        }
        Some(path)
    }

    /// Путь для интерфейса, когда раскрыть его не удалось: `%LOCALAPPDATA%\npm-cache`.
    fn pattern(&self) -> String {
        if self.suffix.is_empty() {
            self.root.label().to_string()
        } else {
            format!("{}\\{}", self.root.label(), self.suffix)
        }
    }
}

/// ЕДИНСТВЕННЫЙ разрешённый список папок для очистки.
///
/// Список зашит в код намеренно. Фронтенд присылает только `id` из этого
/// списка — никогда путь. Если бы путь приходил из интерфейса, любая ошибка
/// или подмена сообщения от веб-слоя превращалась бы в рекурсивное удаление
/// произвольной папки с правами пользователя (вплоть до `C:\Users\<имя>`).
/// При такой схеме максимум, что может сделать фронтенд, — попросить очистить
/// одну из этих пяти папок, и ничего больше.
const TARGETS: &[Target] = &[
    Target {
        id: "user-temp",
        label: "Временные файлы",
        root: Root::Temp,
        suffix: "",
    },
    Target {
        id: "windows-temp",
        label: "Временные файлы Windows",
        root: Root::Windows,
        suffix: "Temp",
    },
    Target {
        id: "npm-cache",
        label: "Кеш npm",
        root: Root::LocalAppData,
        suffix: "npm-cache",
    },
    Target {
        id: "cargo-registry",
        label: "Кеш пакетов Rust",
        root: Root::UserProfile,
        suffix: ".cargo\\registry",
    },
    Target {
        id: "crash-dumps",
        label: "Дампы аварий",
        root: Root::LocalAppData,
        suffix: "CrashDumps",
    },
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanable {
    /// Устойчивый ключ: по нему фронтенд просит очистку.
    pub id: String,
    pub label: String,
    pub path: String,
    pub size_gb: f64,
    pub exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskReport {
    pub system_free_gb: f64,
    pub system_total_gb: f64,
    /// "ok" | "warn" | "critical"
    pub level: String,
    pub cleanables: Vec<Cleanable>,
    pub total_cleanable_gb: f64,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub freed_gb: f64,
    pub removed: u64,
    pub failed: u64,
}

/// Свободно и всего на системном диске, в гигабайтах.
fn system_space() -> Result<(f64, f64), String> {
    let disks = Disks::new_with_refreshed_list();
    let drive = std::env::var("SystemDrive")
        .unwrap_or_else(|_| "C:".to_string())
        .to_uppercase();

    let disk = disks
        .list()
        .iter()
        .find(|disk| {
            disk.mount_point()
                .to_string_lossy()
                .to_uppercase()
                .starts_with(&drive)
        })
        .or_else(|| disks.list().first())
        .ok_or_else(|| "не удалось определить системный диск".to_string())?;

    Ok((
        disk.available_space() as f64 / GB,
        disk.total_space() as f64 / GB,
    ))
}

/// Тревожность по остатку: доля ИЛИ абсолютный остаток — что хуже.
fn level_for(free_gb: f64, total_gb: f64) -> &'static str {
    let free_pct = if total_gb > 0.0 {
        free_gb / total_gb * 100.0
    } else {
        0.0
    };

    if free_pct < CRITICAL_PCT || free_gb < CRITICAL_GB {
        "critical"
    } else if free_pct < WARN_PCT || free_gb < WARN_GB {
        "warn"
    } else {
        "ok"
    }
}

/// Размер папки в байтах: обход своим стеком, без рекурсии — в кешах npm
/// и cargo вложенность легко уходит на десятки уровней, а стек потока
/// у Tauri не резиновый.
///
/// Всё, что не прочиталось, молча пропускается: в `%TEMP%` половина файлов
/// занята процессами, а папки исчезают прямо во время обхода — это норма,
/// а не повод вернуть ошибку.
fn dir_size(root: &Path) -> u64 {
    let mut total: u64 = 0;
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            // нет доступа или папку уже удалили
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            // symlink_metadata смотрит на саму ссылку, а не на её цель
            let meta = match fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(_) => continue,
            };

            // Символические ссылки и junction не разворачиваем: junction внутри
            // профиля пользователя легко заводит обход в бесконечный цикл,
            // да и место занимает не ссылка, а её цель.
            if meta.file_type().is_symlink() {
                continue;
            }

            if meta.is_dir() {
                stack.push(path);
            } else {
                total = total.saturating_add(meta.len());
            }
        }
    }

    total
}

/// Сколько байт осталось по пути. 0 — пути больше нет.
fn size_left(path: &Path) -> u64 {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => 0,
        Ok(meta) if meta.is_dir() => dir_size(path),
        Ok(meta) => meta.len(),
        Err(_) => 0,
    }
}

/// Осмотр: только чтение, ничего не удаляет.
///
/// Обход пяти папок занимает секунды (кеш cargo — это десятки тысяч файлов),
/// поэтому фронтенд вызывает команду редко: раз в несколько минут или по кнопке.
#[tauri::command]
pub fn get_disk_report() -> Result<DiskReport, String> {
    let (free_gb, total_gb) = system_space()?;

    let cleanables: Vec<Cleanable> = TARGETS
        .iter()
        .map(|target| match target.path() {
            Some(path) => {
                let exists = path.is_dir();
                let size_gb = if exists {
                    dir_size(&path) as f64 / GB
                } else {
                    0.0
                };
                Cleanable {
                    id: target.id.to_string(),
                    label: target.label.to_string(),
                    path: path.to_string_lossy().to_string(),
                    size_gb,
                    exists,
                }
            }
            // переменной среды нет — показываем цель, но помечаем как отсутствующую
            None => Cleanable {
                id: target.id.to_string(),
                label: target.label.to_string(),
                path: target.pattern(),
                size_gb: 0.0,
                exists: false,
            },
        })
        .collect();

    let total_cleanable_gb = cleanables.iter().map(|item| item.size_gb).sum();

    Ok(DiskReport {
        system_free_gb: free_gb,
        system_total_gb: total_gb,
        level: level_for(free_gb, total_gb).to_string(),
        cleanables,
        total_cleanable_gb,
    })
}

/// Очистка: удаляет СОДЕРЖИМОЕ папок из `TARGETS`, сами папки остаются.
///
/// Почему список путей зашит в `TARGETS`, а не приходит с фронтенда:
/// команда удаляет папки целиком и рекурсивно, то есть это самая опасная
/// операция во всём приложении. Веб-слой — не доверенная сторона: в него
/// грузится HTML и JS, и любая ошибка в интерфейсе (или подставленный путь)
/// означала бы безвозвратное удаление чужих данных с правами пользователя.
/// Поэтому снаружи принимаются только `id` — метки уже проверенных папок,
/// а множество удаляемых мест целиком определяется этим файлом.
///
/// Неизвестный `id` — ошибка, и тогда не удаляется вообще ничего: лучше
/// ничего не сделать, чем сделать половину непонятного запроса.
#[tauri::command]
pub fn clean_targets(ids: Vec<String>) -> Result<CleanResult, String> {
    // сперва сверяем все id и только потом что-то трогаем
    let mut targets: Vec<&Target> = Vec::with_capacity(ids.len());
    for id in &ids {
        let target = TARGETS
            .iter()
            .find(|target| target.id == id.as_str())
            .ok_or_else(|| format!("неизвестная цель очистки: {id}"))?;
        targets.push(target);
    }

    let mut freed: u64 = 0;
    let mut removed: u64 = 0;
    let mut failed: u64 = 0;

    for target in targets {
        let Some(dir) = target.path() else { continue };

        // Канонический путь самой цели: дальше всё сверяется с ним.
        // Если папки нет — очищать нечего, создавать её мы не должны.
        let Ok(root) = fs::canonicalize(&dir) else {
            continue;
        };
        if !root.is_dir() {
            continue;
        }

        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();

            let Ok(meta) = fs::symlink_metadata(&path) else {
                failed += 1;
                continue;
            };
            let file_type = meta.file_type();
            let is_link = file_type.is_symlink();

            if is_link {
                // У ссылки canonicalize ушла бы к её цели — проверять надо место
                // самой ссылки: её родитель обязан быть очищаемой папкой.
                let inside = path
                    .parent()
                    .and_then(|parent| fs::canonicalize(parent).ok())
                    .is_some_and(|parent| parent == root);
                if !inside {
                    failed += 1;
                    continue;
                }
            } else {
                // Защита от подмены: настоящий путь элемента обязан лежать
                // внутри цели. Если кто-то подсунул сюда junction на другой
                // диск, canonicalize это покажет.
                let inside = fs::canonicalize(&path).is_ok_and(|real| real.starts_with(&root));
                if !inside {
                    failed += 1;
                    continue;
                }
            }

            let size = if is_link {
                // место занимает цель ссылки, а не ссылка
                0
            } else if meta.is_dir() {
                dir_size(&path)
            } else {
                meta.len()
            };

            let outcome = if is_link {
                // ссылку удаляем как ссылку, внутрь не заходим
                if file_type.is_symlink_dir() {
                    fs::remove_dir(&path)
                } else {
                    fs::remove_file(&path)
                }
            } else if meta.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };

            match outcome {
                Ok(()) => {
                    freed = freed.saturating_add(size);
                    removed += 1;
                }
                // Занятые процессами файлы удалить нельзя — это ожидаемо.
                // Из папки при этом могла уйти часть содержимого, поэтому
                // в освобождённое пишем только реальную разницу.
                Err(_) => {
                    failed += 1;
                    freed = freed.saturating_add(size.saturating_sub(size_left(&path)));
                }
            }
        }
    }

    Ok(CleanResult {
        freed_gb: freed as f64 / GB,
        removed,
        failed,
    })
}
