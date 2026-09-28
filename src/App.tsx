import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ClaudeCard } from "./cards/ClaudeCard";
import { DiskCard } from "./cards/DiskCard";
import { PcCard } from "./cards/PcCard";
import { CardShell } from "./components/CardShell";
import { CollapseAllButton } from "./components/CollapseAllButton";
import { CompactBar } from "./components/CompactBar";
import { ResizeHandles } from "./components/ResizeHandles";
import { ThemeToggle } from "./components/ThemeToggle";
import { useClaudeStats } from "./hooks/useClaudeStats";
import { useCollapsed } from "./hooks/useCollapsed";
import { useDiskStats } from "./hooks/useDiskStats";
import { useSystemStats } from "./hooks/useSystemStats";
import { useWidgetMode } from "./hooks/useWidgetMode";
import "./components/layout.css";

const CARD_IDS = ["pc", "claude", "disk"];

/*
 * Сколько столбцов карточек помещается в окно.
 *
 * Карточки свёрстаны под внутреннюю ширину 344px (спарклайн в «Этом ПК» на
 * ней зафиксирован), а рамка карточки добавляет 14px отступа и 1px границы с
 * каждой стороны — значит столбец уже 374px обрезал бы график. Поэтому окно
 * растягивается не в ширину столбцов, а в их количество: один столбец в узком
 * окне, два в обычном, три в широком. Больше трёх смысла не имеет — карточек
 * всего три.
 */
const DECK_COL_MIN = 374;
/** Зазор между столбцами — тот же, что в `gap` у `.deck`. */
const DECK_GAP = 10;
/** Внутренние отступы панели (14px с двух сторон) плюс место под прокрутку. */
const DECK_CHROME = 32;

function deckColumns(windowWidth: number, cards: number): number {
  const room = windowWidth - DECK_CHROME;
  const fits = Math.floor((room + DECK_GAP) / (DECK_COL_MIN + DECK_GAP));
  return Math.min(Math.max(fits, 1), cards);
}

export default function App() {
  // хуки живут только здесь: и плитки, и карточки получают данные сверху,
  // иначе каждый источник опрашивался бы дважды
  const system = useSystemStats();
  const claude = useClaudeStats();
  const disk = useDiskStats();
  const collapse = useCollapsed(CARD_IDS);
  const { compact, toggle: toggleMode } = useWidgetMode();

  const deck = useRef<HTMLDivElement | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // окно тянется мышью, поэтому ширина — величина переменная: от неё зависит
  // число столбцов
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

  /** Осталось ли что-то ниже видимого края — от этого гаснет низ блока. */
  const syncEdge = useCallback(() => {
    const node = deck.current;
    if (!node) {
      setHasMore(false);
      return;
    }
    // 1px допуска: дробное масштабирование окна даёт нецелые scrollHeight
    const more = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    setHasMore((prev) => (prev === more ? prev : more));
  }, []);

  // Без списка зависимостей: пересчитываем после каждой перерисовки. Карточки
  // меняют высоту сами — от новых данных, от сворачивания, от смены вида, —
  // и все эти случаи проходят через перерисовку.
  useEffect(syncEdge);

  // смена размера окна меняет и высоту блока (перерисовки при этом нет),
  // и число столбцов
  useEffect(() => {
    const onResize = () => {
      setWindowWidth(window.innerWidth);
      syncEdge();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [syncEdge]);

  const hide = () => getCurrentWindow().hide();

  const modeHint = compact ? "Подробный вид" : "Компактный вид";

  const cards = [
    <CardShell
      key="pc"
      id="pc"
      title="Этот ПК"
      collapsed={collapse.isCollapsed("pc")}
      onToggle={collapse.toggle}
    >
      <PcCard stats={system.stats} error={system.error} history={system.history} />
    </CardShell>,
    <CardShell
      key="claude"
      id="claude"
      title="Claude Code"
      collapsed={collapse.isCollapsed("claude")}
      onToggle={collapse.toggle}
    >
      <ClaudeCard stats={claude.stats} error={claude.error} refresh={claude.refresh} />
    </CardShell>,
    <CardShell
      key="disk"
      id="disk"
      title="Место на диске"
      collapsed={collapse.isCollapsed("disk")}
      onToggle={collapse.toggle}
    >
      <DiskCard report={disk.report} error={disk.error} refresh={disk.refresh} />
    </CardShell>,
  ];

  // Карточки раскидываются по столбцам по кругу: новая попадает в соседний
  // столбец, а не удлиняет единственный. Размер окна от них не меняется — если
  // столбцы не влезли в высоту, прокручивается блок карточек.
  const cols = deckColumns(windowWidth, cards.length);
  const columns = Array.from({ length: cols }, (_, col) =>
    cards.filter((_, i) => i % cols === col)
  );
  // строкой, а не числом: числовому значению React приписал бы «px»
  const deckStyle = { "--deck-cols": String(cols) } as CSSProperties;

  return (
    <div className="panel">
      <header className="head drag">
        <span className="head-title">Custom</span>
        <span className="dot" />
        <span className="muted">сейчас</span>
        <span className="grow" />

        <button
          type="button"
          className="icon-btn"
          aria-label={compact ? "Открыть подробный вид" : "Вернуться к компактному виду"}
          title={modeHint}
          onClick={toggleMode}
        >
          {compact ? (
            // два столбца — таким станет вид после нажатия
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="7.5" height="16" rx="2" />
              <rect x="13.5" y="4" width="7.5" height="16" rx="2" />
            </svg>
          ) : (
            // одна строка плиток
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="9" width="18" height="6" rx="2" />
              <path d="M9 9v6M15 9v6" />
            </svg>
          )}
        </button>

        <ThemeToggle />

        {!compact && (
          <CollapseAllButton allCollapsed={collapse.allCollapsed} onToggle={collapse.toggleAll} />
        )}

        <button type="button" className="icon-btn" aria-label="Свернуть" title="Свернуть" onClick={hide}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
      </header>

      {compact ? (
        <CompactBar system={system} claude={claude} disk={disk} />
      ) : (
        <div
          className={hasMore ? "deck has-more" : "deck"}
          ref={deck}
          onScroll={syncEdge}
          style={deckStyle}
        >
          {columns.map((column, i) => (
            <div className="deck-col" key={i}>
              {column}
            </div>
          ))}
        </div>
      )}

      <footer className="foot">
        <span>всё считается локально</span>
        <span className="grow" />
        <span className="mono">v0.1.0</span>
      </footer>

      {/* края окна: у виджета нет рамки, тянуть его иначе не за что */}
      <ResizeHandles />
    </div>
  );
}
