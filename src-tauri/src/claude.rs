use chrono::{DateTime, Days, Duration as Span, Local, NaiveDate, SecondsFormat, TimeZone, Utc};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Длина окна лимита Claude Code.
const WINDOW_HOURS: i64 = 5;
/// Сколько дней показываем в графике (включая сегодня).
const DAYS: u64 = 7;
/// Сколько проектов попадает в топ.
const TOP_PROJECTS: usize = 5;
/// Файл считается «живым», если менялся за это время.
const ACTIVE_SECS: u64 = 5 * 60;

/// Порог окна, когда о тарифе не известно ничего: ни отказов в логах, ни
/// ручной настройки. Взят по порядку величины, а не наугад: в расход входят
/// `cache_read_input_tokens`, а их в диалоге Claude Code в десятки раз больше,
/// чем собственно новых токенов, поэтому реальные окна measured-порога
/// получаются на десятках миллионов. 30 млн — примерно половина того, что
/// измеряется на этой машине: заниженный порог заставит полосу предупредить
/// раньше времени, а это безопаснее ложного спокойствия. Карточка всё равно
/// пишет «порог не измерен», так что число видно как ориентир, а не как факт.
const DEFAULT_BUDGET: u64 = 30_000_000;

/// Значения поля `budget_source`.
const SOURCE_MEASURED: &str = "measured";
const SOURCE_MANUAL: &str = "manual";
const SOURCE_DEFAULT: &str = "default";

/// Поля usage, которые складываются в расход одной записи.
const USAGE_FIELDS: [&str; 4] = [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTokens {
    /// Локальная дата в формате YYYY-MM-DD.
    pub date: String,
    pub tokens: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedTokens {
    pub name: String,
    pub tokens: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStats {
    /// Расход за текущее 5-часовое окно.
    pub window_tokens: u64,
    /// Когда окно сбросится, ISO 8601. None — в окне нет записей.
    pub window_reset_at: Option<String>,
    pub today_tokens: u64,
    pub week_tokens: u64,
    pub total_tokens: u64,
    /// Ответы ассистента после дедупликации.
    pub messages: u64,
    /// Число файлов .jsonl.
    pub sessions: u64,
    /// Ровно 7 элементов: последние 7 дней, дни без активности с нулём.
    pub by_day: Vec<DayTokens>,
    pub by_project: Vec<NamedTokens>,
    pub by_model: Vec<NamedTokens>,
    /// Время последнего отказа 429 по 5-часовому лимиту.
    pub last_limit_hit: Option<String>,
    /// Проекты, чей лог менялся за последние 5 минут.
    pub active_projects: Vec<String>,
    /// Действующий порог 5-часового окна в токенах.
    pub window_budget: u64,
    /// Откуда взялся порог: "measured", "manual" или "default".
    pub budget_source: String,
    /// Сколько отказов участвовало в измерении порога (0 — измерения нет).
    pub budget_samples: u32,
}

/// Один файл лога вместе с проектом, к которому он относится.
struct LogFile {
    project: String,
    path: PathBuf,
}

/// Накопитель: заполняется по мере чтения строк всех файлов.
struct Agg {
    /// Пара (message.id, requestId) — одна запись повторяется в логе многократно.
    seen: HashSet<(String, String)>,
    total: u64,
    today: u64,
    window: u64,
    messages: u64,
    by_day: HashMap<NaiveDate, u64>,
    by_project: HashMap<String, u64>,
    by_model: HashMap<String, u64>,
    /// Самая ранняя учтённая запись внутри текущего окна.
    window_earliest: Option<DateTime<Utc>>,
    /// Время последнего отказа 429 и его resetsAt (unix-секунды), если он был.
    last_limit: Option<(DateTime<Utc>, Option<i64>)>,
    /// Время каждой учтённой записи и её расход — материал для калибровки:
    /// сколько токенов ушло за любые пять часов, считается уже после прохода.
    spend: Vec<(DateTime<Utc>, u64)>,
    /// Отказы по 5-часовому лимиту за всю историю, ключ — та же пара
    /// (message.id, requestId): строка отказа в логе тоже дублируется.
    refusals: HashMap<(String, String), DateTime<Utc>>,
}

impl Agg {
    fn new() -> Self {
        Self {
            seen: HashSet::new(),
            total: 0,
            today: 0,
            window: 0,
            messages: 0,
            by_day: HashMap::new(),
            by_project: HashMap::new(),
            by_model: HashMap::new(),
            window_earliest: None,
            last_limit: None,
            spend: Vec::new(),
            refusals: HashMap::new(),
        }
    }
}

/// Границы времени считаем один раз на весь проход.
struct Bounds {
    /// Начало 5-часового окна.
    window_start: DateTime<Utc>,
    /// Локальная дата «сегодня».
    today: NaiveDate,
    /// Самый ранний день графика.
    week_start: NaiveDate,
}

fn projects_dir() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .map_err(|_| "не найдена переменная USERPROFILE".to_string())?;
    Ok(Path::new(&home).join(".claude").join("projects"))
}

/// `f--doc3` → `doc3`, `C--Users-yaros` → `Users-yaros`: отбрасываем префикс буквы диска.
fn pretty_project(folder: &str) -> String {
    let first_is_letter = folder
        .chars()
        .next()
        .map(|c| c.is_ascii_alphabetic())
        .unwrap_or(false);

    if first_is_letter {
        if let Some(tail) = folder.get(1..).and_then(|rest| rest.strip_prefix("--")) {
            if !tail.is_empty() {
                return tail.to_string();
            }
        }
    }
    folder.to_string()
}

/// Логи лежат и в корне папки проекта, и во вложенных подпапках (сессии субагентов).
fn collect_jsonl(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        // папку не прочитать — молча пропускаем, команда не должна падать
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => collect_jsonl(&path, out),
            Ok(kind) if kind.is_file() => {
                if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
                    out.push(path);
                }
            }
            _ => {}
        }
    }
}

