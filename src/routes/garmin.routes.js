'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  DISPOSITIVOS — Garmin (OAuth 1.0a vía garmin-connect + historia completa)
// ════════════════════════════════════════════════════════════════════════════
const express = require('express')
const { auth } = require('../middleware/auth')
const { uuid, now, localDate } = require('../utils/ids')
const { GARMIN_EMAIL, GARMIN_PASSWORD } = require('../config/env')
const { DB, save } = require('../services/db')
const { getGarminClient, garminFetch, invalidateSession } = require('../services/garmin')
const { tssFromHR, rebuildPMCForAthlete } = require('../services/pmc')
const { logSystemEvent } = require('../services/changelog')
const logger = require('../utils/logger')

const router = express.Router()

// Estado de la conexión Garmin (credenciales configuradas = conectado)
router.get('/status', auth, (req, res) => {
  res.json({ connected: !!(GARMIN_EMAIL && GARMIN_PASSWORD), updated_at: null })
})

// Descarga la actividad más reciente de Garmin Connect y calcula TSS via HR Reserve
router.get('/sync', auth, async (req, res) => {
  if (!GARMIN_EMAIL || !GARMIN_PASSWORD) {
    return res.status(503).json({ error: 'config_missing', message: 'Configura GARMIN_EMAIL y GARMIN_PASSWORD en .env' })
  }
  try {
    const activities = await garminFetch((gc) => gc.getActivities(0, 1))
    if (!activities || !activities.length) {
      return res.json({ ok: true, message: 'Sin actividades recientes en Garmin Connect', data: null })
    }
    const act = activities[0]

    const durationMin = Math.round((act.duration || 0) / 60)
    const hrAvg = act.averageHR || act.averageHeartRate || 0
    const hrMax = act.maxHR || act.maxHeartRate || 0
    const activityType = act.activityType?.typeKey || act.activityType || 'OTHER'
    const activityName = act.activityName || activityType
    const calories = act.calories || 0

    const tss = tssFromHR(durationMin, hrAvg, hrMax)

    const garminData = {
      activity_id: act.activityId || null,
      activity_name: activityName,
      activity_type: activityType,
      duration_min: durationMin,
      hr_avg: hrAvg,
      hr_max: hrMax,
      calories,
      tss_actual: tss,
      synced_at: now(),
    }

    DB.device_syncs.push({ id: uuid(), athlete_id: req.user.id, workout_id: null, device: 'garmin', synced_at: now(), data: garminData })

    // Actualizar workout de hoy (si existe) con TSS real para que el PMC lo refleje
    const todayStr = localDate()
    const wIdx = DB.workouts.findIndex((w) => w.athlete_id === req.user.id && w.date === todayStr && w.status === 'COMPLETED')
    let updatedWorkout = null
    if (wIdx >= 0) {
      DB.workouts[wIdx].actual_tss = tss
      DB.workouts[wIdx].garmin_data = garminData
      DB.workouts[wIdx].updated_at = now()
      updatedWorkout = DB.workouts[wIdx]
    }
    save()
    rebuildPMCForAthlete(req.user.id).catch((e) => logger.error('[PMC rebuild/garmin]', e))
    res.json({ ok: true, data: garminData, tss, updated_workout: updatedWorkout })
  } catch (e) {
    logger.error('[Garmin sync]', e)
    invalidateSession() // forzar re-login en el próximo intento
    res.status(502).json({ error: 'garmin_api_error', message: e.message })
  }
})

// Descarga TODAS las actividades de Garmin Connect (paginado 100 por batch)
router.get('/import-history', auth, async (req, res) => {
  if (!GARMIN_EMAIL || !GARMIN_PASSWORD) {
    return res.status(503).json({ error: 'config_missing' })
  }
  try {
    const gc = await getGarminClient()
    let all = []
    let start = 0
    const PAGE = 100
    while (true) {
      const batch = await gc.getActivities(start, PAGE)
      if (!batch || !batch.length) break
      all = all.concat(batch)
      if (batch.length < PAGE) break
      start += PAGE
    }

    const activities = all.map((act) => {
      const durationMin = Math.round((act.duration || 0) / 60)
      const hrAvg = act.averageHR || act.averageHeartRate || 0
      const hrMax = act.maxHR || act.maxHeartRate || 0
      const activityType = act.activityType?.typeKey || String(act.activityType || 'other')
      const activityName = act.activityName || activityType
      const tss = tssFromHR(durationMin, hrAvg, hrMax)
      const dateStr = (act.startTimeLocal || act.startTime || '').toString().slice(0, 10)
      return {
        activity_id: act.activityId || null,
        activity_name: activityName,
        activity_type: activityType,
        date: dateStr,
        duration_min: durationMin,
        hr_avg: hrAvg,
        hr_max: hrMax,
        calories: act.calories || 0,
        distance_m: Math.round((act.distance || 0)),
        elevation_m: Math.round(act.elevationGain || 0),
        tss_actual: tss,
      }
    })

    if (!DB.garmin_activities) DB.garmin_activities = []
    const existingIds = new Set(DB.garmin_activities.map((a) => String(a.activity_id)))
    const newOnes = activities.filter((a) => !existingIds.has(String(a.activity_id)))
    DB.garmin_activities.push(...newOnes)
    // Mantener ordenado por fecha desc
    DB.garmin_activities.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    save()
    if (newOnes.length > 0) {
      logSystemEvent('🚴', 'Garmin actualizado', `${newOnes.length} actividad(es) nueva(s) importada(s) · ${DB.garmin_activities.length} en total`)
    }

    res.json({
      ok: true,
      imported: newOnes.length,
      total: DB.garmin_activities.length,
      oldest: activities[activities.length - 1]?.date || null,
      newest: activities[0]?.date || null,
    })
  } catch (e) {
    logger.error('[Garmin import-history]', e)
    invalidateSession()
    res.status(502).json({ error: 'garmin_api_error', message: e.message })
  }
})

// Devuelve las actividades importadas (para gráficas en el dashboard)
router.get('/activities', auth, (req, res) => {
  const limit = parseInt(req.query.limit || '365')
  const offset = parseInt(req.query.offset || '0')
  const list = (DB.garmin_activities || []).slice(offset, offset + limit)
  res.json({ ok: true, total: (DB.garmin_activities || []).length, data: list })
})

module.exports = router
