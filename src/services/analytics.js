'use strict'
// Fases del plan CAC (fuente única para detección de fase + objetivos de carga)
const { computeAnalytics } = require('../../agents-system')
const { DB } = require('./db')

const CAC_PHASES = [
  { key: 'F1', name: 'F1 Base Técnica',  start: '2026-06-07', end: '2026-06-21', tssWeek: 360, ctlTarget: 28 },
  { key: 'F2', name: 'F2 Carga',         start: '2026-06-22', end: '2026-07-12', tssWeek: 490, ctlTarget: 45 },
  { key: 'F3', name: 'F3 Especificidad', start: '2026-07-13', end: '2026-07-26', tssWeek: 430, ctlTarget: 55 },
  { key: 'F4', name: 'F4 Taper',         start: '2026-07-27', end: '2026-08-01', tssWeek: 160, ctlTarget: 55 },
]

function phaseForDate(dateStr) {
  return CAC_PHASES.find((p) => dateStr >= p.start && dateStr <= p.end) || CAC_PHASES[0]
}

// Calcula analytics + ajuste del día para un atleta (plan vivo)
function analyticsForAthlete(aid, today) {
  const pmcC = DB.pmc_cache_by_athlete?.[aid] || DB.pmc_cache
  const pmcArr = Array.isArray(pmcC) ? pmcC : (pmcC?.data || [])
  const phase = phaseForDate(today)
  return computeAnalytics({
    pmcSeries: pmcArr.slice(-60),
    whoopHistory: (DB.whoop_history || []).slice(-60),
    workouts: (DB.workouts || []).filter((w) => w.athlete_id === aid),
    today, phase,
  })
}

module.exports = { CAC_PHASES, phaseForDate, analyticsForAthlete }
