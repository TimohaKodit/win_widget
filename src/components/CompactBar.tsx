import { Tile, type TileLevel } from "./Tile";
import { percent, round } from "../lib/format";
import { tokens, type ClaudeStats } from "../lib/claudeTypes";
import { levelWord, type DiskReport } from "../lib/diskTypes";
import type { SystemStats } from "../lib/types";

/** С этой доли пятичасового окна плитка предупреждает «скоро лимит». */
const WARN_SHARE = 0.8;

interface Props {
  /** Ровно то, что вернул `useSystemStats` в App: хуки вызываются один раз наверху. */
  system: { stats: SystemStats | null; error: string | null };
  claude: { stats: ClaudeStats | null; error: string | null };
  disk: { report: DiskReport | null; error: string | null };
}

/** Пороги те же, что у `loadColor()`: 75% — предупреждение, 90% — тревога. */
function loadLevel(pct: number): TileLevel {
  if (pct >= 90) return "alarm";
  if (pct >= 75) return "warn";
  return "ok";
}

/** Плитка без данных: виджет только что запустился или источник отказал. */
function blank(label: string, error: string | null) {
  return (
    <Tile
      label={label}
      value="—"
      state={error ? "ошибка" : "нет данных"}
      percent={0}
      level="none"
      hint={error ? `${label}: данные недоступны — ${error}` : `${label}: данные ещё читаются`}
    />
  );
}

function CpuTile({ stats, error }: Props["system"]) {
  if (!stats) return blank("Процессор", error);

  const level = loadLevel(stats.cpuUsage);
  const state = level === "alarm" ? "перегрузка" : level === "warn" ? "нагрузка" : "в норме";

  return (
    <Tile
      label="Процессор"
      value={round(stats.cpuUsage)}
      unit="%"
      state={state}
      percent={stats.cpuUsage}
      level={level}
      hint={`Загрузка процессора: ${round(stats.cpuUsage)}% из 100 — ${state}`}
    />
  );
}

function MemTile({ stats, error }: Props["system"]) {
  if (!stats) return blank("Память", error);

  const pct = percent(stats.memUsedGb, stats.memTotalGb);
  const level = loadLevel(pct);
  const state = level === "alarm" ? "почти полна" : level === "warn" ? "заполняется" : "в норме";
  const total = round(stats.memTotalGb, 1);

  return (
    <Tile
      label="Память"
      value={round(stats.memUsedGb)}
      unit="ГБ"
      state={state}
      percent={pct}
      level={level}
      hint={`Память: занято ${round(stats.memUsedGb, 1)} из ${total} ГБ, ${round(pct)}% — ${state}`}
    />
  );
}

function ClaudeTile({ stats, error }: Props["claude"]) {
  if (!stats) return blank("Окно Claude", error);

  // порог может прийти нулём, пока его не измерили — тогда доли окна нет
  if (stats.windowBudget <= 0) {
    return (
      <Tile
        label="Окно Claude"
        value="—"
        state="нет порога"
        percent={0}
        level="none"
        hint={`Окно 5 ч: израсходовано ${tokens(stats.windowTokens)} токенов, порог не измерен`}
      />
    );
  }

  const share = stats.windowTokens / stats.windowBudget;
  // percent() обрезает по 100, поэтому полоса не уезжает за край плитки
  const pct = percent(stats.windowTokens, stats.windowBudget);
  const level: TileLevel = share >= 1 ? "alarm" : share >= WARN_SHARE ? "warn" : "ok";
  const state = level === "alarm" ? "исчерпан" : level === "warn" ? "скоро лимит" : "в норме";

  return (
    <Tile
      label="Окно Claude"
      value={round(pct)}
      unit="%"
      state={state}
      percent={pct}
      level={level}
      hint={`Окно 5 ч: ${tokens(stats.windowTokens)} из ${tokens(stats.windowBudget)} токенов, ${round(pct)}% — ${state}`}
    />
  );
}

/** На диске в пару терабайт «1 024 ГБ» в плитку не влезает — показываем ТБ. */
function freeSpace(gb: number): { value: string; unit: string } {
  return gb >= 1000
    ? { value: round(gb / 1024, 1), unit: "ТБ" }
    : { value: round(gb), unit: "ГБ" };
}

function DiskTile({ report, error }: Props["disk"]) {
  if (!report) return blank("Свободно", error);

  const free = freeSpace(report.systemFreeGb);
  // число и полоса про одно и то же: и там и там — остаток, а не занятое место
  const freePct = percent(report.systemFreeGb, report.systemTotalGb);
  const level: TileLevel =
    report.level === "critical" ? "alarm" : report.level === "warn" ? "warn" : "ok";
  const state =
    report.level === "critical" ? "кончается" : report.level === "warn" ? "мало места" : "в норме";

  return (
    <Tile
      label="Свободно"
      value={free.value}
      unit={free.unit}
      state={state}
      percent={freePct}
      level={level}
      hint={`Свободно на системном диске: ${round(report.systemFreeGb, 1)} из ${round(
        report.systemTotalGb,
      )} ГБ, ${round(freePct)}% — ${levelWord(report.level)}`}
    />
  );
}

/**
 * Строка плиток компактного вида: то, на что смотрят мельком. Данные приходят
 * сверху — свои хуки здесь не вызываются, иначе опрос шёл бы дважды.
 */
export function CompactBar({ system, claude, disk }: Props) {
  return (
    <div className="tiles">
      <CpuTile stats={system.stats} error={system.error} />
      <MemTile stats={system.stats} error={system.error} />
      <ClaudeTile stats={claude.stats} error={claude.error} />
      <DiskTile report={disk.report} error={disk.error} />
    </div>
  );
}
