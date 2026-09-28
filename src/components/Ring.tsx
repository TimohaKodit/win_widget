import { round } from "../lib/format";

interface Props {
  value: number;
  label: string;
  color: string;
  size?: number;
  stroke?: number;
}

/** Кольцевой индикатор с числом в центре. */
export function Ring({ value, label, color, size = 74, stroke = 7 }: Props) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, value)) / 100) * circumference;

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--track)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-text">
        <div className="ring-value mono">
          {round(value)}
          <span className="ring-sign">%</span>
        </div>
        <div className="ring-label">{label}</div>
      </div>
    </div>
  );
}
