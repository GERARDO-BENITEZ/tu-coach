'use strict'
// ═══════════════════════════════════════════════════════════════════════════════
//  Config central — todo lo que lee process.env pasa por aquí, una sola vez.
//  El .env se carga a mano (sin dotenv) para no agregar una dependencia nueva a
//  un server que ya corre en producción — el parser de abajo es el mismo que
//  usaba server.js antes del refactor, solo movido de lugar.
// ═══════════════════════════════════════════════════════════════════════════════
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..', '..')

;(function loadDotEnv() {
  const envFile = path.join(ROOT, '.env')
  if (!fs.existsSync(envFile)) return
  fs.readFileSync(envFile, 'utf8').split('\n').forEach((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return
    const eq = t.indexOf('=')
    if (eq < 1) return
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  })
})()

const PORT = process.env.PORT || 3001
const COACH_VIEW = process.env.COACH_VIEW === '1'
const DATA_DIR = path.join(ROOT, 'data')
const DB_FILE = COACH_VIEW ? path.join(DATA_DIR, 'coach-view.json') : path.join(DATA_DIR, 'tucoach.json')
const SEED_FILE = path.join(DATA_DIR, 'tucoach.seed.json')

module.exports = {
  ROOT,
  PORT,
  // NOTA: este secret está hardcodeado desde el diseño original (no es una app
  // con muchos usuarios ni datos sensibles de terceros) — no lo cambié en el
  // refactor para no invalidar todas las sesiones activas del dashboard.
  JWT_SECRET: 'tc-cac-games-2026-ilca7',
  COACH_VIEW,
  DATA_DIR,
  DB_FILE,
  SEED_FILE,
  WHOOP_CLIENT_ID: process.env.WHOOP_CLIENT_ID || '',
  WHOOP_CLIENT_SECRET: process.env.WHOOP_CLIENT_SECRET || '',
  WHOOP_REDIRECT_URI: process.env.WHOOP_REDIRECT_URI || `http://localhost:${PORT}/api/auth/whoop/callback`,
  GARMIN_EMAIL: process.env.GARMIN_EMAIL || '',
  GARMIN_PASSWORD: process.env.GARMIN_PASSWORD || '',
}
