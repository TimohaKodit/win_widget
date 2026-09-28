import { useTheme } from "../hooks/useTheme";

/**
 * Кнопка переключения темы для шапки. Оформлена как остальные `.icon-btn`.
 * В тёмной теме показывает солнце («включить светлую»), в светлой — месяц.
 * Состояние держит сам: хук useTheme вызывается здесь и больше нигде,
 * чтобы не разводить два независимых экземпляра состояния.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const light = theme === "light";
  const hint = light ? "Тёмная тема" : "Светлая тема";

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={light ? "Включить тёмную тему" : "Включить светлую тему"}
      title={hint}
    >
      {light ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
        </svg>
      )}
    </button>
  );
}
