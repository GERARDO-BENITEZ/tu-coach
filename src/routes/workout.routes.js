'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  ATLETA — FLUJO 2: ver plan, marcar completado, dar feedback RPE
// ════════════════════════════════════════════════════════════════════════════
const express = require('express')
const { adjustForRecovery } = require('../../analytics-engine')
const { auth } = require('../middleware/auth')
const { now, localDate } = require('../utils/ids')
const { DB, save } = require('../services/db')
const { analyticsForAthlete } = require('../services/analytics')
const { rebuildPMCForAthlete } = require('../services/pmc')
const logger = require('../utils/logger')

const router = express.Router()

// Entreno de hoy
router.get('/today', auth, (req, res) => {
  const today = localDate()
  const workout = DB.workouts.find((w) => w.athlete_id === req.user.id && w.date === today) || null
  const wellness = (DB.wellness || []).find((w) => w.athlete_id === req.user.id && w.date === today) || null
  const sensationDone = !!(workout?.status === 'COMPLETED' && workout?.rpe != null)
  // Plan vivo: ajuste del entreno de hoy según recuperación + carga acumulada
  let adjustment = null
  try { adjustment = adjustForRecovery(workout, analyticsForAthlete(req.user.id, today)) }
  catch (e) { logger.error('[adjust]', e) }
  res.json({ workout, wellness, sensation_done: sensationDone, date: today, adjustment })
})

router.get('/tomorrow', auth, (req, res) => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const workout = DB.workouts.find((w) => w.athlete_id === req.user.id && w.date === tomorrow) || null
  res.json({ workout, date: tomorrow })
})

// Workout detalle por fecha (para el panel del calendario)
router.get('/workout/:date', auth, (req, res) => {
  const workout = (DB.workouts || []).find((w) => w.athlete_id === req.user.id && w.date === req.params.date) || null
  res.json({ ok: !!workout, workout })
})

// Calendario del atleta
router.get('/workouts', auth, (req, res) => {
  const { start, end } = req.query
  let wks = DB.workouts.filter((w) => w.athlete_id === req.user.id)
  if (start) wks = wks.filter((w) => w.date >= start)
  if (end) wks = wks.filter((w) => w.date <= end)
  res.json(wks.sort((a, b) => a.date.localeCompare(b.date)))
})

// Workout de un día específico
router.get('/workouts/:date', auth, (req, res) => {
  res.json(DB.workouts.find((w) => w.athlete_id === req.user.id && w.date === req.params.date) || null)
})

// ── MARCAR COMPLETADO + FEEDBACK (núcleo del Flujo 2) ───────────────────────
router.put('/workouts/:id/complete', auth, (req, res) => {
  const idx = DB.workouts.findIndex((w) => w.id === req.params.id && w.athlete_id === req.user.id)
  if (idx < 0) return res.status(404).json({ error: 'No encontrado o no autorizado' })
  const { rpe, athleteNote, actualDurationMin, actualTss } = req.body
  Object.assign(DB.workouts[idx], {
    status: 'COMPLETED', rpe: rpe || null,
    athlete_note: athleteNote || null,
    actual_duration_min: actualDurationMin || null,
    actual_tss: actualTss || null,
    completed_at: now(), updated_at: now(),
  })
  save()
  rebuildPMCForAthlete(req.user.id).catch((e) => logger.error('[PMC rebuild/complete]', e))
  res.json(DB.workouts[idx])
})

// Guardar pesos registrados de ejercicios de fuerza
router.put('/workouts/:id/strength-log', auth, (req, res) => {
  const idx = DB.workouts.findIndex((w) => w.id === req.params.id && w.athlete_id === req.user.id)
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' })
  const { exercises } = req.body // [{ name, sets, reps, kg }]
  if (!Array.isArray(exercises)) return res.status(400).json({ error: 'exercises debe ser array' })
  DB.workouts[idx].segments = exercises.map((e) => ({
    exercise: e.name, sets: e.sets, reps: e.reps, logged_kg: e.kg, logged_at: now(),
  }))
  DB.workouts[idx].updated_at = now()
  save()
  res.json({ ok: true, segments: DB.workouts[idx].segments })
})

// Historial de progresión de fuerza por ejercicio
router.get('/strength-history', auth, (req, res) => {
  const aid = req.user.id
  const history = {}
  DB.workouts
    .filter((w) => w.athlete_id === aid && (w.segments || []).length > 0 &&
      ((w.type || '').toLowerCase().includes('fuerza') || (w.name || '').toLowerCase().includes('fuerza')))
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((w) => {
      (w.segments || []).forEach((s) => {
        if (s.exercise && s.logged_kg != null) {
          if (!history[s.exercise]) history[s.exercise] = []
          history[s.exercise].push({ date: w.date, kg: s.logged_kg, sets: s.sets, reps: s.reps })
        }
      })
    })
  res.json({ history })
})

// Marcar como omitido
router.put('/workouts/:id/skip', auth, (req, res) => {
  const idx = DB.workouts.findIndex((w) => w.id === req.params.id && w.athlete_id === req.user.id)
  if (idx >= 0) { DB.workouts[idx].status = 'SKIPPED'; DB.workouts[idx].updated_at = now(); save() }
  res.json({ ok: true })
})

module.exports = router
