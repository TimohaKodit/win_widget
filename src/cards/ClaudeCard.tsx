import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bar } from "../components/Bar";
import { percent } from "../lib/format";
import {
  budgetNote,
  clock,
  shortDate,
  todayKey,
  tokens,
  weekday,
  type ClaudeStats,
  type Settings,
} from "../lib/claudeTypes";
import "./claude-card.css";

/** С этой доли окна карточка предупреждает «скоро лимит». */
const WARN_SHARE = 0.8;

interface Props {
  stats: ClaudeStats | null;
  error: string | null;
  /**
   * Перезапрос статистики после смены порога. Проп необязательный только чтобы
   * карточку можно было показать без хука; в приложении его передавать нужно,
   * иначе новый порог доедет до полосы лишь со следующим опросом.
   */
  refresh?: () => void | Promise<void>;
}

/** Порог в поле ввода показываем в миллионах: девять цифр руками не набрать. */
function toMillions(value: number): string {
  return (value / 1_000_000).toFixed(1);
}

export function ClaudeCard({ stats, error, refresh }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (error) {
    return (
      <section className="card">
        <span className="muted">Не удалось прочитать логи Claude Code: {error}</span>
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="card">
        <span className="muted">Читаю логи Claude Code…</span>
      </section>
    );
  }

  const share = stats.windowBudget > 0 ? stats.windowTokens / stats.windowBudget : 0;
  // percent() обрезает по 100, поэтому полоса не уезжает за край карточки
  const windowPct = percent(stats.windowTokens, stats.windowBudget);
  const over = share >= 1;
  const near = !over && share >= WARN_SHARE;
  const windowColor = over ? "var(--red)" : near ? "var(--amber)" : "var(--orange)";

  const weekPeak = Math.max(1, ...stats.byDay.map((d) => d.tokens));
  const projectPeak = Math.max(1, ...stats.byProject.map((p) => p.tokens));
  const today = todayKey();

  const openEditor = () => {
    setDraft(toMillions(stats.windowBudget));
    setSaveError(null);
    setEditing(true);
  };

  /** `null` — вернуться к автокалибровке. */
  const save = async (windowBudget: number | null) => {
    setSaving(true);
    setSaveError(null);
    try {
      const settings: Settings = { windowBudget };
      await invoke("save_settings", { settings });
      await refresh?.();
      setEditing(false);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    const millions = Number(draft.replace(",", "."));
    if (!Number.isFinite(millions) || millions <= 0) {
      setSaveError("Порог должен быть числом больше нуля");
      return;
    }
    void save(Math.round(millions * 1_000_000));
  };

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-mark claude-mark">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
          </svg>
        </span>
        <span className="card-title">Claude Code</span>
        <span className="grow" />
        {stats.windowResetAt && (
          <span className="card-sub">
            сброс <span className="mono strong">{clock(stats.windowResetAt)}</span>
          </span>
        )}
      </div>

      <div className="claude-window">
        <Bar
          label="Окно 5 ч"
          value={tokens(stats.windowTokens)}
          total={tokens(stats.windowBudget)}
          percent={windowPct}
          color={windowColor}
        />

        <div className="claude-budget">
          <span className="claude-budget-note">
            {budgetNote(stats.budgetSource, stats.budgetSamples)}
          </span>
          {(over || near) && (
            <span className={over ? "claude-budget-alarm" : "claude-budget-warn"}>
              {over ? "лимит исчерпан" : "скоро лимит"}
            </span>
          )}
          <span className="grow" />
          <button
            type="button"
            className="icon-btn claude-budget-edit"
            aria-label="Задать порог окна вручную"
            aria-expanded={editing}
            onClick={() => (editing ? setEditing(false) : openEditor())}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
              <path d="M14.5 5.5l4 4" />
            </svg>
          </button>
        </div>

        {editing && (
          <div className="claude-editor">
            <label className="claude-editor-label" htmlFor="claude-budget-input">
              Порог окна, млн токенов
            </label>
            <input
              id="claude-budget-input"
              className="claude-editor-input mono"
              type="number"
              min="0.1"
              step="0.5"
              value={draft}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="claude-editor-actions">
              <button
                type="button"
                className="claude-btn claude-btn-main"
                disabled={saving}
                onClick={submit}
              >
                {saving ? "Сохраняю…" : "Сохранить"}
              </button>
              <button
                type="button"
                className="claude-btn claude-btn-ghost"
                disabled={saving}
                onClick={() => void save(null)}
              >
                Сбросить
              </button>
            </div>
            <span className="claude-editor-hint">
              «Сбросить» вернёт автокалибровку по отказам в логах.
            </span>
            {saveError && <span className="claude-editor-error">{saveError}</span>}
          </div>
        )}
      </div>

      <div className="claude-today">
        <span className="claude-today-value mono">{tokens(stats.todayTokens)}</span>
        <span className="claude-today-label">токенов сегодня</span>
      </div>

      <div className="card-meta">
        за неделю <span className="mono strong">{tokens(stats.weekTokens)}</span> ·{" "}
        <span className="mono strong">{stats.messages}</span> сообщений ·{" "}
        <span className="mono strong">{stats.sessions}</span> сессий
      </div>

      <div className="claude-week" role="img" aria-label={`Токены за 7 дней, максимум ${tokens(weekPeak)}`}>
        {stats.byDay.map((day) => {
          const isToday = day.date === today;
          const height = day.tokens > 0 ? Math.max(6, (day.tokens / weekPeak) * 100) : 0;
          return (
            <div key={day.date} className="claude-day">
              <div className="claude-day-track">
                {/* нулевой день рисуем тонкой полоской, чтобы колонка не пропадала */}
                <div
                  className={day.tokens > 0 ? "claude-day-fill" : "claude-day-fill claude-day-zero"}
                  style={day.tokens > 0 ? { height: `${height}%` } : undefined}
                />
              </div>
              <span className={isToday ? "claude-day-name claude-day-now" : "claude-day-name"}>
                {weekday(day.date)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="claude-projects">
        {stats.byProject.map((p) => (
          <div key={p.name} className="claude-proj">
            <span className="claude-proj-name">{p.name}</span>
            <span
              className="claude-proj-track"
              role="progressbar"
              aria-label={p.name}
              aria-valuenow={Math.round(percent(p.tokens, projectPeak))}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                className="claude-proj-fill"
                style={{ width: `${percent(p.tokens, projectPeak)}%` }}
              />
            </span>
            <span className="claude-proj-value mono">{tokens(p.tokens)}</span>
          </div>
        ))}
      </div>

      {stats.byModel.length > 0 && (
        <div className="chips">
          {stats.byModel.map((m) => (
            <span key={m.name} className="chip claude-chip">
              {m.name}
              <span className="chip-value mono">{tokens(m.tokens)}</span>
            </span>
          ))}
        </div>
      )}

      {stats.activeProjects.length > 0 && (
        <div className="card-meta">
          сейчас: <span className="strong">{stats.activeProjects.join(", ")}</span>
        </div>
      )}

      {stats.lastLimitHit && (
        <div className="card-meta">
          последний лимит <span className="mono strong">{shortDate(stats.lastLimitHit)}</span>
        </div>
      )}
    </section>
  );
}
