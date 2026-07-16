'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  NUTRIÓLOGA — plan nutricional por atleta
// ════════════════════════════════════════════════════════════════════════════
const express = require('express')
const { recommendNutrition } = require('../../analytics-engine')
const { auth } = require('../middleware/auth')
const { uuid, now, localDate } = require('../utils/ids')
const { DB, save, resolve } = require('../services/db')

const router = express.Router()

// Atletas asignados a la nutrióloga (reutiliza coach_athletes)
router.get('/nutritionist/athletes', auth, (req, res) => {
  if (req.user.role !== 'NUTRITIONIST' && req.user.role !== 'COACH')
    return res.status(403).json({ error: 'Solo nutriólogos o coaches' })
  const ids = DB.coach_athletes.filter((ca) => ca.coach_id === 'coach-erick-001').map((ca) => ca.athlete_id)
  res.json(DB.users.filter((u) => ids.includes(u.id)).map(({ id, name, email }) => ({ id, name, email })))
})

// Plan nutricional de un atleta (más reciente, o por fecha)
router.get('/nutritionist/athletes/:id/nutrition-plan', auth, (req, res) => {
  const { date } = req.query
  const plans = (DB.nutrition_plans || []).filter((p) => p.athlete_id === req.params.id)
  if (date) {
    return res.json(plans.find((p) => p.date === date) || null)
  }
  const sorted = plans.sort((a, b) => b.date.localeCompare(a.date))
  res.json(sorted[0] || null)
})

// El atleta ve su propio plan
router.get('/athlete/nutrition-plan', auth, (req, res) => {
  const plans = (DB.nutrition_plans || []).filter((p) => p.athlete_id === req.user.id)
  const sorted = plans.sort((a, b) => b.date.localeCompare(a.date))
  res.json(sorted[0] || null)
})

// Plan nutricional de hoy — incluye targets del screening y ajuste por workout
router.get('/nutrition/today', auth, (req, res) => {
  const plans = (DB.nutrition_plans || []).filter((p) => p.athlete_id === req.user.id)
  const latest = plans.sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!latest) return res.json({ ok: false, today: null })

  const today = localDate()
  const todayWorkout = DB.workouts.find((w) => w.athlete_id === req.user.id && w.date === today)
  const dMin = todayWorkout?.duration_min || 0
  const kcalAdj = Math.round(dMin * 10) // ~10 kcal/min de ajuste por entreno

  // Ayer: gasto (Garmin) + consumo (check-in) para la recomendación
  const yest = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) })()
  const yestActs = (DB.garmin_activities || []).filter((a) => (a.date || '') === yest)
  const yesterdayBurn = yestActs.reduce((s, a) => s + (a.calories || 0), 0) || null
  const yesterdayTSS = yestActs.reduce((s, a) => s + (a.tss_actual || a.tss || 0), 0) || null
  const yestWell = (DB.wellness || []).find((w) => w.athlete_id === req.user.id && w.date === yest)
  const yesterdayIntake = yestWell?.kcal_consumed ?? null

  const recommendation = recommendNutrition({
    todayWorkout,
    plan: { calories: latest.calories, protein_g: latest.protein_g, carbs_g: latest.carbs_g, fat_g: latest.fat_g },
    yesterdayBurn, yesterdayTSS, yesterdayIntake,
  })

  res.json({
    ok: true,
    recommendation,
    today: {
      calories: (latest.calories || 2673) + kcalAdj,
      carbsG: latest.carbs_g || 270,
      proteinG: latest.protein_g || 198,
      fatG: latest.fat_g || 89,
      // Ingesta actual (del screening)
      actual_calories: latest.actual_calories || null,
      actual_protein: latest.actual_protein_g || null,
      actual_carbs: latest.actual_carbs_g || null,
      // Metadata del screening
      performance_score: latest.performance_score || null,
      red_flags: latest.red_flags || [],
      quick_wins: latest.quick_wins || [],
      source: latest.source || 'manual',
    },
  })
})

// Nutrióloga guarda o actualiza un plan (upsert por fecha + atleta)
router.post('/nutritionist/nutrition-plan', auth, (req, res) => {
  const { athleteId, date, day_type, calories, protein_g, carbs_g, fat_g, notes, meals, supplements } = req.body
  if (!athleteId) return res.status(400).json({ error: 'athleteId requerido' })
  const targetId = resolve(athleteId)
  const planDate = date || localDate()
  if (!DB.nutrition_plans) DB.nutrition_plans = []
  const idx = DB.nutrition_plans.findIndex((p) => p.athlete_id === targetId && p.date === planDate)
  const plan = {
    id: idx >= 0 ? DB.nutrition_plans[idx].id : uuid(),
    athlete_id: targetId, nutritionist_id: req.user.id, date: planDate,
    day_type: day_type || 'ENTRENAMIENTO',
    calories: calories || 3200, protein_g: protein_g || 180, carbs_g: carbs_g || 380, fat_g: fat_g || 85,
    notes: notes || '', meals: meals || [], supplements: supplements || [],
    created_at: idx >= 0 ? DB.nutrition_plans[idx].created_at : now(),
    updated_at: now(),
  }
  if (idx >= 0) DB.nutrition_plans[idx] = plan
  else DB.nutrition_plans.push(plan)
  save()
  res.json(plan)
})

module.exports = router
