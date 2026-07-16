'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  PMC — CTL / ATL / TSB usando EWA (exponentially weighted avg)
// ════════════════════════════════════════════════════════════════════════════
const { now, localDate } = require('../utils/ids')
const { COACH_VIEW } = require('../config/env')
const { DB, save } = require('./db')

function computePMC(workouts, seedCtl = 0, seedAtl = 0) {
  // EWA con τ = 42d (CTL) y 7d (ATL). Acepta semilla para evitar cold-start.
  const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date))
  let ctl = isFinite(seedCtl) ? seedCtl : 0
  let atl = isFinite(seedAtl) ? seedAtl : 0
  sorted.forEach((w) => {
    const raw = Number(w.actual_tss ?? w.tss_planned ?? 0)
    const tss = isFinite(raw) ? raw : 0
    ctl = ctl + (tss - ctl) * (1 - Math.exp(-1 / 42))
    atl = atl + (tss - atl) * (1 - Math.exp(-1 / 7))
  })
  const ctlR = Math.round(ctl * 10) / 10
  const atlR = Math.round(atl * 10) / 10
  const tsbR = Math.round((ctlR - atlR) * 10) / 10
  return { ctl: isFinite(ctlR) ? ctlR : 0, atl: isFinite(atlR) ? atlR : 0, tsb: isFinite(tsbR) ? tsbR : 0 }
}

function weekStartISO() {
  const d = new Date()
  const dow = d.getDay() || 7
  const mon = new Date(d)
  mon.setDate(d.getDate() - dow + 1)
  return mon.toISOString().split('T')[0]
}

// TSS desde Frecuencia Cardíaca de Reserva (Karvonen) — más preciso que RPE simple
function tssFromHR(durationMin, hrAvg, hrMax, hrRest = 43) {
  const maxHR = hrMax > 100 ? hrMax : 185
  const reserve = maxHR - hrRest
  const intensity = reserve > 0 ? Math.max(0, Math.min(1.5, (hrAvg - hrRest) / reserve)) : 0
  return Math.max(0, Math.round(intensity ** 2 * (durationMin / 60) * 100))
}

// ── PMC REBUILD — función reutilizable (llamada internamente + desde endpoint) ──
async function rebuildPMCForAthlete(athleteId) {
  // En modo COACH_VIEW, el PMC viene del export — no recalcular
  if (COACH_VIEW) return (DB.pmc_cache_by_athlete?.[athleteId] || DB.pmc_cache)

  const tssByDate = {}

  // Garmin activities no tienen athlete_id — se asignan al atleta primario (primer ATHLETE del DB)
  const primaryAthleteId = (DB.users || []).find((u) => u.role === 'ATHLETE')?.id
  if (athleteId === primaryAthleteId) {
    for (const act of (DB.garmin_activities || []).filter((a) => a.date?.length === 10)) {
      tssByDate[act.date] = (tssByDate[act.date] || 0) + (act.tss_actual || 0)
    }
  }

  // Workouts completados con TSS real — siempre tienen prioridad sobre Garmin
  for (const w of (DB.workouts || []).filter((w) => w.athlete_id === athleteId && w.actual_tss && w.date)) {
    tssByDate[w.date] = Math.max(tssByDate[w.date] || 0, w.actual_tss)
  }

  const sortedDates = Object.keys(tssByDate).sort()
  if (!sortedDates.length) return null

  const earliest = sortedDates[0]
  const today = localDate()

  const allDates = []
  const d = new Date(earliest + 'T12:00:00Z')
  const endD = new Date(today + 'T12:00:00Z')
  while (d <= endD) {
    allDates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }

  const k_ctl = 1 / 42, k_atl = 1 / 7
  let ctl = 0, atl = 0
  const pmcData = []

  for (const date of allDates) {
    const tss = tssByDate[date] || 0
    ctl = ctl * (1 - k_ctl) + tss * k_ctl
    atl = atl * (1 - k_atl) + tss * k_atl
    pmcData.push({
      date,
      tss: Math.round(tss),
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
    })
  }

  // Guardar por atleta para que el auto-sync de múltiples atletas no se sobrescriba
  if (!DB.pmc_cache_by_athlete) DB.pmc_cache_by_athlete = {}
  DB.pmc_cache_by_athlete[athleteId] = { athlete_id: athleteId, built_at: now(), data: pmcData }
  // Mantener DB.pmc_cache apuntando al atleta primario (backwards compat)
  if (athleteId === primaryAthleteId) {
    DB.pmc_cache = DB.pmc_cache_by_athlete[athleteId]
  }
  save()

  const last = pmcData[pmcData.length - 1] || {}
  return { ctl: last.ctl || 0, atl: last.atl || 0, tsb: last.tsb || 0, days: pmcData.length }
}

module.exports = { computePMC, weekStartISO, tssFromHR, rebuildPMCForAthlete }
