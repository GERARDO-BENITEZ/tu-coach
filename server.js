'use strict'
// ═══════════════════════════════════════════════════════════════════════════════
//  Tu Coach — Servidor local  |  Express 4 + JSON store (sin compilación nativa)
//  La BD es un archivo JSON en ./data/tucoach.json
//  $ npm install && node server.js
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express')
const cors    = require('cors')
const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const { v4: uuid } = require('uuid')
const path    = require('path')
const fs      = require('fs')
const crypto  = require('crypto')

const PORT       = 3001
const JWT_SECRET = 'tc-cac-games-2026-ilca7'
const DATA_DIR   = path.join(__dirname, 'data')
const DB_FILE    = path.join(DATA_DIR, 'tucoach.json')

fs.mkdirSync(DATA_DIR, { recursive: true })

// Si no existe tucoach.json y hay un seed disponible → copiar el seed automáticamente
const SEED_FILE = path.join(DATA_DIR, 'tucoach.seed.json')
if (!fs.existsSync(DB_FILE) && fs.existsSync(SEED_FILE)) {
  fs.copyFileSync(SEED_FILE, DB_FILE)
  console.log('[DB] tucoach.json creado desde seed.')
}

// ── Carga opcional de .env ────────────────────────────────────────────────────
;(function () {
  const envFile = path.join(__dirname, '.env')
  if (!fs.existsSync(envFile)) return
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return
    const eq = t.indexOf('=')
    if (eq < 1) return
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  })
})()

const WHOOP_CLIENT_ID     = process.env.WHOOP_CLIENT_ID     || ''
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET || ''
const WHOOP_REDIRECT_URI  = process.env.WHOOP_REDIRECT_URI  || `http://localhost:${PORT}/api/auth/whoop/callback`

const GARMIN_EMAIL    = process.env.GARMIN_EMAIL    || ''
const GARMIN_PASSWORD = process.env.GARMIN_PASSWORD || ''

// Cliente Garmin Connect (sesión reutilizable)
const { GarminConnect } = require('garmin-connect')
const { runFullPipeline, streamLocalPipeline, AGENT_PERSONAS } = require('./agents-system')
let _gcClient = null
let _gcReady  = false

async function getGarminClient() {
  if (_gcReady) return _gcClient
  _gcClient = new GarminConnect({ username: GARMIN_EMAIL, password: GARMIN_PASSWORD })
  await _gcClient.login(GARMIN_EMAIL, GARMIN_PASSWORD)
  _gcReady = true
  return _gcClient
}

// Reconectar si la sesión expira
async function garminFetch(fn) {
  try {
    const gc = await getGarminClient()
    return await fn(gc)
  } catch (e) {
    if (e.message?.includes('401') || e.message?.includes('auth') || e.message?.includes('login')) {
      _gcReady = false
      const gc = await getGarminClient()
      return await fn(gc)
    }
    throw e
  }
}

// ── JSON STORE ────────────────────────────────────────────────────────────────
// Lee el JSON completo, aplica la mutación, lo vuelve a escribir.
// Suficiente para un prototipo con < 100 atletas y miles de workouts.

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) } catch { return null }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2))
}

// Datos semilla de composición corporal para Gerardo (medición inicial DEXA)
const SEED_BODY_COMP = [
  {
    id: 'bc-gb-2026-06-07', athlete_id: 'athlete-gb-001', date: '2026-06-07',
    weight_kg: 90, height_cm: 178, bodyfat_pct: 22.8, muscle_kg: 40.0, goal_weight_kg: 86,
    recorded_by: 'nutri-001',
    notes: 'Medición inicial DEXA. Meta: 86 kg sin perder masa muscular para Juegos CAC.',
    created_at: new Date().toISOString(),
  }
]

// Baseline de rendimiento para inicializar CTL/ATL sin cold-start distortion
// Gerardo tiene ~74 CTL al inicio del Plan CAC (6 meses de base vela + gym)
const SEED_PERFORMANCE_BASELINES = [
  {
    id: 'pb-gb-001', athlete_id: 'athlete-gb-001',
    date: '2026-06-07',
    ctl_seed: 74, atl_seed: 88,
    notes: 'Estado de forma inicial al comienzo del Plan CAC Games ILCA 7. 6 meses base.',
    created_at: new Date().toISOString(),
  }
]

// Plan nutricional semilla (día de entrenamiento tipo F1)
const SEED_NUTRITION_PLAN = [
  {
    id: 'np-gb-2026-06-07', athlete_id: 'athlete-gb-001', nutritionist_id: 'nutri-001',
    date: '2026-06-07', day_type: 'ENTRENAMIENTO',
    calories: 3200, protein_g: 180, carbs_g: 380, fat_g: 85,
    notes: 'Día de entrenamiento F1. Priorizar carbos pre-sesión y recuperación post. Déficit controlado de ~300 kcal para progresión hacia 86 kg.',
    meals: [
      { time: '07:00', name: 'Desayuno', foods: 'Avena 80g + plátano + 3 huevos + café', kcal: 650, protein_g: 35, carbs_g: 80, fat_g: 18 },
      { time: '10:00', name: 'Pre-entreno', foods: 'Arroz 60g + pollo 120g + BCAA', kcal: 400, protein_g: 30, carbs_g: 55, fat_g: 5 },
      { time: '13:00', name: 'Almuerzo', foods: 'Pasta 100g + atún 180g + vegetales salteados', kcal: 700, protein_g: 45, carbs_g: 80, fat_g: 15 },
      { time: '16:30', name: 'Post-entreno', foods: 'Batido whey 40g + dátiles 50g + agua', kcal: 450, protein_g: 42, carbs_g: 60, fat_g: 8 },
      { time: '20:00', name: 'Cena', foods: 'Salmón 180g + arroz integral 80g + ensalada', kcal: 650, protein_g: 45, carbs_g: 60, fat_g: 25 },
    ],
    supplements: ['Creatina 5g', 'Omega-3 3g', 'Vitamina D 2000 UI', 'Magnesio 400mg'],
    created_at: new Date().toISOString(),
  }
]

function initDB() {
  let existing = readDB()

  if (existing) {
    // Migración aditiva: añadir colecciones nuevas sin borrar datos existentes
    let changed = false
    if (!existing.body_compositions)       { existing.body_compositions       = SEED_BODY_COMP;                 changed = true }
    if (!existing.nutrition_plans)         { existing.nutrition_plans         = SEED_NUTRITION_PLAN;            changed = true }
    if (!existing.performance_baselines)   { existing.performance_baselines   = SEED_PERFORMANCE_BASELINES;    changed = true }
    if (!existing.whoop_tokens)            { existing.whoop_tokens            = [];                             changed = true }
    if (!existing.garmin_tokens)           { existing.garmin_tokens           = [];                             changed = true }
    if (!existing.wellness)               { existing.wellness               = [];                              changed = true }
    if (!existing.sensation_logs)         { existing.sensation_logs         = [];                              changed = true }
    if (!existing.agents_intercom)        { existing.agents_intercom        = [];                              changed = true }
    if (changed) writeDB(existing)
    return existing
  }

  const PW = bcrypt.hashSync('TuCoach2026!', 10)
  const db = {
    users: [
      { id: 'coach-erick-001', email: 'coach@tucoach.app',     name: 'Coach Erick',       role: 'COACH',         password_hash: PW },
      { id: 'athlete-gb-001',  email: 'gerardo@tucoach.app',   name: 'Gerardo Benítez',   role: 'ATHLETE',       password_hash: PW },
      { id: 'athlete-al-001',  email: 'ana@tucoach.app',       name: 'Ana López',         role: 'ATHLETE',       password_hash: PW },
      { id: 'nutri-001',       email: 'nutricion@tucoach.app', name: 'Nutriólogo García', role: 'NUTRITIONIST',  password_hash: PW },
    ],
    coach_athletes: [
      { coach_id: 'coach-erick-001', athlete_id: 'athlete-gb-001' },
      { coach_id: 'coach-erick-001', athlete_id: 'athlete-al-001' },
    ],
    workouts:                [],   // { id, athlete_id, coach_id, date, name, type, duration_min, tss_planned, coach_note, segments, status, rpe, athlete_note, actual_duration_min, actual_tss, completed_at, garmin_data, whoop_data, created_at, updated_at }
    device_syncs:            [],   // { id, athlete_id, workout_id, device, synced_at, data }
    body_compositions:       SEED_BODY_COMP,
    nutrition_plans:         SEED_NUTRITION_PLAN,
    performance_baselines:   SEED_PERFORMANCE_BASELINES, // { id, athlete_id, date, ctl_seed, atl_seed, notes, created_at }
    whoop_tokens:            [],   // { athlete_id, access_token, refresh_token, expires_at, updated_at }
    garmin_tokens:           [],   // { athlete_id, access_token, access_token_secret, updated_at }
  }
  writeDB(db)
  return db
}

let DB = initDB()
const save = () => writeDB(DB)

// ID de atleta por alias corto (coincide con los HTML)
const ALIAS_MAP = { gb: 'athlete-gb-001', al: 'athlete-al-001', cr: 'athlete-al-001' }
const resolve = id => ALIAS_MAP[id] || id

// ── EXPRESS ───────────────────────────────────────────────────────────────────
const app = express()
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'] }))
app.use(express.json({ limit: '4mb' }))
app.use(express.static(__dirname))   // sirve login.html, athlete-dashboard.html, etc.

// ── AUTH ──────────────────────────────────────────────────────────────────────
function makeToken(u) {
  return jwt.sign({ id: u.id, email: u.email, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: '7d' })
}
function auth(req, res, next) {
  const hdr = req.headers.authorization
  if (!hdr?.startsWith('Bearer ')) return res.status(401).json({ error: 'Sin token' })
  try { req.user = jwt.verify(hdr.slice(7), JWT_SECRET); next() }
  catch { res.status(401).json({ error: 'Token inválido o expirado' }) }
}

// Para flujos OAuth iniciados desde el browser (sin header Authorization)
// acepta el token también desde ?token= en la query string
function authBrowser(req, res, next) {
  const raw = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.query.token
  if (!raw) return res.status(401).json({ error: 'Sin token' })
  try { req.user = jwt.verify(raw, JWT_SECRET); next() }
  catch { res.status(401).json({ error: 'Token inválido o expirado' }) }
}
const now = () => new Date().toISOString()
const localDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
app.post('/auth/login', (req, res) => {
  DB = readDB() || DB   // refrescar por si otro proceso modificó el archivo
  const { email, password } = req.body || {}
  const u = DB.users.find(u => u.email === email)
  if (!u || !bcrypt.compareSync(password, u.password_hash))
    return res.status(401).json({ error: 'Credenciales incorrectas' })
  const token = makeToken(u)
  res.json({ token, refreshToken: token, user: { id: u.id, email: u.email, name: u.name, role: u.role } })
})

app.post('/auth/refresh', (req, res) => {
  try {
    const d = jwt.verify(req.body?.refreshToken, JWT_SECRET)
    res.json({ token: makeToken(d) })
  } catch { res.status(401).json({ error: 'Refresh token inválido' }) }
})

// ════════════════════════════════════════════════════════════════════════════
//  COACH — FLUJO 1: planificar entrenos por atleta y fecha
// ════════════════════════════════════════════════════════════════════════════

// Lista atletas del coach
app.get('/api/coach/athletes', auth, (req, res) => {
  const ids = DB.coach_athletes.filter(ca => ca.coach_id === req.user.id).map(ca => ca.athlete_id)
  res.json(DB.users.filter(u => ids.includes(u.id)).map(({ id, email, name, role }) => ({ id, email, name, role })))
})

