'use strict'
const express = require('express')
const path = require('path')
const fs = require('fs')
const { runFullPipeline } = require('../../agents-system')
const { auth } = require('../middleware/auth')
const { uuid, localDate } = require('../utils/ids')
const { DATA_DIR } = require('../config/env')
const { DB, save } = require('../services/db')
const { analyticsForAthlete } = require('../services/analytics')
const { buildAthleteContext } = require('../services/agentsContext')
const logger = require('../utils/logger')

const router = express.Router()

// Series de tendencia para gráficas (Whoop: HRV/recovery/RHR/sueño + baselines)
router.get('/trends', auth, (req, res) => {
  const days = Math.min(180, parseInt(req.query.days || '60'))
  const wh = (DB.whoop_history || []).slice(-days)
  const series = wh.map((w) => ({
    date: w.date,
    hrv: w.hrv_ms ?? null,
    recovery: w.recovery_score ?? null,
    rhr: w.rhr_bpm ?? null,
    sleep: w.sleep_hours ?? null,
  }))
  // Baselines del motor (HRV vs baseline, etc.)
  const A = analyticsForAthlete(req.user.id, localDate())
  // Peso (body_compositions) para la gráfica de progreso a 86 kg
  const weight = (DB.body_compositions || [])
    .filter((b) => b.athlete_id === req.user.id && b.weight_kg != null)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map((b) => ({ date: b.date, weight: b.weight_kg, bodyfat: b.bodyfat_pct ?? null }))
  res.json({
    ok: true,
    series,
    weight,
    baselines: {
      hrv: A.hrvBaseAvg, hrv_sd: A.hrvBaseSd,
      recovery: A.recBaseAvg, rhr: A.rhrBaseAvg,
    },
    summary: {
      hrv_7d: A.hrvRecentAvg, hrv_z: A.hrvZ,
      recovery_7d: A.recRecentAvg, rhr_7d: A.rhrRecentAvg, sleep_7d: A.sleepRecentAvg,
      weight_goal: 86, weight_start: 90,
    },
  })
})

// Novedades: mejoras de la app (changelog.json) + eventos del sistema (DB.changelog)
router.get('/changelog', auth, (req, res) => {
  let mejoras = []
  try {
    const f = path.join(DATA_DIR, 'changelog.json')
    if (fs.existsSync(f)) mejoras = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch (e) { logger.error('[changelog]', e) }
  const sistema = DB.changelog || []
  const items = [...mejoras, ...sistema]
    .filter((e) => e && e.ts)
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 60)
  res.json({ ok: true, items })
})

