import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Какие карточки свёрнуты. Состояние переживает перезапуск виджета, но не
 * является критичным: если `localStorage` недоступен (изолированное окружение,
 * запрет на хранилище в WebView), хук молча работает в памяти.
 */
const STORAGE_KEY = "winapp_lab.collapsedCards";

/** Разделитель для ключа зависимости: в id карточек его быть не может. */
const SEP = "\u0000";

export interface CollapsedState {
  /** Свёрнута ли карточка с этим id. */
  isCollapsed: (id: string) => boolean;
  /** Свернуть/развернуть одну карточку. */
  toggle: (id: string) => void;
  /** Свёрнуты ли все известные карточки. */
  allCollapsed: boolean;
  /** Одно нажатие сворачивает всё, следующее разворачивает всё. */
  toggleAll: () => void;
}

function readStored(known: readonly string[]): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // чужие и устаревшие id отбрасываем, иначе allCollapsed врёт
    return parsed.filter(
      (id): id is string => typeof id === "string" && known.includes(id),
    );
  } catch {
    return [];
  }
}

function writeStored(ids: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // хранилище недоступно — состояние просто не переживёт перезапуск
  }
}

/**
 * @param ids список известных карточек: по нему `toggleAll` понимает, что
 * сворачивать, и проверяется сохранённое состояние. Массив можно передавать
 * литералом — хук сравнивает содержимое, а не ссылку.
 */
export function useCollapsed(ids: readonly string[]): CollapsedState {
  const idsKey = ids.join(SEP);
  const known = useMemo(
    () => (idsKey === "" ? [] : idsKey.split(SEP)),
    [idsKey],
  );

  const [collapsed, setCollapsed] = useState<string[]>(() => readStored(ids));

  // список карточек может измениться (например, карточку убрали из App)
  useEffect(() => {
    setCollapsed((prev) => {
      const next = prev.filter((id) => known.includes(id));
      return next.length === prev.length ? prev : next;
    });
  }, [known]);

  useEffect(() => {
    writeStored(collapsed);
  }, [collapsed]);

  const isCollapsed = useCallback(
    (id: string) => collapsed.includes(id),
    [collapsed],
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const allCollapsed =
    known.length > 0 && known.every((id) => collapsed.includes(id));

  const toggleAll = useCallback(() => {
    setCollapsed((prev) => {
      const everyone = known.length > 0 && known.every((id) => prev.includes(id));
      return everyone ? [] : [...known];
    });
  }, [known]);

  return { isCollapsed, toggle, allCollapsed, toggleAll };
}
