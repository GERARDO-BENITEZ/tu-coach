'use strict'
// ═══════════════════════════════════════════════════════════════════════════════
//  Tu Coach — Motor de Analítica (ciencia del deporte real, sin API externa)
//  Calcula sobreentrenamiento, recuperación y balance de carga a partir del
//  histórico real: PMC (CTL/ATL/TSB), Whoop (HRV/Recovery/RHR/Sueño) y plan.
//
//  Marcadores usados (literatura de fisiología del entrenamiento):
//   • HRV vs baseline (z-score)  → supresión = fatiga autonómica / overreaching
//   • RHR vs baseline            → elevación = fatiga / enfermedad
//   • Recovery score (Whoop)     → tendencia 7d vs baseline
//   • TSB (forma = CTL−ATL)      → muy negativo sostenido = sobrecarga
//   • ACWR (carga aguda/crónica = ATL/CTL) → >1.4 riesgo, <0.8 desentrenamiento
//   • Ramp de CTL (fitness/semana)
// ═══════════════════════════════════════════════════════════════════════════════

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
const sd = (a) => {
  if (a.length < 2) return null
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1))
}
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10)
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100)
const col = (v) => v.filter((x) => x != null && !Number.isNaN(x))

// Toma los valores de `key` de las últimas `n` muestras válidas
const lastN = (arr, key, n) => col(arr.slice(-n).map((x) => x[key]))
// Baseline: ventana de 30 días que EXCLUYE la última semana (días -37 a -7)
const baseline = (arr, key) => col(arr.slice(-37, -7).map((x) => x[key]))