// Calendario de un atleta (para el coach)
app.get('/api/coach/athletes/:id/workouts', auth, (req, res) => {
  const { start, end } = req.query
  let wks = DB.workouts.filter(w => w.athlete_id === req.params.id)
  if (start) wks = wks.filter(w => w.date >= start)
  if (end)   wks = wks.filter(w => w.date <= end)
  res.json(wks.sort((a, b) => a.date.localeCompare(b.date)))
})

// Crear / actualizar workout (upsert por fecha + atleta)
app.post('/api/coach/workouts', auth, (req, res) => {
  const { athleteId, date, name, type, durationMin, tssPlanned, coachNote, segments } = req.body
  if (!athleteId || !date || !name) return res.status(400).json({ error: 'athleteId, date y name son requeridos' })

  const realId = resolve(athleteId)
  const ts = now()
  const idx = DB.workouts.findIndex(w => w.athlete_id === realId && w.date === date)
  const id = idx >= 0 ? DB.workouts[idx].id : uuid()
  const workout = {
    id, athlete_id: realId, coach_id: req.user.id, date,
    name, type: type || 'Tierra / Físico',
    duration_min: durationMin || 60, tss_planned: tssPlanned || 50,
    coach_note: coachNote || '', segments: segments || [],
    status: 'PENDING', rpe: null, athlete_note: null,
    actual_duration_min: null, actual_tss: null, completed_at: null,
    garmin_data: null, whoop_data: null,
    created_at: idx >= 0 ? DB.workouts[idx].created_at : ts, updated_at: ts,
  }
  if (idx >= 0) DB.workouts[idx] = workout
  else DB.workouts.push(workout)
  save()
  res.json(workout)
})

// Carga masiva del Plan CAC (48 días en un POST)
app.post('/api/coach/workouts/bulk', auth, (req, res) => {
  const { athleteId, workouts } = req.body
  if (!athleteId || !Array.isArray(workouts)) return res.status(400).json({ error: 'athleteId y workouts[] requeridos' })

  const realId = resolve(athleteId)
  const ts = now()
  workouts.forEach(w => {
    const idx = DB.workouts.findIndex(e => e.athlete_id === realId && e.date === w.date)
    const entry = {
      id: w.id || uuid(), athlete_id: realId, coach_id: req.user.id, date: w.date,
      name: w.name, type: w.type || 'Tierra / Físico',
      duration_min: w.durationMin || 60, tss_planned: w.tssPlanned || 50,
      coach_note: w.coachNote || '', segments: w.segments || [],
      status: 'PENDING', rpe: null, athlete_note: null,
      actual_duration_min: null, actual_tss: null, completed_at: null,
      garmin_data: null, whoop_data: null,
      created_at: idx >= 0 ? DB.workouts[idx].created_at : ts, updated_at: ts,
    }
    if (idx >= 0) DB.workouts[idx] = entry
    else DB.workouts.push(entry)
  })
  save()
  res.json({ ok: true, count: workouts.length })
})

// Editar workout
app.put('/api/coach/workouts/:id', auth, (req, res) => {
  const idx = DB.workouts.findIndex(w => w.id === req.params.id && w.coach_id === req.user.id)
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' })
  const { name, type, durationMin, tssPlanned, coachNote, segments, date } = req.body
  Object.assign(DB.workouts[idx], { name, type, duration_min: durationMin, tss_planned: tssPlanned, coach_note: coachNote, segments, date, updated_at: now() })
  save()
  res.json(DB.workouts[idx])
})

// Borrar workout
app.delete('/api/coach/workouts/:id', auth, (req, res) => {
  DB.workouts = DB.workouts.filter(w => !(w.id === req.params.id && w.coach_id === req.user.id))
  save()
  res.json({ ok: true })
})

// Ver workout completo con datos del atleta (real vs planificado)
app.get('/api/coach/workouts/:id', auth, (req, res) => {
  const w = DB.workouts.find(w => w.id === req.params.id)
  if (!w) return res.status(404).json({ error: 'No encontrado' })
  const syncs = DB.device_syncs.filter(s => s.workout_id === req.params.id)
  res.json({ ...w, device_syncs: syncs })
})

// ════════════════════════════════════════════════════════════════════════════
//  ATLETA — FLUJO 2: ver plan, marcar completado, dar feedback RPE
// ════════════════════════════════════════════════════════════════════════════

// Entreno de hoy
app.get('/api/athlete/today', auth, (req, res) => {
  const today   = localDate()
  const workout = DB.workouts.find(w => w.athlete_id === req.user.id && w.date === today) || null
  const wellness = (DB.wellness || []).find(w => w.athlete_id === req.user.id && w.date === today) || null
  const sensationDone = !!(workout?.status === 'COMPLETED' && workout?.rpe != null)
  res.json({ workout, wellness, sensation_done: sensationDone, date: today })
})

app.get('/api/athlete/tomorrow', auth, (req, res) => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const tomorrow = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const workout  = DB.workouts.find(w => w.athlete_id === req.user.id && w.date === tomorrow) || null
  res.json({ workout, date: tomorrow })
})

// Workout detalle por fecha (para el panel del calendario)
app.get('/api/athlete/workout/:date', auth, (req, res) => {
  const workout = (DB.workouts || []).find(w => w.athlete_id === req.user.id && w.date === req.params.date) || null
  res.json({ ok: !!workout, workout })
})

// Guardar wellness (check-in matutino) — un registro por atleta por día
app.post('/api/athlete/wellness', auth, (req, res) => {
  const today = localDate()
  if (!DB.wellness) DB.wellness = []
  const existing = DB.wellness.findIndex(w => w.athlete_id === req.user.id && w.date === today)
  const entry = { id: uuid(), athlete_id: req.user.id, date: today, ...req.body, created_at: now() }
  if (existing >= 0) DB.wellness[existing] = { ...DB.wellness[existing], ...req.body, updated_at: now() }
  else DB.wellness.push(entry)
  save()
  res.json({ ok: true })
})

// Wellness del atleta (historial)
app.get('/api/athlete/wellness', auth, (req, res) => {
  const days = parseInt(req.query.days || '30')
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
  const cutStr = cutoff.toISOString().slice(0, 10)
  const data = (DB.wellness || []).filter(w => w.athlete_id === req.user.id && w.date >= cutStr)
    .sort((a, b) => b.date.localeCompare(a.date))
  res.json(data)
})

// Calendario del atleta
app.get('/api/athlete/workouts', auth, (req, res) => {
  const { start, end } = req.query
  let wks = DB.workouts.filter(w => w.athlete_id === req.user.id)
  if (start) wks = wks.filter(w => w.date >= start)
  if (end)   wks = wks.filter(w => w.date <= end)
  res.json(wks.sort((a, b) => a.date.localeCompare(b.date)))
})

// Workout de un día específico
app.get('/api/athlete/workouts/:date', auth, (req, res) => {
  res.json(DB.workouts.find(w => w.athlete_id === req.user.id && w.date === req.params.date) || null)
})

// ── MARCAR COMPLETADO + FEEDBACK (núcleo del Flujo 2) ───────────────────────
app.put('/api/athlete/workouts/:id/complete', auth, (req, res) => {
  const idx = DB.workouts.findIndex(w => w.id === req.params.id && w.athlete_id === req.user.id)
  if (idx < 0) return res.status(404).json({ error: 'No encontrado o no autorizado' })
  const { rpe, athleteNote, actualDurationMin, actualTss } = req.body
  Object.assign(DB.workouts[idx], {
    status: 'COMPLETED', rpe: rpe || null,
    athlete_note: athleteNote || null,
    actual_duration_min: actualDurationMin || null,
    actual_tss: actualTss || null,
    completed_at: now(), updated_at: now(),
  })
  save()
  rebuildPMCForAthlete(req.user.id).catch(e => console.error('[PMC rebuild/complete]', e.message))
  res.json(DB.workouts[idx])
})

// Guardar pesos registrados de ejercicios de fuerza
app.put('/api/athlete/workouts/:id/strength-log', auth, (req, res) => {
  const idx = DB.workouts.findIndex(w => w.id === req.params.id && w.athlete_id === req.user.id)
  if (idx < 0) return res.status(404).json({ error: 'No encontrado' })
  const { exercises } = req.body  // [{ name, sets, reps, kg }]
  if (!Array.isArray(exercises)) return res.status(400).json({ error: 'exercises debe ser array' })
  DB.workouts[idx].segments = exercises.map(e => ({
    exercise: e.name, sets: e.sets, reps: e.reps, logged_kg: e.kg, logged_at: now()
  }))
  DB.workouts[idx].updated_at = now()
  save()
  res.json({ ok: true, segments: DB.workouts[idx].segments })
})

// Historial de progresión de fuerza por ejercicio
app.get('/api/athlete/strength-history', auth, (req, res) => {
  const aid = req.user.id
  const history = {}
  const strengthTypes = ['Fuerza', 'fuerza', 'strength']
  DB.workouts
    .filter(w => w.athlete_id === aid && (w.segments || []).length > 0 &&
      strengthTypes.some(t => (w.type || '').toLowerCase().includes('fuerza') || (w.name || '').toLowerCase().includes('fuerza')))
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(w => {
      (w.segments || []).forEach(s => {
        if (s.exercise && s.logged_kg != null) {
          if (!history[s.exercise]) history[s.exercise] = []
          history[s.exercise].push({ date: w.date, kg: s.logged_kg, sets: s.sets, reps: s.reps })
        }
      })
    })
  res.json({ history })
})

// Marcar como omitido
app.put('/api/athlete/workouts/:id/skip', auth, (req, res) => {
  const idx = DB.workouts.findIndex(w => w.id === req.params.id && w.athlete_id === req.user.id)
  if (idx >= 0) { DB.workouts[idx].status = 'SKIPPED'; DB.workouts[idx].updated_at = now(); save() }
  res.json({ ok: true })
})

// ════════════════════════════════════════════════════════════════════════════
//  DISPOSITIVOS — FLUJO 3: Garmin + Whoop se "pegan" al workout
// ════════════════════════════════════════════════════════════════════════════

// Sync Garmin → adjunta métricas al workout
app.post('/api/athlete/sync/garmin', auth, (req, res) => {
  const { workoutId, data } = req.body
  const entry = { id: uuid(), athlete_id: req.user.id, workout_id: workoutId || null, device: 'garmin', synced_at: now(), data }
  DB.device_syncs.push(entry)
  if (workoutId) {
    const idx = DB.workouts.findIndex(w => w.id === workoutId && w.athlete_id === req.user.id)
    if (idx >= 0) { DB.workouts[idx].garmin_data = data; DB.workouts[idx].updated_at = now() }
  }
  save()
  res.json({ ok: true, syncId: entry.id })
})

// Sync Whoop → adjunta métricas al workout
app.post('/api/athlete/sync/whoop', auth, (req, res) => {
  const { workoutId, data } = req.body
  const entry = { id: uuid(), athlete_id: req.user.id, workout_id: workoutId || null, device: 'whoop', synced_at: now(), data }
  DB.device_syncs.push(entry)
  if (workoutId) {
    const idx = DB.workouts.findIndex(w => w.id === workoutId && w.athlete_id === req.user.id)
    if (idx >= 0) { DB.workouts[idx].whoop_data = data; DB.workouts[idx].updated_at = now() }
  }
  save()
  res.json({ ok: true, syncId: entry.id })
})

// Últimas sincronizaciones
app.get('/api/athlete/syncs/latest', auth, (req, res) => {
  const syncs = DB.device_syncs.filter(s => s.athlete_id === req.user.id)
  const garmin = [...syncs].filter(s => s.device === 'garmin').sort((a, b) => b.synced_at.localeCompare(a.synced_at))[0] || null
  const whoop  = [...syncs].filter(s => s.device === 'whoop' ).sort((a, b) => b.synced_at.localeCompare(a.synced_at))[0] || null
  res.json({ garmin, whoop })
})

