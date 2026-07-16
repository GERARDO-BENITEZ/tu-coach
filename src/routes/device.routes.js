'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  DISPOSITIVOS — FLUJO 3: Garmin + Whoop se "pegan" al workout (registro manual)
// ════════════════════════════════════════════════════════════════════════════
const express = require('express')
const { auth } = require('../middleware/auth')
const { uuid, now } = require('../utils/ids')
const { DB, save } = require('../services/db')

const router = express.Router()

// Sync Garmin → adjunta métricas al workout
router.post('/sync/garmin', auth, (req, res) => {
  const { workoutId, data } = req.body
  const entry = { id: uuid(), athlete_id: req.user.id, workout_id: workoutId || null, device: 'garmin', synced_at: now(), data }
  DB.device_syncs.push(entry)
  if (workoutId) {
    const idx = DB.workouts.findIndex((w) => w.id === workoutId && w.athlete_id === req.user.id)
    if (idx >= 0) { DB.workouts[idx].garmin_data = data; DB.workouts[idx].updated_at = now() }
  }
  save()
  res.json({ ok: true, syncId: entry.id })
})

// Sync Whoop → adjunta métricas al workout
router.post('/sync/whoop', auth, (req, res) => {
  const { workoutId, data } = req.body
  const entry = { id: uuid(), athlete_id: req.user.id, workout_id: workoutId || null, device: 'whoop', synced_at: now(), data }
  DB.device_syncs.push(entry)
  if (workoutId) {
    const idx = DB.workouts.findIndex((w) => w.id === workoutId && w.athlete_id === req.user.id)
    if (idx >= 0) { DB.workouts[idx].whoop_data = data; DB.workouts[idx].updated_at = now() }
  }
  save()
  res.json({ ok: true, syncId: entry.id })
})

// Últimas sincronizaciones
router.get('/syncs/latest', auth, (req, res) => {
  const syncs = DB.device_syncs.filter((s) => s.athlete_id === req.user.id)
  const garmin = [...syncs].filter((s) => s.device === 'garmin').sort((a, b) => b.synced_at.localeCompare(a.synced_at))[0] || null
  const whoop = [...syncs].filter((s) => s.device === 'whoop').sort((a, b) => b.synced_at.localeCompare(a.synced_at))[0] || null
  res.json({ garmin, whoop })
})

module.exports = router
