import { Bar } from "../components/Bar";
import { Ring } from "../components/Ring";
import { Sparkline } from "../components/Sparkline";
import { loadColor, memory, percent, round, uptime } from "../lib/format";
import type { SystemStats } from "../lib/types";

interface Props {
  stats: SystemStats | null;
  error: string | null;
  history: number[];
}

export function PcCard({ stats, error, history }: Props) {
  if (error) {
    return (
      <section className="card">
        <span className="muted">Не удалось прочитать данные системы: {error}</span>
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="card">
        <span className="muted">Читаю состояние системы…</span>
      </section>
    );
  }

  const memPct = percent(stats.memUsedGb, stats.memTotalGb);
  // системный диск показываем полосой, остальные — строкой ниже
  const main = stats.disks.find((d) => d.name.startsWith("C")) ?? stats.disks[0];
  const mainPct = main ? percent(main.usedGb, main.totalGb) : 0;
  const rest = stats.disks.filter((d) => d !== main);

  const healthy = memPct < 90 && mainPct < 95 && stats.cpuUsage < 90;

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-mark violet">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
          </svg>
        </span>
        <span className="card-title">{stats.host}</span>
        <span className="card-sub card-sub-shrink">{stats.cpuName}</span>
        <span className="grow" />
        <span className={healthy ? "dot" : "dot dot-warn"} />
        <span className="card-sub">{healthy ? "в норме" : "под нагрузкой"}</span>
      </div>

      <div className="pc-main">
        <Ring value={stats.cpuUsage} label="CPU" color={loadColor(stats.cpuUsage)} />
        <div className="pc-bars">
          <Bar
            label="RAM"
            value={round(stats.memUsedGb, 1)}
            total={`${round(stats.memTotalGb, 1)} ГБ`}
            percent={memPct}
            color={loadColor(memPct)}
          />
          {main && (
            <Bar
              label={`Диск ${main.name}`}
              value={round(main.usedGb)}
              total={`${round(main.totalGb)} ГБ`}
              percent={mainPct}
              color={loadColor(mainPct)}
            />
          )}
        </div>
      </div>

      <div className="card-meta">
        {stats.cores} потоков · аптайм <span className="mono strong">{uptime(stats.uptimeHours)}</span>
        {rest.map((d) => (
          <span key={d.name}>
            {" · "}
            {d.name} {round(d.usedGb)}/{round(d.totalGb)} ГБ
          </span>
        ))}
      </div>

      <Sparkline
        values={history}
        color="var(--violet)"
        fill="var(--sparkline-fill)"
      />

      <div className="chips">
        {stats.topProcs.map((p) => (
          <span key={p.name} className="chip chip-violet">
            {p.name}
            {p.count > 1 && <span className="chip-count">×{p.count}</span>}
            <span className="chip-value mono">{memory(p.memoryMb)}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
