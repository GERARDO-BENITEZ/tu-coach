'use strict'
const { localDate } = require('../utils/ids')
const { DB } = require('./db')

// Datos del atleta para el pipeline de agentes — combina BD + parámetros opcionales
function buildAthleteContext(athleteId) {
  const today = localDate()
  const tomorrow = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()

  const bc = (DB.body_compositions || []).filter((b) => b.athlete_id === athleteId).slice(-1)[0] || {}
  const pmcArr = Array.isArray(DB.pmc_cache) ? DB.pmc_cache : (DB.pmc_cache?.data || [])
  const pmc = pmcArr[pmcArr.length - 1] || {}

  const allWorkouts = (DB.workouts || []).filter((w) => w.athlete_id === athleteId)
  const workout_today = allWorkouts.find((w) => w.date === today) || null
  const workout_tomorrow = allWorkouts.find((w) => w.date === tomorrow) || null
  const workouts_completed = allWorkouts.filter((w) => w.status === 'COMPLETED').length
  const workouts_planned = allWorkouts.filter((w) => w.date >= '2026-06-08').length

  // Whoop: usar device_syncs (whoop_history siempre vacío)
  const whoopSyncs = (DB.device_syncs || [])
    .filter((s) => s.athlete_id === athleteId && s.device === 'whoop' && s.data?.recovery_score != null)
    .sort((a, b) => b.synced_at.localeCompare(a.synced_at))
  const latestWhoop = whoopSyncs[0] || null
  const whoop_today = latestWhoop?.data || null
  const last_whoop_sync = latestWhoop?.synced_at || null

  const garminSyncs = (DB.device_syncs || [])
    .filter((s) => s.athlete_id === athleteId && s.device === 'garmin')
    .sort((a, b) => b.synced_at.localeCompare(a.synced_at))
  const last_garmin_sync = garminSyncs[0]?.synced_at || null

  // garmin_activities está ordenado por fecha DESC (nuevo→viejo): las recientes son las primeras
  const garminAll = DB.garmin_activities || []
  const garmin_activities = garminAll.slice(0, 14)

  // Series históricas para el motor de analítica (ascendentes por fecha, últimas ~60)
  const pmc_series = pmcArr.slice(-60)
  const whoop_history = (DB.whoop_history || []).slice(-60)

  return {
    weight_kg: bc.weight_kg || 90,
    bodyfat_pct: bc.bodyfat_pct || 22.8,
    muscle_kg: bc.muscle_kg || 40,
    ctl: pmc.ctl || 18.5,
    atl: pmc.atl || 31.5,
    tsb: pmc.tsb || -13,
    garmin_activities,
    garmin_total: garminAll.length,
    pmc_series,
    whoop_history,
    workouts_all: allWorkouts,
    whoop_today,
    last_whoop_sync,
    last_garmin_sync,
    workout_today,
    workout_tomorrow,
    workouts_completed,
    workouts_planned,
  }
}

module.exports = { buildAthleteContext }
