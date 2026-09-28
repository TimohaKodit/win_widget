import type { ReactNode } from "react";
import "./collapse.css";

interface Props {
  /** Стабильный id карточки: по нему хранится состояние и строится aria-controls. */
  id: string;
  /** Название карточки для aria-label кнопки, например «Этот ПК». */
  title: string;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}

/**
 * Обёртка вокруг готовой карточки: добавляет шеврон в правом верхнем углу и
 * скрывает всё, кроме `.card-head`. Что именно внутри — не знает.
 */
export function CardShell({ id, title, collapsed, onToggle, children }: Props) {
  const bodyId = `card-body-${id}`;
  const action = collapsed ? "Развернуть" : "Свернуть";
  const label = `${action} карточку ${title}`;

  return (
    <div className={collapsed ? "shell is-collapsed" : "shell"} data-card={id}>
      <div className="shell-body" id={bodyId}>
        {children}
      </div>

      <button
        type="button"
        className="shell-toggle"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        aria-label={label}
        title={label}
        onClick={() => onToggle(id)}
      >
        <svg
          className="shell-chevron"
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
          <path d="M6 9.5l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
