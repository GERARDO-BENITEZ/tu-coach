'use strict'
// ═══════════════════════════════════════════════════════════════════════════════
//  Tu Coach — Servidor local  |  Express 4 + JSON store (sin compilación nativa)
//  La BD es un archivo JSON en ./data/tucoach.json
//  $ npm install && node server.js
//
//  Este archivo es solo bootstrap: arma el app de Express, monta las rutas y
//  levanta el server + el cron de medianoche. Toda la lógica vive en src/routes/
//  (capa HTTP) y src/services/ (capa de negocio + acceso a datos) — refactor del
//  8 jul 2026, mismo criterio que tucoach-plataforma. Nada del comportamiento
//  cambió a propósito: cada ruta se movió tal cual, no se reescribió.
// ═══════════════════════════════════════════════════════════════════════════════
const express = require('express')
const cors = require('cors')
const path = require('path')

const { PORT, COACH_VIEW } = require('./src/config/env')
const logger = require('./src/utils/logger')
const { localDate } = require('./src/utils/ids')
const { notFound, errorHandler } = require('./src/middleware/errorHandler')
const { DB } = require('./src/services/db')
const { scheduleMidnightSync, runAutoSync } = require('./src/services/sync')

const authRoutes = require('./src/routes/auth.routes')
const coachRoutes = require('./src/routes/coach.routes')
const workoutRoutes = require('./src/routes/workout.routes')
const wellnessRoutes = require('./src/routes/wellness.routes')
const deviceRoutes = require('./src/routes/device.routes')
const pmcRoutes = require('./src/routes/pmc.routes')
const alertsRoutes = require('./src/routes/alerts.routes')
const summaryRoutes = require('./src/routes/summary.routes')
const nutritionRoutes = require('./src/routes/nutrition.routes')
const bodyRoutes = require('./src/routes/body.routes')
const garminRoutes = require('./src/routes/garmin.routes')
const whoopRoutes = require('./src/routes/whoop.routes')
const agentsRoutes = require('./src/routes/agents.routes')
const historialRoutes = require('./src/routes/historial.routes')
const systemRoutes = require('./src/routes/system.routes')

const app = express()
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] }))
app.use(express.json({ limit: '4mb' }))

// En modo COACH_VIEW (Render), la raíz redirige al dashboard completo ANTES del static
if (COACH_VIEW) {
  app.get('/', (req, res) => res.redirect('/athlete-dashboard.html'))
}
app.use(express.static(__dirname)) // sirve login.html, athlete-dashboard.html, etc.

app.use('/', systemRoutes)          // /health, /api/reload-db, /api/export-and-push
app.use('/auth', authRoutes)        // /auth/login, /auth/refresh
app.use('/api/coach', coachRoutes)
app.use('/api/athlete', workoutRoutes)
app.use('/api/athlete/wellness', wellnessRoutes)
app.use('/api/athlete', deviceRoutes)      // /sync/garmin, /sync/whoop, /syncs/latest
app.use('/api/athlete/pmc', pmcRoutes)
app.use('/api/athlete/alerts', alertsRoutes)
app.use('/api/athlete', summaryRoutes)     // /executive-summary, /ai-analysis
app.use('/api', nutritionRoutes)
app.use('/api', bodyRoutes)
app.use('/api/athlete/garmin', garminRoutes)
app.use('/api', whoopRoutes)               // /auth/whoop*, /athlete/whoop/*
app.use('/api/agents', agentsRoutes)
app.use('/api/athlete', historialRoutes)   // /trends, /changelog, /historial, /daily-sync

// Estos dos van AL FINAL, en este orden — notFound solo corre si ninguna ruta
// de arriba respondió; errorHandler solo corre si algo tronó (throw síncrono
// o next(err)). Si se cambia el orden, Express deja de mandarles tráfico.
app.use(notFound)
app.use(errorHandler)

app.listen(PORT, () => {
  logger.info(`
╔════════════════════════════════════════════════════╗
║        Tu Coach — Servidor local listo             ║
║   http://localhost:${PORT}                              ║
╠════════════════════════════════════════════════════╣
║  BD: ./data/tucoach.json  (${DB.workouts.length} workouts)             ║
╠════════════════════════════════════════════════════╣
║  Cuentas demo (contraseña: TuCoach2026!)           ║
║  Coach:    coach@tucoach.app                       ║
║  Atleta:   gerardo@tucoach.app                     ║
╠════════════════════════════════════════════════════╣
║  🤖 Colmena de 5 agentes — ACTIVA                  ║
║  Abre: http://localhost:${PORT}/login.html              ║
╚════════════════════════════════════════════════════╝
`)
  const startDate = localDate()
  const startDow = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][new Date().getDay()]
  logger.info(`Fecha actual: ${startDow} ${startDate} — Días para CAC Games (1 ago): ${Math.max(0, Math.ceil((new Date('2026-08-01') - new Date()) / 86400000))}`)
  scheduleMidnightSync()
  runAutoSync() // sync inmediato al arrancar si es día nuevo
})
