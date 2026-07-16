'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  COACH — FLUJO 1: planificar entrenos por atleta y fecha
// ════════════════════════════════════════════════════════════════════════════
const express = require('express')
const { uuid, now } = require('../utils/ids')
const { auth } = require('../middleware/auth')
const { DB, save, resolve } = require('../services/db')

const router = express.Router()

// Lista atletas del coach
router.get('/athletes', auth, (req, res) => {
  const ids = DB.coach_athletes.filter((ca) => ca.coach_id === req.user.id).map((ca) => ca.athlete_id)
  res.json(DB.users.filter((u) => ids.includes(u.id)).map(({ id, email, name, role }) => ({ id, email, name, role })))
})

// Calendario de un atleta (para el coach)
router.get('/athletes/:id/workouts', auth, (req, res) => {
  const { start, end } = req.query
  let wks = DB.workouts.filter((w) => w.athlete_id === req.params.id)
  if (start) wks = wks.filter((w) => w.date >= start)
  if (end) wks = wks.filter((w) => w.date <= end)
  res.json(wks.sort((a, b) => a.date.localeCompare(b.date)))
})

// Crear / actualizar workout (upsert por fecha + atleta)
router.post('/workouts', auth, (req, res) => {
  const { athleteId, date, name, type, durationMin, tssPlanned, coachNote, segments } = req.body
  if (!athleteId || !date || !name) return res.status(400).json({ error: 'athleteId, date y name son requeridos' })

  const realId = resolve(athleteId)
  const ts = now()
  const idx = DB.workouts.findIndex((w) => w.athlete_id === realId && w.date === date)
  const id = idx >= 0 ? DB.workouts[idx].id : uuid()
  const workout = {
    id, athlete_id: realId, coach_id: req.user.id, date,
    name, type: type || 'Tierra / Físico',
    duration_min: durationMin || 60, tss_planned: tssPlanned || 50,
    coach_note: coachNote || '', segments: segments || [],
    status: 'PENDING', rpe: null, athlete_note: null,
    actual_duration_min: null, actual_tss: null, completed_at: null,
    garmin_data: null, whoop_data: null,
    created_at: idx >= 0 ? DB.workouts[idx].created_at : ts, updated_at: ts,
  }
  if (idx >= 0) DB.workouts[idx] = workout
  else DB.workouts.push(workout)
  save()
  res.json(workout)
})

// Carga masiva del Plan CAC (48 días en un POST)
router.post('/workouts/bulk', auth, (req, res) => {
  const { athleteId, workouts } = req.body
  if (!athleteId || !Array.isArray(workouts)) return res.status(400).json({ error: 'athleteId y workouts[] requeridos' })

  const realId = resolve(athleteId)
  const ts = now()
  workouts.forEach((w) => {
    const idx = DB.workouts.findIndex((e) => e.athlete_id === realId && e.date === w.date)
    const entry = {
      id: w.id || uuid(), athlete_id: realId, coach_id: req.user.id, date: w.date,
      name: w.name, type: w.type || 'Tierra / Físico',
      duration_min: w.durationMin || 60, tss_planned: w.tssPlanned || 50,
      coach_note: w.coachNote || '', segments: w.segments || [],
      status: 'PENDING', rpe: null, athlete_note: null,
      actual_duration_min: null, actual_tss: null, completed_at: null,
      garmin_data: null, whoop_data: null,
      created_at: idx >= 0 ? DB.workouts[idx].created_at : ts, updated_at: ts,
    }
    if (idx >= 0) DB.workouts[idx] = entry
    else DB.workouts.push(entry)
  })
  save()
  res.json({ ok: true, count: workouts.length })
})

// Editar workout
router.put('/workouts/:id', auth, (req, res) => {
  const idx = DB.workouts.findIndex((w) => w.id === req.params.id && w.coach_id === req.user.id)
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' })
  const { name, type, durationMin, tssPlanned, coachNote, segments, date } = req.body
  Object.assign(DB.workouts[idx], { name, type, duration_min: durationMin, tss_planned: tssPlanned, coach_note: coachNote, segments, date, updated_at: now() })
  save()
  res.json(DB.workouts[idx])
})

// Borrar workout
router.delete('/workouts/:id', auth, (req, res) => {
  DB.workouts = DB.workouts.filter((w) => !(w.id === req.params.id && w.coach_id === req.user.id))
  save()
  res.json({ ok: true })
})

// Ver workout completo con datos del atleta (real vs planificado)
router.get('/workouts/:id', auth, (req, res) => {
  const w = DB.workouts.find((w) => w.id === req.params.id)
  if (!w) return res.status(404).json({ error: 'No encontrado' })
  const syncs = DB.device_syncs.filter((s) => s.workout_id === req.params.id)
  res.json({ ...w, device_syncs: syncs })
})

// Reporte coach: workout con feedback + syncs (real vs planificado)
router.get('/athletes/:athleteId/workouts/:workoutId/report', auth, (req, res) => {
  const w = DB.workouts.find((w) => w.id === req.params.workoutId && w.athlete_id === req.params.athleteId)
  if (!w) return res.status(404).json({ error: 'No encontrado' })
  const syncs = DB.device_syncs.filter((s) => s.workout_id === req.params.workoutId)
  res.json({ ...w, device_syncs: syncs })
})

module.exports = router
