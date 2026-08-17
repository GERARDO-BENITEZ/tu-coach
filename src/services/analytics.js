'use strict'
// Fases del plan CAC (fuente única para detección de fase + objetivos de carga)
const { computeAnalytics } = require('../../agents-system')
const { DB } = require('./db')

const CAC_PHASES = [
  { key: 'F1', name: 'F1 Base Técnica',  start: '2026-06-07', end: '2026-06-21', tssWeek: 360, ctlTarget: 28, color: '#4f8ef7' },
  { key: 'F2', name: 'F2 Carga',         start: '2026-06-22', end: '2026-07-12', tssWeek: 490, ctlTarget: 45, color: '#f97316' },
  { key: 'F3', name: 'F3 Especificidad', start: '2026-07-13', end: '2026-07-26', tssWeek: 430, ctlTarget: 55, color: '#22c55e' },
  { key: 'F4', name: 'F4 Taper',         start: '2026-07-27', end: '2026-08-01', tssWeek: 160, ctlTarget: 55, color: '#eab308' },
  { key: 'COMP', name: 'CAC Games',      start: '2026-08-01', end: '2026-08-08', tssWeek: 220, ctlTarget: 52, color: '#ef4444' },
  // Plan post-CAC → CORK → base general (agregado 17 ago 2026)
  { key: 'REC0', name: 'Recuperación Post-CAC',  start: '2026-08-09', end: '2026-08-17', tssWeek: 130, ctlTarget: 24, color: '#94a3b8' },
  { key: 'F1B',  name: 'F1B Reactivación',       start: '2026-08-18', end: '2026-08-23', tssWeek: 300, ctlTarget: 26, color: '#4f8ef7' },
  { key: 'F2B',  name: 'F2B Carga General',      start: '2026-08-24', end: '2026-09-06', tssWeek: 480, ctlTarget: 33, color: '#f97316' },
  { key: 'F3B',  name: 'F3B Especificidad Vela', start: '2026-09-07', end: '2026-09-11', tssWeek: 400, ctlTarget: 35, color: '#22c55e' },
  { key: 'F4B',  name: 'F4B Taper + Viaje',      start: '2026-09-12', end: '2026-09-15', tssWeek: 140, ctlTarget: 34, color: '#eab308' },
  { key: 'CORK', name: 'CORK — Clasificatorio Panamericano', start: '2026-09-16', end: '2026-09-28', tssWeek: 260, ctlTarget: 34, color: '#ef4444' },
  { key: 'REC',  name: 'Recuperación Post-CORK', start: '2026-09-29', end: '2026-10-04', tssWeek: 150, ctlTarget: 30, color: '#94a3b8' },
  { key: 'F5',   name: 'F5 Fuerza General',      start: '2026-10-05', end: '2026-11-01', tssWeek: 420, ctlTarget: 40, color: '#a855f7' },
  { key: 'F6',   name: 'F6 Fuerza Máxima + Potencia', start: '2026-11-02', end: '2026-11-29', tssWeek: 440, ctlTarget: 45, color: '#f97316' },
  { key: 'F7',   name: 'F7 Transición + Base Aeróbica', start: '2026-11-30', end: '2026-12-20', tssWeek: 400, ctlTarget: 46, color: '#4f8ef7' },
  { key: 'F8',   name: 'F8 Cierre de Año',       start: '2026-12-21', end: '2026-12-31', tssWeek: 180, ctlTarget: 42, color: '#94a3b8' },
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
