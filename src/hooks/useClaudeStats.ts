import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClaudeStats } from "../lib/claudeTypes";

/** Логи Claude Code меняются медленно, чаще опрашивать нет смысла. */
const POLL_MS = 30_000;

export function useClaudeStats() {
  const [stats, setStats] = useState<ClaudeStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);

  /** Разовый запрос: наружу отдаётся как `refresh`, внутри вызывается по таймеру. */
  const refresh = useCallback(async () => {
    // разбор всех .jsonl может занять секунды — не накладываем вызовы
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await invoke<ClaudeStats>("get_claude_stats");
      if (!alive.current) return;
      setStats(next);
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
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  return { stats, error, refresh };
}
