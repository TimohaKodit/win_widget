/** Зеркало структур команды `get_claude_stats` из src-tauri. */

export interface DayTokens {
  /** YYYY-MM-DD, локальная дата */
  date: string;
  tokens: number;
}

export interface NamedTokens {
  name: string;
  tokens: number;
}

/**
 * Откуда взялся порог 5-часового окна:
 * `measured` — посчитан по отказам в логах, `manual` — задан пользователем,
 * `default` — ничего не известно, показан ориентир.
 */
export type BudgetSource = "measured" | "manual" | "default";

/** Зеркало `Settings` из src-tauri/src/settings.rs. */
export interface Settings {
  /** Ручной порог окна в токенах; null — калибровать автоматически */
  windowBudget: number | null;
}

export interface ClaudeStats {
  /** Расход в текущем 5-часовом окне */
  windowTokens: number;
  /** ISO 8601, когда окно обнулится; null — окно ещё не упиралось в лимит */
  windowResetAt: string | null;
  todayTokens: number;
  weekTokens: number;
  totalTokens: number;
  messages: number;
  sessions: number;
  /** Ровно 7 элементов: последние 7 дней, от старого к новому */
  byDay: DayTokens[];
  /** Топ-5 проектов */
  byProject: NamedTokens[];
  byModel: NamedTokens[];
  /** ISO 8601 последнего отказа по лимиту */
  lastLimitHit: string | null;
  /** Проекты, в которых сессия идёт прямо сейчас */
  activeProjects: string[];
  /** Действующий порог окна в токенах */
  windowBudget: number;
  budgetSource: BudgetSource;
  /** Сколько отказов участвовало в измерении порога */
  budgetSamples: number;
}

/** «1 отказу», «2 отказам», «5 отказам» — дательный падеж. */
export function refusals(count: number): string {
  const single = count % 10 === 1 && count % 100 !== 11;
  return `${count} ${single ? "отказу" : "отказам"}`;
}

/** Подпись под полосой окна: откуда взялся порог. */
export function budgetNote(source: BudgetSource, samples: number): string {
  if (source === "manual") return "порог задан вручную";
  if (source === "measured") return `порог измерен по ${refusals(samples)}`;
  return "порог не измерен — задайте вручную";
}

/** Токены коротко: «1.01 М», «340 К», «812». */
export function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} М`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} К`;
  return String(Math.round(value));
}

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

/** "2026-09-27" → локальная дата без сдвига часового пояса. */
function parseDay(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "2026-09-27" → "пн". */
export function weekday(date: string): string {
  const d = parseDay(date);
  return d ? WEEKDAYS[d.getDay()] : "—";
}

/** Сегодняшняя дата в том же формате, что приходит из Rust. */
export function todayKey(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/** ISO 8601 → "ЧЧ:ММ" по местному времени. */
export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** ISO 8601 → "24 сен". */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
