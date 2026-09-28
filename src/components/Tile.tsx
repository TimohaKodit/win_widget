import "./compact.css";

/** Насколько всё тревожно: те же три уровня, что у полос в карточках. */
export type TileLevel = "ok" | "warn" | "alarm" | "none";

interface Props {
  /** Короткая подпись, например «Процессор». */
  label: string;
  /** Крупное число без единиц: «47», «12», «—». */
  value: string;
  /** Единица рядом с числом мелким кеглем: «%», «ГБ». */
  unit?: string;
  /** Состояние словами: «в норме», «скоро лимит». Дублирует цвет текстом. */
  state: string;
  /** Заполнение индикатора, 0–100. */
  percent: number;
  level: TileLevel;
  /** Полная расшифровка плитки: уходит в aria-label и во всплывающую подсказку. */
  hint: string;
}

const LEVEL_CLASS: Record<TileLevel, string> = {
  ok: "tile is-ok",
  warn: "tile is-warn",
  alarm: "tile is-alarm",
  none: "tile is-none",
};

/**
 * Плитка компактного вида: крупное число, подпись, состояние словами и тонкая
 * полоса внизу. Ничего не считает — уровень и подписи выбирает вызывающий.
 */
export function Tile({ label, value, unit, state, percent, level, hint }: Props) {
  const width = Math.min(100, Math.max(0, percent));

  return (
    <div className={LEVEL_CLASS[level]} role="group" aria-label={hint} title={hint}>
      <div className="tile-value mono">
        {value}
        {unit && <span className="tile-unit">{unit}</span>}
      </div>
      <div className="tile-label">{label}</div>
      <div className="tile-state">{state}</div>
      {/* полоса только дублирует число, поэтому для чтения вслух она лишняя */}
      <div className="tile-track" aria-hidden="true">
        <div className="tile-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
