'use strict'
const express = require('express')
const { auth } = require('../middleware/auth')
const { now, localDate } = require('../utils/ids')
const { DB } = require('../services/db')
const { weekStartISO } = require('../services/pmc')
const { computeAnalytics } = require('../../agents-system')

const router = express.Router()

// ════════════════════════════════════════════════════════════════════════════
//  RESUMEN EJECUTIVO — agrega los 4 bloques en un solo endpoint
// ════════════════════════════════════════════════════════════════════════════
router.get('/executive-summary', auth, (req, res) => {
  const aid = req.user.id

  // ── Rendimiento ──────────────────────────────────────────────────────────
  // Bug fix: usar pmc_cache (construido con datos reales) en vez de computePMC que incluye workouts planeados futuros
  const pmcCacheArr = (() => {
    const c = DB.pmc_cache_by_athlete?.[aid] || DB.pmc_cache
    return Array.isArray(c) ? c : (c?.data || [])
  })()
  const lastPMC = pmcCacheArr[pmcCacheArr.length - 1] || {}
  const ctl = lastPMC.ctl || 0
  const atl = lastPMC.atl || 0
  const tsb = lastPMC.tsb || 0

  // Bug fix: solo workouts COMPLETADOS para TSS real de la semana (no contar planeados futuros)
  const allWk = DB.workouts.filter((w) => w.athlete_id === aid)
  const wkStart = weekStartISO()
  const wkWorkouts = allWk.filter((w) => w.date >= wkStart && w.status === 'COMPLETED')
  const weeklyTSS = wkWorkouts.reduce((s, w) => s + (Number(w.actual_tss ?? 0) || 0), 0)

  // Mini PMC: últimas 6 semanas reales + proyección plan hasta CAC (Jul 25)
  const realSlice = pmcCacheArr.slice(-42).map((p) => ({ date: p.date, tss: p.tss || 0, ctl: p.ctl, atl: p.atl, tsb: p.tsb, projected: false }))
  // Proyectar hacia adelante usando workouts PENDING del plan
  const today = localDate()
  const planFuture = allWk.filter((w) => w.date > today && w.date <= '2026-07-26').sort((a, b) => a.date.localeCompare(b.date))
  let projCtl = lastPMC.ctl || 0, projAtl = lastPMC.atl || 0
  const kCtl = 1 - Math.exp(-1 / 42), kAtl = 1 - Math.exp(-1 / 7)
  // Iterar fecha a fecha desde mañana hasta el fin del plan
  const projEnd = new Date('2026-07-26T12:00:00Z')
  const projStart = new Date(today + 'T12:00:00Z')
  projStart.setUTCDate(projStart.getUTCDate() + 1)
  const planTssByDate = {}
  planFuture.forEach((w) => { planTssByDate[w.date] = (w.tss_planned || 0) })
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
    .filter((s) => s.athlete_id === aid && s.device === 'whoop' && s.data?.recovery_score != null)
    .sort((a, b) => b.synced_at.localeCompare(a.synced_at))
    .slice(0, 7)
  // Usar lectura más reciente como valor principal (no promedio) — coincide con el dashboard
  const latestWhoop = whoopSyncs[0]?.data || null
  const hrv7d = latestWhoop?.hrv_ms ?? null
  const rec7d = latestWhoop?.recovery_score ?? null
  const sleep7d = latestWhoop?.sleep_hours ?? null
  const rhr7d = latestWhoop?.rhr_bpm ?? null
  const strain7d = latestWhoop?.strain ?? null

  // ── Nutrición ─────────────────────────────────────────────────────────────
  const garminSyncs = DB.device_syncs.filter((s) => s.athlete_id === aid && s.device === 'garmin').sort((a, b) => b.synced_at.localeCompare(a.synced_at)).slice(0, 7)
  const calBurned7d = garminSyncs.reduce((s, x) => s + (x.data?.calories || 0), 0)
  const latestNP = (DB.nutrition_plans || []).filter((p) => p.athlete_id === aid).sort((a, b) => b.date.localeCompare(a.date))[0]
  const calIn7d = latestNP ? latestNP.calories * 7 : null
  const calBalance = calIn7d && calBurned7d ? calIn7d - calBurned7d : null

  // ── Antropometría ─────────────────────────────────────────────────────────
  const bcHistory = (DB.body_compositions || []).filter((b) => b.athlete_id === aid).sort((a, b) => a.date.localeCompare(b.date))
  const latestBC = bcHistory[bcHistory.length - 1] || null
  const prevBC = bcHistory[bcHistory.length - 2] || null
  const trends = latestBC && prevBC ? {
    weight: latestBC.weight_kg < prevBC.weight_kg ? 'down' : latestBC.weight_kg > prevBC.weight_kg ? 'up' : 'flat',
    fat: latestBC.bodyfat_pct < prevBC.bodyfat_pct ? 'down' : latestBC.bodyfat_pct > prevBC.bodyfat_pct ? 'up' : 'flat',
    muscle: latestBC.muscle_kg > prevBC.muscle_kg ? 'up' : latestBC.muscle_kg < prevBC.muscle_kg ? 'down' : 'flat',
  } : null

  // ── Motor de analítica real (mismo veredicto que el panel Análisis IA) ──────
  const sumPhases = [
    { name: 'F1 Base Técnica', start: '2026-06-07', end: '2026-06-21', tssWeek: 360, ctlTarget: 28 },
    { name: 'F2 Carga', start: '2026-06-22', end: '2026-07-12', tssWeek: 490, ctlTarget: 45 },
    { name: 'F3 Especificidad', start: '2026-07-13', end: '2026-07-26', tssWeek: 430, ctlTarget: 55 },
    { name: 'F4 Taper', start: '2026-07-27', end: '2026-08-01', tssWeek: 160, ctlTarget: 55 },
  ]
  const sumPhase = sumPhases.find((p) => today >= p.start && today <= p.end) || sumPhases[0]
  const A = computeAnalytics({
    pmcSeries: pmcCacheArr.slice(-60),
    whoopHistory: (DB.whoop_history || []).slice(-60),
    workouts: allWk,
    today,
    phase: sumPhase,
  })

  res.json({
    performance: { ctl, atl, tsb, weekly_tss: A.weekTSS || weeklyTSS, tss_goal: sumPhase.tssWeek, mini_pmc: miniPMC, acwr: A.acwr, ctl_ramp: A.ctlRamp },
    recovery: { hrv_7d: A.hrvRecentAvg ?? hrv7d, hrv_today: hrv7d, hrv_baseline: A.hrvBaseAvg ?? 58, recovery_7d: A.recRecentAvg ?? rec7d, recovery_today: rec7d, sleep_7d: A.sleepRecentAvg ?? sleep7d, rhr: A.rhrRecentAvg ?? rhr7d, rhr_baseline: A.rhrBaseAvg, strain: strain7d },
    verdict: { label: A.verdict, color: A.verdictColor, emoji: A.verdictEmoji, text: A.verdictText, flags: [...A.fatigueFlags, ...A.underFlags] },
    nutrition: { calories_in_7d: calIn7d, calories_burned_7d: calBurned7d, balance_7d: calBalance, daily_plan: latestNP ? { protein_g: latestNP.protein_g, carbs_g: latestNP.carbs_g, fat_g: latestNP.fat_g, calories: latestNP.calories } : null },
    anthropometry: latestBC ? { ...latestBC, trends } : null,
    generated_at: now(),
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  ANÁLISIS IA — Insights cruzados + recomendaciones + correlaciones
// ════════════════════════════════════════════════════════════════════════════
router.get('/ai-analysis', auth, (req, res) => {
  const aid = req.user.id
  const today = localDate()

  // ── Datos base ───────────────────────────────────────────────────────────
  const pmcArr = Array.isArray(DB.pmc_cache) ? DB.pmc_cache : (DB.pmc_cache?.data || [])
  const lastPMC = pmcArr[pmcArr.length - 1] || {}
  const ctl = lastPMC.ctl || 0, atl = lastPMC.atl || 0, tsb = lastPMC.tsb || 0

  const whoopSyncs = DB.device_syncs
    .filter((s) => s.athlete_id === aid && s.device === 'whoop' && s.data?.recovery_score != null)
    .sort((a, b) => b.synced_at.localeCompare(a.synced_at))
  const latestW = whoopSyncs[0]?.data || null
  const rec = latestW?.recovery_score ?? null
  const hrv = latestW?.hrv_ms ?? null
  const sleep = latestW?.sleep_hours ?? null
  const rhr = latestW?.rhr_bpm ?? null

  const allWk = DB.workouts.filter((w) => w.athlete_id === aid)
  const todayWk = allWk.find((w) => w.date === today) || null
  const doneWk = allWk.filter((w) => w.status === 'COMPLETED')

  const nutrition = (DB.nutrition_plans || []).filter((p) => p.athlete_id === aid).sort((a, b) => b.date.localeCompare(a.date))[0] || null
  const bc = (DB.body_compositions || []).filter((b) => b.athlete_id === aid).sort((a, b) => a.date.localeCompare(b.date)).pop() || null

  const wkStart = weekStartISO()
  const weekDone = allWk.filter((w) => w.date >= wkStart && w.status === 'COMPLETED')
  const weekTSS = weekDone.reduce((s, w) => s + (Number(w.actual_tss ?? 0) || 0), 0)
  const daysToRace = Math.max(0, Math.ceil((new Date('2026-08-01') - new Date(today + 'T12:00:00Z')) / 86400000))

  // ── Plan phase detection ─────────────────────────────────────────────────
  const planPhases = [
    { name: 'F1 Base Técnica', start: '2026-06-07', end: '2026-06-21', color: '#4f8ef7', tssWeek: 360 },
    { name: 'F2 Carga', start: '2026-06-22', end: '2026-07-12', color: '#f97316', tssWeek: 490 },
    { name: 'F3 Especificidad', start: '2026-07-13', end: '2026-07-26', color: '#22c55e', tssWeek: 430 },
    { name: 'F4 Taper', start: '2026-07-27', end: '2026-08-01', color: '#eab308', tssWeek: 160 },
  ]
  const currentPhase = planPhases.find((p) => today >= p.start && today <= p.end) || planPhases[0]
  const tssGoal = currentPhase.tssWeek || 360
  const planDayNum = Math.max(1, Math.ceil((new Date(today + 'T12:00:00Z') - new Date(currentPhase.start + 'T12:00:00Z')) / 86400000) + 1)
  const phaseTotalDays = Math.ceil((new Date(currentPhase.end + 'T12:00:00Z') - new Date(currentPhase.start + 'T12:00:00Z')) / 86400000) + 1

  // ── Insights ─────────────────────────────────────────────────────────────
  const insights = []

  // Veredicto real (motor de analítica: HRV vs baseline, ACWR, TSB, recovery)
  const A = computeAnalytics({
    pmcSeries: pmcArr.slice(-60),
    whoopHistory: (DB.whoop_history || []).slice(-60),
    workouts: allWk,
    today,
    phase: currentPhase,
  })
  const aLevel = A.verdictColor === '#ef4444' ? 'red' : A.verdictColor === '#f97316' || A.verdictColor === '#eab308' ? 'yellow' : A.verdictColor === '#3b82f6' ? 'blue' : 'green'
  insights.push({
    pillar: 'overview', level: aLevel, icon: A.verdictEmoji,
    title: `Estado: ${A.verdict}`,
    body: `${A.verdictText}${A.fatigueFlags.length || A.underFlags.length ? ' · ' + [...A.fatigueFlags, ...A.underFlags].join('; ') : ''}`,
  })

  // Recovery
  if (rec != null) {
    const hDiff = A.hrvBaseAvg != null && hrv != null ? Math.round(hrv - A.hrvBaseAvg) : null
    const recLvl = rec >= 67 ? 'green' : rec >= 34 ? 'yellow' : 'red'
    const recTxt = rec >= 67
      ? `Recovery ${rec}% — sistema nervioso bien recuperado. HRV ${hrv}ms (${hDiff >= 0 ? '+' + hDiff : hDiff}ms vs baseline). Listo para entrenamiento de carga.`
      : rec >= 34
        ? `Recovery ${rec}% — moderado. HRV ${hrv}ms. Tolera volumen pero evita intensidad máxima hoy.`
        : `Recovery ${rec}% — bajo. Prioriza recuperación activa. HRV ${hrv}ms indica fatiga del SNC.`
    insights.push({ pillar: 'recovery', level: recLvl, icon: '🫀', title: `Recovery ${rec}% · HRV ${hrv}ms`, body: recTxt })
  }

  // Performance / plan
  const tsbLvl = tsb > 5 ? 'green' : tsb >= -10 ? 'blue' : tsb >= -20 ? 'yellow' : 'red'
  const tsbBody = tsb > 5
    ? `TSB +${tsb} — forma positiva. El cuerpo está fresco para alta intensidad. CTL ${ctl} estable.`
    : tsb >= -10
      ? `TSB ${tsb} — zona de entrenamiento productivo. CTL ${ctl} en construcción (${currentPhase.name}, día ${planDayNum}/${phaseTotalDays}).`
      : tsb >= -20
        ? `TSB ${tsb} — carga acumulada. Normal para ${currentPhase.name}. Monitorea RPE. CTL ${ctl} creciendo.`
        : `TSB ${tsb} — sobrecarga alta. Considera ajuste de carga con Coach Erick. CTL ${ctl}.`
  insights.push({ pillar: 'performance', level: tsbLvl, icon: '📈', title: `${currentPhase.name} · Día ${planDayNum}`, body: tsbBody })

  // Nutrition — usa plan Ivonne (125g del plan); nutrition_plans en BD contiene metas, no ingesta real
  {
    const protPlan = 125 // lo que provee el plan de Ivonne tal como está diseñado
    const protGoal = 198 // meta Bullshark Lab
    const protEff = protPlan // siempre plan Ivonne; food log diario no está implementado aún
    const protDiff = protGoal - protEff
    const nutLvl = protDiff <= 0 ? 'green' : protDiff <= 30 ? 'yellow' : protDiff <= 60 ? 'orange' : 'red'
    const gapMsg = protDiff > 0
      ? `Faltan ${protDiff}g — añade shake 30g whey + yogur griego 200g = +${Math.round(30 * 0.8 + 20)}g. Meta: ${protGoal}g/día`
      : `Objetivo cubierto. Mantén el ritmo.`
    const protColor = nutLvl === 'green' ? '#22c55e' : nutLvl === 'yellow' ? '#eab308' : '#f97316'
    insights.push({
      pillar: 'nutrition', level: nutLvl, icon: '🥩',
      title: `Proteína ${protEff}g / ${protGoal}g · ${Math.round(protEff / protGoal * 100)}%`,
      body: `Plan Ivonne provee ~${protPlan}g/día (${Math.round(protPlan / protGoal * 100)}% de meta). ${gapMsg}. Déficit calórico −300 kcal/día alineado con composición corporal CAC.`,
      prot_current: protEff, prot_goal: protGoal, prot_pct: Math.round(protEff / protGoal * 100), prot_color: protColor,
    })
  }

  // Body comp
  if (bc) {
    const bfDiff = Math.round((bc.bodyfat_pct - 18) * 10) / 10
    const wDiff = Math.round((bc.weight_kg - 86) * 10) / 10
    const bcLvl = bfDiff <= 0 ? 'green' : bfDiff <= 3 ? 'yellow' : 'orange'
    insights.push({
      pillar: 'body', level: bcLvl, icon: '⚖️', title: `Peso ${bc.weight_kg}kg · Grasa ${bc.bodyfat_pct}%`,
      body: `Grasa ${bc.bodyfat_pct}% (meta <18%, faltan ${bfDiff}% · ${Math.round(bfDiff * bc.weight_kg / 100 * 10) / 10}kg de grasa). Peso objetivo: 86kg (diff ${wDiff > 0 ? '+' : ''}${wDiff}kg). Músculo ${bc.muscle_kg}kg ✓.`,
    })
  }

  // ── Recomendaciones ──────────────────────────────────────────────────────
  const recommendations = []

  // Workout de hoy
  if (todayWk && todayWk.status !== 'COMPLETED') {
    const segs = (todayWk.segments || []).slice(0, 2).map((s) => s.name).join(' · ') || ''
    recommendations.push({
      priority: 'high', icon: '🏋️', category: 'Entrenamiento',
      title: todayWk.name,
      body: `${todayWk.duration_min || '—'}' · TSS ~${todayWk.tss_planned || '—'} · ${segs}`,
    })
  } else if (todayWk && todayWk.status === 'COMPLETED') {
    recommendations.push({ priority: 'done', icon: '✅', category: 'Entrenamiento', title: 'Sesión completada hoy', body: `TSS ${todayWk.actual_tss || todayWk.tss_planned} · RPE ${todayWk.actual_rpe || '—'}/10` })
  }

  // Nutrición — siempre mostrar: el plan Ivonne da 125g vs meta 198g = gap de 73g
  {
    const protPlan = 125, protGoal = 198, protDiff = protGoal - protPlan
    recommendations.push({ priority: 'medium', icon: '🥩', category: 'Nutrición', title: `+${protDiff}g proteína · cerrar brecha hoy`, body: `Plan Ivonne provee ~${protPlan}g/día (meta ${protGoal}g). Añade shake 30g whey + 200g yogur griego = +44g → llegas a ~169g. Progreso diario cierra el gap gradualmente.` })
  }

  // Sueño
  if (sleep != null && sleep < 8) {
    recommendations.push({ priority: 'medium', icon: '😴', category: 'Recuperación', title: 'Apunta a 8.5h esta noche', body: `Sueño anterior: ${sleep}h. Duerme 21:30–22:00 para alcanzar 8.5h. El sueño impacta directamente HRV y rendimiento de mañana.` })
  } else if (sleep != null && sleep >= 8) {
    recommendations.push({ priority: 'low', icon: '😴', category: 'Recuperación', title: `Sueño ${sleep}h — mantén el ritmo`, body: `Excelente. Sigue durmiendo 21:30–22:00. La consistencia en el sueño mantiene HRV estable.` })
  }

  // ── Correlaciones calculadas ─────────────────────────────────────────────
  const correlations = []

  // Correlación 1: Recovery score → TSS realizado (cross reference whoop syncs con workouts)
  const matchedPairs = []
  whoopSyncs.forEach((sync) => {
    const syncDate = sync.synced_at.slice(0, 10)
    // Find workout on same day or day after the sync
    const wkAfter = allWk.find((w) => (w.date === syncDate || w.date === (() => { const d = new Date(syncDate + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()) && w.status === 'COMPLETED' && w.actual_tss)
    if (wkAfter) matchedPairs.push({ rec: sync.data.recovery_score, hrv: sync.data.hrv_ms, tss: wkAfter.actual_tss, rpe: wkAfter.actual_rpe })
  })

  if (matchedPairs.length >= 2) {
    const highRec = matchedPairs.filter((p) => p.rec >= 67)
    const lowRec = matchedPairs.filter((p) => p.rec < 67)
    if (highRec.length && lowRec.length) {
      const avgHigh = Math.round(highRec.reduce((s, p) => s + p.tss, 0) / highRec.length)
      const avgLow = Math.round(lowRec.reduce((s, p) => s + p.tss, 0) / lowRec.length)
      const diff = Math.round((avgHigh - avgLow) / avgLow * 100)
      correlations.push({ icon: '🫀', title: 'Recovery → Rendimiento', value: `+${diff}% TSS`, body: `Con recovery ≥67%: ${avgHigh} TSS prom vs ${avgLow} con recovery bajo. Mayor disponibilidad = mejor entrenamiento.`, strength: Math.min(matchedPairs.length, 5) })
    }
  } else {
    correlations.push({ icon: '🫀', title: 'Recovery → Rendimiento', value: '—', body: `Se necesitan ≥2 semanas de datos pareados para calcular correlación HRV/Recovery × TSS.`, strength: 0, pending: true })
  }

  // Correlación 2: Sueño → RPE
  const sleepRpePairs = whoopSyncs.map((sync) => {
    const nextDay = (() => { const d = new Date(sync.synced_at.slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
    const wk = allWk.find((w) => w.date === nextDay && w.actual_rpe != null)
    return wk ? { sleep: sync.data.sleep_hours, rpe: wk.actual_rpe } : null
  }).filter(Boolean)

  if (sleepRpePairs.length >= 2) {
    const goodSleep = sleepRpePairs.filter((p) => p.sleep >= 8)
    const poorSleep = sleepRpePairs.filter((p) => p.sleep < 8)
    if (goodSleep.length && poorSleep.length) {
      const rpeGood = +(goodSleep.reduce((s, p) => s + p.rpe, 0) / goodSleep.length).toFixed(1)
      const rpePoor = +(poorSleep.reduce((s, p) => s + p.rpe, 0) / poorSleep.length).toFixed(1)
      correlations.push({ icon: '😴', title: 'Sueño → RPE', value: `−${+(rpePoor - rpeGood).toFixed(1)} pts`, body: `Con ≥8h de sueño: RPE ${rpeGood} vs ${rpePoor} con <8h. Menos esfuerzo percibido con mejor recuperación.`, strength: sleepRpePairs.length })
    }
  } else {
    correlations.push({ icon: '😴', title: 'Sueño → Esfuerzo percibido', value: '—', body: `Con datos actuales: sueño ${sleep}h → entrenamiento mañana. Se necesitan más sesiones completadas para correlación estadística.`, strength: 0, pending: true })
  }

  // Correlación 3: Tendencia CTL (real vs proyectado)
  const planWks = allWk.filter((w) => w.status !== 'COMPLETED').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7)
  const projectedCTLAtRace = (() => {
    let c = ctl, a = atl
    const kc = 1 - Math.exp(-1 / 42), ka = 1 - Math.exp(-1 / 7)
    planWks.forEach((w) => { const t = w.tss_planned || 0; c = c + (t - c) * kc; a = a + (t - a) * ka })
    return Math.round(c * 10) / 10
  })()
  correlations.push({ icon: '📈', title: 'CTL proyectado', value: `${projectedCTLAtRace} CTL`, body: `Si cumples el plan F1 esta semana: CTL proyectado ${projectedCTLAtRace} en 7 días (vs ${ctl} hoy). Tendencia positiva en construcción.`, strength: 3, projected: true })

  // ── Radar scores 0-100 ───────────────────────────────────────────────────
  const radarRendimiento = (() => {
    let s = tsb < -25 ? 30 : tsb < -15 ? 58 : tsb < -5 ? 74 : tsb < 5 ? 82 : 88
    if (ctl >= 20) s = Math.min(100, s + 5) // CTL en construcción
    return s
  })()
  const radarNutricion = Math.round(Math.min(100, (125 / 198) * 90)) // plan provee 125g vs 198g meta
  const radarDescanso = rec != null ? Math.min(100, rec) : 50
  const radarSueno = sleep != null ? Math.min(100, Math.round((sleep / 8) * 100)) : 50

  const radarInterpLines = []
  if (radarSueno >= 80) radarInterpLines.push(`Sueño ${sleep ?? '—'}h ${radarSueno >= 100 ? '✓ óptimo' : 'adecuado'} — ventana anabólica nocturna aprovechada.`)
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

module.exports = router
