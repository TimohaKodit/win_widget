import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bar } from "../components/Bar";
import { percent, round } from "../lib/format";
import {
  levelColor,
  levelWord,
  selectedItems,
  size,
  type CleanResult,
  type DiskReport,
} from "../lib/diskTypes";
import "./disk-card.css";

interface Props {
  report: DiskReport | null;
  error: string | null;
  /**
   * Пересчёт отчёта после очистки. Проп необязательный только чтобы карточку
   * можно было показать без хука; в приложении его передавать нужно, иначе
   * цифры останутся старыми.
   */
  refresh?: () => void | Promise<void>;
}

/** «Содержимое 1 папки», но «содержимое 2 папок» — родительный падеж. */
function folders(count: number): string {
  const single = count % 10 === 1 && count % 100 !== 11;
  return `${count} ${single ? "папки" : "папок"}`;
}

export function DiskCard({ report, error, refresh }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [cleanError, setCleanError] = useState<string | null>(null);

  if (error) {
    return (
      <section className="card">
        <span className="muted">Не удалось осмотреть диск: {error}</span>
      </section>
    );
  }

  if (!report) {
    return (
      <section className="card">
        <span className="muted">Считаю, чем занят диск…</span>
      </section>
    );
  }

  const chosen = selectedItems(report, selected);
  const chosenGb = chosen.reduce((sum, item) => sum + item.sizeGb, 0);
  const usedGb = report.systemTotalGb - report.systemFreeGb;
  const usedPct = percent(usedGb, report.systemTotalGb);
  const color = levelColor(report.level);

  const toggle = (id: string, on: boolean) => {
    setResult(null);
    setCleanError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const clean = async () => {
    setCleaning(true);
    setCleanError(null);
    try {
      // наружу уходят только id из зашитого в Rust списка, никаких путей
      const done = await invoke<CleanResult>("clean_targets", {
        ids: chosen.map((item) => item.id),
      });
      setResult(done);
      setSelected(new Set());
      await refresh?.();
    } catch (err) {
      setCleanError(String(err));
    } finally {
      setCleaning(false);
      setConfirming(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <span className={`card-mark disk-mark disk-mark-${report.level}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 13h18" />
            <path d="M7 16.5h4" />
          </svg>
        </span>
        <span className="card-title">Место на диске</span>
        <span className="grow" />
        <span className={`dot disk-dot-${report.level}`} />
        <span className="card-sub">{levelWord(report.level)}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Пересчитать занятое место"
          onClick={() => void refresh?.()}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 6.3" />
            <path d="M20 4v7h-7" />
          </svg>
        </button>
      </div>

      <div className="disk-free">
        <span className="disk-free-value mono" style={{ color }}>
          {round(report.systemFreeGb, 1)}
        </span>
        <span className="disk-free-label">
          ГБ свободно из {round(report.systemTotalGb)}
        </span>
      </div>

      <Bar
        label="Занято"
        value={round(usedGb)}
        total={`${round(report.systemTotalGb)} ГБ`}
        percent={usedPct}
        color={color}
      />

      <div className="disk-list">
        {report.cleanables.map((item) => {
          const inputId = `disk-${item.id}`;
          const empty = !item.exists || item.sizeGb < 0.001;
          return (
            <div key={item.id} className="disk-row">
              <input
                type="checkbox"
                id={inputId}
                className="disk-check"
                checked={selected.has(item.id)}
                disabled={empty || cleaning}
                onChange={(e) => toggle(item.id, e.target.checked)}
              />
              <label htmlFor={inputId} className="disk-row-label" title={item.path}>
                {item.label}
              </label>
              <span className="disk-row-size mono">
                {item.exists ? size(item.sizeGb) : "нет"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="card-meta">
        всего можно освободить <span className="mono strong">{size(report.totalCleanableGb)}</span>
      </div>

      {confirming ? (
        <div className="disk-confirm" role="group" aria-label="Подтверждение очистки">
          <span className="disk-confirm-text">
            Будет удалено содержимое {folders(chosen.length)}. Продолжить?
          </span>
          <div className="disk-actions">
            <button
              type="button"
              className="disk-btn disk-btn-ghost"
              disabled={cleaning}
              onClick={() => setConfirming(false)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="disk-btn disk-btn-danger"
              disabled={cleaning}
              onClick={() => void clean()}
            >
              {cleaning ? "Удаляю…" : "Удалить"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="disk-btn disk-btn-main"
          disabled={chosen.length === 0 || cleaning}
          onClick={() => setConfirming(true)}
        >
          Освободить {size(chosenGb)}
        </button>
      )}

      {result && (
        <div className="card-meta">
          Освобождено <span className="mono strong">{size(result.freedGb)}</span> ·{" "}
          удалено <span className="mono strong">{result.removed}</span>
          {result.failed > 0 && (
            <span>
              {" · "}
              занято другими программами:{" "}
              <span className="mono strong">{result.failed}</span>
            </span>
          )}
        </div>
      )}

      {cleanError && <span className="muted">Очистка не удалась: {cleanError}</span>}
    </section>
  );
}
