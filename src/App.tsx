import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ClaudeCard } from "./cards/ClaudeCard";
import { DiskCard } from "./cards/DiskCard";
import { PcCard } from "./cards/PcCard";
import { CardShell } from "./components/CardShell";
import { CollapseAllButton } from "./components/CollapseAllButton";
import { CompactBar } from "./components/CompactBar";
import { ThemeToggle } from "./components/ThemeToggle";
import { useClaudeStats } from "./hooks/useClaudeStats";
import { useCollapsed } from "./hooks/useCollapsed";
import { useDiskStats } from "./hooks/useDiskStats";
import { useSystemStats } from "./hooks/useSystemStats";
import { useWidgetMode } from "./hooks/useWidgetMode";
import "./components/layout.css";

const CARD_IDS = ["pc", "claude", "disk"];

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

  // смена размера окна меняет высоту блока, а перерисовки при этом нет
  useEffect(() => {
    window.addEventListener("resize", syncEdge);
    return () => window.removeEventListener("resize", syncEdge);
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

  // Карточки раскидываются по столбцам через одну: новая попадает в соседний
  // столбец, а не удлиняет единственный. Размер окна от них не меняется — если
  // столбцы не влезли в высоту, прокручивается блок карточек.
  const left = cards.filter((_, i) => i % 2 === 0);
  const right = cards.filter((_, i) => i % 2 === 1);

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
        >
          <div className="deck-col">{left}</div>
          <div className="deck-col">{right}</div>
        </div>
      )}

      <footer className="foot">
        <span>всё считается локально</span>
        <span className="grow" />
        <span className="mono">v0.1.0</span>
      </footer>
    </div>
  );
}
