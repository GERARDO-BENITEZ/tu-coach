'use strict'
// ═══════════════════════════════════════════════════════════════════════════════
//  Tu Coach — Motor de Agentes LOCAL (reglas JS puras, sin API externa)
//  Atleta: Gerardo Benítez · ILCA 7 (Laser) · CAC Games 2026 · Barranquilla
//  Pipeline: Datos → Físico + Nutrición → Sistemas → CEO → reporte ejecutivo
// ═══════════════════════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── Constantes del plan CAC Games 2026 ───────────────────────────────────────
const PLAN = {
  raceDate:    '2026-08-01',       // Día 1 CAC Games
  compEnd:     '2026-08-08',       // Día 8 CAC Games (cierre)
  weightGoal:  86,                 // kg objetivo a los juegos
  weightStart: 90,                 // kg inicio plan (Jun 7)
  bodyfatGoal: 18,                 // % grasa objetivo
  ctlPeak:     55,                 // CTL objetivo al llegar a los juegos
  sport:       'ILCA 7 (Laser)',   // clase vela
  event:       'CAC Games 2026 · Barranquilla',
  phases: [
    { key:'F1', name:'F1 Base Técnica',  start:'2026-06-07', end:'2026-06-21', rir:'3-4', focus:'técnica + base aeróbica + fuerza general', tssWeek:360, ctlTarget:28,  pct:'65-72%', color:'#4f8ef7' },
    { key:'F2', name:'F2 Carga',          start:'2026-06-22', end:'2026-07-12', rir:'1-2', focus:'fuerza máxima + potencia explosiva',        tssWeek:490, ctlTarget:45,  pct:'80-88%', color:'#f97316' },
    { key:'F3', name:'F3 Especificidad',  start:'2026-07-13', end:'2026-07-26', rir:'0-1', focus:'potencia específica vela + pico CTL',        tssWeek:430, ctlTarget:55,  pct:'85-95%', color:'#22c55e' },
    { key:'F4', name:'F4 Taper',          start:'2026-07-27', end:'2026-08-01', rir:'3-4', focus:'reducción de carga + activación pico',       tssWeek:160, ctlTarget:55,  pct:'60-70%', color:'#eab308' },
    { key:'COMP', name:'CAC Games',       start:'2026-08-01', end:'2026-08-08', rir:'—',   focus:'regatas ILCA 7 · máximo rendimiento',        tssWeek:220, ctlTarget:52,  pct:'100%',  color:'#ef4444' },
  ],
}

// ── Umbrales de decisión (Screening Bullshark Lab 05-Jun-2026) ────────────────
const THR = {
  tsb:     { critico: -25, fatiga: -15, train: -5, fresco: 0 },
  whoop:   { verde: 67, amarillo: 33 },
  // Plan nutricional Ivonne (Bullshark Nutrition Team) — valores del PDF Jun 2026
  kcalPlanEntrenamiento: 1462,
  kcalPlanDescanso:      1172,
  kcalGET:               3549, // Gasto Energético Total estimado
  proteinMeta:  198,  // META Bullshark Lab
  proteinPlan:  125,  // lo que provee el plan Ivonne tal como está diseñado
  gapProteinG:   73,  // 198g meta − 125g plan = 73g pendientes
  carbsG:       118,  // carbos plan día entrenamiento
  fatG:          38,  // grasas plan
  scoreBullshark: 55, // Performance Score nutricional inicial
  suplementos: ['Creatina 7.5g pre-entreno (Gatorlite)', 'Omega 3 noche', 'Glicinato Mg KAL x2 noche', 'Vitamina C 500mg noche', 'Zincsel noche'],
}

