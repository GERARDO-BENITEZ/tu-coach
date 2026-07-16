'use strict'
const express = require('express')
const { auth } = require('../middleware/auth')
const { DB } = require('../services/db')
const { rebuildPMCForAthlete } = require('../services/pmc')
const { logSystemEvent } = require('../services/changelog')

const router = express.Router()

router.get('/rebuild', auth, async (req, res) => {
  const result = await rebuildPMCForAthlete(req.user.id)
  if (!result) return res.json({ ok: false, message: 'Sin actividades importadas. Ejecuta import-history primero.' })
  const cache = DB.pmc_cache_by_athlete?.[req.user.id] || DB.pmc_cache
  logSystemEvent('📈', 'PMC recalculado', `Fitness/Fatiga/Forma actualizados · CTL ${result.ctl} · ATL ${result.atl} · TSB ${result.tsb}`)
  res.json({
    ok: true,
    data: cache.data,
    summary: {
      total_days: result.days,
      current_ctl: result.ctl,
      current_atl: result.atl,
      current_tsb: result.tsb,
    },
  })
})

// PMC cacheado (para cargas rápidas sin recalcular)
router.get('/data', auth, (req, res) => {
  const cache = DB.pmc_cache_by_athlete?.[req.user.id] || DB.pmc_cache
  if (!cache) return res.json({ ok: false, message: 'Sin datos PMC. Ejecuta /rebuild primero.' })
  const days = parseInt(req.query.days || '180')
  const slice = cache.data.slice(-days)
  const last = slice[slice.length - 1] || {}
  res.json({
    ok: true,
    data: slice,
    summary: {
      current_ctl: last.ctl || 0,
      current_atl: last.atl || 0,
      current_tsb: last.tsb || 0,
      built_at: cache.built_at,
    },
  })
})

module.exports = router
