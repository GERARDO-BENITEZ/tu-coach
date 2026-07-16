'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  SISTEMA MULTI-AGENTE IA
// ════════════════════════════════════════════════════════════════════════════
const express = require('express')
const { runFullPipeline, streamLocalPipeline } = require('../../agents-system')
const { auth, authBrowser } = require('../middleware/auth')
const { uuid } = require('../utils/ids')
const { DB, save } = require('../services/db')
const { buildAthleteContext } = require('../services/agentsContext')
const { localDate } = require('../utils/ids')
const logger = require('../utils/logger')

const router = express.Router()

// POST /api/agents/run — pipeline completo (sin streaming) → guarda en agents_intercom
router.post('/run', auth, async (req, res) => {
  try {
    const ctx = buildAthleteContext(req.user.id)
    const result = await runFullPipeline(ctx)
    const entry = { id: uuid(), athlete_id: req.user.id, timestamp: result.timestamp, ...result }
    if (!DB.agents_intercom) DB.agents_intercom = []
    DB.agents_intercom.push(entry)
    if (DB.agents_intercom.length > 50) DB.agents_intercom = DB.agents_intercom.slice(-50)
    save()
    res.json({ ok: true, report: entry })
  } catch (e) {
    logger.error('[agents/run]', e)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/agents/stream — SSE con motor local + delays para animación premium
router.get('/stream', authBrowser, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  try {
    const ctx = buildAthleteContext(req.user.id)
    const result = await streamLocalPipeline(ctx, send)

    const entry = { id: uuid(), athlete_id: req.user.id, ...result }
    if (!DB.agents_intercom) DB.agents_intercom = []
    DB.agents_intercom.push(entry)
    if (DB.agents_intercom.length > 50) DB.agents_intercom = DB.agents_intercom.slice(-50)
    save()

    send({ type: 'done', report_id: entry.id })
  } catch (e) {
    logger.error('[agents/stream]', e)
    send({ type: 'error', message: e.message })
  }

  res.end()
})

// GET /api/agents/history — últimos N reportes del atleta
router.get('/history', auth, (req, res) => {
  const limit = parseInt(req.query.limit || '10')
  const history = (DB.agents_intercom || [])
    .filter((e) => e.athlete_id === req.user.id)
    .slice(-limit)
    .reverse()
  // El reporte de agentes es un snapshot: si el PMC (o el workout de hoy) se
  // actualizó DESPUÉS del último reporte, ese reporte quedó viejo aunque tenga
  // menos de 6h — el frontend debe forzar un re-run en vez de mostrarlo.
  const pmcCache = DB.pmc_cache_by_athlete?.[req.user.id] || DB.pmc_cache
  const pmcBuiltAt = pmcCache?.built_at || null
  const today = localDate()
  const workoutToday = (DB.workouts || []).find((w) => w.athlete_id === req.user.id && w.date === today)
  const workoutUpdatedAt = workoutToday?.updated_at || null
  const last = history[0]
  const stale = !!(last && (
    (pmcBuiltAt && pmcBuiltAt > last.timestamp) ||
    (workoutUpdatedAt && workoutUpdatedAt > last.timestamp)
  ))
  res.json({ ok: true, total: history.length, history, stale })
})

module.exports = router
