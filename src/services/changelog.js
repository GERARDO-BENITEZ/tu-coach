'use strict'
const { now, localDate } = require('../utils/ids')
const { DB, save } = require('./db')

// Registra un evento del sistema en el changelog (dedupe: 1 por título por día)
function logSystemEvent(icon, title, detail) {
  if (!DB.changelog) DB.changelog = []
  const day = localDate()
  const entry = { ts: now(), type: 'sistema', icon, title, detail }
  const idx = DB.changelog.findIndex((e) => e.title === title && (e.ts || '').slice(0, 10) === day)
  if (idx >= 0) DB.changelog[idx] = entry
  else DB.changelog.push(entry)
  if (DB.changelog.length > 200) DB.changelog = DB.changelog.slice(-200)
  try { save() } catch (_e) { /* no-op: el próximo save() exitoso ya incluye este evento */ }
}

module.exports = { logSystemEvent }