// Reporte coach: workout con feedback + syncs (real vs planificado)
app.get('/api/coach/athletes/:athleteId/workouts/:workoutId/report', auth, (req, res) => {
  const w = DB.workouts.find(w => w.id === req.params.workoutId && w.athlete_id === req.params.athleteId)
  if (!w) return res.status(404).json({ error: 'No encontrado' })
  const syncs = DB.device_syncs.filter(s => s.workout_id === req.params.workoutId)
  res.json({ ...w, device_syncs: syncs })
})

// ════════════════════════════════════════════════════════════════════════════
//  HELPERS DE CARGA — CTL / ATL / TSB usando EWA (exponentially weighted avg)
// ════════════════════════════════════════════════════════════════════════════

function computePMC(workouts, seedCtl = 0, seedAtl = 0) {
  // EWA con τ = 42d (CTL) y 7d (ATL). Acepta semilla para evitar cold-start.
  const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date))
  let ctl = isFinite(seedCtl) ? seedCtl : 0
  let atl = isFinite(seedAtl) ? seedAtl : 0
  sorted.forEach(w => {
    const raw = Number(w.actual_tss ?? w.tss_planned ?? 0)
    const tss = isFinite(raw) ? raw : 0
    ctl = ctl + (tss - ctl) * (1 - Math.exp(-1 / 42))
    atl = atl + (tss - atl) * (1 - Math.exp(-1 / 7))
  })
  const ctlR = Math.round(ctl * 10) / 10
  const atlR = Math.round(atl * 10) / 10
  const tsbR = Math.round((ctlR - atlR) * 10) / 10
  return { ctl: isFinite(ctlR) ? ctlR : 0, atl: isFinite(atlR) ? atlR : 0, tsb: isFinite(tsbR) ? tsbR : 0 }
}

function weekStartISO() {
  const d = new Date()
  const dow = d.getDay() || 7
  const mon = new Date(d)
  mon.setDate(d.getDate() - dow + 1)
  return mon.toISOString().split('T')[0]
}

// ════════════════════════════════════════════════════════════════════════════
//  MOTOR DE ALERTAS INTELIGENTES — cruza Garmin + Whoop + Plan + Nutrición
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/athlete/alerts', auth, (req, res) => {
  const aid = req.user.id
  const alerts = []

  // Últimos 3 syncs de cada dispositivo (orden desc)
  const whoopSyncs  = DB.device_syncs.filter(s => s.athlete_id === aid && s.device === 'whoop').sort((a,b) => b.synced_at.localeCompare(a.synced_at)).slice(0,3)
  const garminSyncs = DB.device_syncs.filter(s => s.athlete_id === aid && s.device === 'garmin').sort((a,b) => b.synced_at.localeCompare(a.synced_at)).slice(0,3)

  // Últimos 7 workouts completados
  const completedWk = DB.workouts.filter(w => w.athlete_id === aid && w.status === 'COMPLETED').sort((a,b) => b.date.localeCompare(a.date)).slice(0,7)

  // Calcular CTL/ATL/TSB de todos los workouts del atleta (con baseline real)
  const allWk   = DB.workouts.filter(w => w.athlete_id === aid)
  const baseline = (DB.performance_baselines || []).find(b => b.athlete_id === aid) || {}
  const { ctl, atl, tsb } = computePMC(allWk, baseline.ctl_seed || 0, baseline.atl_seed || 0)

  // ── ALERTA 1: Sobreentrenamiento / Riesgo de Lesión ──────────────────────
  // Condición: TSB < -20 Y recovery Whoop < 50% en los últimos 2 syncs
  const last2Whoop = whoopSyncs.slice(0, 2)
  const criticalRecovery = last2Whoop.length >= 2 && last2Whoop.every(s => (s.data?.recovery_score ?? 100) < 50)
  const lowTSB = tsb < -20

  if (lowTSB && criticalRecovery) {
    alerts.push({
      id: 'overtraining', severity: 'critical', icon: '⚠️',
      title: 'Fatiga Crítica — Riesgo de Sobreentrenamiento',
      message: `TSB en ${tsb} (umbral crítico: −20) y recuperación Whoop < 50% por dos días consecutivos. El tejido muscular no tiene tiempo suficiente para supercompensar.`,
      action: 'Reducir volumen de entrenamiento un 30% hoy. Priorizar sueño y proteína.',
      data: { tsb: Math.round(tsb), recovery: last2Whoop[0]?.data?.recovery_score },
      triggered_at: now(),
    })
  }

  // ── ALERTA 2: Desconexión Nutricional (glucógeno) ────────────────────────
  // Condición: TSS real > TSS planificado × 1.20 en el último workout completado
  const lastW = completedWk[0]
  if (lastW?.actual_tss && lastW?.tss_planned && lastW.tss_planned > 0) {
    const ratio = lastW.actual_tss / lastW.tss_planned
    if (ratio > 1.2) {
      alerts.push({
        id: 'nutritional-disconnect', severity: 'warning', icon: '🥗',
        title: 'Déficit de Glucógeno Detectado',
        message: `TSS real (${lastW.actual_tss}) superó el objetivo planificado (${lastW.tss_planned}) en un ${Math.round((ratio - 1) * 100)}%. Con esa carga extra y carbohidratos por debajo del plan, el glucógeno muscular puede estar comprometido.`,
        action: 'Añadir 80–100g de carbohidratos de alto IG inmediatamente después del entreno.',
        data: { actual_tss: lastW.actual_tss, planned_tss: lastW.tss_planned, ratio: ratio.toFixed(2) },
        triggered_at: now(),
      })
    }
  }

  // ── ALERTA 3: Sueño / Eficiencia ─────────────────────────────────────────
  // Condición: último sync Whoop con sleep_hours < 6.5 (proxy de eficiencia < 75%)
  const latestW = whoopSyncs[0]
  if (latestW) {
    const sh = latestW.data?.sleep_hours ?? 8
    const hrv = latestW.data?.hrv_ms ?? 60
    if (sh < 6.5) {
      alerts.push({
        id: 'sleep-alert', severity: 'warning', icon: '😴',
        title: 'Eficiencia de Sueño Insuficiente',
        message: `Sueño registrado: ${sh}h (umbral mínimo: 6.5h efectivas = 75% de eficiencia). Con menos de 6.5h el nivel de testosterona y la síntesis proteica caen significativamente en atletas de fuerza.`,
        action: 'Meta esta noche: 8–9h. Sin pantallas 1h antes. Magnesio 400mg al dormir.',
        data: { sleep_hours: sh, hrv_ms: hrv },
        triggered_at: now(),
      })
    }
  }

  res.json({ alerts, meta: { tsb: Math.round(tsb), ctl: Math.round(ctl), atl: Math.round(atl), evaluated_at: now() } })
})

