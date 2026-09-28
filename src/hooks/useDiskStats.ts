import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DiskReport } from "../lib/diskTypes";

/**
 * Обход `%TEMP%` и кешей npm/cargo — это десятки тысяч файлов и секунды работы
 * диска. Место не убегает за минуту, поэтому опрос редкий; после очистки
 * карточка дёргает `refresh` сама.
 */
const POLL_MS = 5 * 60_000;

export function useDiskStats() {
  const [report, setReport] = useState<DiskReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    // обход дорогой — второй вызов поверх первого только загрузит диск
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await invoke<DiskReport>("get_disk_report");
      if (!alive.current) return;
      setReport(next);
      setError(null);
    } catch (err) {
      if (alive.current) setError(String(err));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, POLL_MS);

    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  return { report, error, refresh };
}
