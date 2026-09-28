import type { PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./resize.css";

/**
 * Куда тянем. Набор — ровно тот, что принимает `startResizeDragging`
 * (тип `ResizeDirection` в `@tauri-apps/api/window`); наружу из пакета он не
 * экспортируется, поэтому повторён здесь один в один.
 */
type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

/**
 * Полоска: класс задаёт место и курсор, направление — что делает Windows.
 * Подсказок (`title`) у зон нет намеренно: всплывающее окошко вылезало бы
 * каждый раз, когда курсор просто задержался у края.
 */
const ZONES: ReadonlyArray<{ side: string; direction: ResizeDirection }> = [
  { side: "n", direction: "North" },
  { side: "s", direction: "South" },
  { side: "w", direction: "West" },
  { side: "e", direction: "East" },
  { side: "nw", direction: "NorthWest" },
  { side: "ne", direction: "NorthEast" },
  { side: "sw", direction: "SouthWest" },
  { side: "se", direction: "SouthEast" },
];

/**
 * Края окна для растягивания мышью.
 *
 * Окно объявлено без рамки, поэтому системных краёв у него нет: их заменяют
 * восемь прозрачных полосок по периметру. Нажатие передаёт растягивание
 * оконному менеджеру — дальше размер меняет он сам, с соблюдением
 * `minWidth`/`minHeight` из `tauri.conf.json`. Никакого расчёта в JS: ручной
 * подсчёт пикселей на мышиных событиях отстаёт от курсора и ломается при
 * дробном масштабе экрана.
 *
 * Зоны висят по самому краю (6px сторона, 12px угол), а панель имеет
 * внутренний отступ 14px — до кнопок шапки и содержимого карточек они не
 * достают.
 */
export function ResizeHandles() {
  const start = (direction: ResizeDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
    // только левая кнопка: правая и средняя не растягивают окна нигде в системе
    if (event.button !== 0) return;
    // иначе браузер начнёт своё выделение/перетаскивание параллельно системному
    event.preventDefault();
    // без права `core:window:allow-start-resize-dragging` вызов отклонится —
    // ронять виджет из-за этого нельзя, окно просто останется прежним
    void getCurrentWindow()
      .startResizeDragging(direction)
      .catch(() => {});
  };

  return (
    <>
      {ZONES.map(({ side, direction }) => (
        <div
          key={side}
          className={`rz rz-${side}`}
          aria-hidden="true"
          onPointerDown={start(direction)}
        />
      ))}
    </>
  );
}