// ════════════════════════════════════════════════════════════════════════════
//  RESUMEN EJECUTIVO — agrega los 4 bloques en un solo endpoint
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/athlete/executive-summary', auth, (req, res) => {
  const aid = req.user.id

  // ── Rendimiento ──────────────────────────────────────────────────────────
  // Bug fix: usar pmc_cache (construido con datos reales) en vez de computePMC que incluye workouts planeados futuros
  const pmcCacheArr = Array.isArray(DB.pmc_cache) ? DB.pmc_cache : (DB.pmc_cache?.data || [])
  const lastPMC = pmcCacheArr[pmcCacheArr.length - 1] || {}
  const ctl = lastPMC.ctl || 0
  const atl = lastPMC.atl || 0
  const tsb = lastPMC.tsb || 0

  // Bug fix: solo workouts COMPLETADOS para TSS real de la semana (no contar planeados futuros)
  const allWk  = DB.workouts.filter(w => w.athlete_id === aid)
  const wkStart    = weekStartISO()
  const wkWorkouts = allWk.filter(w => w.date >= wkStart && w.status === 'COMPLETED')
  const weeklyTSS  = wkWorkouts.reduce((s, w) => s + (Number(w.actual_tss ?? 0) || 0), 0)

  // Mini PMC: últimas 6 semanas reales + proyección plan hasta CAC (Jul 25)
  const realSlice = pmcCacheArr.slice(-42).map(p => ({ date: p.date, tss: p.tss || 0, ctl: p.ctl, atl: p.atl, tsb: p.tsb, projected: false }))
  // Proyectar hacia adelante usando workouts PENDING del plan
  const today = localDate()
  const planFuture = allWk.filter(w => w.date > today && w.date <= '2026-07-26').sort((a,b) => a.date.localeCompare(b.date))
  let projCtl = lastPMC.ctl || 0, projAtl = lastPMC.atl || 0
  const kCtl = 1 - Math.exp(-1/42), kAtl = 1 - Math.exp(-1/7)
  // Iterar fecha a fecha desde mañana hasta el fin del plan
  const projEnd = new Date('2026-07-26T12:00:00Z')
  const projStart = new Date(today + 'T12:00:00Z')
  projStart.setUTCDate(projStart.getUTCDate() + 1)
  const planTssByDate = {}
  planFuture.forEach(w => { planTssByDate[w.date] = (w.tss_planned || 0) })
  const projPMC = []
  for (let d = new Date(projStart); d <= projEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10)
    const tss = planTssByDate[dateStr] || 0
    projCtl = projCtl * (1 - kCtl) + tss * kCtl
    projAtl = projAtl * (1 - kAtl) + tss * kAtl
    projPMC.push({ date: dateStr, tss, ctl: Math.round(projCtl * 10) / 10, atl: Math.round(projAtl * 10) / 10, tsb: Math.round((projCtl - projAtl) * 10) / 10, projected: true })
  }
  const miniPMC = [...realSlice, ...projPMC]

  // ── Recuperación ─────────────────────────────────────────────────────────
  // Bug fix: filtrar solo syncs con datos reales (no auto-syncs diurnos con recovery_score null)
  const whoopSyncs = DB.device_syncs
    .filter(s => s.athlete_id === aid && s.device === 'whoop' && s.data?.recovery_score != null)
    .sort((a,b) => b.synced_at.localeCompare(a.synced_at))
    .slice(0, 7)
  // Usar lectura más reciente como valor principal (no promedio) — coincide con el dashboard
  const latestWhoop = whoopSyncs[0]?.data || null
  const hrv7d   = latestWhoop?.hrv_ms   ?? null
  const rec7d   = latestWhoop?.recovery_score ?? null
  const sleep7d = latestWhoop?.sleep_hours ?? null
  const rhr7d   = latestWhoop?.rhr_bpm ?? null
  const strain7d = latestWhoop?.strain ?? null

  // ── Nutrición ─────────────────────────────────────────────────────────────
  const garminSyncs = DB.device_syncs.filter(s => s.athlete_id === aid && s.device === 'garmin').sort((a,b) => b.synced_at.localeCompare(a.synced_at)).slice(0, 7)
  const calBurned7d = garminSyncs.reduce((s,x) => s + (x.data?.calories || 0), 0)
  const latestNP = (DB.nutrition_plans || []).filter(p => p.athlete_id === aid).sort((a,b) => b.date.localeCompare(a.date))[0]
  const calIn7d = latestNP ? latestNP.calories * 7 : null
  const calBalance = calIn7d && calBurned7d ? calIn7d - calBurned7d : null

  // ── Antropometría ─────────────────────────────────────────────────────────
  const bcHistory = (DB.body_compositions || []).filter(b => b.athlete_id === aid).sort((a,b) => a.date.localeCompare(b.date))
  const latestBC  = bcHistory[bcHistory.length - 1] || null
  const prevBC    = bcHistory[bcHistory.length - 2] || null
  const trends = latestBC && prevBC ? {
    weight: latestBC.weight_kg < prevBC.weight_kg ? 'down' : latestBC.weight_kg > prevBC.weight_kg ? 'up' : 'flat',
    fat:    latestBC.bodyfat_pct < prevBC.bodyfat_pct ? 'down' : latestBC.bodyfat_pct > prevBC.bodyfat_pct ? 'up' : 'flat',
    muscle: latestBC.muscle_kg > prevBC.muscle_kg ? 'up' : latestBC.muscle_kg < prevBC.muscle_kg ? 'down' : 'flat',
  } : null

  res.json({
    performance: { ctl, atl, tsb, weekly_tss: weeklyTSS, tss_goal: 580, mini_pmc: miniPMC },
    recovery:    { hrv_7d: hrv7d, hrv_baseline: 58, recovery_7d: rec7d, sleep_7d: sleep7d, rhr: rhr7d, strain: strain7d },
    nutrition:   { calories_in_7d: calIn7d, calories_burned_7d: calBurned7d, balance_7d: calBalance, daily_plan: latestNP ? { protein_g: latestNP.protein_g, carbs_g: latestNP.carbs_g, fat_g: latestNP.fat_g, calories: latestNP.calories } : null },
    anthropometry: latestBC ? { ...latestBC, trends } : null,
    generated_at: now(),
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  ANÁLISIS IA — Insights cruzados + recomendaciones + correlaciones
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/athlete/ai-analysis', auth, (req, res) => {
  const aid    = req.user.id
  const today  = localDate()

  // ── Datos base ───────────────────────────────────────────────────────────
  const pmcArr    = Array.isArray(DB.pmc_cache) ? DB.pmc_cache : (DB.pmc_cache?.data || [])
  const lastPMC   = pmcArr[pmcArr.length - 1] || {}
  const ctl = lastPMC.ctl || 0, atl = lastPMC.atl || 0, tsb = lastPMC.tsb || 0

  const whoopSyncs = DB.device_syncs
    .filter(s => s.athlete_id === aid && s.device === 'whoop' && s.data?.recovery_score != null)
    .sort((a,b) => b.synced_at.localeCompare(a.synced_at))
  const latestW  = whoopSyncs[0]?.data || null
  const rec      = latestW?.recovery_score ?? null
  const hrv      = latestW?.hrv_ms ?? null
  const sleep    = latestW?.sleep_hours ?? null
  const rhr      = latestW?.rhr_bpm ?? null

  const allWk     = DB.workouts.filter(w => w.athlete_id === aid)
  const todayWk   = allWk.find(w => w.date === today) || null
  const doneWk    = allWk.filter(w => w.status === 'COMPLETED')

  const nutrition = (DB.nutrition_plans || []).filter(p => p.athlete_id === aid).sort((a,b) => b.date.localeCompare(a.date))[0] || null
  const bc        = (DB.body_compositions || []).filter(b => b.athlete_id === aid).sort((a,b) => a.date.localeCompare(b.date)).pop() || null

  const wkStart   = weekStartISO()
  const weekDone  = allWk.filter(w => w.date >= wkStart && w.status === 'COMPLETED')
  const weekTSS   = weekDone.reduce((s,w) => s + (Number(w.actual_tss ?? 0) || 0), 0)
  const daysToRace = Math.max(0, Math.ceil((new Date('2026-08-01') - new Date(today + 'T12:00:00Z')) / 86400000))

  // ── Plan phase detection ─────────────────────────────────────────────────
  const planPhases = [
    { name:'F1 Base Técnica', start:'2026-06-07', end:'2026-06-21', color:'#4f8ef7', tssWeek:360 },
    { name:'F2 Carga',        start:'2026-06-22', end:'2026-07-12', color:'#f97316', tssWeek:490 },
    { name:'F3 Especificidad',start:'2026-07-13', end:'2026-07-26', color:'#22c55e', tssWeek:430 },
    { name:'F4 Taper',        start:'2026-07-27', end:'2026-08-01', color:'#eab308', tssWeek:160 },
  ]
  const currentPhase = planPhases.find(p => today >= p.start && today <= p.end) || planPhases[0]
  const tssGoal   = currentPhase.tssWeek || 360
  const planDayNum   = Math.max(1, Math.ceil((new Date(today + 'T12:00:00Z') - new Date(currentPhase.start + 'T12:00:00Z')) / 86400000) + 1)
  const phaseTotalDays = Math.ceil((new Date(currentPhase.end + 'T12:00:00Z') - new Date(currentPhase.start + 'T12:00:00Z')) / 86400000) + 1

  // ── Insights ─────────────────────────────────────────────────────────────
  const insights = []

  // Recovery
  if (rec != null) {
    const hDiff  = hrv != null ? Math.round(hrv - 58) : null
    const recLvl = rec >= 67 ? 'green' : rec >= 34 ? 'yellow' : 'red'
    const recTxt = rec >= 67
      ? `Recovery ${rec}% — sistema nervioso bien recuperado. HRV ${hrv}ms (${hDiff >= 0 ? '+' + hDiff : hDiff}ms vs baseline). Listo para entrenamiento de carga.`
      : rec >= 34
      ? `Recovery ${rec}% — moderado. HRV ${hrv}ms. Tolera volumen pero evita intensidad máxima hoy.`
      : `Recovery ${rec}% — bajo. Prioriza recuperación activa. HRV ${hrv}ms indica fatiga del SNC.`
    insights.push({ pillar:'recovery', level:recLvl, icon:'🫀', title:`Recovery ${rec}% · HRV ${hrv}ms`, body:recTxt })
  }

  // Performance / plan
  const tsbLvl  = tsb > 5 ? 'green' : tsb >= -10 ? 'blue' : tsb >= -20 ? 'yellow' : 'red'
  const tsbBody = tsb > 5
    ? `TSB +${tsb} — forma positiva. El cuerpo está fresco para alta intensidad. CTL ${ctl} estable.`
    : tsb >= -10
    ? `TSB ${tsb} — zona de entrenamiento productivo. CTL ${ctl} en construcción (${currentPhase.name}, día ${planDayNum}/${phaseTotalDays}).`
    : tsb >= -20
    ? `TSB ${tsb} — carga acumulada. Normal para ${currentPhase.name}. Monitorea RPE. CTL ${ctl} creciendo.`
    : `TSB ${tsb} — sobrecarga alta. Considera ajuste de carga con Coach Erick. CTL ${ctl}.`
  insights.push({ pillar:'performance', level:tsbLvl, icon:'📈', title:`${currentPhase.name} · Día ${planDayNum}`, body:tsbBody })

  // Nutrition — usa plan Ivonne (125g del plan); nutrition_plans en BD contiene metas, no ingesta real
  {
    const protPlan  = 125  // lo que provee el plan de Ivonne tal como está diseñado
    const protGoal  = 198  // meta Bullshark Lab
    const protEff   = protPlan  // siempre plan Ivonne; food log diario no está implementado aún
    const protDiff  = protGoal - protEff
    const nutLvl    = protDiff <= 0 ? 'green' : protDiff <= 30 ? 'yellow' : protDiff <= 60 ? 'orange' : 'red'
    const gapMsg    = protDiff > 0
      ? `Faltan ${protDiff}g — añade shake 30g whey + yogur griego 200g = +${Math.round(30*0.8+20)}g. Meta: ${protGoal}g/día`
      : `Objetivo cubierto. Mantén el ritmo.`
    const protColor = nutLvl === 'green' ? '#22c55e' : nutLvl === 'yellow' ? '#eab308' : '#f97316'
    insights.push({
      pillar: 'nutrition', level: nutLvl, icon: '🥩',
      title: `Proteína ${protEff}g / ${protGoal}g · ${Math.round(protEff/protGoal*100)}%`,
      body: `Plan Ivonne provee ~${protPlan}g/día (${Math.round(protPlan/protGoal*100)}% de meta). ${gapMsg}. Déficit calórico −300 kcal/día alineado con composición corporal CAC.`,
      prot_current: protEff, prot_goal: protGoal, prot_pct: Math.round(protEff/protGoal*100), prot_color: protColor,
    })
  }

  // Body comp
  if (bc) {
    const bfDiff  = Math.round((bc.bodyfat_pct - 18) * 10) / 10
    const wDiff   = Math.round((bc.weight_kg - 86) * 10) / 10
    const bcLvl   = bfDiff <= 0 ? 'green' : bfDiff <= 3 ? 'yellow' : 'orange'
    insights.push({ pillar:'body', level:bcLvl, icon:'⚖️', title:`Peso ${bc.weight_kg}kg · Grasa ${bc.bodyfat_pct}%`,
      body:`Grasa ${bc.bodyfat_pct}% (meta <18%, faltan ${bfDiff}% · ${Math.round(bfDiff * bc.weight_kg / 100 * 10)/10}kg de grasa). Peso objetivo: 86kg (diff ${wDiff > 0 ? '+' : ''}${wDiff}kg). Músculo ${bc.muscle_kg}kg ✓.` })
  }

  // ── Recomendaciones ──────────────────────────────────────────────────────
  const recommendations = []

  // Workout de hoy
  if (todayWk && todayWk.status !== 'COMPLETED') {
    const segs = (todayWk.segments || []).slice(0,2).map(s => s.name).join(' · ') || ''
    recommendations.push({
      priority:'high', icon:'🏋️', category:'Entrenamiento',
      title: todayWk.name,
      body: `${todayWk.duration_min || '—'}' · TSS ~${todayWk.tss_planned || '—'} · ${segs}`
    })
  } else if (todayWk && todayWk.status === 'COMPLETED') {
    recommendations.push({ priority:'done', icon:'✅', category:'Entrenamiento', title:'Sesión completada hoy', body:`TSS ${todayWk.actual_tss || todayWk.tss_planned} · RPE ${todayWk.actual_rpe || '—'}/10` })
  }

  // Nutrición — siempre mostrar: el plan Ivonne da 125g vs meta 198g = gap de 73g
  {
    const protPlan = 125, protGoal = 198, protDiff = protGoal - protPlan
    recommendations.push({ priority:'medium', icon:'🥩', category:'Nutrición', title:`+${protDiff}g proteína · cerrar brecha hoy`, body:`Plan Ivonne provee ~${protPlan}g/día (meta ${protGoal}g). Añade shake 30g whey + 200g yogur griego = +44g → llegas a ~169g. Progreso diario cierra el gap gradualmente.` })
  }

  // Sueño
  if (sleep != null && sleep < 8) {
    recommendations.push({ priority:'medium', icon:'😴', category:'Recuperación', title:'Apunta a 8.5h esta noche', body:`Sueño anterior: ${sleep}h. Duerme 21:30–22:00 para alcanzar 8.5h. El sueño impacta directamente HRV y rendimiento de mañana.` })
  } else if (sleep != null && sleep >= 8) {
    recommendations.push({ priority:'low', icon:'😴', category:'Recuperación', title:`Sueño ${sleep}h — mantén el ritmo`, body:`Excelente. Sigue durmiendo 21:30–22:00. La consistencia en el sueño mantiene HRV estable.` })
  }

  // ── Correlaciones calculadas ─────────────────────────────────────────────
  const correlations = []

  // Correlación 1: Recovery score → TSS realizado (cross reference whoop syncs con workouts)
  const matchedPairs = []
  whoopSyncs.forEach(sync => {
    const syncDate = sync.synced_at.slice(0,10)
    // Find workout on same day or day after the sync
    const wkAfter = allWk.find(w => (w.date === syncDate || w.date === (() => { const d=new Date(syncDate+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10) })()) && w.status === 'COMPLETED' && w.actual_tss)
    if (wkAfter) matchedPairs.push({ rec: sync.data.recovery_score, hrv: sync.data.hrv_ms, tss: wkAfter.actual_tss, rpe: wkAfter.actual_rpe })
  })

  if (matchedPairs.length >= 2) {
    const highRec = matchedPairs.filter(p => p.rec >= 67)
    const lowRec  = matchedPairs.filter(p => p.rec < 67)
    if (highRec.length && lowRec.length) {
      const avgHigh = Math.round(highRec.reduce((s,p)=>s+p.tss,0)/highRec.length)
      const avgLow  = Math.round(lowRec.reduce((s,p)=>s+p.tss,0)/lowRec.length)
      const diff    = Math.round((avgHigh - avgLow) / avgLow * 100)
      correlations.push({ icon:'🫀', title:'Recovery → Rendimiento', value:`+${diff}% TSS`, body:`Con recovery ≥67%: ${avgHigh} TSS prom vs ${avgLow} con recovery bajo. Mayor disponibilidad = mejor entrenamiento.`, strength: Math.min(matchedPairs.length, 5) })
    }
  } else {
    correlations.push({ icon:'🫀', title:'Recovery → Rendimiento', value:'—', body:`Se necesitan ≥2 semanas de datos pareados para calcular correlación HRV/Recovery × TSS.`, strength:0, pending:true })
  }

  // Correlación 2: Sueño → RPE
  const sleepRpePairs = whoopSyncs.map(sync => {
    const nextDay = (() => { const d=new Date(sync.synced_at.slice(0,10)+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10) })()
    const wk = allWk.find(w => w.date === nextDay && w.actual_rpe != null)
    return wk ? { sleep: sync.data.sleep_hours, rpe: wk.actual_rpe } : null
  }).filter(Boolean)

  if (sleepRpePairs.length >= 2) {
    const goodSleep = sleepRpePairs.filter(p => p.sleep >= 8)
    const poorSleep = sleepRpePairs.filter(p => p.sleep < 8)
    if (goodSleep.length && poorSleep.length) {
      const rpeGood = +(goodSleep.reduce((s,p)=>s+p.rpe,0)/goodSleep.length).toFixed(1)
      const rpePoor = +(poorSleep.reduce((s,p)=>s+p.rpe,0)/poorSleep.length).toFixed(1)
      correlations.push({ icon:'😴', title:'Sueño → RPE', value:`−${+(rpePoor-rpeGood).toFixed(1)} pts`, body:`Con ≥8h de sueño: RPE ${rpeGood} vs ${rpePoor} con <8h. Menos esfuerzo percibido con mejor recuperación.`, strength:sleepRpePairs.length })
    }
  } else {
    correlations.push({ icon:'😴', title:'Sueño → Esfuerzo percibido', value:'—', body:`Con datos actuales: sueño ${sleep}h → entrenamiento mañana. Se necesitan más sesiones completadas para correlación estadística.`, strength:0, pending:true })
  }

  // Correlación 3: Tendencia CTL (real vs proyectado)
  const planWks = allWk.filter(w => w.status !== 'COMPLETED').sort((a,b)=>a.date.localeCompare(b.date)).slice(0,7)
  const projectedCTLAtRace = (() => {
    let c = ctl, a = atl
    const kc = 1-Math.exp(-1/42), ka = 1-Math.exp(-1/7)
    planWks.forEach(w => { const t = w.tss_planned||0; c=c+(t-c)*kc; a=a+(t-a)*ka })
    return Math.round(c * 10)/10
  })()
  correlations.push({ icon:'📈', title:'CTL proyectado', value:`${projectedCTLAtRace} CTL`, body:`Si cumples el plan F1 esta semana: CTL proyectado ${projectedCTLAtRace} en 7 días (vs ${ctl} hoy). Tendencia positiva en construcción.`, strength:3, projected:true })

  // ── Radar scores 0-100 ───────────────────────────────────────────────────
  const radarRendimiento = (() => {
    let s = tsb < -25 ? 30 : tsb < -15 ? 58 : tsb < -5 ? 74 : tsb < 5 ? 82 : 88
    if (ctl >= 20) s = Math.min(100, s + 5)  // CTL en construcción
    return s
  })()
  const radarNutricion   = Math.round(Math.min(100, (125 / 198) * 90))  // plan provee 125g vs 198g meta
  const radarDescanso    = rec != null ? Math.min(100, rec) : 50
  const radarSueno       = sleep != null ? Math.min(100, Math.round((sleep / 8) * 100)) : 50

  const radarInterpLines = []
  if (radarSueno >= 80)    radarInterpLines.push(`Sueño ${sleep ?? '—'}h ${radarSueno >= 100 ? '✓ óptimo' : 'adecuado'} — ventana anabólica nocturna aprovechada.`)
  if (radarDescanso >= 67) radarInterpLines.push(`Recovery ${rec ?? '—'}% — SNC recuperado, listo para carga ${currentPhase.name}.`)
  else if (radarDescanso >= 34) radarInterpLines.push(`Recovery ${rec ?? '—'}% — intensidad moderada recomendada en ${currentPhase.name}.`)
  else radarInterpLines.push(`Recovery ${rec ?? '—'}% crítico — considera reducir carga hoy, priorizar sueño.`)
  radarInterpLines.push(`Proteína es el principal limitante: +73g/día aceleran adaptación muscular ~15% en 2-3 semanas. Añade shake 30g whey + yogur griego 200g.`)
  radarInterpLines.push(radarRendimiento >= 70 ? `TSB ${tsb > 0 ? '+' : ''}${Math.round(tsb)} en zona de entrenamiento — progresión ${currentPhase.name} controlada hacia CAC.` : `TSB ${Math.round(tsb)} elevado — acumulación de fatiga en ${currentPhase.name}, monitorear RPE.`)
  const radarInterpretacion = radarInterpLines.join(' ')

  res.json({
    insights,
    recommendations,
    correlations,
    radar_scores: {
      rendimiento: radarRendimiento,
      nutricion: radarNutricion,
      descanso: radarDescanso,
      sueno: radarSueno,
    },
    radar_interpretacion: radarInterpretacion,
    summary: {
      ctl, atl, tsb, weekTSS, tssGoal,
      rec, hrv, sleep, rhr,
      weight: bc?.weight_kg, bodyfat: bc?.bodyfat_pct, muscle: bc?.muscle_kg,
      plan_phase: currentPhase.name, plan_phase_color: currentPhase.color,
      plan_day: planDayNum, plan_total_days: phaseTotalDays,
      days_to_race: daysToRace,
      completed_workouts: doneWk.length,
      total_plan_workouts: allWk.length,
    },
    generated_at: now(),
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  COMPOSICIÓN CORPORAL — Flujo nutrición × entrenamiento
// ════════════════════════════════════════════════════════════════════════════

// Historial completo de mediciones del atleta
app.get('/api/athlete/body-composition', auth, (req, res) => {
  const recs = (DB.body_compositions || [])
    .filter(r => r.athlete_id === req.user.id)
    .sort((a, b) => a.date.localeCompare(b.date))
  res.json(recs)
})

// Última medición (la más reciente por fecha)
app.get('/api/athlete/body-composition/latest', auth, (req, res) => {
  const recs = (DB.body_compositions || [])
    .filter(r => r.athlete_id === req.user.id)
    .sort((a, b) => b.date.localeCompare(a.date))
  res.json(recs[0] || null)
})

// Guardar nueva medición (atleta o nutriólogo)
app.post('/api/athlete/body-composition', auth, (req, res) => {
  const { athleteId, date, weight_kg, height_cm, bodyfat_pct, muscle_kg, goal_weight_kg, notes } = req.body
  const targetId = athleteId ? resolve(athleteId) : req.user.id
  const rec = {
    id: uuid(), athlete_id: targetId,
    date: date || localDate(),
    weight_kg:      weight_kg      || null,
    height_cm:      height_cm      || 178,
    bodyfat_pct:    bodyfat_pct    || null,
    muscle_kg:      muscle_kg      || null,
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
app.get('/api/coach/athletes/:id/body-composition', auth, (req, res) => {
  const recs = (DB.body_compositions || [])
    .filter(r => r.athlete_id === req.params.id)
    .sort((a, b) => a.date.localeCompare(b.date))
  res.json(recs)
})

// ════════════════════════════════════════════════════════════════════════════
//  NUTRIÓLOGA — plan nutricional por atleta
// ════════════════════════════════════════════════════════════════════════════

// Atletas asignados a la nutrióloga (reutiliza coach_athletes)
app.get('/api/nutritionist/athletes', auth, (req, res) => {
  if (req.user.role !== 'NUTRITIONIST' && req.user.role !== 'COACH')
    return res.status(403).json({ error: 'Solo nutriólogos o coaches' })
  const ids = DB.coach_athletes.filter(ca => ca.coach_id === 'coach-erick-001').map(ca => ca.athlete_id)
  res.json(DB.users.filter(u => ids.includes(u.id)).map(({ id, name, email }) => ({ id, name, email })))
})

// Plan nutricional de un atleta (más reciente, o por fecha)
app.get('/api/nutritionist/athletes/:id/nutrition-plan', auth, (req, res) => {
  const { date } = req.query
  const plans = (DB.nutrition_plans || []).filter(p => p.athlete_id === req.params.id)
  if (date) {
    return res.json(plans.find(p => p.date === date) || null)
  }
  const sorted = plans.sort((a, b) => b.date.localeCompare(a.date))
  res.json(sorted[0] || null)
})

// El atleta ve su propio plan
app.get('/api/athlete/nutrition-plan', auth, (req, res) => {
  const plans = (DB.nutrition_plans || []).filter(p => p.athlete_id === req.user.id)
  const sorted = plans.sort((a, b) => b.date.localeCompare(a.date))
  res.json(sorted[0] || null)
})

// Plan nutricional de hoy — incluye targets del screening y ajuste por workout
app.get('/api/nutrition/today', auth, (req, res) => {
  const plans  = (DB.nutrition_plans || []).filter(p => p.athlete_id === req.user.id)
  const latest = plans.sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!latest) return res.json({ ok: false, today: null })

  const todayWorkout = DB.workouts.find(w => w.athlete_id === req.user.id && w.date === localDate())
  const dMin    = todayWorkout?.duration_min || 0
  const kcalAdj = Math.round(dMin * 10)   // ~10 kcal/min de ajuste por entreno

  res.json({
    ok:   true,
    today: {
      calories:  (latest.calories || 2673) + kcalAdj,
      carbsG:    latest.carbs_g    || 270,
      proteinG:  latest.protein_g  || 198,
      fatG:      latest.fat_g      || 89,
      // Ingesta actual (del screening)
      actual_calories: latest.actual_calories || null,
      actual_protein:  latest.actual_protein_g || null,
      actual_carbs:    latest.actual_carbs_g   || null,
      // Metadata del screening
      performance_score: latest.performance_score || null,
      red_flags:         latest.red_flags         || [],
      quick_wins:        latest.quick_wins         || [],
      source:            latest.source             || 'manual',
    },
  })
})

// Nutrióloga guarda o actualiza un plan (upsert por fecha + atleta)
app.post('/api/nutritionist/nutrition-plan', auth, (req, res) => {
  const { athleteId, date, day_type, calories, protein_g, carbs_g, fat_g, notes, meals, supplements } = req.body
  if (!athleteId) return res.status(400).json({ error: 'athleteId requerido' })
  const targetId = resolve(athleteId)
  const planDate = date || localDate()
  if (!DB.nutrition_plans) DB.nutrition_plans = []
  const idx = DB.nutrition_plans.findIndex(p => p.athlete_id === targetId && p.date === planDate)
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

// ── GARMIN OAUTH 1.0a ─────────────────────────────────────────────────────────

// TSS desde Frecuencia Cardíaca de Reserva (Karvonen) — más preciso que RPE simple
function _tssFromHR(durationMin, hrAvg, hrMax, hrRest = 43) {
  const maxHR    = hrMax > 100 ? hrMax : 185
  const reserve  = maxHR - hrRest
  const intensity = reserve > 0 ? Math.max(0, Math.min(1.5, (hrAvg - hrRest) / reserve)) : 0
  return Math.max(0, Math.round(intensity ** 2 * (durationMin / 60) * 100))
}

const _garminEmoji = { RUNNING:'🏃', CYCLING:'🚴', SWIMMING:'🏊', SAILING:'⛵', HIKING:'🥾', STRENGTH_TRAINING:'🏋️', YOGA:'🧘' }

// Estado de la conexión Garmin (credenciales configuradas = conectado)
app.get('/api/athlete/garmin/status', auth, (req, res) => {
  res.json({ connected: !!(GARMIN_EMAIL && GARMIN_PASSWORD), updated_at: null })
})

// Descarga la actividad más reciente de Garmin Connect y calcula TSS via HR Reserve
app.get('/api/athlete/garmin/sync', auth, async (req, res) => {
  if (!GARMIN_EMAIL || !GARMIN_PASSWORD) {
    return res.status(503).json({ error: 'config_missing', message: 'Configura GARMIN_EMAIL y GARMIN_PASSWORD en .env' })
  }
  try {
    const activities = await garminFetch(gc => gc.getActivities(0, 1))
    if (!activities || !activities.length) {
      return res.json({ ok: true, message: 'Sin actividades recientes en Garmin Connect', data: null })
    }
    const act = activities[0]

    // Campos que devuelve garmin-connect
    const durationMin  = Math.round((act.duration || 0) / 60)
    const hrAvg        = act.averageHR        || act.averageHeartRate || 0
    const hrMax        = act.maxHR            || act.maxHeartRate     || 0
    const activityType = act.activityType?.typeKey || act.activityType || 'OTHER'
    const activityName = act.activityName     || activityType
    const calories     = act.calories         || 0

    const tss = _tssFromHR(durationMin, hrAvg, hrMax)

    const garminData = {
      activity_id:   act.activityId   || null,
      activity_name: activityName,
      activity_type: activityType,
      duration_min:  durationMin,
      hr_avg:        hrAvg,
      hr_max:        hrMax,
      calories,
      tss_actual:    tss,
      synced_at:     now(),
    }

    DB.device_syncs.push({ id: uuid(), athlete_id: req.user.id, workout_id: null, device: 'garmin', synced_at: now(), data: garminData })

    // Actualizar workout de hoy (si existe) con TSS real para que el PMC lo refleje
    const todayStr = localDate()
    const wIdx = DB.workouts.findIndex(w => w.athlete_id === req.user.id && w.date === todayStr && w.status === 'COMPLETED')
    let updatedWorkout = null
    if (wIdx >= 0) {
      DB.workouts[wIdx].actual_tss  = tss
      DB.workouts[wIdx].garmin_data = garminData
      DB.workouts[wIdx].updated_at  = now()
      updatedWorkout = DB.workouts[wIdx]
    }
    save()
    rebuildPMCForAthlete(req.user.id).catch(e => console.error('[PMC rebuild/garmin]', e.message))
    res.json({ ok: true, data: garminData, tss, updated_workout: updatedWorkout })
  } catch (e) {
    console.error('[Garmin sync]', e.message)
    _gcReady = false // forzar re-login en el próximo intento
    res.status(502).json({ error: 'garmin_api_error', message: e.message })
  }
})

// ── WHOOP OAUTH2 ──────────────────────────────────────────────────────────────

// Paso 1: redirige al login oficial de Whoop
app.get('/api/auth/whoop', authBrowser, (req, res) => {
  if (!WHOOP_CLIENT_ID) {
    return res.status(503).json({ error: 'config_missing', message: 'Agrega WHOOP_CLIENT_ID en el archivo .env y reinicia el servidor.' })
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     WHOOP_CLIENT_ID,
    redirect_uri:  WHOOP_REDIRECT_URI,
    scope:         'read:recovery read:sleep read:body_measurement read:workout offline',
    state:         req.user.id,
  })
  res.redirect(`https://api.prod.whoop.com/oauth/oauth2/auth?${params}`)
})

// Paso 2: Whoop redirige aquí con el código de autorización
app.get('/api/auth/whoop/callback', async (req, res) => {
  const { code, state: athleteId, error } = req.query
  if (error || !code) return res.redirect('/athlete-dashboard.html?whoop=error')
  try {
    const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_id:     WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
        redirect_uri:  WHOOP_REDIRECT_URI,
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) return res.redirect('/athlete-dashboard.html?whoop=error')
    const entry = {
      athlete_id:    athleteId,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at:    tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      updated_at:    now(),
    }
    const idx = DB.whoop_tokens.findIndex(t => t.athlete_id === athleteId)
    if (idx >= 0) DB.whoop_tokens[idx] = entry
    else DB.whoop_tokens.push(entry)
    save()
    res.redirect('/athlete-dashboard.html?whoop=connected')
  } catch (e) {
    console.error('[Whoop OAuth]', e.message)
    res.redirect('/athlete-dashboard.html?whoop=error')
  }
})

// Paso 3: descarga datos reales de la API de Whoop y los guarda en device_syncs
app.get('/api/athlete/whoop/sync', auth, async (req, res) => {
  const tokenEntry = DB.whoop_tokens.find(t => t.athlete_id === req.user.id)
  if (!tokenEntry) return res.status(404).json({ error: 'no_token', message: 'Cuenta Whoop no vinculada.' })

  // Siempre intentar refrescar (el token dura 1 hora)
  let accessToken = tokenEntry.access_token
  if (tokenEntry.refresh_token) {
    try {
      const r = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token', refresh_token: tokenEntry.refresh_token,
          client_id: WHOOP_CLIENT_ID, client_secret: WHOOP_CLIENT_SECRET,
        }),
      })
      const fresh = await r.json()
      if (fresh.access_token) {
        accessToken = fresh.access_token
        const idx = DB.whoop_tokens.findIndex(t => t.athlete_id === req.user.id)
        DB.whoop_tokens[idx] = {
          ...tokenEntry,
          access_token:  fresh.access_token,
          refresh_token: fresh.refresh_token || tokenEntry.refresh_token,
          expires_at:    fresh.expires_in ? new Date(Date.now() + fresh.expires_in * 1000).toISOString() : null,
          updated_at:    now(),
        }
        save()
      }
    } catch (_e) { /* continúa con token anterior */ }
  }

  const h = { Authorization: `Bearer ${accessToken}` }

  // Función auxiliar: fetch seguro que nunca lanza, devuelve null si falla
  async function whoopFetch(url) {
    try {
      const r = await fetch(url, { headers: h })
      const text = await r.text()
      try { return JSON.parse(text) } catch { return null }
    } catch { return null }
  }

  // Llamadas en paralelo — cada una falla de forma independiente
  const [bodyData, recovData, sleepData, cycleData] = await Promise.all([
    whoopFetch('https://api.prod.whoop.com/developer/v1/user/measurement/body'),
    whoopFetch('https://api.prod.whoop.com/developer/v1/recovery?limit=1'),
    whoopFetch('https://api.prod.whoop.com/developer/v1/activity/sleep?limit=1'),
    whoopFetch('https://api.prod.whoop.com/developer/v1/cycle?limit=1'),
  ])

  const rec   = recovData?.records?.[0]
  const sleep = sleepData?.records?.[0]
  const cycle = cycleData?.records?.[0]

  const whoopData = {
    recovery_score: rec?.score?.recovery_score                       ?? null,
    hrv_ms:         rec?.score?.hrv_rmssd_milli != null
                      ? Math.round(rec.score.hrv_rmssd_milli)        : null,
    rhr_bpm:        rec?.score?.resting_heart_rate                   ?? null,
    sleep_hours:    sleep?.score?.stage_summary?.total_in_bed_time_milli != null
                      ? +(sleep.score.stage_summary.total_in_bed_time_milli / 3_600_000).toFixed(1) : null,
    strain:         cycle?.score?.strain != null
                      ? +cycle.score.strain.toFixed(1)               : null,
    max_heart_rate: bodyData?.max_heart_rate                         ?? null,
    weight_kg:      bodyData?.weight_kilogram                        ?? null,
    synced_at:      now(),
  }

  // Actualizar body_compositions con el peso real si está disponible
  if (bodyData?.weight_kilogram) {
    const bcIdx = DB.body_compositions.findIndex(b => b.athlete_id === req.user.id)
    if (bcIdx >= 0) {
      DB.body_compositions[bcIdx].weight_kg = +bodyData.weight_kilogram.toFixed(1)
      DB.body_compositions[bcIdx].updated_at = now()
    }
  }

  const entry = { id: uuid(), athlete_id: req.user.id, workout_id: null, device: 'whoop', synced_at: now(), data: whoopData }
  DB.device_syncs.push(entry)
  save()

  const available = Object.entries(whoopData).filter(([k, v]) => v !== null && k !== 'synced_at').map(([k]) => k)
  res.json({ ok: true, data: whoopData, available_fields: available })
})

// Estado de la conexión Whoop (conectado / no conectado)
app.get('/api/athlete/whoop/status', auth, (req, res) => {
  const t = DB.whoop_tokens.find(e => e.athlete_id === req.user.id)
  res.json({ connected: !!t, expires_at: t?.expires_at || null, updated_at: t?.updated_at || null })
})

// Biométricos Whoop más recientes con recovery_score — para mostrar en dashboard al cargar
app.get('/api/athlete/whoop/today', auth, (req, res) => {
  const syncs = (DB.device_syncs || [])
    .filter(s => s.athlete_id === req.user.id && s.device === 'whoop' && s.data?.recovery_score != null)
    .sort((a, b) => b.synced_at.localeCompare(a.synced_at))
  const latest = syncs[0]
  if (!latest) return res.json({ ok: false, data: null })
  res.json({ ok: true, data: latest.data, synced_at: latest.synced_at })
})

// ── GARMIN HISTORIA COMPLETA ──────────────────────────────────────────────────

// Descarga TODAS las actividades de Garmin Connect (paginado 100 por batch)
app.get('/api/athlete/garmin/import-history', auth, async (req, res) => {
  if (!GARMIN_EMAIL || !GARMIN_PASSWORD) {
    return res.status(503).json({ error: 'config_missing' })
  }
  try {
    const gc = await getGarminClient()
    let all = []
    let start = 0
    const PAGE = 100
    while (true) {
      const batch = await gc.getActivities(start, PAGE)
      if (!batch || !batch.length) break
      all = all.concat(batch)
      if (batch.length < PAGE) break
      start += PAGE
    }

    const activities = all.map(act => {
      const durationMin  = Math.round((act.duration || 0) / 60)
      const hrAvg        = act.averageHR || act.averageHeartRate || 0
      const hrMax        = act.maxHR    || act.maxHeartRate     || 0
      const activityType = act.activityType?.typeKey || String(act.activityType || 'other')
      const activityName = act.activityName || activityType
      const tss          = _tssFromHR(durationMin, hrAvg, hrMax)
      const dateStr      = (act.startTimeLocal || act.startTime || '').toString().slice(0, 10)
      return {
        activity_id:   act.activityId || null,
        activity_name: activityName,
        activity_type: activityType,
        date:          dateStr,
        duration_min:  durationMin,
        hr_avg:        hrAvg,
        hr_max:        hrMax,
        calories:      act.calories || 0,
        distance_m:    Math.round((act.distance || 0)),
        elevation_m:   Math.round(act.elevationGain || 0),
        tss_actual:    tss,
      }
    })

    if (!DB.garmin_activities) DB.garmin_activities = []
    const existingIds = new Set(DB.garmin_activities.map(a => String(a.activity_id)))
    const newOnes = activities.filter(a => !existingIds.has(String(a.activity_id)))
    DB.garmin_activities.push(...newOnes)
    // Mantener ordenado por fecha desc
    DB.garmin_activities.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    save()

    res.json({
      ok:       true,
      imported: newOnes.length,
      total:    DB.garmin_activities.length,
      oldest:   activities[activities.length - 1]?.date || null,
      newest:   activities[0]?.date || null,
    })
  } catch (e) {
    console.error('[Garmin import-history]', e.message)
    _gcReady = false
    res.status(502).json({ error: 'garmin_api_error', message: e.message })
  }
})

// Devuelve las actividades importadas (para gráficas en el dashboard)
app.get('/api/athlete/garmin/activities', auth, (req, res) => {
  const limit  = parseInt(req.query.limit  || '365')
  const offset = parseInt(req.query.offset || '0')
  const list = (DB.garmin_activities || []).slice(offset, offset + limit)
  res.json({ ok: true, total: (DB.garmin_activities || []).length, data: list })
})

// ── PMC REBUILD — función reutilizable (llamada internamente + desde endpoint) ──

async function rebuildPMCForAthlete(athleteId) {
  // Combinar TSS: Garmin activities base + workouts completados con TSS real (mayor prioridad)
  const tssByDate = {}

  for (const act of (DB.garmin_activities || []).filter(a => a.date?.length === 10)) {
    tssByDate[act.date] = (tssByDate[act.date] || 0) + (act.tss_actual || 0)
  }
  for (const w of (DB.workouts || []).filter(w => w.athlete_id === athleteId && w.actual_tss && w.date)) {
    tssByDate[w.date] = Math.max(tssByDate[w.date] || 0, w.actual_tss)
  }

  const sortedDates = Object.keys(tssByDate).sort()
  if (!sortedDates.length) return null

  const earliest = sortedDates[0]
  const today    = localDate()

  const allDates = []
  const d    = new Date(earliest + 'T12:00:00Z')
  const endD = new Date(today   + 'T12:00:00Z')
  while (d <= endD) {
    allDates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }

  const k_ctl = 1 / 42, k_atl = 1 / 7
  let ctl = 0, atl = 0
  const pmcData = []

  for (const date of allDates) {
    const tss = tssByDate[date] || 0
    ctl = ctl * (1 - k_ctl) + tss * k_ctl
    atl = atl * (1 - k_atl) + tss * k_atl
    pmcData.push({
      date,
      tss: Math.round(tss),
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
    })
  }

  DB.pmc_cache = { athlete_id: athleteId, built_at: now(), data: pmcData }
  save()

  const last = pmcData[pmcData.length - 1] || {}
  return { ctl: last.ctl || 0, atl: last.atl || 0, tsb: last.tsb || 0, days: pmcData.length }
}

app.get('/api/athlete/pmc/rebuild', auth, async (req, res) => {
  const result = await rebuildPMCForAthlete(req.user.id)
  if (!result) return res.json({ ok: false, message: 'Sin actividades importadas. Ejecuta import-history primero.' })
  const cache = DB.pmc_cache
  res.json({
    ok: true,
    data: cache.data,
    summary: {
      total_days:  result.days,
      current_ctl: result.ctl,
      current_atl: result.atl,
      current_tsb: result.tsb,
    },
  })
})

// PMC cacheado (para cargas rápidas sin recalcular)
app.get('/api/athlete/pmc/data', auth, (req, res) => {
  const cache = DB.pmc_cache
  if (!cache) return res.json({ ok: false, message: 'Sin datos PMC. Ejecuta /rebuild primero.' })
  // Devolver solo los últimos N días para no saturar el cliente
  const days = parseInt(req.query.days || '180')
  const slice = cache.data.slice(-days)
  const last  = slice[slice.length - 1] || {}
  res.json({
    ok:   true,
    data: slice,
    summary: {
      current_ctl: last.ctl || 0,
      current_atl: last.atl || 0,
      current_tsb: last.tsb || 0,
      built_at:    cache.built_at,
    },
  })
})

// ── WHOOP HISTORIA COMPLETA ───────────────────────────────────────────────────

app.get('/api/athlete/whoop/import-history', auth, async (req, res) => {
  const tokenEntry = DB.whoop_tokens.find(t => t.athlete_id === req.user.id)
  if (!tokenEntry) return res.status(401).json({ error: 'no_token', message: 'Conecta Whoop primero.' })

  // Siempre refrescar el token antes
  let accessToken = tokenEntry.access_token
  try {
    const r = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
        refresh_token: tokenEntry.refresh_token,
      }),
    })
    const fresh = await r.json()
    if (fresh.access_token) {
      accessToken = fresh.access_token
      const idx = DB.whoop_tokens.findIndex(t => t.athlete_id === req.user.id)
      DB.whoop_tokens[idx] = {
        ...tokenEntry,
        access_token:  fresh.access_token,
        refresh_token: fresh.refresh_token || tokenEntry.refresh_token,
        expires_at:    fresh.expires_in ? new Date(Date.now() + fresh.expires_in * 1000).toISOString() : null,
        updated_at:    now(),
      }
      save()
    }
  } catch (_e) { /* continúa con token anterior */ }

  const h = { Authorization: `Bearer ${accessToken}` }

  // Pagina un endpoint Whoop hasta agotar los registros
  async function whoopPageAll(endpoint) {
    const records = []
    let nextToken = null
    let attempts  = 0
    while (attempts < 50) {
      attempts++
      const qs  = nextToken ? `?limit=25&nextToken=${encodeURIComponent(nextToken)}` : '?limit=25'
      const url = `https://api.prod.whoop.com/developer/v1/${endpoint}${qs}`
      try {
        const r    = await fetch(url, { headers: h })
        const text = await r.text()
        const data = JSON.parse(text)
        if (Array.isArray(data.records)) records.push(...data.records)
        nextToken = data.next_token || null
        if (!nextToken) break
      } catch { break }
    }
    return records
  }

  // Descargar en paralelo
  const [recoveries, sleeps, cycles] = await Promise.all([
    whoopPageAll('recovery'),
    whoopPageAll('activity/sleep'),
    whoopPageAll('cycle'),
  ])

  // Fusionar por fecha
  const byDate = {}
  for (const rec of recoveries) {
    const date = (rec.start || rec.created_at || '').slice(0, 10)
    if (!date) continue
    if (!byDate[date]) byDate[date] = { date }
    byDate[date].recovery_score = rec.score?.recovery_score ?? null
    byDate[date].hrv_ms  = rec.score?.hrv_rmssd_milli != null
      ? Math.round(rec.score.hrv_rmssd_milli) : null
    byDate[date].rhr_bpm = rec.score?.resting_heart_rate ?? null
  }
  for (const sl of sleeps) {
    const date = (sl.start || sl.created_at || '').slice(0, 10)
    if (!date) continue
    if (!byDate[date]) byDate[date] = { date }
    byDate[date].sleep_hours = sl.score?.stage_summary?.total_in_bed_time_milli != null
      ? +(sl.score.stage_summary.total_in_bed_time_milli / 3_600_000).toFixed(1) : null
    byDate[date].sleep_efficiency = sl.score?.sleep_efficiency_percentage ?? null
    byDate[date].sleep_performance = sl.score?.sleep_performance_percentage ?? null
  }
  for (const cy of cycles) {
    const date = (cy.start || cy.created_at || '').slice(0, 10)
    if (!date) continue
    if (!byDate[date]) byDate[date] = { date }
    byDate[date].strain = cy.score?.strain != null ? +cy.score.strain.toFixed(1) : null
    byDate[date].avg_hr = cy.score?.average_heart_rate ?? null
    byDate[date].max_hr = cy.score?.max_heart_rate ?? null
    byDate[date].kilojoules = cy.score?.kilojoule ?? null
  }

  DB.whoop_history = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
  save()

  res.json({
    ok:         true,
    recoveries: recoveries.length,
    sleeps:     sleeps.length,
    cycles:     cycles.length,
    days:       DB.whoop_history.length,
    oldest:     DB.whoop_history[0]?.date || null,
    newest:     DB.whoop_history[DB.whoop_history.length - 1]?.date || null,
  })
})

