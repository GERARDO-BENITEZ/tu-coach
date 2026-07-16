'use strict'
const express = require('express')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { auth } = require('../middleware/auth')
const { now } = require('../utils/ids')
const { DB_FILE, DATA_DIR, ROOT } = require('../config/env')
const { DB } = require('../services/db')
const logger = require('../utils/logger')

const router = express.Router()

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ ok: true, db: 'json-store', file: DB_FILE, workouts: DB.workouts.length, ts: now() })
})

// Recarga DB desde disco sin reiniciar el servidor
// NOTA: sin `auth` a propósito (igual que antes del refactor) — lo usa un script
// local en la misma Mac, nunca expuesto públicamente. No lo cambié al mover el
// código porque agregarle auth es una decisión de seguridad, no de arquitectura.
router.post('/api/reload-db', (_req, res) => {
  try {
    const fresh = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
    Object.assign(DB, fresh)
    logger.info(`DB recargado desde disco — ${DB.workouts.length} workouts`)
    res.json({ ok: true, workouts: DB.workouts.length, ts: now() })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Exporta coach-view.json y hace git push (para LaunchAgents fuera del Desktop)
router.post('/api/export-and-push', auth, async (req, res) => {
  const coachViewPath = path.join(DATA_DIR, 'coach-view.json')

  // 1. Escribir coach-view.json
  try {
    // Recortar PMC a últimos 730 días para no saturar Render
    const pmcRaw = DB.pmc_cache || {}
    const pmcData = Array.isArray(pmcRaw) ? pmcRaw : (pmcRaw.data || [])
    const pmcSlice = pmcData.slice(-730)
    const pmcExport = { ...pmcRaw, data: pmcSlice }

    // pmc_cache_by_athlete — incluir solo atleta primario, también recortado
    const pmcByAthlete = {}
    for (const [aid, cache] of Object.entries(DB.pmc_cache_by_athlete || {})) {
      const d = Array.isArray(cache) ? cache : (cache?.data || [])
      pmcByAthlete[aid] = { ...cache, data: d.slice(-730) }
    }

    const view = {
      users: DB.users || [],
      coach_athletes: DB.coach_athletes || [],
      workouts: DB.workouts || [],
      pmc_cache: pmcExport,
      pmc_cache_by_athlete: pmcByAthlete,
      nutrition_plans: DB.nutrition_plans || [],
      strength_logs: DB.strength_logs || [],
      garmin_activities: DB.garmin_activities || [],
      device_syncs: DB.device_syncs || [],
      wellness: DB.wellness || [],
      whoop_history: DB.whoop_history || [],
      body_composition: DB.body_compositions || [],
    }
    fs.writeFileSync(coachViewPath, JSON.stringify(view, null, 2))
    logger.info(`coach-view.json escrito — ${view.workouts.length} workouts`)
  } catch (e) {
    return res.status(500).json({ ok: false, step: 'export', error: e.message })
  }

  // 2. Git add + commit + push (no-op si no hay cambios)
  const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { cwd: ROOT, timeout: 20000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }))
      else resolve((stdout || '').trim())
    })
    void child
  })

  try {
    await run('git', ['add', 'data/coach-view.json'])
    const diff = await run('git', ['diff', '--staged', '--stat'])
    if (!diff) return res.json({ ok: true, pushed: false, msg: 'Sin cambios — ya actualizado' })

    const label = `night-sync ${now().slice(0, 16)}`
    await run('git', ['commit', '-m', label])
    const pushOut = await run('git', ['push'])
    logger.info(`Push OK — ${label}`)
    return res.json({ ok: true, pushed: true, msg: label, detail: pushOut })
  } catch (e) {
    const msg = e.stderr || e.stdout || e.message
    logger.error('Git error:', msg)
    return res.json({ ok: true, pushed: false, msg: 'export OK pero git falló: ' + msg.slice(0, 200) })
  }
})

module.exports = router
