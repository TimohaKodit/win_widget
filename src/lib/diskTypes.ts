/** Зеркало структур команд `get_disk_report` и `clean_targets` из src-tauri. */

import { memory } from "./format";

/** Насколько всё плохо с местом: считает Rust, фронтенд только раскрашивает. */
export type DiskLevel = "ok" | "warn" | "critical";

export interface Cleanable {
  /** Устойчивый ключ, он же то единственное, что уходит в `clean_targets` */
  id: string;
  label: string;
  path: string;
  sizeGb: number;
  /** false — папки нет (или не задана переменная среды), очищать нечего */
  exists: boolean;
}

export interface DiskReport {
  systemFreeGb: number;
  systemTotalGb: number;
  level: DiskLevel;
  cleanables: Cleanable[];
  totalCleanableGb: number;
}

export interface CleanResult {
  freedGb: number;
  removed: number;
  failed: number;
}

/** Гигабайты в читаемую строку: мелкие папки показываем в МБ. */
export function size(gb: number): string {
  return memory(gb * 1024);
}

/** Статус словами для шапки карточки. */
export function levelWord(level: DiskLevel): string {
  if (level === "critical") return "место кончается";
  if (level === "warn") return "мало места";
  return "в норме";
}

/** Цвет метки и полосы под уровень тревоги. */
export function levelColor(level: DiskLevel): string {
  if (level === "critical") return "var(--red)";
  if (level === "warn") return "var(--amber)";
  return "var(--violet)";
}

/** Сколько папок из выбранных реально будут очищены. */
export function selectedItems(report: DiskReport, ids: Set<string>): Cleanable[] {
  return report.cleanables.filter((item) => item.exists && ids.has(item.id));
}