// ─────────────────────────────────────────────────────────────────────────────
//  computeAnalytics — función pura. Entrada: series ascendentes por fecha.
//  { pmcSeries:[{date,tss,ctl,atl,tsb}], whoopHistory:[{date,recovery_score,
//    hrv_ms,rhr_bpm,sleep_hours,strain}], workouts:[{date,status}], today, phase }
// ─────────────────────────────────────────────────────────────────────────────
function computeAnalytics(inp) {
  const { pmcSeries = [], whoopHistory = [], workouts = [], today, phase } = inp

  // ── PMC / carga ────────────────────────────────────────────────────────────
  const pmc = pmcSeries.slice()
  const lp = pmc[pmc.length - 1] || {}
  const ctl = r1(lp.ctl), atl = r1(lp.atl), tsb = r1(lp.tsb)
  const ctl7ago = pmc[pmc.length - 8]?.ctl
  const ctlRamp = lp.ctl != null && ctl7ago != null ? r1(lp.ctl - ctl7ago) : null // CTL/semana
  const tsb7ago = pmc[pmc.length - 8]?.tsb
  const tsbTrend = lp.tsb != null && tsb7ago != null ? r1(lp.tsb - tsb7ago) : null
  const acwr = lp.ctl > 0 ? r2(lp.atl / lp.ctl) : null
  const weekTSS = Math.round(pmc.slice(-7).reduce((s, d) => s + (d.tss || 0), 0))
  const prevWeekTSS = Math.round(pmc.slice(-14, -7).reduce((s, d) => s + (d.tss || 0), 0))

  // ── HRV (z-score vs baseline) ──────────────────────────────────────────────
  const wh = whoopHistory.slice()
  const hrvRecentAvg = r1(mean(lastN(wh, 'hrv_ms', 7)))
  const hrvBaseArr = baseline(wh, 'hrv_ms')
  const hrvBaseAvg = r1(mean(hrvBaseArr))
  const hrvBaseSd = r1(sd(hrvBaseArr))
  const hrvZ =
    hrvRecentAvg != null && hrvBaseAvg != null && hrvBaseSd
      ? r2((hrvRecentAvg - hrvBaseAvg) / hrvBaseSd)
      : null
  const hrvSuppressed = hrvZ != null && hrvZ <= -0.75

  // ── Recovery ───────────────────────────────────────────────────────────────
  const recRecentAvg = r1(mean(lastN(wh, 'recovery_score', 7)))
  const recBaseAvg = r1(mean(baseline(wh, 'recovery_score')))
  const recToday = wh[wh.length - 1]?.recovery_score ?? null

  // ── RHR (elevación vs baseline) ────────────────────────────────────────────
  const rhrRecentAvg = r1(mean(lastN(wh, 'rhr_bpm', 7)))
  const rhrBaseAvg = r1(mean(baseline(wh, 'rhr_bpm')))
  const rhrElevated =
    rhrRecentAvg != null && rhrBaseAvg != null && rhrRecentAvg - rhrBaseAvg >= 2

  // ── Sueño / strain ─────────────────────────────────────────────────────────
  const sleepRecentAvg = r1(mean(lastN(wh, 'sleep_hours', 7)))
  const strainRecentAvg = r1(mean(lastN(wh, 'strain', 7)))

  // ── Adherencia ─────────────────────────────────────────────────────────────
  const planned = workouts.filter((w) => w.date >= '2026-06-08' && w.date <= today)
  const completed = planned.filter((w) => w.status === 'COMPLETED')
  const adherence = planned.length ? Math.round((completed.length / planned.length) * 100) : null

  // ── VEREDICTO (suma de señales) ────────────────────────────────────────────
  const fatigueFlags = []
  if (hrvSuppressed) fatigueFlags.push(`HRV ${hrvRecentAvg}ms por debajo de tu baseline (${hrvBaseAvg}ms, z=${hrvZ})`)
  if (rhrElevated) fatigueFlags.push(`FC reposo elevada (+${r1(rhrRecentAvg - rhrBaseAvg)}bpm vs baseline)`)
  if (recRecentAvg != null && recRecentAvg < 50) fatigueFlags.push(`Recovery 7d bajo (${recRecentAvg}%)`)
  if (lp.tsb != null && lp.tsb < -25) fatigueFlags.push(`TSB muy negativo (${tsb})`)
  if (acwr != null && acwr > 1.4) fatigueFlags.push(`ACWR alto (${acwr} · carga aguda muy por encima de la crónica)`)

  const underFlags = []
  if (acwr != null && acwr < 0.8) underFlags.push(`ACWR bajo (${acwr})`)
  if (lp.tsb != null && lp.tsb > 10) underFlags.push(`TSB muy positivo (${tsb} · demasiado fresco)`)
  if (ctlRamp != null && ctlRamp < -2) underFlags.push(`CTL cayendo (${ctlRamp}/sem · perdiendo forma)`)
  if (phase && weekTSS < phase.tssWeek * 0.6) underFlags.push(`TSS semana ${weekTSS} muy por debajo del objetivo ${phase.tssWeek}`)

  let verdict, verdictColor, verdictEmoji, verdictText
  if (fatigueFlags.length >= 3) {
    verdict = 'SOBREENTRENAMIENTO'
    verdictColor = '#ef4444'; verdictEmoji = '🔴'
    verdictText = 'Múltiples marcadores de fatiga simultáneos. Reduce carga ahora: 2-3 días en Z1 o descanso, y reevalúa. Avisa a tu coach.'
  } else if (fatigueFlags.length === 2) {
    verdict = 'SOBRECARGA (overreaching)'
    verdictColor = '#f97316'; verdictEmoji = '🟠'
    verdictText = 'Fatiga acumulándose. Es normal en bloques de carga, pero baja intensidad ~20% hoy y prioriza sueño/proteína. Si persiste 3+ días, descarga.'
  } else if (underFlags.length >= 2) {
    verdict = 'FALTA CARGA'
    verdictColor = '#eab308'; verdictEmoji = '🟡'
    verdictText = 'Estás demasiado fresco y/o perdiendo forma. Puedes (y debes) entrenar más fuerte para no estancar el CTL rumbo a la meta.'
  } else if (tsb != null && tsb > 5 && recRecentAvg != null && recRecentAvg >= 67) {
    verdict = 'PICO / FRESCO'
    verdictColor = '#3b82f6'; verdictEmoji = '🔵'
    verdictText = 'Forma y recuperación altas: ventana de rendimiento. Ideal para sesión de calidad o competir.'
  } else if (tsb != null && tsb < -15) {
    // Carga profunda PERO marcadores autonómicos estables → estás absorbiendo bien el bloque
    verdict = 'CARGA PRODUCTIVA'
    verdictColor = '#22c55e'; verdictEmoji = '🟢'
    const recoveryNote = recRecentAvg != null && recBaseAvg != null && recRecentAvg < recBaseAvg - 8
      ? ` Tu recovery bajó a ${recRecentAvg}% (baseline ${recBaseAvg}%) — esperable en un bloque duro mientras HRV y FC reposo sigan estables.`
      : ''
    verdictText = `Estás en plena carga (TSB ${tsb}) pero tu HRV y FC reposo están estables: tu cuerpo absorbe el bloque.${recoveryNote} Sigue el plan y vigila que HRV no caiga.`
  } else {
    verdict = 'ÓPTIMO'
    verdictColor = '#22c55e'; verdictEmoji = '🟢'
    verdictText = 'Carga y recuperación en equilibrio productivo. Sigue el plan: la constancia es lo que construye el CTL.'
  }

  // Estado de recuperación de HOY (cómo actuar)
  let recoveryState, recoveryAction
  if (recToday == null) {
    recoveryState = 'sin lectura'
    recoveryAction = 'Sincroniza Whoop para tener tu recuperación de hoy.'
  } else if (recToday >= 67) {
    recoveryState = `ALTA (${recToday}%)`
    recoveryAction = 'Verde: tu cuerpo acepta carga. Ejecuta el entreno planificado al 100%.'
  } else if (recToday >= 34) {
    recoveryState = `MEDIA (${recToday}%)`
    recoveryAction = 'Amarillo: entrena, pero modera intensidad/volumen ~15-20% y cuida la técnica.'
  } else {
    recoveryState = `BAJA (${recToday}%)`
    recoveryAction = 'Rojo: prioriza recuperación activa (Z1, movilidad). No fuerces alta intensidad hoy.'
  }

  return {
    // PMC
    ctl, atl, tsb, ctlRamp, tsbTrend, acwr, weekTSS, prevWeekTSS,
    // Whoop
    hrvRecentAvg, hrvBaseAvg, hrvBaseSd, hrvZ, hrvSuppressed,
    recRecentAvg, recBaseAvg, recToday,
    rhrRecentAvg, rhrBaseAvg, rhrElevated,
    sleepRecentAvg, strainRecentAvg,
    // Adherencia
    adherence, planned: planned.length, completed: completed.length,
    // Veredicto
    fatigueFlags, underFlags, verdict, verdictColor, verdictEmoji, verdictText,
    recoveryState, recoveryAction,
    // meta
    daysOfData: { pmc: pmc.length, whoop: wh.length },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  adjustForRecovery — PLAN VIVO: ajusta el entreno de HOY según recuperación
//  + carga acumulada, para entrenar casi a diario sin caer en sobreentrenamiento
//  ni enfermedad. Recibe el workout planificado y el objeto de computeAnalytics.
// ─────────────────────────────────────────────────────────────────────────────
function adjustForRecovery(workout, A) {
  const rec = A.recToday
  const name = (workout && workout.name) || ''
  const isRestPlanned = !workout ||
    /descanso|reposo|libre|recuperaci|movilidad|off|suave/i.test(name) ||
    (workout.tss_planned != null && workout.tss_planned <= 25)

  // Señales de enfermedad / fatiga autonómica (override de máxima prioridad)
  const illnessRisk = A.hrvSuppressed && A.rhrElevated
  const overtrained = A.verdict && A.verdict.startsWith('SOBREENTREN')

  const out = (level, emoji, color, title, detail, intensityPct) =>
    ({ level, emoji, color, title, detail, intensityPct, recToday: rec, verdict: A.verdict })

  // Si el plan ya es descanso, confírmalo (no añadir carga aunque el recovery esté verde)
  if (isRestPlanned) {
    return out('rest', '🛌', '#3b82f6', 'Descanso planificado — respétalo',
      `Hoy toca recuperación según el plan${rec != null ? ` (recovery ${rec}%)` : ''}. Z1 muy suave máximo, hidratación y sueño. El descanso es lo que te hace absorber la carga.`, 0)
  }

  // Override por enfermedad / sobreentrenamiento
  if (overtrained || illnessRisk) {
    return out('rest', '🔴', '#ef4444',
      illnessRisk ? 'Señal de enfermedad — convierte a descanso' : 'Sobreentrenamiento — descansa hoy',
      `${illnessRisk ? 'HRV suprimido + FC reposo elevada (posible incubando algo).' : 'Marcadores de fatiga acumulada.'} Convierte la sesión en descanso o 20-30min Z1. No fuerces. Reevalúa mañana con tu HRV.`, 0)
  }

  // Sin lectura de recovery
  if (rec == null) {
    return out('full', '⚪', '#94a3b8', 'Sin recovery hoy — sincroniza Whoop',
      'Ejecuta el plan con sensaciones (RPE). Sincroniza Whoop para ajuste preciso.', 100)
  }

  // Ajuste por recovery de hoy + guarda de ACWR
  const acwrHigh = A.acwr != null && A.acwr > 1.5
  if (rec < 34) {
    return out('recovery', '🔴', '#ef4444', 'Recovery bajo — recuperación activa',
      `Recovery ${rec}%. Cambia a Z1/movilidad 30-40min. Nada de intensidad ni fuerza pesada hoy: forzar con recovery rojo es como entrenas lesiones y bajones.`, 40)
  }
  if (rec < 50) {
    return out('reduce', '🟠', '#f97316', 'Recovery medio-bajo — baja ~30%',
      `Recovery ${rec}%. Reduce volumen/intensidad ~30%. Si era fuerza, sube el RIR (deja 2-3 reps en reserva). Mantén técnica, no busques el fallo.`, 70)
  }
  if (rec < 67 || acwrHigh) {
    return out('moderate', '🟡', '#eab308',
      acwrHigh && rec >= 67 ? 'Recovery ok pero carga alta — modera ~15%' : 'Recovery medio — modera ~15%',
      `${acwrHigh ? `Tu ACWR (${A.acwr}) ya está alto: ` : `Recovery ${rec}%: `}haz la sesión pero baja ~15% el volumen/intensidad para no acumular fatiga de más esta semana.`, 85)
  }
  return out('full', '🟢', '#22c55e', 'Verde — entrena al 100%',
    `Recovery ${rec}%, HRV y carga en rango. Tu cuerpo acepta el estímulo: ejecuta la sesión completa según el plan.`, 100)
}

// ─────────────────────────────────────────────────────────────────────────────
//  recommendNutrition — recomienda comida según actividad de hoy + ayer.
//  Día de carga → comer completo, priorizar carbos, evitar déficit.
//  Día de descanso → más ligero, déficit moderado para quemar grasa, proteína alta.
//  Respeta el plan de Ivonne (ajusta sobre él, no lo reemplaza).
// ─────────────────────────────────────────────────────────────────────────────
function recommendNutrition(inp) {
  const { todayWorkout, plan = {}, yesterdayBurn = null, yesterdayTSS = null, yesterdayIntake = null, todayName = '' } = inp
  const planKcal = plan.calories  || 2673
  const planP    = plan.protein_g || 198
  const planC    = plan.carbs_g   || 270
  const planF    = plan.fat_g     || 89

  const name = (todayWorkout && todayWorkout.name) || todayName || ''
  const isRest = !todayWorkout ||
    /descanso|reposo|recuperaci|movilidad|libre|enferm|off/i.test(name) ||
    (todayWorkout.tss_planned != null && todayWorkout.tss_planned <= 15)

  const tips = []
  let target, headline, color, emoji, mealLean

  if (isRest) {
    // Descanso → déficit moderado para quemar grasa, manteniendo proteína
    const cutKcal = 380, cutCarbs = 90
    target = { kcal: planKcal - cutKcal, protein: planP, carbs: planC - cutCarbs, fat: planF }
    emoji = '🔥'; color = '#22c55e'
    headline = 'Día de descanso — ventana para quemar grasa'
    mealLean = 'ligero'
    tips.push(`Apunta a ~${target.kcal} kcal (unas ${cutKcal} menos que un día de entreno) para favorecer el déficit y la pérdida de grasa rumbo a 86 kg.`)
    tips.push(`Recorta ~${cutCarbs}g de carbos: elige las opciones más ligeras de Ivonne y baja arroz/pasta/pan. Mantén verduras y proteína.`)
    tips.push(`NO bajes la proteína: sigue en ${planP}g — protege el músculo en déficit.`)
  } else {
    // Entreno → comer completo, priorizar carbos, evitar déficit
    const dur = (todayWorkout && todayWorkout.duration_min) || 0
    const extraKcal = Math.round(dur * 6) // refuel aprox según duración
    target = { kcal: planKcal + extraKcal, protein: planP, carbs: planC + Math.round(extraKcal / 4), fat: planF }
    emoji = '⚡'; color = '#f97316'
    headline = 'Día de carga — come completo, no te quedes corto'
    mealLean = 'alto'
    tips.push(`Apunta a ~${target.kcal} kcal con ${target.carbs}g de carbos: elige las opciones más altas en carbos de Ivonne, sobre todo antes y después del entreno.`)
    tips.push(`Evita el déficit hoy: entrenar en bajo combustible alarga la fatiga y baja el rendimiento. El déficit lo haces en los días de descanso.`)
  }

  // Proteína — brecha a la meta (cierre con shake)
  tips.push(`Proteína meta ${planP}g/día. Si tus comidas se quedan cortas, cierra con un shake (30g whey) + yogur griego.`)

  // Arrastre del día anterior (según actividad real / consumo)
  let yesterday = null
  if (yesterdayBurn != null && yesterdayBurn > 0) {
    if (yesterdayBurn >= 600) {
      yesterday = `Ayer gastaste ~${yesterdayBurn} kcal en actividad (TSS ${yesterdayTSS ?? '—'}). ${isRest ? 'Aunque hoy descanses, no recortes de más: tu cuerpo sigue reponiendo.' : 'Asegura recuperar bien hoy.'}`
    } else {
      yesterday = `Ayer gasto bajo (~${yesterdayBurn} kcal). ${isRest ? 'Hoy puedes ajustar el déficit con tranquilidad.' : ''}`
    }
  }
  // Si hay consumo registrado de ayer, compáralo con el objetivo
  if (yesterdayIntake != null) {
    const ref = isRest ? planKcal : planKcal // referencia simple
    const diff = yesterdayIntake - ref
    if (diff < -400) yesterday = `Ayer comiste ${yesterdayIntake} kcal (${Math.abs(diff)} bajo el plan): venías en déficit alto. Hoy no te quedes corto, sobre todo en proteína.`
    else if (diff > 400) yesterday = `Ayer comiste ${yesterdayIntake} kcal (${diff} sobre el plan): hoy ajusta a la baja para reencauzar la pérdida de grasa.`
  }

  return { isRest, emoji, color, headline, mealLean, target, tips, yesterday }
}

module.exports = { computeAnalytics, adjustForRecovery, recommendNutrition }
