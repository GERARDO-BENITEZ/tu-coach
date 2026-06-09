/**
 * PMC — Performance Management Chart
 * CTL (Fitness): EWA con tau=42 días
 * ATL (Fatigue): EWA con tau=7 días
 * TSB (Form):    CTL - ATL
 */

export const K_CTL = 1 - Math.exp(-1 / 42)  // ≈ 0.02353
export const K_ATL = 1 - Math.exp(-1 / 7)   // ≈ 0.13317

export interface PMCPoint {
  date: Date
  tss: number
  ctl: number
  atl: number
  tsb: number
}

/** Calcula PMC completo a partir de array [{date, tss}] */
export function calculatePMC(
  data: { date: Date; tss: number }[],
  initialCtl = 0,
  initialAtl = 0
): PMCPoint[] {
  const sorted = [...data].sort((a, b) => a.date.getTime() - b.date.getTime())

  let ctl = initialCtl
  let atl = initialAtl

  return sorted.map(({ date, tss }) => {
    ctl = ctl + (tss - ctl) * K_CTL
    atl = atl + (tss - atl) * K_ATL
    return {
      date,
      tss,
      ctl: +ctl.toFixed(2),
      atl: +atl.toFixed(2),
      tsb: +(ctl - atl).toFixed(2),
    }
  })
}

/** Determina el estado de forma según TSB */
export function formStatus(tsb: number): {
  label: string
  color: string
  description: string
} {
  if (tsb > 25)  return { label: 'Descansado', color: '#22c55e', description: 'En forma, listo para competencia' }
  if (tsb > 5)   return { label: 'Óptimo',     color: '#4f8ef7', description: 'Forma ideal para entrenar fuerte' }
  if (tsb > -10) return { label: 'Neutro',     color: '#eab308', description: 'Carga manejable, seguir plan' }
  if (tsb > -20) return { label: 'Cargado',    color: '#f97316', description: 'Carga alta, monitorear recuperación' }
  if (tsb > -30) return { label: 'Fatigado',   color: '#ef4444', description: 'Fatiga elevada, considerar ajuste' }
  return           { label: 'Sobreentrenado',  color: '#dc2626', description: 'Reducir carga inmediatamente' }
}

/** Alerta HRV basada en z-score */
export function hrvAlert(
  todayHrv: number,
  mean: number,
  sd: number
): { level: 'RED' | 'YELLOW' | 'PEAK' | 'OK'; message: string } {
  if (sd === 0) return { level: 'OK', message: 'HRV normal' }
  const z = (todayHrv - mean) / sd
  if (z < -3)   return { level: 'RED',    message: `HRV crítico (${todayHrv}ms) — ${z.toFixed(1)}σ bajo baseline` }
  if (z < -1)   return { level: 'yellow', message: `HRV bajo (${todayHrv}ms) — ${z.toFixed(1)}σ` } as any
  if (z > 2)    return { level: 'PEAK',   message: `HRV excelente (${todayHrv}ms) — forma óptima` }
  return               { level: 'OK',     message: `HRV normal (${todayHrv}ms)` }
}

/** TSS estimado por deporte */
export function estimateTSS(
  sport: string,
  durationMin: number,
  options: { rpe?: number; pctFtp?: number; if?: number } = {}
): number {
  const hours = durationMin / 60

  if (sport === 'cycling' && options.pctFtp) {
    // Cycling TSS = (sec × NP × IF) / (FTP × 3600) × 100
    const IF = options.pctFtp / 100
    return Math.round(hours * IF * IF * 100)
  }

  if (sport === 'running' && options.rpe) {
    // Running sRPE = rpe × duration_min / 10 (escala aproximada)
    return Math.round(options.rpe * durationMin * 1.5)
  }

  // Genérico: rpe × mins × factor
  const rpe = options.rpe ?? 5
  const baseFactors: Record<string, number> = {
    cycling: 1.5,
    running: 1.8,
    swimming: 1.2,
    strength: 0.8,
    cross: 1.0,
  }
  return Math.round(rpe * durationMin * (baseFactors[sport] ?? 1.2))
}