// ── HISTORIAL DEPORTIVO INTEGRAL ──────────────────────────────────────────────
// Fusiona workouts, wellness, Garmin, Whoop, composición corporal y PMC por fecha
router.get('/historial', auth, (req, res) => {
  const athleteId = req.user.id
  const days = parseInt(req.query.days || '30')
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
  const cutStr = cutoff.toISOString().split('T')[0]

  const byDate = {}
  const row = (date) => { if (!byDate[date]) byDate[date] = { date }; return byDate[date] }

  // Workouts planificados + completados
  ;(DB.workouts || [])
    .filter((w) => w.athlete_id === athleteId && w.date >= cutStr)
    .forEach((w) => {
      const d = row(w.date)
      d.workout_name = w.name
      d.workout_type = w.type
      d.tss_planned = w.tss_planned || null
      d.duration_planned = w.duration_min || null
      d.rpe = w.rpe || null
      d.workout_status = w.status || 'PENDING'
      d.tss_actual = w.actual_tss || w.garmin_data?.tss_actual || null
      d.duration_actual = w.actual_duration_min || w.garmin_data?.duration_min || null
      d.athlete_note = w.athlete_note || null
    })

  // Wellness / check-in matutino
  ;(DB.wellness || [])
    .filter((w) => w.athlete_id === athleteId && w.date >= cutStr)
    .forEach((w) => {
      const d = row(w.date)
      d.energy = w.energy || null
      d.mood = w.mood || null
      d.soreness = w.muscleSoreness || w.soreness || null
      d.kcal_consumed = w.kcal_consumed || null
      d.water_ml = w.water_ml || null
      d.wellness_note = w.notes || null
      // sleepHours puede venir en camelCase desde el check-in matutino
      if (d.sleep_hours == null && w.sleepHours != null)
        d.sleep_hours = +Number(w.sleepHours).toFixed(1)
    })

  // Actividades Garmin — todas las del día, la más larga como referencia principal
  const garminByDate = {}
  ;(DB.garmin_activities || []).forEach((a) => {
    const date = (a.start_time || '').slice(0, 10) || a.date || ''
    if (!date || date < cutStr) return
    if (!garminByDate[date]) garminByDate[date] = []
    garminByDate[date].push(a)
  })
  Object.entries(garminByDate).forEach(([date, acts]) => {
    const d = row(date)
    // Actividad principal = la más larga
    const main = acts.reduce((best, a) => {
      const dur = a.duration_min || Math.round((a.duration || a.duration_sec || 0) / 60)
      const bDur = best.duration_min || Math.round((best.duration || best.duration_sec || 0) / 60)
      return dur > bDur ? a : best
    }, acts[0])
    const dur = main.duration_min || Math.round((main.duration || main.duration_sec || 0) / 60)
    d.garmin_tss = main.tss_actual != null ? Math.round(main.tss_actual) : (main.tss ? Math.round(main.tss) : null)
    d.garmin_duration = dur || null
    d.garmin_hr_avg = main.hr_avg || main.averageHR || main.averageHeartRate || null
    d.garmin_hr_max = main.hr_max || null
    d.garmin_type = main.activity_type || main.activityType || null
    d.activity_type = d.garmin_type
    d.duration_min = dur || null
    d.garmin_name = main.activity_name || main.name || null
    d.garmin_calories = main.calories || null
    d.garmin_power_w = main.avg_power_w || null
    d.garmin_distance_m = main.distance_m || null
    d.garmin_distance_nm = main.distance_nm || null
    d.garmin_speed_mph = main.speed_avg_mph || null
    d.garmin_speed_kts = main.speed_avg_kts || null
    d.garmin_sessions = acts.length // cuántas actividades ese día
    // TSS total del día (suma de todas las actividades)
    const totalTss = acts.reduce((s, a) => s + (a.tss_actual || 0), 0)
    if (totalTss > 0) d.garmin_tss = Math.round(totalTss)
  })

  // Whoop — recovery, HRV, sueño (fuente primaria: whoop_history)
  ;(DB.whoop_history || [])
    .filter((w) => w.date >= cutStr)
    .forEach((w) => {
      const d = row(w.date)
      d.recovery_score = w.recovery_score != null ? Math.round(w.recovery_score) : null
      d.hrv_ms = w.hrv_ms != null ? Math.round(w.hrv_ms) : null
      d.sleep_hours = w.sleep_hours != null ? +w.sleep_hours.toFixed(1) : null
      d.rhr_bpm = w.rhr_bpm != null ? Math.round(w.rhr_bpm) : null
      d.whoop_strain = w.strain != null ? +w.strain.toFixed(1) : null
    })

  // Fallback: si whoop_history vacío, usar el sync más reciente con datos reales por día
  const whoopSyncsByDate = {}
  ;(DB.device_syncs || [])
    .filter((s) => s.device === 'whoop' && s.data?.recovery_score != null)
    .forEach((s) => {
      const date = (s.synced_at || '').slice(0, 10)
      if (!date || date < cutStr) return
      // Guardar el sync más reciente con recovery_score real por fecha
      if (!whoopSyncsByDate[date] || s.synced_at > whoopSyncsByDate[date].synced_at)
        whoopSyncsByDate[date] = s
    })
  Object.entries(whoopSyncsByDate).forEach(([date, s]) => {
    const d = row(date)
    if (d.recovery_score == null) d.recovery_score = s.data.recovery_score != null ? Math.round(s.data.recovery_score) : null
    if (d.hrv_ms == null) d.hrv_ms = s.data.hrv_ms != null ? Math.round(s.data.hrv_ms) : null
    if (d.sleep_hours == null) d.sleep_hours = s.data.sleep_hours != null ? +Number(s.data.sleep_hours).toFixed(1) : null
    if (d.rhr_bpm == null) d.rhr_bpm = s.data.rhr_bpm != null ? Math.round(s.data.rhr_bpm) : null
    if (d.whoop_strain == null) d.whoop_strain = s.data.strain != null ? +Number(s.data.strain).toFixed(1) : null
  })

  // Composición corporal (DEXA/manual)
  ;(DB.body_compositions || [])
    .filter((b) => b.athlete_id === athleteId && b.date >= cutStr)
    .forEach((b) => {
      const d = row(b.date)
      d.weight_kg = b.weight_kg || null
      d.bodyfat_pct = b.bodyfat_pct || null
      d.muscle_kg = b.muscle_kg || null
    })

  // PMC cache — CTL / ATL / TSB del día
  const pmcArr = Array.isArray(DB.pmc_cache) ? DB.pmc_cache : (DB.pmc_cache?.data || [])
  pmcArr.filter((p) => p.date >= cutStr).forEach((p) => {
    const d = row(p.date)
    d.ctl = p.ctl != null ? +p.ctl.toFixed(1) : null
    d.atl = p.atl != null ? +p.atl.toFixed(1) : null
    d.tsb = p.tsb != null ? +p.tsb.toFixed(1) : null
  })

  // Agentes — último reporte CEO del día
  ;(DB.agents_intercom || [])
    .filter((e) => e.athlete_id === athleteId && (e.timestamp || '').slice(0, 10) >= cutStr)
    .forEach((e) => {
      const date = (e.timestamp || '').slice(0, 10)
      if (!date) return
      const d = row(date)
      // Solo guardamos las primeras 100 chars del CEO para la tabla
      if (e.ceo) d.ceo_summary = e.ceo.split('\n')[0].replace('🎯 ESTADO DEL DÍA: ', '').slice(0, 80)
    })

  const rows = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date))
  res.json({ ok: true, total: rows.length, cut: cutStr, rows })
})

// ── DAILY SYNC — dispara el pipeline y hace upsert en agents_intercom (sin duplicar el día)
router.post('/daily-sync', auth, async (req, res) => {
  try {
    const today = localDate()
    const ctx = buildAthleteContext(req.user.id)
    const result = await runFullPipeline(ctx)

    if (!DB.agents_intercom) DB.agents_intercom = []
    // Upsert: si ya existe una entrada para hoy de este atleta, actualizarla
    const existIdx = DB.agents_intercom.findIndex(
      (e) => e.athlete_id === req.user.id && (e.timestamp || '').slice(0, 10) === today
    )
    const entry = {
      id: existIdx >= 0 ? DB.agents_intercom[existIdx].id : uuid(),
      athlete_id: req.user.id,
      timestamp: result.timestamp,
      auto: false,
      ...result,
    }
    if (existIdx >= 0) {
      DB.agents_intercom[existIdx] = entry
    } else {
      DB.agents_intercom.push(entry)
    }
    if (DB.agents_intercom.length > 100) DB.agents_intercom = DB.agents_intercom.slice(-100)
    save()
    res.json({ ok: true, report_id: entry.id, ceo_estado: entry.ceo?.split('\n')[0] || '' })
  } catch (e) {
    logger.error('[daily-sync]', e)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
