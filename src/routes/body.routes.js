'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  COMPOSICIÓN CORPORAL — Flujo nutrición × entrenamiento
// ════════════════════════════════════════════════════════════════════════════
const express = require('express')
const { auth } = require('../middleware/auth')
const { uuid, now, localDate } = require('../utils/ids')
const { DB, save, resolve } = require('../services/db')

const router = express.Router()

// Historial completo de mediciones del atleta
router.get('/athlete/body-composition', auth, (req, res) => {
  const recs = (DB.body_compositions || [])
    .filter((r) => r.athlete_id === req.user.id)
    .sort((a, b) => a.date.localeCompare(b.date))
  res.json(recs)
})

// Última medición (la más reciente por fecha)
router.get('/athlete/body-composition/latest', auth, (req, res) => {
  const recs = (DB.body_compositions || [])
    .filter((r) => r.athlete_id === req.user.id)
    .sort((a, b) => b.date.localeCompare(a.date))
  res.json(recs[0] || null)
})

// Guardar nueva medición (atleta o nutriólogo)
router.post('/athlete/body-composition', auth, (req, res) => {
  const { athleteId, date, weight_kg, height_cm, bodyfat_pct, muscle_kg, goal_weight_kg, notes } = req.body
  const targetId = athleteId ? resolve(athleteId) : req.user.id
  const rec = {
    id: uuid(), athlete_id: targetId,
    date: date || localDate(),
    weight_kg: weight_kg || null,
    height_cm: height_cm || 178,
    bodyfat_pct: bodyfat_pct || null,
    muscle_kg: muscle_kg || null,
    goal_weight_kg: goal_weight_kg || 86,
    recorded_by: req.user.id,
    notes: notes || '',
    created_at: now(),
  }
  if (!DB.body_compositions) DB.body_compositions = []
  DB.body_compositions.push(rec)
  save()
  res.json(rec)
})

// Coach o nutriólogo ven historial de un atleta
router.get('/coach/athletes/:id/body-composition', auth, (req, res) => {
  const recs = (DB.body_compositions || [])
    .filter((r) => r.athlete_id === req.params.id)
    .sort((a, b) => a.date.localeCompare(b.date))
  res.json(recs)
})

module.exports = router
