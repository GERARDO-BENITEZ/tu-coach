'use strict'
// ═══════════════════════════════════════════════════════════════════════════════
//  Tu Coach — Motor de Agentes LOCAL (reglas JS puras, sin API externa)
//  Atleta: Gerardo Benítez · ILCA 7 (Laser) · CAC Games 2026 · Barranquilla
//  Pipeline: Datos → Físico + Nutrición → Sistemas → CEO → reporte ejecutivo
// ═══════════════════════════════════════════════════════════════════════════════

const { computeAnalytics } = require('./analytics-engine.js')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Calcula el bloque de métricas reales una sola vez por corrida del pipeline
function buildAnalytics(d) {
  return computeAnalytics({
    pmcSeries:    d.pmc_series    || [],
    whoopHistory: d.whoop_history || [],
    workouts:     d.workouts_all  || [],
    today:        new Date().toISOString().slice(0, 10),
    phase:        getCurrentPhase(),
  })
}

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
function analyzeDatos(d, A) {
  const phase     = getCurrentPhase()
  const diasCac   = getDaysToRace()
  const tssVsGoal = A.weekTSS != null ? Math.round((A.weekTSS / phase.tssWeek) * 100) : null
  const planDay   = getPlanDayNumber(phase)
  const planTotal = getPhaseTotalDays(phase)

  const tsbZone = A.tsb < THR.tsb.critico ? '🔴 Sobrecarga'
                : A.tsb < THR.tsb.fatiga  ? '🟠 Carga alta'
                : A.tsb < THR.tsb.fresco  ? '🟡 Bloque de carga'
                : '🔵 Forma fresca'

  const lines = [
    `📊 PMC: CTL ${A.ctl} · ATL ${A.atl} · TSB ${A.tsb} (${tsbZone}) · ACWR ${A.acwr ?? '—'} · ramp CTL ${A.ctlRamp >= 0 ? '+' : ''}${A.ctlRamp ?? '—'}/sem · objetivo CAC CTL ≥${phase.ctlTarget}`,
    `📅 ${phase.name} · Día ${planDay}/${planTotal} · TSS semana ${A.weekTSS} (${tssVsGoal ?? '—'}% del objetivo ${phase.tssWeek}) · semana previa ${A.prevWeekTSS}`,
    A.recToday != null
      ? `🫀 Whoop hoy: Recovery ${A.recToday}% · HRV 7d ${A.hrvRecentAvg}ms (baseline ${A.hrvBaseAvg}±${A.hrvBaseSd}, z=${A.hrvZ}) · Recovery 7d ${A.recRecentAvg}% vs baseline ${A.recBaseAvg}% · Sueño 7d ${A.sleepRecentAvg}h`
      : '🫀 Whoop: sin lectura de hoy — revisar sincronización del brazalete',
    A.adherence != null
      ? `📋 Adherencia: ${A.completed}/${A.planned} sesiones (${A.adherence}%) · ${diasCac}d para ${PLAN.event} · ${A.daysOfData.whoop}d de datos Whoop`
      : `📋 ${diasCac} días para ${PLAN.event} · ${phase.name} activa · RIR objetivo: ${phase.rir}`,
  ]
  return lines.map(l => `• ${l}`).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOTOR FÍSICO — carga, plan, fuerza ILCA 7, RIR, recomendación de intensidad
// ─────────────────────────────────────────────────────────────────────────────
function analyzeFisico(d, A) {
  const { workout_today, workout_tomorrow } = d
  const phase = getCurrentPhase()
  const gap   = A.weekTSS != null ? phase.tssWeek - A.weekTSS : null
  const wkType = getWorkoutType(workout_today)
  const restDay = !workout_today ||
    /descanso|reposo|libre|recuperaci|movilidad|off|suave/i.test(workout_today.name || '') ||
    (workout_today.tss_planned != null && workout_today.tss_planned <= 25)
  const hoyGuia = restDay
    ? 'Día de descanso/recuperación del plan — respétalo: Z1 suave, hidratación y sueño.'
    : A.recoveryAction

  // Veredicto físico real (motor de analítica)
  const estadoFisico = `${A.verdictEmoji} ${A.verdict}`

  // Marcadores que sustentan el veredicto
  const flags = [...A.fatigueFlags, ...A.underFlags]
  const flagsTxt = flags.length ? `Señales: ${flags.join('; ')}.` : 'Sin señales de alarma en HRV, FC reposo ni recovery.'

  // Contexto específico por tipo de entreno + fase
  let strengthContext = ''
  if (wkType === 'strength') {
    const rirMap = { F1:'3-4 (técnica, lejos del fallo)', F2:'1-2 (cerca del fallo, máxima tensión)', F3:'0-1 (al límite, pico de fuerza)', F4:'3-4 (mantenimiento, sin fatiga)' }
    const loadMap = { F1:'65-72%1RM', F2:'80-88%1RM', F3:'85-95%1RM', F4:'60-70%1RM' }
    strengthContext = ` · RIR objetivo hoy: ${rirMap[phase.key] || phase.rir} · Carga: ${loadMap[phase.key] || phase.pct} · Ejercicios clave: hiking isométrico + tracción de escota`
  }

  const lines = [
    `💪 Estado físico ${phase.key}: ${estadoFisico} — ${A.verdictText}`,
    `🔬 ${flagsTxt}`,
    workout_today
      ? `⚡ Hoy: ${workout_today.name} · ${workout_today.duration_min || '—'}min · TSS ~${workout_today.tss_planned || '—'} · ${workout_today.status === 'COMPLETED' ? '✓ COMPLETADO' : 'pendiente'} → ${hoyGuia}${restDay ? '' : strengthContext}`
      : `⚡ Hoy: sin entreno planificado — ${hoyGuia}`,
    `📈 Carga: ACWR ${A.acwr ?? '—'} · ramp CTL ${A.ctlRamp >= 0 ? '+' : ''}${A.ctlRamp ?? '—'}/sem · TSS semana ${A.weekTSS}${gap > 0 ? ` (${gap} bajo objetivo ${phase.tssWeek} → ${gap > 150 ? 'puedes meter sesión extra' : 'dentro del rango'})` : ' ✓ objetivo cumplido'}`,
    workout_tomorrow
      ? `🔮 Mañana: ${workout_tomorrow.name} · ${workout_tomorrow.duration_min || '—'}min · prepara hidratación + nutrición post-entreno`
      : '🔮 Mañana: sin sesión programada · recuperación activa o movilidad Laser',
  ]
  return lines.map(l => `• ${l}`).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOTOR NUTRICIÓN — plan Ivonne, macros, brecha proteína, estrategia por fase
// ─────────────────────────────────────────────────────────────────────────────
function analyzeNutricion(d, A) {
  const { workout_today } = d
  const tsb     = A.tsb
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
function analyzeSistemas(d, A) {
  const { garmin_total, whoop_today, last_whoop_sync } = d
  const garminOk  = (garmin_total || 0) > 0
  const whoopOk   = !!whoop_today
  const diasCac   = getDaysToRace()
  const phase     = getCurrentPhase()

  const garminSt = garminOk
    ? `Garmin ✓ · ${garmin_total} actividades importadas (histórico completo)`
    : 'Garmin ⚠️ — sin actividades · verifica conexión en Configuración'

  const whoopSt = whoopOk
    ? `Whoop ✓ · ${A.daysOfData.whoop}d de histórico · Recovery hoy ${whoop_today.recovery_score}% · HRV ${whoop_today.hrv_ms}ms · última sync ${last_whoop_sync ? new Date(last_whoop_sync).toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'}) : '—'}`
    : 'Whoop ⚠️ — sin datos de recuperación · abre la app Whoop y sincroniza esta mañana'

  const lines = [
    `⚙️ Tu Coach Server ✓ · BD JSON ✓ · Pipeline agentes ✓ · ${phase.name} activa`,
    `📡 ${garminSt}`,
    `📡 ${whoopSt}`,
    `🔄 Auto-sync: Whoop 7 y 10 AM · Garmin+PMC 11:50 PM · ${diasCac}d para CAC Games · CTL tracking activo`,
  ]
  return lines.map(l => `• ${l}`).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
//  MOTOR CEO — veredicto ejecutivo cruzando todos los agentes
// ─────────────────────────────────────────────────────────────────────────────
function analyzeCEO(d, A) {
  const { workout_today } = d
  const phase     = getCurrentPhase()
  const diasCac   = getDaysToRace()
  const wkType    = getWorkoutType(workout_today)

  // Contexto específico de fase para el CEO
  const phaseContext = {
    F1: `${phase.key} Base — construyendo fundamentos aeróbicos y fuerza general. RIR ${phase.rir} en gym. CTL objetivo: ${phase.ctlTarget}+.`,
    F2: `${phase.key} Carga — semanas de mayor estrés del ciclo. RIR ${phase.rir}, cargas 80-88%RM. Recuperación y proteína son críticas.`,
    F3: `${phase.key} Especificidad — potencia ILCA 7 al máximo. RIR ${phase.rir}, pico de CTL hacia ${phase.ctlTarget}. Cada sesión cuenta.`,
    F4: `${phase.key} Taper — reducir volumen 40%, mantener intensidad. RIR ${phase.rir}. Llegar fresco a Barranquilla.`,
    COMP: 'CAC Games activo — maximizar rendimiento en regata. Sin entrenamientos de fatiga. Foco en táctica y ejecución.',
  }

  // Acción del día derivada del veredicto real + recuperación de hoy
  const isOvertrain = A.verdict.startsWith('SOBREENTREN')
  const isOverreach = A.verdict.startsWith('SOBRECARGA')
  const isUnder     = A.verdict === 'FALTA CARGA'
  // ¿El plan de hoy ya es descanso/recuperación? (no contradecir con "al 100%")
  const restDay = !workout_today ||
    /descanso|reposo|libre|recuperaci|movilidad|off|suave/i.test(workout_today.name || '') ||
    (workout_today.tss_planned != null && workout_today.tss_planned <= 25)

  const accionBase = isOvertrain
    ? `Reduce carga HOY: convierte la sesión en 30min Z1 o descansa. Avisa a Coach Erick. Esta noche: +carbos + Mg 400mg + dormir 9h. Reevalúa HRV mañana.`
    : isOverreach
      ? `Ejecuta ${workout_today?.name || 'la sesión'} al ~80% de intensidad. ${A.recoveryAction} ${wkType === 'strength' ? `RIR ${phase.rir} en fuerza, no busques fallo hoy.` : ''} Prioriza proteína (+${THR.gapProteinG}g) y sueño.`
      : isUnder
        ? `Tienes margen: sube la carga. ${A.weekTSS < phase.tssWeek ? `Vas en ${A.weekTSS} TSS esta semana vs objetivo ${phase.tssWeek} — mete intensidad o una sesión extra.` : ''} No te estanques rumbo al pico de CTL ${phase.ctlTarget}.`
        : restDay
          ? `Hoy el plan es descanso/recuperación: ${workout_today?.name || 'día libre'}. Respétalo aunque tu recovery esté en ${A.recToday ?? '—'}% — Z1 suave máximo, hidratación y sueño. El descanso es parte del entrenamiento.`
          : `Ejecuta ${workout_today?.name || 'la sesión planificada'} de ${phase.key}. ${A.recoveryAction} CTL ${A.ctl} → objetivo ${phase.ctlTarget}. ${diasCac > 7 ? 'La adherencia constante es el diferencial.' : 'Últimos días — cada sesión cuenta para llegar en pico.'}`

  const ctlGap = Math.round((PLAN.ctlPeak - A.ctl) * 10) / 10
  const nota = [
    `${A.verdictEmoji} Recuperación hoy: ${A.recoveryState}`,
    `Carga: ACWR ${A.acwr ?? '—'} · TSB ${A.tsb} · ramp ${A.ctlRamp >= 0 ? '+' : ''}${A.ctlRamp}/sem`,
    `CTL ${A.ctl} → pico objetivo ${PLAN.ctlPeak} (${ctlGap > 0 ? `faltan +${ctlGap}` : 'objetivo alcanzado ✓'})`,
    `Nutrición: ${THR.gapProteinG}g proteína/día pendiente`,
    `${diasCac}d para ${PLAN.sport} · ${phaseContext[phase.key] || phaseContext.F1}`,
  ].join('  |  ')

  return `🎯 ESTADO DEL DÍA: ${A.verdictEmoji} ${A.verdict}\n${A.verdictText}\n\n⚡ ACCIÓN: ${accionBase}\n\n📋 NOTA TÉCNICA: ${nota}\n\n${analyzePaginas(d, A)}`
}

// ─────────────────────────────────────────────────────────────────────────────
//  RESUMEN POR PÁGINA — qué está pasando en cada sección del dashboard
// ─────────────────────────────────────────────────────────────────────────────
function analyzePaginas(d, A) {
  const { workout_today, workout_tomorrow } = d
  const phase   = getCurrentPhase()
  const diasCac = getDaysToRace()

  const recTrend = A.recRecentAvg != null && A.recBaseAvg != null
    ? (A.recRecentAvg < A.recBaseAvg - 5 ? '↓ bajando' : A.recRecentAvg > A.recBaseAvg + 5 ? '↑ subiendo' : '→ estable')
    : '—'
  const hrvTrend = A.hrvZ == null ? '—' : A.hrvZ <= -0.75 ? '↓ suprimido' : A.hrvZ >= 0.75 ? '↑ alto' : '→ en baseline'

  const pags = [
    `🏠 Dashboard: CTL ${A.ctl} / ATL ${A.atl} / TSB ${A.tsb} · Recovery hoy ${A.recToday ?? '—'}% · ${phase.name}`,
    `📅 Planificación: hoy ${workout_today ? workout_today.name : 'sin sesión'}${workout_today ? ` (${workout_today.status === 'COMPLETED' ? 'hecho ✓' : 'pendiente'})` : ''} · mañana ${workout_tomorrow ? workout_tomorrow.name : 'libre'}`,
    `📊 Historial: TSS semana ${A.weekTSS} (previa ${A.prevWeekTSS}) · adherencia ${A.adherence ?? '—'}% (${A.completed}/${A.planned})`,
    `❤️ Recuperación: Recovery 7d ${A.recRecentAvg ?? '—'}% (${recTrend}) · HRV 7d ${A.hrvRecentAvg ?? '—'}ms (${hrvTrend}) · Sueño ${A.sleepRecentAvg ?? '—'}h · FC reposo ${A.rhrRecentAvg ?? '—'}bpm`,
    `🥗 Nutrición: brecha de proteína ${THR.gapProteinG}g/día pendiente · plan Ivonne ${THR.kcalPlanEntrenamiento}/${THR.kcalPlanDescanso} kcal`,
    `🏆 Plan CAC: ${phase.name} día ${getPlanDayNumber(phase)}/${getPhaseTotalDays(phase)} · ${diasCac}d para la meta · CTL ${A.ctl} → objetivo fase ${phase.ctlTarget} (pico ${PLAN.ctlPeak})`,
  ]
  return `🗂️ RESUMEN POR PÁGINA:\n${pags.map(p => `• ${p}`).join('\n')}`
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

  // Métricas reales calculadas una sola vez
  const A = buildAnalytics(athleteData)

  // ── Oleada 1: Datos + Sistemas (paralelo visual)
  startAgent('datos')
  startAgent('sistemas')

  await sleep(1500)
  const datosReport = analyzeDatos(athleteData, A)
  doneAgent('datos', datosReport)

  await sleep(500)
  const sistemasReport = analyzeSistemas(athleteData, A)
  doneAgent('sistemas', sistemasReport)

  // ── Oleada 2: Físico
  await sleep(900)
  startAgent('fisico')
  await sleep(1700)
  const fisicoReport = analyzeFisico(athleteData, A)
  doneAgent('fisico', fisicoReport)

  // ── Oleada 3: Nutrición
  await sleep(700)
  startAgent('nutricion')
  await sleep(1400)
  const nutricionReport = analyzeNutricion(athleteData, A)
  doneAgent('nutricion', nutricionReport)

  // ── CEO sintetiza con efecto typewriter
  await sleep(1000)
  startAgent('ceo')
  await sleep(1300)

  const ceoReport = analyzeCEO(athleteData, A)
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
  const A = buildAnalytics(athleteData)
  const datosReport     = analyzeDatos(athleteData, A)
  const sistemasReport  = analyzeSistemas(athleteData, A)
  const fisicoReport    = analyzeFisico(athleteData, A)
  const nutricionReport = analyzeNutricion(athleteData, A)
  const ceoReport       = analyzeCEO(athleteData, A)
  return { datos: datosReport, sistemas: sistemasReport, fisico: fisicoReport, nutricion: nutricionReport, ceo: ceoReport, analytics: A, timestamp: new Date().toISOString() }
}

module.exports = { runFullPipeline, streamLocalPipeline, AGENT_PERSONAS, computeAnalytics }
