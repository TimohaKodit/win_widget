import "./collapse.css";

interface Props {
  /** Свёрнуты ли уже все карточки — от этого зависит иконка и подпись. */
  allCollapsed: boolean;
  onToggle: () => void;
}

/**
 * Кнопка для шапки приложения: одно нажатие убирает подробности всех карточек,
 * следующее возвращает их обратно.
 */
export function CollapseAllButton({ allCollapsed, onToggle }: Props) {
  const label = allCollapsed ? "Развернуть все карточки" : "Свернуть все карточки";

  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 12h16" />
        {allCollapsed ? (
          // стрелки друг от друга — развернуть
          <path d="M9 7.5l3-3 3 3M9 16.5l3 3 3-3" />
        ) : (
          // стрелки друг к другу — свернуть
          <path d="M9 4.5l3 3 3-3M9 19.5l3-3 3 3" />
        )}
      </svg>
    </button>
  );
}