// ── Metadata de cada agente ───────────────────────────────────────────────────
const AGENT_PERSONAS = {
  datos:    { name:'Agente Datos',    emoji:'📊', color:'#4f8ef7', loadingMsg:'Analizando PMC, Whoop y adherencia al plan…' },
  fisico:   { name:'Agente Físico',   emoji:'💪', color:'#22c55e', loadingMsg:'Evaluando carga, fuerza y estado ILCA 7…' },
  nutricion:{ name:'Agente Nutrición',emoji:'🥗', color:'#f97316', loadingMsg:'Consultando plan Ivonne y estrategia de macros…' },
  sistemas: { name:'Agente Sistemas', emoji:'⚙️', color:'#a855f7', loadingMsg:'Verificando conexiones Garmin, Whoop y BD…' },
  ceo:      { name:'CEO Agent',       emoji:'🤖', color:'#fbbf24', loadingMsg:'Sintetizando veredicto ejecutivo ILCA 7…' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCurrentPhase() {
  const today = new Date().toISOString().slice(0, 10)
  return PLAN.phases.find(p => today >= p.start && today <= p.end) || PLAN.phases[0]
}

function getDaysToRace() {
  return Math.max(0, Math.round((new Date(PLAN.raceDate) - new Date()) / 86400000))
}

function getPlanDayNumber(phase) {
  const today = new Date().toISOString().slice(0, 10)
  return Math.max(1, Math.ceil((new Date(today + 'T12:00:00Z') - new Date(phase.start + 'T12:00:00Z')) / 86400000) + 1)
}

function getPhaseTotalDays(phase) {
  return Math.ceil((new Date(phase.end + 'T12:00:00Z') - new Date(phase.start + 'T12:00:00Z')) / 86400000) + 1
}

function getWorkoutType(workout) {
  if (!workout) return null
  const name = (workout.name || '').toLowerCase()
  const key  = (workout.key || '').toLowerCase()
  if (key.includes('strength') || name.includes('fuerza') || name.includes('gym')) return 'strength'
  if (key.includes('run') || name.includes('ciclismo') || name.includes('bici'))   return 'cycling'
  if (key.includes('sail') || name.includes('vela') || name.includes('regata'))    return 'sailing'
  if (key.includes('core') || key.includes('mob'))                                  return 'recovery'
  return 'training'
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOTOR DATOS — PMC + Whoop + adherencia + fase activa
// ─────────────────────────────────────────────────────────────────────────────
function analyzeDatos(d) {
  const { ctl, atl, tsb, garmin_activities, whoop_today, workouts_completed, workouts_planned } = d
  const phase     = getCurrentPhase()
  const diasCac   = getDaysToRace()
  const weekTSS   = garmin_activities.slice(-7).reduce((s, a) => s + (a.tss || 0), 0)
  const tssVsGoal = Math.round((weekTSS / phase.tssWeek) * 100)
  const adherencia = workouts_planned > 0 ? Math.round((workouts_completed / workouts_planned) * 100) : null

  const tsbZone = tsb < THR.tsb.critico ? '🔴 Sobrecarga'
                : tsb < THR.tsb.fatiga  ? '🟠 Fatiga activa'
                : tsb < THR.tsb.fresco  ? '🟡 Bloque de carga'
                : '🔵 Pico de forma'

  const planDay = getPlanDayNumber(phase)
  const planTotal = getPhaseTotalDays(phase)

  const lines = [
    `📊 PMC: CTL ${ctl.toFixed(1)} · ATL ${atl.toFixed(1)} · TSB ${tsb.toFixed(1)} (${tsbZone}) · Objetivo CAC: CTL ≥${phase.ctlTarget}`,
    `📅 ${phase.name} · Día ${planDay}/${planTotal} · Semana: ${weekTSS} TSS (${tssVsGoal}% del objetivo ${phase.tssWeek} en ${phase.key})`,
    whoop_today
      ? `🫀 Whoop: Recovery ${whoop_today.recovery_score}% · HRV ${whoop_today.hrv_ms}ms · Sueño ${whoop_today.sleep_hours}h · RHR ${whoop_today.rhr_bpm ?? '—'}bpm`
      : '🫀 Whoop: sin lectura de hoy — revisar sincronización del brazalete',
    adherencia != null
      ? `📋 Adherencia: ${workouts_completed}/${workouts_planned} sesiones (${adherencia}%) · ${diasCac}d para ${PLAN.event}`
      : `📋 ${diasCac} días para ${PLAN.event} · ${phase.name} activa · RIR objetivo: ${phase.rir}`,
  ]
  return lines.map(l => `• ${l}`).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOTOR FÍSICO — carga, plan, fuerza ILCA 7, RIR, recomendación de intensidad
// ─────────────────────────────────────────────────────────────────────────────
function analyzeFisico(d) {
  const { ctl, atl, tsb, workout_today, workout_tomorrow, garmin_activities } = d
  const phase   = getCurrentPhase()
  const weekTSS = garmin_activities.slice(-7).reduce((s, a) => s + (a.tss || 0), 0)
  const gap     = phase.tssWeek - weekTSS
  const rampRate = ctl > 0 ? ((atl - ctl) / ctl * 100).toFixed(1) : 0
  const wkType  = getWorkoutType(workout_today)

  const estadoFisico = tsb < THR.tsb.critico ? '🔴 Reducir carga urgente — posible sobrentrenamiento'
                     : tsb < THR.tsb.fatiga  ? '🟠 Fatiga — bajar intensidad 20% · monitorear RPE'
                     : tsb < THR.tsb.fresco  ? '🟡 Zona de entrenamiento óptima — plan en marcha'
                     : '🔵 En forma — ventana de rendimiento disponible'

  // Contexto específico por tipo de entreno + fase
  let strengthContext = ''
  if (wkType === 'strength') {
    const rirMap = { F1:'3-4 (técnica, lejos del fallo)', F2:'1-2 (cerca del fallo, máxima tensión)', F3:'0-1 (al límite, pico de fuerza)', F4:'3-4 (mantenimiento, sin fatiga)' }
    const loadMap = { F1:'65-72%1RM', F2:'80-88%1RM', F3:'85-95%1RM', F4:'60-70%1RM' }
    strengthContext = ` · RIR objetivo hoy: ${rirMap[phase.key] || phase.rir} · Carga: ${loadMap[phase.key] || phase.pct} · Ejercicios clave: hiking isométrico + tracción de escota`
  }

  const lines = [
    `💪 Estado físico ${phase.key}: ${estadoFisico} (TSB ${tsb.toFixed(0)} · CTL actual ${ctl.toFixed(1)} / objetivo ${phase.ctlTarget})`,
    workout_today
      ? `⚡ Hoy: ${workout_today.name} · ${workout_today.duration_min || '—'}min · TSS ~${workout_today.tss_planned || '—'} · ${workout_today.status === 'COMPLETED' ? '✓ COMPLETADO' : 'pendiente'}${strengthContext}`
      : '⚡ Hoy: sin entreno planificado — día de recuperación activa · movilidad + foam roller',
    `📈 Ramp rate ATL/CTL: ${rampRate}% · TSS semana ${weekTSS}${gap > 0 ? ` (${gap} bajo obj. ${phase.tssWeek} ${phase.key} → ${gap > 150 ? 'considera sesión ligera extra' : 'dentro del rango tolerable'})` : ' ✓ objetivo cumplido'}`,
    workout_tomorrow
      ? `🔮 Mañana: ${workout_tomorrow.name} · ${workout_tomorrow.duration_min || '—'}min · prepara hidratación + nutrición post-entreno`
      : '🔮 Mañana: sin sesión programada · recuperación activa o movilidad Laser',
  ]
  return lines.map(l => `• ${l}`).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOTOR NUTRICIÓN — plan Ivonne, macros, brecha proteína, estrategia por fase
// ─────────────────────────────────────────────────────────────────────────────
function analyzeNutricion(d) {
  const { tsb, workout_today } = d
  const phase   = getCurrentPhase()
  const dMin    = workout_today?.duration_min || 0
  const isRest  = !workout_today
  const wkType  = getWorkoutType(workout_today)

  // Calorías del plan según tipo de día
  const kcalHoy = isRest ? THR.kcalPlanDescanso : THR.kcalPlanEntrenamiento

  // Proteína: plan Ivonne da 125g vs meta 198g
  const protPlan   = THR.proteinPlan
  const protGap    = THR.proteinMeta - protPlan
  const protStatus = protGap >= 60 ? '🔴 CRÍTICO' : protGap >= 30 ? '🟠 ALTO' : '🟡 MODERADO'

  // Ajuste carbos según fase y fatiga
  let carbsAdj = isRest ? -40 : 0
  if (tsb < THR.tsb.fatiga) carbsAdj += 30
  if (phase.key === 'F2')   carbsAdj += 20  // F2 más carga → más carbos
  if (phase.key === 'F4')   carbsAdj -= 20  // taper → reducir carbos
  const carbsHoy = THR.carbsG + carbsAdj

  // Estrategia por fase
  const phaseNutricion = {
    F1: 'Déficit controlado ~300 kcal/día · construir masa muscular magra · proteína es prioridad #1',
    F2: 'Carga alta → más carbos pre-entreno · déficit mínimo en días de fuerza máxima · proteína crítica para recuperación muscular',
    F3: 'Periodo de especificidad · carbos estratégicos (alto antes de sesiones de potencia, bajo en recuperación) · proteína ≥1.8g/kg',
    F4: 'Taper nutricional · mantener proteína alta · reducir carbos suave · hidratación +500ml/día pre-competencia',
    COMP: 'Competencia: carbos 6-8g/kg el día anterior a cada regata · proteína mínima 30g cada comida · evitar alimentos nuevos',
  }

  const dayType = isRest ? 'Descanso' : `${dMin}min ${wkType === 'strength' ? '· Fuerza ' + phase.key : wkType === 'cycling' ? '· Ciclismo' : '· Entrenamiento'}`

  const lines = [
    `🥗 Plan Ivonne: ~${kcalHoy} kcal · ${carbsHoy}g C${carbsAdj !== 0 ? ` (${carbsAdj > 0 ? '+' : ''}${carbsAdj}g ajuste)` : ''} · ${THR.fatG}g G · ${dayType}`,
    `⚠️ Proteína ${protStatus}: plan provee ~${protPlan}g · meta ${THR.proteinMeta}g · brecha ${protGap}g (Bullshark ${THR.scoreBullshark}/100)`,
    `🍳 Para cerrar brecha: shake 30g whey + 200g yogur griego = +${Math.round(30*0.8+20)}g → llegarías a ~${protPlan + Math.round(30*0.8+20)}g (${Math.round((protPlan + Math.round(30*0.8+20))/THR.proteinMeta*100)}% meta)`,
    `🎯 Estrategia ${phase.key}: ${phaseNutricion[phase.key] || phaseNutricion.F1}`,
    `💊 Suplementos: Creatina 7.5g pre-entreno · Omega 3 + Mg KAL x2 + Vit C 500mg + Zincsel → noche`,
  ]
  return lines.map(l => `• ${l}`).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOTOR SISTEMAS — salud conexiones + sincronización + estado BD
// ─────────────────────────────────────────────────────────────────────────────
function analyzeSistemas(d) {
  const { garmin_activities, whoop_today, last_garmin_sync, last_whoop_sync } = d
  const todayStr  = new Date().toISOString().slice(0, 10)
  const actHoy    = garmin_activities.filter(a => a.date === todayStr)
  const garminOk  = garmin_activities.length > 0
  const whoopOk   = !!whoop_today
  const diasCac   = getDaysToRace()
  const phase     = getCurrentPhase()

  const garminSt = garminOk
    ? `Garmin ✓ · ${garmin_activities.length} actividades · ${actHoy.length > 0 ? `${actHoy.length} registrada(s) hoy · TSS sync ✓` : 'sin actividad registrada hoy'}`
    : 'Garmin ⚠️ — sin actividades · verifica conexión en Configuración'

  const whoopSt = whoopOk
    ? `Whoop ✓ · Recovery ${whoop_today.recovery_score}% · HRV ${whoop_today.hrv_ms}ms · última sync ${last_whoop_sync ? new Date(last_whoop_sync).toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'}) : '—'}`
    : 'Whoop ⚠️ — sin datos de recuperación · abre la app Whoop y sincroniza esta mañana'

  const nextSync = Math.ceil((new Date().setHours(24,1,0,0) - Date.now()) / 3600000)
  const lines = [
    `⚙️ Tu Coach Server ✓ · BD JSON ✓ · Pipeline agentes ✓ · ${phase.name} activa`,
    `📡 ${garminSt}`,
    `📡 ${whoopSt}`,
    `🔄 Auto-sync: 00:01 AM diario · próxima ejecución ~${nextSync}h · ${diasCac}d para CAC Games · CTL tracking activo`,
  ]
  return lines.map(l => `• ${l}`).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOTOR CEO — veredicto ejecutivo cruzando todos los agentes
// ─────────────────────────────────────────────────────────────────────────────
function analyzeCEO(d) {
  const { ctl, atl, tsb, weight_kg, whoop_today, workout_today } = d
  const phase     = getCurrentPhase()
  const diasCac   = getDaysToRace()
  const whoopRec  = whoop_today?.recovery_score ?? 70
  const isCritical = tsb < THR.tsb.critico && whoopRec < THR.whoop.amarillo
  const isFatigued = tsb < THR.tsb.fatiga  || whoopRec < THR.whoop.amarillo
  const isPeak     = tsb > THR.tsb.fresco  && whoopRec >= THR.whoop.verde
  const wkType     = getWorkoutType(workout_today)

  // Contexto específico de fase para el CEO
  const phaseContext = {
    F1: `${phase.key} Base — construyendo fundamentos aeróbicos y fuerza general. RIR ${phase.rir} en gym. CTL objetivo: ${phase.ctlTarget}+.`,
    F2: `${phase.key} Carga — semanas de mayor estrés del ciclo. RIR ${phase.rir}, cargas 80-88%RM. Recuperación y proteína son críticas.`,
    F3: `${phase.key} Especificidad — potencia ILCA 7 al máximo. RIR ${phase.rir}, pico de CTL hacia ${phase.ctlTarget}. Cada sesión cuenta.`,
    F4: `${phase.key} Taper — reducir volumen 40%, mantener intensidad. RIR ${phase.rir}. Llegar fresco a Barranquilla.`,
    COMP: 'CAC Games activo — maximizar rendimiento en regata. Sin entrenamientos de fatiga. Foco en táctica y ejecución.',
  }

  const estado = isCritical ? '🔴 ALERTA — sobrecarga + recuperación crítica'
               : isFatigued  ? '🟠 FATIGA — ajustar carga hoy'
               : isPeak      ? '🔵 PICO — máximo rendimiento disponible'
               : '🟡 ADAPTACIÓN — progresión controlada'

  const accionBase = isCritical
    ? `Suspende o convierte a 30min recuperación activa Z1. Comunicar a Coach Erick hoy. Nutrióloga Ivonne: +80g carbos + Mg 400mg esta noche. Prioritario.`
    : isFatigued
      ? `Ejecutar ${workout_today?.name || 'sesión'} al 80% de intensidad planificada. TSB ${tsb.toFixed(0)} indica fatiga acumulada — no forzar carga. ${wkType === 'strength' ? `RIR ${phase.rir} en fuerza.` : ''} Proteína +${THR.gapProteinG}g urgente.`
      : isPeak
        ? `Sesión completa al 100%. Recovery ${whoopRec}% + TSB ${tsb.toFixed(0)} = ventana de rendimiento ILCA 7 óptima. Aprovecha para TSS alto esta semana.`
        : `Completar ${workout_today?.name || 'sesión planificada'} según plan ${phase.key}. CTL ${ctl.toFixed(0)} → objetivo ${phase.ctlTarget}. ${diasCac > 7 ? 'Adherencia constante es el diferencial.' : 'Últimos días — cada sesión cuenta para llegar en forma pico.'}`

  const semaforo = isCritical ? '🔴' : isFatigued ? '🟠' : isPeak ? '🔵' : '🟡'
  const ctlGap   = Math.round((PLAN.ctlPeak - ctl) * 10) / 10
  const nota = [
    `${semaforo} Coach Erick: ${isFatigued ? '−10min duración hoy' : `ejecutar plan según ${phase.key}`}`,
    `Nutrióloga Ivonne: ${THR.gapProteinG}g proteína/día pendiente`,
    `CTL: ${ctl.toFixed(1)} → pico objetivo ${PLAN.ctlPeak} (${ctlGap > 0 ? `faltan +${ctlGap}` : 'objetivo alcanzado ✓'})`,
    `${diasCac}d para ${PLAN.sport} · ${phaseContext[phase.key] || phaseContext.F1}`,
  ].join('  |  ')

  return `🎯 ESTADO DEL DÍA: ${estado}\n\n⚡ ACCIÓN: ${accionBase}\n\n📋 NOTA TÉCNICA: ${nota}`
}

// ─────────────────────────────────────────────────────────────────────────────
//  STREAM LOCAL — emite eventos SSE con delays para animación premium
// ─────────────────────────────────────────────────────────────────────────────
async function streamLocalPipeline(athleteData, sendEvent) {
  const P = AGENT_PERSONAS

  const startAgent = (key) => sendEvent({
    type: 'agent_update', agent: key, status: 'running',
    statusText: P[key].loadingMsg, name: P[key].name, emoji: P[key].emoji, color: P[key].color,
  })
  const doneAgent = (key, text) => sendEvent({
    type: 'agent_update', agent: key, status: 'done',
    text, name: P[key].name, emoji: P[key].emoji, color: P[key].color,
  })

  // ── Oleada 1: Datos + Sistemas (paralelo visual)
  startAgent('datos')
  startAgent('sistemas')

  await sleep(1500)
  const datosReport = analyzeDatos(athleteData)
  doneAgent('datos', datosReport)

  await sleep(500)
  const sistemasReport = analyzeSistemas(athleteData)
  doneAgent('sistemas', sistemasReport)

  // ── Oleada 2: Físico
  await sleep(900)
  startAgent('fisico')
  await sleep(1700)
  const fisicoReport = analyzeFisico(athleteData)
  doneAgent('fisico', fisicoReport)

  // ── Oleada 3: Nutrición
  await sleep(700)
  startAgent('nutricion')
  await sleep(1400)
  const nutricionReport = analyzeNutricion(athleteData)
  doneAgent('nutricion', nutricionReport)

  // ── CEO sintetiza con efecto typewriter
  await sleep(1000)
  startAgent('ceo')
  await sleep(1300)

  const ceoReport = analyzeCEO(athleteData)
  const chunks = ceoReport.split(/(\s+)/)
  for (const chunk of chunks) {
    if (chunk) sendEvent({ type: 'ceo_chunk', chunk })
    await sleep(22)
  }
  doneAgent('ceo', ceoReport)

  return {
    datos:     datosReport,
    sistemas:  sistemasReport,
    fisico:    fisicoReport,
    nutricion: nutricionReport,
    ceo:       ceoReport,
    timestamp: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PIPELINE SIN STREAMING — para guardado en BD sin animación
// ─────────────────────────────────────────────────────────────────────────────
async function runFullPipeline(athleteData) {
  const datosReport     = analyzeDatos(athleteData)
  const sistemasReport  = analyzeSistemas(athleteData)
  const fisicoReport    = analyzeFisico(athleteData)
  const nutricionReport = analyzeNutricion(athleteData)
  const ceoReport       = analyzeCEO(athleteData)
  return { datos: datosReport, sistemas: sistemasReport, fisico: fisicoReport, nutricion: nutricionReport, ceo: ceoReport, timestamp: new Date().toISOString() }
}

module.exports = { runFullPipeline, streamLocalPipeline, AGENT_PERSONAS }
