use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, ProcessesToUpdate, RefreshKind, System};
use tauri::State;

const GB: f64 = 1024.0 * 1024.0 * 1024.0;
const MB: f64 = 1024.0 * 1024.0;

/// Сколько процессов показываем в карточке.
const TOP_PROCESSES: usize = 4;

/// Диски меньше гигабайта — это служебные разделы и пустые картоводы, их не показываем.
const MIN_DISK_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    /// Буква диска, например "C:"
    pub name: String,
    pub used_gb: f64,
    pub total_gb: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub name: String,
    pub memory_mb: f64,
    /// Сколько процессов с таким именем слиплось в одну строку (у Chrome их десятки).
    pub count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub host: String,
    pub cpu_name: String,
    pub cpu_usage: f32,
    pub cores: usize,
    pub mem_used_gb: f64,
    pub mem_total_gb: f64,
    pub uptime_hours: u64,
    pub disks: Vec<DiskInfo>,
    pub top_procs: Vec<ProcInfo>,
}

/// Живёт всё время работы приложения: sysinfo считает загрузку процессора
/// как разницу между двумя соседними опросами, поэтому состояние нельзя терять.
pub struct Monitor {
    sys: Mutex<System>,
    disks: Mutex<Disks>,
}

impl Monitor {
    pub fn new() -> Self {
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_cpu_usage().with_frequency())
                .with_memory(MemoryRefreshKind::nothing().with_ram()),
        );
        // первый опрос задаёт точку отсчёта для процессора
        sys.refresh_cpu_usage();
        sys.refresh_memory();

        Self {
            sys: Mutex::new(sys),
            disks: Mutex::new(Disks::new_with_refreshed_list()),
        }
    }
}

impl Default for Monitor {
    fn default() -> Self {
        Self::new()
    }
}

/// Складывает процессы с одинаковым именем в одну строку и отдаёт самые прожорливые.
fn top_processes(sys: &System) -> Vec<ProcInfo> {
    let mut by_name: HashMap<String, (f64, usize)> = HashMap::new();

    for process in sys.processes().values() {
        let name = process.name().to_string_lossy().to_string();
        if name.is_empty() {
            continue;
        }
        let entry = by_name.entry(name).or_insert((0.0, 0));
        entry.0 += process.memory() as f64 / MB;
        entry.1 += 1;
    }

    let mut list: Vec<ProcInfo> = by_name
        .into_iter()
        .map(|(name, (memory_mb, count))| ProcInfo {
            name: name.trim_end_matches(".exe").to_string(),
            memory_mb,
            count,
        })
        .collect();

    list.sort_by(|a, b| b.memory_mb.total_cmp(&a.memory_mb));
    list.truncate(TOP_PROCESSES);
    list
}

/// Производители пишут в модель процессора много мусора.
/// В карточке шириной 400 пикселей нужен только сам номер модели:
/// "AMD FX-4330 Quad-Core Processor" -> "FX-4330".
fn clean_cpu_name(raw: &str) -> String {
    let compact = raw.replace("(R)", "").replace("(TM)", "").replace("(tm)", "");
    // частота после "@" ничего не говорит о реальной скорости
    let without_freq = compact.split('@').next().unwrap_or(&compact).to_string();

    without_freq
        .split_whitespace()
        .filter(|word| {
            !matches!(
                *word,
                "AMD"
                    | "Intel"
                    | "CPU"
                    | "Processor"
                    | "Core"
                    | "Dual-Core"
                    | "Quad-Core"
                    | "Six-Core"
                    | "Eight-Core"
                    | "with"
                    | "Graphics"
                    | "Radeon"
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn collect_disks(disks: &Disks) -> Vec<DiskInfo> {
    let mut list: Vec<DiskInfo> = disks
        .list()
        .iter()
        .filter(|disk| disk.total_space() >= MIN_DISK_BYTES)
        .map(|disk| {
            let total = disk.total_space() as f64;
            let free = disk.available_space() as f64;
            DiskInfo {
                // "C:\" -> "C:"
                name: disk
                    .mount_point()
                    .to_string_lossy()
                    .trim_end_matches(['\\', '/'])
                    .to_string(),
                used_gb: (total - free) / GB,
                total_gb: total / GB,
            }
        })
        .collect();

    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}

#[tauri::command]
pub fn get_system_stats(state: State<'_, Monitor>) -> Result<SystemStats, String> {
    let mut sys = state.sys.lock().map_err(|e| e.to_string())?;
    let mut disks = state.disks.lock().map_err(|e| e.to_string())?;

    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    disks.refresh(true);

    let cpu_name = sys
        .cpus()
        .first()
        .map(|cpu| clean_cpu_name(cpu.brand()))
        .unwrap_or_default();

    Ok(SystemStats {
        host: System::host_name().unwrap_or_else(|| "этот ПК".to_string()),
        cpu_name,
        cpu_usage: sys.global_cpu_usage(),
        cores: sys.cpus().len(),
        mem_used_gb: sys.used_memory() as f64 / GB,
        mem_total_gb: sys.total_memory() as f64 / GB,
        uptime_hours: System::uptime() / 3600,
        disks: collect_disks(&disks),
        top_procs: top_processes(&sys),
    })
}
