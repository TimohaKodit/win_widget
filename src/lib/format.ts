/** Форматирование чисел для карточек. */

export function round(value: number, digits = 0): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Мегабайты в читаемую строку: до 1024 — МБ, дальше — ГБ. */
export function memory(mb: number): string {
  return mb >= 1024 ? `${round(mb / 1024, 1)} ГБ` : `${round(mb)} МБ`;
}

/** Часы в "8 дн" или "28 ч". */
export function uptime(hours: number): string {
  if (hours >= 48) return `${round(hours / 24)} дн`;
  return `${round(hours)} ч`;
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

/**
 * Цвет заполнения по степени загрузки.
 * Оттенки различаются и по светлоте, не только по тону.
 */
export function loadColor(pct: number): string {
  if (pct >= 90) return "var(--red)";
  if (pct >= 75) return "var(--amber)";
  return "var(--violet)";
}