// Devuelve el historial Whoop almacenado
app.get('/api/athlete/whoop/history', auth, (req, res) => {
  const days = parseInt(req.query.days || '90')
  const data = (DB.whoop_history || []).slice(-days)
  res.json({ ok: true, total: (DB.whoop_history || []).length, data })
})

// ── SISTEMA MULTI-AGENTE IA ───────────────────────────────────────────────────

// Datos del atleta para el pipeline — combina BD + parámetros opcionales
function buildAthleteContext(athleteId) {
  const today    = localDate()
  const tomorrow = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0,10) })()

  const bc       = (DB.body_compositions || []).filter(b => b.athlete_id === athleteId).slice(-1)[0] || {}
  const pmcArr   = Array.isArray(DB.pmc_cache) ? DB.pmc_cache : (DB.pmc_cache?.data || [])
  const pmc      = pmcArr[pmcArr.length - 1] || {}

  const allWorkouts = (DB.workouts || []).filter(w => w.athlete_id === athleteId)
  const workout_today    = allWorkouts.find(w => w.date === today)    || null
  const workout_tomorrow = allWorkouts.find(w => w.date === tomorrow) || null
  const workouts_completed = allWorkouts.filter(w => w.status === 'COMPLETED').length
  const workouts_planned   = allWorkouts.filter(w => w.date >= '2026-06-08').length

  // Whoop: usar device_syncs (whoop_history siempre vacío)
  const whoopSyncs = (DB.device_syncs || [])
    .filter(s => s.athlete_id === athleteId && s.device === 'whoop' && s.data?.recovery_score != null)
    .sort((a, b) => b.synced_at.localeCompare(a.synced_at))
  const latestWhoop    = whoopSyncs[0] || null
  const whoop_today    = latestWhoop?.data || null
  const last_whoop_sync = latestWhoop?.synced_at || null

  const garminSyncs = (DB.device_syncs || [])
    .filter(s => s.athlete_id === athleteId && s.device === 'garmin')
    .sort((a, b) => b.synced_at.localeCompare(a.synced_at))
  const last_garmin_sync = garminSyncs[0]?.synced_at || null

  const garmin_activities = (DB.garmin_activities || []).slice(-14)

  return {
    weight_kg:          bc.weight_kg   || 90,
    bodyfat_pct:        bc.bodyfat_pct || 22.8,
    muscle_kg:          bc.muscle_kg   || 40,
    ctl:                pmc.ctl        || 18.5,
    atl:                pmc.atl        || 31.5,
    tsb:                pmc.tsb        || -13,
    garmin_activities,
    whoop_today,
    last_whoop_sync,
    last_garmin_sync,
    workout_today,
    workout_tomorrow,
    workouts_completed,
    workouts_planned,
  }
}

