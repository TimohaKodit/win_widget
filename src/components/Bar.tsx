interface Props {
  label: string;
  value: string;
  total: string;
  percent: number;
  color: string;
}

/** Строка «подпись — число — полоса заполнения». */
export function Bar({ label, value, total, percent, color }: Props) {
  return (
    <div className="bar">
      <div className="bar-head">
        <span className="bar-label">{label}</span>
        <span className="grow" />
        <span className="bar-value mono">{value}</span>
        <span className="bar-total">&nbsp;/ {total}</span>
      </div>
      <div
        className="bar-track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="bar-fill" style={{ width: `${percent}%`, background: color }} />
      </div>
    </div>
  );
}
