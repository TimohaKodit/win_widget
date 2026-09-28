import { useCallback, useEffect, useState } from "react";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Два вида виджета. Экран 1920×1080, и вниз места меньше всего, поэтому
 * подробный вид растёт в ширину, а не в высоту: карточки становятся в два
 * столбца. Компактный — основной: одна строка плиток, чтобы виджет почти
 * всё время занимал полоску сверху экрана.
 */
export type WidgetMode = "compact" | "full";

const STORAGE_KEY = "winapp_lab.widgetMode";

/**
 * Логические размеры окна под каждый вид. Они зависят только от вида и никогда
 * от содержимого: новые карточки прокручиваются внутри окна, а не растягивают
 * его. Высота полного вида — 700: три развёрнутые карточки в два столбца дают
 * около 600px, а больше брать нельзя, экран 1080 и окну нужен воздух.
 */
export const MODE_SIZE: Record<WidgetMode, { width: number; height: number }> = {
  compact: { width: 400, height: 190 },
  full: { width: 860, height: 700 },
};

/**
 * localStorage может быть недоступен (изолированное окружение, запрет на
 * хранилище в WebView) — обращения к нему не должны ронять виджет.
 */
function readStored(): WidgetMode | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "compact" || saved === "full" ? saved : null;
  } catch {
    return null;
  }
}

function writeStored(mode: WidgetMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // не страшно: вид просто не запомнится до следующего запуска
  }
}

/**
 * Размер окна и возврат его в центр экрана. Ширина меняется сильно, поэтому
 * без `center()` окно уезжало бы за правый край.
 */
async function applySize(mode: WidgetMode): Promise<void> {
  const { width, height } = MODE_SIZE[mode];
  try {
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(width, height));
    await win.center();
  } catch {
    // вне Tauri (или без прав на set-size) вид всё равно переключится,
    // просто окно останется прежнего размера — ронять виджет из-за этого нельзя
  }
}

export interface WidgetModeState {
  mode: WidgetMode;
  /** Сокращение для разметки: в компактном виде нет ни карточек, ни сворачивания. */
  compact: boolean;
  toggle: () => void;
}

export function useWidgetMode(): WidgetModeState {
  const [mode, setMode] = useState<WidgetMode>(() => readStored() ?? "compact");

  // и при старте (восстановленный вид), и при каждом переключении
  useEffect(() => {
    void applySize(mode);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next: WidgetMode = prev === "compact" ? "full" : "compact";
      writeStored(next);
      return next;
    });
  }, []);

  return { mode, compact: mode === "compact", toggle };
}
