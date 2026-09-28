import { useCallback, useEffect, useState } from "react";

/**
 * Тема оформления. Тёмная — по умолчанию, светлая — по выбору пользователя.
 * Выбор живёт в localStorage и выставляется атрибутом data-theme на <html>,
 * оттуда его подхватывают переменные в styles.css.
 */
export type Theme = "dark" | "light";

const STORAGE_KEY = "winapp_lab.theme";

/**
 * localStorage может быть недоступен (изолированное окружение, отключённое
 * хранилище) — обращения к нему не должны ронять виджет, поэтому всё в try.
 */
function readStored(): Theme | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

function writeStored(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // не страшно: тема просто не запомнится до следующего запуска
  }
}

/** Системная настройка — используется, только пока выбора нет. */
function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? systemTheme());

  // атрибут на корне документа — единственный источник правды для CSS
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // пока пользователь не выбирал сам, следим за системной темой
  useEffect(() => {
    if (readStored()) return;

    let media: MediaQueryList;
    try {
      media = window.matchMedia("(prefers-color-scheme: light)");
    } catch {
      return;
    }

    const onChange = (event: MediaQueryListEvent) => {
      // явный выбор, сделанный за время жизни окна, важнее системного
      if (!readStored()) setTheme(event.matches ? "light" : "dark");
    };

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "light" ? "dark" : "light";
      writeStored(next);
      return next;
    });
  }, []);

  return { theme, toggle };
}