fn collect_logs(dir: &Path) -> Vec<LogFile> {
    let mut logs = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return logs,
    };

    for entry in entries.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let project = pretty_project(&entry.file_name().to_string_lossy());

        let mut paths = Vec::new();
        collect_jsonl(&entry.path(), &mut paths);
        for path in paths {
            logs.push(LogFile {
                project: project.clone(),
                path,
            });
        }
    }

    logs
}

/// Менялся ли файл за последние `ACTIVE_SECS` секунд.
fn changed_recently(path: &Path) -> bool {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .map(|age| age <= Duration::from_secs(ACTIVE_SECS))
        .unwrap_or(false)
}

fn parse_timestamp(record: &Value) -> Option<DateTime<Utc>> {
    let raw = record.get("timestamp")?.as_str()?;
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Любое поле usage может отсутствовать — считаем его нулём.
fn usage_tokens(message: &Value) -> u64 {
    let usage = match message.get("usage") {
        Some(usage) => usage,
        None => return 0,
    };

    USAGE_FIELDS
        .iter()
        .filter_map(|field| usage.get(*field).and_then(Value::as_u64))
        .sum()
}

fn to_iso(moment: DateTime<Utc>) -> String {
    moment.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Запись о 5-часовом лимите. Запоминаем самую свежую (её `resetsAt` точнее
/// расчётного времени сброса) и отдельно — все отказы, по которым калибруется
/// порог. Такие записи приходят с `model: "<synthetic>"` и нулевым usage,
/// поэтому в расход они не попадают.
fn note_limit_hit(agg: &mut Agg, record: &Value) {
    let quota = match record.get("quotaLimits") {
        Some(quota) => quota,
        None => return,
    };
    if quota.get("rateLimitType").and_then(Value::as_str) != Some("five_hour") {
        return;
    }
    let moment = match parse_timestamp(record) {
        Some(moment) => moment,
        None => return,
    };

    let fresher = agg
        .last_limit
        .as_ref()
        .map(|(known, _)| moment > *known)
        .unwrap_or(true);

    if fresher {
        agg.last_limit = Some((moment, quota.get("resetsAt").and_then(Value::as_i64)));
    }

    // калибруем только по настоящим отказам: запись со status != "rejected"
    // говорит, что запрос прошёл, и моментом исчерпания лимита не является
    if quota.get("status").and_then(Value::as_str) != Some("rejected") {
        return;
    }
    let id = record
        .get("message")
        .and_then(|message| message.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let request_id = record
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    // без идентификаторов дедуплицировать нечем — разделяем такие отказы по времени
    let key = if id.is_empty() && request_id.is_empty() {
        (moment.to_rfc3339(), String::new())
    } else {
        (id, request_id)
    };
    agg.refusals.entry(key).or_insert(moment);
}

/// Одна строка лога. Возвращает расход, если запись учтена.
fn take_record(agg: &mut Agg, bounds: &Bounds, project: &str, line: &str) {
    let record: Value = match serde_json::from_str(line) {
        Ok(record) => record,
        // битые строки в логе встречаются, молча пропускаем
        Err(_) => return,
    };

    note_limit_hit(agg, &record);

    if record.get("type").and_then(Value::as_str) != Some("assistant") {
        return;
    }
    let message = match record.get("message") {
        Some(message) => message,
        None => return,
    };

    let model = message.get("model").and_then(Value::as_str).unwrap_or("");
    // служебные записи вида «лимит исчерпан» — не расход
    if model == "<synthetic>" {
        return;
    }

    // без message.id дедуплицировать нечем
    let id = match message.get("id").and_then(Value::as_str) {
        Some(id) => id.to_string(),
        None => return,
    };
    let request_id = record
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if !agg.seen.insert((id, request_id)) {
        return;
    }

    let tokens = usage_tokens(message);
    agg.messages += 1;
    agg.total += tokens;
    *agg.by_project.entry(project.to_string()).or_insert(0) += tokens;
    if !model.is_empty() {
        *agg.by_model.entry(model.to_string()).or_insert(0) += tokens;
    }

    let moment = match parse_timestamp(&record) {
        Some(moment) => moment,
        // без времени запись попадает только в общий итог
        None => return,
    };

    agg.spend.push((moment, tokens));

    if moment >= bounds.window_start {
        agg.window += tokens;
        let earlier = agg
            .window_earliest
            .map(|known| moment < known)
            .unwrap_or(true);
        if earlier {
            agg.window_earliest = Some(moment);
        }
    }

    // группировка по дням — по локальному времени машины
    let date = moment.with_timezone(&Local).date_naive();
    if date == bounds.today {
        agg.today += tokens;
    }
    if date >= bounds.week_start && date <= bounds.today {
        *agg.by_day.entry(date).or_insert(0) += tokens;
    }
}

fn read_file(agg: &mut Agg, bounds: &Bounds, log: &LogFile) {
    let file = match File::open(&log.path) {
        Ok(file) => file,
        // файл не читается (занят, удалён) — пропускаем целиком
        Err(_) => return,
    };

    // логи весят десятки мегабайт, поэтому строго построчно
    for line in BufReader::new(file).lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
        take_record(agg, bounds, &log.project, &line);
    }
}

/// Раскладывает карту по дням в ровно 7 элементов, от старого к новому.
fn week_series(agg: &Agg, bounds: &Bounds) -> Vec<DayTokens> {
    let mut series = Vec::with_capacity(DAYS as usize);

    for back in (0..DAYS).rev() {
        let date = match bounds.today.checked_sub_days(Days::new(back)) {
            Some(date) => date,
            None => continue,
        };
        series.push(DayTokens {
            date: date.format("%Y-%m-%d").to_string(),
            tokens: agg.by_day.get(&date).copied().unwrap_or(0),
        });
    }

    series
}

/// Карта «имя → токены» в список по убыванию; при равенстве — по имени.
fn ranked(map: &HashMap<String, u64>, limit: Option<usize>) -> Vec<NamedTokens> {
    let mut list: Vec<NamedTokens> = map
        .iter()
        .map(|(name, tokens)| NamedTokens {
            name: name.clone(),
            tokens: *tokens,
        })
        .collect();

    list.sort_by(|a, b| b.tokens.cmp(&a.tokens).then_with(|| a.name.cmp(&b.name)));
    if let Some(limit) = limit {
        list.truncate(limit);
    }
    list
}

/// Время сброса окна: расчётное (первая запись окна + 5 часов),
/// но если в логе есть свежий `resetsAt` из будущего — он точнее.
fn window_reset(agg: &Agg, now: DateTime<Utc>) -> Option<String> {
    if let Some((_, Some(resets_at))) = agg.last_limit {
        if let Some(moment) = Utc.timestamp_opt(resets_at, 0).single() {
            if moment > now {
                return Some(to_iso(moment));
            }
        }
    }

    agg.window_earliest
        .and_then(|first| first.checked_add_signed(Span::hours(WINDOW_HOURS)))
        .map(to_iso)
}

/// Измеряет порог окна по отказам.
///
/// Момент отказа — это момент, когда лимит был исчерпан ровно, значит расход за
/// пять часов перед отказом и есть размер окна. Из наблюдений берём **максимум**,
/// а не среднее: часть запросов могла не попасть в лог (обрыв, битая строка,
/// удалённая сессия), от чего наблюдение только уменьшается, поэтому большее
/// число ближе к правде.
///
/// Возвращает `None`, если отказов нет или расход вокруг них не записался.
fn measure_budget(agg: &mut Agg) -> Option<(u64, u32)> {
    if agg.refusals.is_empty() {
        return None;
    }

    agg.spend.sort_by_key(|(moment, _)| *moment);
    // префиксные суммы: расход за любой интервал — разность двух чисел
    let mut prefix: Vec<u64> = Vec::with_capacity(agg.spend.len() + 1);
    prefix.push(0);
    for (_, tokens) in &agg.spend {
        prefix.push(prefix.last().copied().unwrap_or(0) + tokens);
    }

    let mut best = 0;
    let mut samples = 0;

    for hit in agg.refusals.values() {
        let start = match hit.checked_sub_signed(Span::hours(WINDOW_HOURS)) {
            Some(start) => start,
            None => continue,
        };
        // spend отсортирован, поэтому границы окна ищем делением пополам
        let from = agg.spend.partition_point(|(moment, _)| *moment < start);
        let till = agg.spend.partition_point(|(moment, _)| moment <= hit);
        let used = prefix[till] - prefix[from];

        samples += 1;
        if used > best {
            best = used;
        }
    }

    if best == 0 {
        return None;
    }
    Some((best, samples))
}

/// Действующий порог: ручная настройка важнее измерения, измерение — умолчания.
fn pick_budget(manual: Option<u64>, measured: Option<(u64, u32)>) -> (u64, &'static str) {
    // ноль в настройках означает «не задано», иначе полоса делилась бы на ноль
    match (manual.filter(|value| *value > 0), measured) {
        (Some(value), _) => (value, SOURCE_MANUAL),
        (None, Some((value, _))) => (value, SOURCE_MEASURED),
        (None, None) => (DEFAULT_BUDGET, SOURCE_DEFAULT),
    }
}

#[tauri::command]
pub fn get_claude_stats(app: tauri::AppHandle) -> Result<ClaudeStats, String> {
    let dir = projects_dir()?;
    let logs = collect_logs(&dir);

    let now = Utc::now();
    let today = Local::now().date_naive();
    let bounds = Bounds {
        window_start: now - Span::hours(WINDOW_HOURS),
        today,
        week_start: today
            .checked_sub_days(Days::new(DAYS - 1))
            .unwrap_or(today),
    };

    let mut agg = Agg::new();
    let mut active: Vec<String> = Vec::new();

    for log in &logs {
        if changed_recently(&log.path) && !active.contains(&log.project) {
            active.push(log.project.clone());
        }
        read_file(&mut agg, &bounds, log);
    }
    active.sort();

    let by_day = week_series(&agg, &bounds);
    let week_tokens = by_day.iter().map(|day| day.tokens).sum();

    let measured = measure_budget(&mut agg);
    // настройки читаются без ошибки: нет файла — считаем, что порог не задан
    let manual = crate::settings::load(&app).window_budget;
    let (window_budget, budget_source) = pick_budget(manual, measured);

    Ok(ClaudeStats {
        window_tokens: agg.window,
        window_reset_at: window_reset(&agg, now),
        today_tokens: agg.today,
        week_tokens,
        total_tokens: agg.total,
        messages: agg.messages,
        sessions: logs.len() as u64,
        by_day,
        by_project: ranked(&agg.by_project, Some(TOP_PROJECTS)),
        by_model: ranked(&agg.by_model, None),
        last_limit_hit: agg.last_limit.map(|(moment, _)| to_iso(moment)),
        active_projects: active,
        window_budget,
        budget_source: budget_source.to_string(),
        // сколько отказов удалось измерить — даже если порог сейчас взят из настроек
        budget_samples: measured.map(|(_, samples)| samples).unwrap_or(0),
    })
}
