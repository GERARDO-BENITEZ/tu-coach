'use strict'
// ── CRON DE MEDIANOCHE — sincronización automática diaria ─────────────────────
const { runFullPipeline } = require('../../agents-system')
const { uuid, localDate } = require('../utils/ids')
const { DB, save } = require('./db')
const { buildAthleteContext } = require('./agentsContext')
const { rebuildPMCForAthlete } = require('./pmc')
const logger = require('../utils/logger')

let _lastAutoSyncDate = ''

async function runAutoSync() {
  const today = localDate()
  if (_lastAutoSyncDate === today) return
  _lastAutoSyncDate = today
  logger.info(`🕛 Iniciando sincronización diaria — ${today}`)
  const athletes = (DB.users || []).filter((u) => u.role === 'ATHLETE')
  for (const u of athletes) {
    try {
      const ctx = buildAthleteContext(u.id)
      const result = await runFullPipeline(ctx)
      const entry = { id: uuid(), athlete_id: u.id, timestamp: result.timestamp, auto: true, ...result }
      if (!DB.agents_intercom) DB.agents_intercom = []
      DB.agents_intercom.push(entry)
      await rebuildPMCForAthlete(u.id)
    } catch (e) {
      logger.error(`Auto-sync error para ${u.id}:`, e)
    }
  }
  if ((DB.agents_intercom || []).length > 150) DB.agents_intercom = DB.agents_intercom.slice(-150)
  save()
  logger.info(`✓ Sincronización diaria completada — ${athletes.length} atletas`)
}

function scheduleMidnightSync() {
  const nowD = new Date()
  const tomorrow = new Date(nowD)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 1, 0, 0) // 00:01 AM del día siguiente
  const msLeft = tomorrow - nowD
  setTimeout(() => { runAutoSync(); scheduleMidnightSync() }, msLeft)
  const mins = Math.round(msLeft / 60000)
  logger.info(`Próxima sync automática en ${mins} min (${tomorrow.toISOString().slice(0, 16)})`)
}

module.exports = { runAutoSync, scheduleMidnightSync }
