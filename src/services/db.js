'use strict'
// ═══════════════════════════════════════════════════════════════════════════════
//  JSON store — lee el archivo completo, aplica la mutación, lo vuelve a escribir.
//  Suficiente para un prototipo con < 100 atletas y miles de workouts. Migrar a
//  una BD real solo si esto se convierte en multi-usuario de verdad (hoy es la
//  app personal de Gerardo).
// ═══════════════════════════════════════════════════════════════════════════════
const fs = require('fs')
const bcrypt = require('bcryptjs')
const { DATA_DIR, DB_FILE, SEED_FILE } = require('../config/env')
const logger = require('../utils/logger')

fs.mkdirSync(DATA_DIR, { recursive: true })

// Si no existe tucoach.json y hay un seed disponible → copiarlo automáticamente
if (!fs.existsSync(DB_FILE) && fs.existsSync(SEED_FILE)) {
  fs.copyFileSync(SEED_FILE, DB_FILE)
  logger.info('tucoach.json creado desde seed.')
}

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
    if (!existing.body_compositions)     { existing.body_compositions     = SEED_BODY_COMP;               changed = true }
    if (!existing.nutrition_plans)       { existing.nutrition_plans       = SEED_NUTRITION_PLAN;          changed = true }
    if (!existing.performance_baselines) { existing.performance_baselines = SEED_PERFORMANCE_BASELINES;   changed = true }
    if (!existing.whoop_tokens)          { existing.whoop_tokens          = [];                            changed = true }
    if (!existing.garmin_tokens)         { existing.garmin_tokens         = [];                            changed = true }
    if (!existing.wellness)              { existing.wellness              = [];                            changed = true }
    if (!existing.sensation_logs)        { existing.sensation_logs        = [];                            changed = true }
    if (!existing.agents_intercom)       { existing.agents_intercom       = [];                            changed = true }
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
    workouts:              [],
    device_syncs:          [],
    body_compositions:     SEED_BODY_COMP,
    nutrition_plans:       SEED_NUTRITION_PLAN,
    performance_baselines: SEED_PERFORMANCE_BASELINES,
    whoop_tokens:          [],
    garmin_tokens:         [],
  }
  writeDB(db)
  return db
}

const DB = initDB()
const save = () => writeDB(DB)

// Refresca el contenido de DB desde disco SIN romper la referencia compartida.
// Antes esto era `DB = readDB() || DB` en el login — reasignar rompería a
// cualquier módulo que ya haya importado este objeto (seguiría apuntando al
// viejo), así que ahora es un merge in-place con el mismo efecto práctico.
function refreshFromDisk() {
  const fresh = readDB()
  if (fresh) Object.assign(DB, fresh)
  return DB
}

// ID de atleta por alias corto (coincide con los HTML)
const ALIAS_MAP = { gb: 'athlete-gb-001', al: 'athlete-al-001', cr: 'athlete-al-001' }
const resolve = (id) => ALIAS_MAP[id] || id

module.exports = { DB, save, readDB, writeDB, refreshFromDisk, resolve }