// POST /api/agents/run — pipeline completo (sin streaming) → guarda en agents_intercom
app.post('/api/agents/run', auth, async (req, res) => {
  try {
    const ctx    = buildAthleteContext(req.user.id)
    const result = await runFullPipeline(ctx)
    const entry  = { id: uuid(), athlete_id: req.user.id, timestamp: result.timestamp, ...result }
    if (!DB.agents_intercom) DB.agents_intercom = []
    DB.agents_intercom.push(entry)
    if (DB.agents_intercom.length > 50) DB.agents_intercom = DB.agents_intercom.slice(-50)
    save()
    res.json({ ok: true, report: entry })
  } catch (e) {
    console.error('[agents/run]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/agents/stream — SSE con motor local + delays para animación premium
app.get('/api/agents/stream', authBrowser, async (req, res) => {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  try {
    const ctx    = buildAthleteContext(req.user.id)
    const result = await streamLocalPipeline(ctx, send)

    const entry = { id: uuid(), athlete_id: req.user.id, ...result }
    if (!DB.agents_intercom) DB.agents_intercom = []
    DB.agents_intercom.push(entry)
    if (DB.agents_intercom.length > 50) DB.agents_intercom = DB.agents_intercom.slice(-50)
    save()

    send({ type: 'done', report_id: entry.id })
  } catch (e) {
    console.error('[agents/stream]', e.message)
    send({ type: 'error', message: e.message })
  }

  res.end()
})

// GET /api/agents/history — últimos N reportes del atleta
app.get('/api/agents/history', auth, (req, res) => {
  const limit   = parseInt(req.query.limit || '10')
  const history = (DB.agents_intercom || [])
    .filter(e => e.athlete_id === req.user.id)
    .slice(-limit)
    .reverse()
  res.json({ ok: true, total: history.length, history })
})

// ── HISTORIAL DEPORTIVO INTEGRAL ──────────────────────────────────────────────
// Fusiona workouts, wellness, Garmin, Whoop, composición corporal y PMC por fecha
app.get('/api/athlete/historial', auth, (req, res) => {
  const athleteId = req.user.id
  const days = parseInt(req.query.days || '30')
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
  const cutStr = cutoff.toISOString().split('T')[0]

  const byDate = {}
  const row = (date) => { if (!byDate[date]) byDate[date] = { date }; return byDate[date] }

  // Workouts planificados + completados
  ;(DB.workouts || [])
    .filter(w => w.athlete_id === athleteId && w.date >= cutStr)
    .forEach(w => {
      const d = row(w.date)
      d.workout_name    = w.name
      d.workout_type    = w.type
      d.tss_planned     = w.tss_planned || null
      d.duration_planned = w.duration_min || null
      d.rpe             = w.rpe || null
      d.workout_status  = w.status || 'PENDING'
      d.tss_actual      = w.actual_tss || w.garmin_data?.tss_actual || null
      d.duration_actual = w.actual_duration_min || w.garmin_data?.duration_min || null
      d.athlete_note    = w.athlete_note || null
    })

  // Wellness / check-in matutino
  ;(DB.wellness || [])
    .filter(w => w.athlete_id === athleteId && w.date >= cutStr)
    .forEach(w => {
      const d = row(w.date)
      d.energy        = w.energy        || null
      d.mood          = w.mood          || null
      d.soreness      = w.muscleSoreness || w.soreness || null
      d.kcal_consumed = w.kcal_consumed  || null
      d.water_ml      = w.water_ml       || null
      d.wellness_note = w.notes          || null
      // sleepHours puede venir en camelCase desde el check-in matutino
      if (d.sleep_hours == null && w.sleepHours != null)
        d.sleep_hours = +Number(w.sleepHours).toFixed(1)
    })

  // Actividades Garmin — todas las del día, la más larga como referencia principal
  const garminByDate = {}
  ;(DB.garmin_activities || []).forEach(a => {
    const date = (a.start_time || '').slice(0, 10) || a.date || ''
    if (!date || date < cutStr) return
    if (!garminByDate[date]) garminByDate[date] = []
    garminByDate[date].push(a)
  })
  Object.entries(garminByDate).forEach(([date, acts]) => {
    const d = row(date)
    // Actividad principal = la más larga
    const main = acts.reduce((best, a) => {
      const dur = a.duration_min || Math.round((a.duration || a.duration_sec || 0) / 60)
      const bDur = best.duration_min || Math.round((best.duration || best.duration_sec || 0) / 60)
      return dur > bDur ? a : best
    }, acts[0])
    const dur = main.duration_min || Math.round((main.duration || main.duration_sec || 0) / 60)
    d.garmin_tss        = main.tss_actual != null ? Math.round(main.tss_actual) : (main.tss ? Math.round(main.tss) : null)
    d.garmin_duration   = dur || null
    d.garmin_hr_avg     = main.hr_avg || main.averageHR || main.averageHeartRate || null
    d.garmin_hr_max     = main.hr_max || null
    d.garmin_type       = main.activity_type || main.activityType || null
    d.activity_type     = d.garmin_type
    d.duration_min      = dur || null
    d.garmin_name       = main.activity_name || main.name || null
    d.garmin_calories   = main.calories || null
    d.garmin_power_w    = main.avg_power_w || null
    d.garmin_distance_m = main.distance_m || null
    d.garmin_distance_nm = main.distance_nm || null
    d.garmin_speed_mph  = main.speed_avg_mph || null
    d.garmin_speed_kts  = main.speed_avg_kts || null
    d.garmin_sessions   = acts.length   // cuántas actividades ese día
    // TSS total del día (suma de todas las actividades)
    const totalTss = acts.reduce((s, a) => s + (a.tss_actual || 0), 0)
    if (totalTss > 0) d.garmin_tss = Math.round(totalTss)
  })

  // Whoop — recovery, HRV, sueño (fuente primaria: whoop_history)
  ;(DB.whoop_history || [])
    .filter(w => w.date >= cutStr)
    .forEach(w => {
      const d = row(w.date)
      d.recovery_score = w.recovery_score != null ? Math.round(w.recovery_score) : null
      d.hrv_ms         = w.hrv_ms        != null ? Math.round(w.hrv_ms)        : null
      d.sleep_hours    = w.sleep_hours   != null ? +w.sleep_hours.toFixed(1)   : null
      d.rhr_bpm        = w.rhr_bpm       != null ? Math.round(w.rhr_bpm)       : null
      d.whoop_strain   = w.strain        != null ? +w.strain.toFixed(1)        : null
    })

  // Fallback: si whoop_history vacío, usar el sync más reciente con datos reales por día
  const whoopSyncsByDate = {}
  ;(DB.device_syncs || [])
    .filter(s => s.device === 'whoop' && s.data?.recovery_score != null)
    .forEach(s => {
      const date = (s.synced_at || '').slice(0, 10)
      if (!date || date < cutStr) return
      // Guardar el sync más reciente con recovery_score real por fecha
      if (!whoopSyncsByDate[date] || s.synced_at > whoopSyncsByDate[date].synced_at)
        whoopSyncsByDate[date] = s
    })
  Object.entries(whoopSyncsByDate).forEach(([date, s]) => {
    const d = row(date)
    if (d.recovery_score == null) d.recovery_score = s.data.recovery_score != null ? Math.round(s.data.recovery_score) : null
    if (d.hrv_ms == null)         d.hrv_ms         = s.data.hrv_ms        != null ? Math.round(s.data.hrv_ms)        : null
    if (d.sleep_hours == null)    d.sleep_hours    = s.data.sleep_hours   != null ? +Number(s.data.sleep_hours).toFixed(1) : null
    if (d.rhr_bpm == null)        d.rhr_bpm        = s.data.rhr_bpm       != null ? Math.round(s.data.rhr_bpm)       : null
    if (d.whoop_strain == null)   d.whoop_strain   = s.data.strain        != null ? +Number(s.data.strain).toFixed(1): null
  })

  // Composición corporal (DEXA/manual)
  ;(DB.body_compositions || [])
    .filter(b => b.athlete_id === athleteId && b.date >= cutStr)
    .forEach(b => {
      const d = row(b.date)
      d.weight_kg    = b.weight_kg    || null
      d.bodyfat_pct  = b.bodyfat_pct  || null
      d.muscle_kg    = b.muscle_kg    || null
    })

  // PMC cache — CTL / ATL / TSB del día
  const pmcArr = Array.isArray(DB.pmc_cache) ? DB.pmc_cache : (DB.pmc_cache?.data || [])
  pmcArr.filter(p => p.date >= cutStr).forEach(p => {
    const d = row(p.date)
    d.ctl = p.ctl != null ? +p.ctl.toFixed(1) : null
    d.atl = p.atl != null ? +p.atl.toFixed(1) : null
    d.tsb = p.tsb != null ? +p.tsb.toFixed(1) : null
  })

  // Agentes — último reporte CEO del día
  ;(DB.agents_intercom || [])
    .filter(e => e.athlete_id === athleteId && (e.timestamp || '').slice(0, 10) >= cutStr)
    .forEach(e => {
      const date = (e.timestamp || '').slice(0, 10)
      if (!date) return
      const d = row(date)
      // Solo guardamos las primeras 100 chars del CEO para la tabla
      if (e.ceo) d.ceo_summary = e.ceo.split('\n')[0].replace('🎯 ESTADO DEL DÍA: ', '').slice(0, 80)
    })

  const rows = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date))
  res.json({ ok: true, total: rows.length, cut: cutStr, rows })
})

// ── DAILY SYNC — dispara el pipeline y hace upsert en agents_intercom (sin duplicar el día)
app.post('/api/athlete/daily-sync', auth, async (req, res) => {
  try {
    const today  = localDate()
    const ctx    = buildAthleteContext(req.user.id)
    const result = await runFullPipeline(ctx)

    if (!DB.agents_intercom) DB.agents_intercom = []
    // Upsert: si ya existe una entrada para hoy de este atleta, actualizarla
    const existIdx = DB.agents_intercom.findIndex(
      e => e.athlete_id === req.user.id && (e.timestamp || '').slice(0, 10) === today
    )
    const entry = {
      id:         existIdx >= 0 ? DB.agents_intercom[existIdx].id : uuid(),
      athlete_id: req.user.id,
      timestamp:  result.timestamp,
      auto:       false,
      ...result,
    }
    if (existIdx >= 0) {
      DB.agents_intercom[existIdx] = entry
    } else {
      DB.agents_intercom.push(entry)
    }
    if (DB.agents_intercom.length > 100) DB.agents_intercom = DB.agents_intercom.slice(-100)
    save()
    res.json({ ok: true, report_id: entry.id, ceo_estado: entry.ceo?.split('\n')[0] || '' })
  } catch (e) {
    console.error('[daily-sync]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, db: 'json-store', file: DB_FILE, workouts: DB.workouts.length, ts: now() })
})

// ── CRON DE MEDIANOCHE — sincronización automática diaria ─────────────────────
let _lastAutoSyncDate = ''

async function runAutoSync() {
  const today = localDate()
  if (_lastAutoSyncDate === today) return
  _lastAutoSyncDate = today
  console.log(`[Auto-sync] 🕛 Iniciando sincronización diaria — ${today}`)
  const athletes = (DB.users || []).filter(u => u.role === 'ATHLETE')
  for (const u of athletes) {
    try {
      const ctx    = buildAthleteContext(u.id)
      const result = await runFullPipeline(ctx)
      const entry  = { id: uuid(), athlete_id: u.id, timestamp: result.timestamp, auto: true, ...result }
      if (!DB.agents_intercom) DB.agents_intercom = []
      DB.agents_intercom.push(entry)
      await rebuildPMCForAthlete(u.id)
    } catch (e) {
      console.error(`[Auto-sync] Error para ${u.id}:`, e.message)
    }
  }
  if ((DB.agents_intercom || []).length > 150) DB.agents_intercom = DB.agents_intercom.slice(-150)
  save()
  console.log(`[Auto-sync] ✓ Sincronización diaria completada — ${athletes.length} atletas`)
}

function scheduleMidnightSync() {
  const now      = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 1, 0, 0)                     // 00:01 AM del día siguiente
  const msLeft = tomorrow - now
  setTimeout(() => { runAutoSync(); scheduleMidnightSync() }, msLeft)
  const mins = Math.round(msLeft / 60000)
  console.log(`[Auto-sync] Próxima sync automática en ${mins} min (${tomorrow.toISOString().slice(0,16)})`)
}

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
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
  const startDow  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][new Date().getDay()]
  console.log(`[Fecha actual] ${startDow} ${startDate} — Días para CAC Games (1 ago): ${Math.max(0,Math.ceil((new Date('2026-08-01')-new Date())/86400000))}`)
  scheduleMidnightSync()
  runAutoSync()               // sync inmediato al arrancar si es día nuevo
})
