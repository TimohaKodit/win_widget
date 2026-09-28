import { useCallback, useEffect, useRef, useState } from "react";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import type { PhysicalSize } from "@tauri-apps/api/dpi";
import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * Два вида виджета. Экран 1920×1080, и вниз места меньше всего, поэтому
 * подробный вид растёт в ширину, а не в высоту: карточки становятся в два
 * столбца. Компактный — основной: одна строка плиток, чтобы виджет почти
 * всё время занимал полоску сверху экрана.
 */
export type WidgetMode = "compact" | "full";

const MODE_KEY = "winapp_lab.widgetMode";
const SIZE_KEY = "winapp_lab.widgetSize";

/**
 * Размеры окна под каждый вид — теперь только значения по умолчанию, то есть
 * то, что пользователь увидит, пока сам не растянул окно за край. Высота
 * полного вида — 700: три развёрнутые карточки в два столбца дают около 600px,
 * а больше брать нельзя, экран 1080 и окну нужен воздух.
 */
export const MODE_SIZE: Record<WidgetMode, { width: number; height: number }> = {
  compact: { width: 400, height: 190 },
  full: { width: 860, height: 700 },
};

/**
 * Тот же минимум, что стоит в `minWidth`/`minHeight` в `tauri.conf.json`.
 * Ниже него виджет не растягивается системой — значит и сохранять такие
 * размеры незачем: восстановленное значение обрезаем здесь же.
 */
const MIN_WIDTH = 360;
const MIN_HEIGHT = 170;

/** Пауза перед записью размера: при перетаскивании события идут потоком. */
const SAVE_DELAY = 400;

/**
 * Разница, которую считаем «тем же размером». Логический размер получается
 * делением физического на дробный масштаб экрана, поэтому туда-обратно
 * значение может уехать на пиксель.
 */
const SIZE_EPS = 2;

interface Size {
  width: number;
  height: number;
}

type SizeStore = Partial<Record<WidgetMode, Size>>;

/**
 * localStorage может быть недоступен (изолированное окружение, запрет на
 * хранилище в WebView) — обращения к нему не должны ронять виджет.
 */
function readStoredMode(): WidgetMode | null {
  try {
    const saved = window.localStorage.getItem(MODE_KEY);
    return saved === "compact" || saved === "full" ? saved : null;
  } catch {
    return null;
  }
}

function writeStoredMode(mode: WidgetMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // не страшно: вид просто не запомнится до следующего запуска
  }
}

/** Размер из хранилища доверия не заслуживает: его мог испортить кто угодно. */
function validSize(value: unknown): Size | null {
  if (typeof value !== "object" || value === null) return null;
  const { width, height } = value as Partial<Size>;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    width: Math.max(MIN_WIDTH, Math.round(width as number)),
    height: Math.max(MIN_HEIGHT, Math.round(height as number)),
  };
}

function readSizes(): SizeStore {
  try {
    const raw = window.localStorage.getItem(SIZE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const store: SizeStore = {};
    for (const mode of ["compact", "full"] as const) {
      const size = validSize((parsed as Record<string, unknown>)[mode]);
      if (size) store[mode] = size;
    }
    return store;
  } catch {
    return {};
  }
}

function readSize(mode: WidgetMode): Size | null {
  return readSizes()[mode] ?? null;
}

function sameSize(a: Size, b: Size): boolean {
  return Math.abs(a.width - b.width) <= SIZE_EPS && Math.abs(a.height - b.height) <= SIZE_EPS;
}

/**
 * Запоминает размер текущего вида.
 *
 * Размер, равный значению по умолчанию, не записывается, пока для вида ничего
 * не сохранено: иначе первое же применение размера (и вызванное им событие
 * `onResized`) выглядело бы как «пользователь настроил окно» и навсегда
 * отключило бы центрирование.
 */
function saveSize(mode: WidgetMode, size: Size): void {
  const store = readSizes();
  if (!store[mode] && sameSize(size, MODE_SIZE[mode])) return;
  const known = store[mode];
  if (known && sameSize(size, known)) return;

  store[mode] = size;
  try {
    window.localStorage.setItem(SIZE_KEY, JSON.stringify(store));
  } catch {
    // не страшно: размер просто не переживёт перезапуск
  }
}

/**
 * Ставит окну размер вида.
 *
 * Центрируем только тогда, когда размер берётся по умолчанию: если
 * пользователь уже настраивал вид, он же, скорее всего, и поставил окно туда,
 * где ему удобно, — двигать его при каждом переключении грубо.
 */
async function applySize(mode: WidgetMode): Promise<void> {
  const saved = readSize(mode);
  const { width, height } = saved ?? MODE_SIZE[mode];
  try {
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(width, height));
    if (!saved) await win.center();
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
  const [mode, setMode] = useState<WidgetMode>(() => readStoredMode() ?? "compact");

  // подписка на изменение размера живёт дольше одной перерисовки, а вид к
  // моменту срабатывания мог смениться — читаем его через ref
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // и при старте (восстановленный вид), и при каждом переключении
  useEffect(() => {
    void applySize(mode);
  }, [mode]);

  // Ручной размер запоминается отдельно для каждого вида. События при
  // перетаскивании края идут потоком, поэтому пишем не на каждое, а спустя
  // паузу после последнего.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    let timer: number | undefined;
    let latest: PhysicalSize | null = null;

    const flush = () => {
      timer = undefined;
      const size = latest;
      latest = null;
      if (!size) return;

      void (async () => {
        try {
          // окно сообщает размер в физических пикселях, а ставится он
          // логическими — без пересчёта на мониторе со 125% всё разъедется
          const factor = await getCurrentWindow().scaleFactor();
          const logical = size.toLogical(factor);
          if (disposed) return;
          saveSize(modeRef.current, {
            width: Math.round(logical.width),
            height: Math.round(logical.height),
          });
        } catch {
          // не страшно: размер просто не запомнится
        }
      })();
    };

    void getCurrentWindow()
      .onResized(({ payload }) => {
        latest = payload;
        if (timer !== undefined) window.clearTimeout(timer);
        timer = window.setTimeout(flush, SAVE_DELAY);
      })
      .then((stop) => {
        // размонтирование могло случиться, пока подписка оформлялась
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
      })
      .catch(() => {
        // вне Tauri подписаться не на что — виджет работает и так
      });

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      unlisten?.();
    };
  }, []);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next: WidgetMode = prev === "compact" ? "full" : "compact";
      writeStoredMode(next);
      return next;
    });
  }, []);

  return { mode, compact: mode === "compact", toggle };
}
