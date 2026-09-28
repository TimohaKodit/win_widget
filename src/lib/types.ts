/** Зеркало структур из src-tauri/src/system.rs */

export interface DiskInfo {
  /** Буква диска, например "C:" */
  name: string;
  usedGb: number;
  totalGb: number;
}

export interface ProcInfo {
  name: string;
  memoryMb: number;
  /** Сколько одноимённых процессов слиплось в строку */
  count: number;
}

export interface SystemStats {
  host: string;
  cpuName: string;
  cpuUsage: number;
  cores: number;
  memUsedGb: number;
  memTotalGb: number;
  uptimeHours: number;
  disks: DiskInfo[];
  topProcs: ProcInfo[];
}
