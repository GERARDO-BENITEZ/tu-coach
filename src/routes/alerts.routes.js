'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  MOTOR DE ALERTAS INTELIGENTES — cruza Garmin + Whoop + Plan + Nutrición
// ════════════════════════════════════════════════════════════════════════════
const express = require('express')
const { auth } = require('../middleware/auth')
const { now } = require('../utils/ids')
const { DB } = require('../services/db')
const { computePMC } = require('../services/pmc')

const router = express.Router()

router.get('/', auth, (req, res) => {
  const aid = req.user.id
  const alerts = []

  // Últimos 3 syncs de cada dispositivo (orden desc)
  const whoopSyncs = DB.device_syncs.filter((s) => s.athlete_id === aid && s.device === 'whoop').sort((a, b) => b.synced_at.localeCompare(a.synced_at)).slice(0, 3)

  // Últimos 7 workouts completados
  const completedWk = DB.workouts.filter((w) => w.athlete_id === aid && w.status === 'COMPLETED').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7)

  // Calcular CTL/ATL/TSB de todos los workouts del atleta (con baseline real)
  const allWk = DB.workouts.filter((w) => w.athlete_id === aid)
  const baseline = (DB.performance_baselines || []).find((b) => b.athlete_id === aid) || {}
  const { ctl, atl, tsb } = computePMC(allWk, baseline.ctl_seed || 0, baseline.atl_seed || 0)

  // ── ALERTA 1: Sobreentrenamiento / Riesgo de Lesión ──────────────────────
  // Condición: TSB < -20 Y recovery Whoop < 50% en los últimos 2 syncs
  const last2Whoop = whoopSyncs.slice(0, 2)
  const criticalRecovery = last2Whoop.length >= 2 && last2Whoop.every((s) => (s.data?.recovery_score ?? 100) < 50)
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

module.exports = router
