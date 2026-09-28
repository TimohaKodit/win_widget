interface Props {
  /** Значения в процентах, 0–100. Шкала фиксированная, чтобы график не врал. */
  values: number[];
  width?: number;
  height?: number;
  color: string;
  fill: string;
}

export function Sparkline({ values, width = 344, height = 32, color, fill }: Props) {
  if (values.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const step = width / (values.length - 1);
  const y = (v: number) => height - (Math.min(100, Math.max(0, v)) / 100) * (height - 2) - 1;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <svg width={width} height={height} role="img" aria-label="Загрузка процессора за последнюю минуту">
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={fill} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
