import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SystemStats } from "../lib/types";

const POLL_MS = 2000;
/** Точек в спарклайне: 40 опросов — примерно последние 80 секунд. */
const HISTORY_LEN = 40;

export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      // на слабой машине опрос может не успеть за 2 секунды — не накладываем вызовы
      if (busy.current) return;
      busy.current = true;
      try {
        const next = await invoke<SystemStats>("get_system_stats");
        if (!alive) return;
        setStats(next);
        setError(null);
        setHistory((prev) => [...prev, next.cpuUsage].slice(-HISTORY_LEN));
      } catch (err) {
        if (alive) setError(String(err));
      } finally {
        busy.current = false;
      }
    };

    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return { stats, error, history };
}
