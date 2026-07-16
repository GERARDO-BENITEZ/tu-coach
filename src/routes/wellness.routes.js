'use strict'
const express = require('express')
const { auth } = require('../middleware/auth')
const { uuid, now, localDate } = require('../utils/ids')
const { DB, save } = require('../services/db')

const router = express.Router()

// Guardar wellness (check-in matutino) — un registro por atleta por día
router.post('/', auth, (req, res) => {
  const today = localDate()
  if (!DB.wellness) DB.wellness = []
  const existing = DB.wellness.findIndex((w) => w.athlete_id === req.user.id && w.date === today)
  const entry = { id: uuid(), athlete_id: req.user.id, date: today, ...req.body, created_at: now() }
  if (existing >= 0) DB.wellness[existing] = { ...DB.wellness[existing], ...req.body, updated_at: now() }
  else DB.wellness.push(entry)
  save()
  res.json({ ok: true })
})

// Wellness del atleta (historial)
router.get('/', auth, (req, res) => {
  const days = parseInt(req.query.days || '30')
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
  const cutStr = cutoff.toISOString().slice(0, 10)
  const data = (DB.wellness || []).filter((w) => w.athlete_id === req.user.id && w.date >= cutStr)
    .sort((a, b) => b.date.localeCompare(a.date))
  res.json(data)
})

module.exports = router
