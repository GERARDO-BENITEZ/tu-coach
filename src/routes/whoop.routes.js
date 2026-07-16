'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  DISPOSITIVOS — Whoop (OAuth2 + historia completa)
// ════════════════════════════════════════════════════════════════════════════
const express = require('express')
const { auth, authBrowser } = require('../middleware/auth')
const { uuid, now, localDate } = require('../utils/ids')
const { WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI } = require('../config/env')
const { DB, save } = require('../services/db')
const { logSystemEvent } = require('../services/changelog')
const logger = require('../utils/logger')

const router = express.Router()

// Paso 1: redirige al login oficial de Whoop
router.get('/auth/whoop', authBrowser, (req, res) => {
  if (!WHOOP_CLIENT_ID) {
    return res.status(503).json({ error: 'config_missing', message: 'Agrega WHOOP_CLIENT_ID en el archivo .env y reinicia el servidor.' })
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: WHOOP_CLIENT_ID,
    redirect_uri: WHOOP_REDIRECT_URI,
    scope: 'read:recovery read:sleep read:cycles read:body_measurement read:workout offline',
    state: req.user.id,
  })
  res.redirect(`https://api.prod.whoop.com/oauth/oauth2/auth?${params}`)
})

// Paso 2: Whoop redirige aquí con el código de autorización
router.get('/auth/whoop/callback', async (req, res) => {
  const { code, state: athleteId, error } = req.query
  if (error || !code) return res.redirect('/athlete-dashboard.html?whoop=error')
  try {
    const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
        redirect_uri: WHOOP_REDIRECT_URI,
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) return res.redirect('/athlete-dashboard.html?whoop=error')
    const entry = {
      athlete_id: athleteId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      updated_at: now(),
    }
    const idx = DB.whoop_tokens.findIndex((t) => t.athlete_id === athleteId)
    if (idx >= 0) DB.whoop_tokens[idx] = entry
    else DB.whoop_tokens.push(entry)
    save()
    res.redirect('/athlete-dashboard.html?whoop=connected')
  } catch (e) {
    logger.error('[Whoop OAuth]', e)
    res.redirect('/athlete-dashboard.html?whoop=error')
  }
})

// Paso 3: descarga datos reales de la API de Whoop y los guarda en device_syncs
router.get('/athlete/whoop/sync', auth, async (req, res) => {
  const tokenEntry = DB.whoop_tokens.find((t) => t.athlete_id === req.user.id)
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
        const idx = DB.whoop_tokens.findIndex((t) => t.athlete_id === req.user.id)
        DB.whoop_tokens[idx] = {
          ...tokenEntry,
          access_token: fresh.access_token,
          refresh_token: fresh.refresh_token || tokenEntry.refresh_token,
          expires_at: fresh.expires_in ? new Date(Date.now() + fresh.expires_in * 1000).toISOString() : null,
          updated_at: now(),
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
    whoopFetch('https://api.prod.whoop.com/developer/v2/user/measurement/body'),
    whoopFetch('https://api.prod.whoop.com/developer/v2/recovery?limit=1'),
    whoopFetch('https://api.prod.whoop.com/developer/v2/activity/sleep?limit=1'),
    whoopFetch('https://api.prod.whoop.com/developer/v2/cycle?limit=1'),
  ])

  const rec = recovData?.records?.[0]
  const sleep = sleepData?.records?.[0]
  const cycle = cycleData?.records?.[0]

  // Milisegundos → horas, redondeado a 1 decimal. Whoop trae null para etapas
  // sin dato (ej. dispositivo sin colocar toda la noche) — se propaga como null.
  const msToH = (ms) => (ms != null ? +(ms / 3_600_000).toFixed(1) : null)
  const stages = sleep?.score?.stage_summary || {}

  const whoopData = {
    recovery_score: rec?.score?.recovery_score ?? null,
    hrv_ms: rec?.score?.hrv_rmssd_milli != null ? Math.round(rec.score.hrv_rmssd_milli) : null,
    rhr_bpm: rec?.score?.resting_heart_rate ?? null,
    sleep_hours: stages.total_in_bed_time_milli != null ? msToH(stages.total_in_bed_time_milli) : null,
    sleep_light_h: msToH(stages.total_light_sleep_time_milli),
    sleep_rem_h: msToH(stages.total_rem_sleep_time_milli),
    sleep_deep_h: msToH(stages.total_slow_wave_sleep_time_milli),
    sleep_awake_h: msToH(stages.total_awake_time_milli),
    sleep_disturbances: stages.disturbance_count ?? null,
    strain: cycle?.score?.strain != null ? +cycle.score.strain.toFixed(1) : null,
    max_heart_rate: bodyData?.max_heart_rate ?? null,
    weight_kg: bodyData?.weight_kilogram ?? null,
    synced_at: now(),
  }

  // Actualizar body_compositions con el peso real si está disponible
  if (bodyData?.weight_kilogram) {
    const bcIdx = DB.body_compositions.findIndex((b) => b.athlete_id === req.user.id)
    if (bcIdx >= 0) {
      DB.body_compositions[bcIdx].weight_kg = +bodyData.weight_kilogram.toFixed(1)
      DB.body_compositions[bcIdx].updated_at = now()
    }
  }

  const entry = { id: uuid(), athlete_id: req.user.id, workout_id: null, device: 'whoop', synced_at: now(), data: whoopData }
  DB.device_syncs.push(entry)

  // computeAnalytics() (agents-system/analytics-engine) lee whoop_history, NO
  // device_syncs, para el veredicto del CEO/Datos — y whoop_history antes solo
  // se llenaba con el import histórico completo (caro, no corre a diario). Sin
  // este upsert, el reporte del CEO queda un día atrás de recovery/HRV/sueño
  // reales aunque la sync diaria sí haya traído el dato de hoy.
  if (whoopData.recovery_score != null || whoopData.hrv_ms != null || whoopData.sleep_hours != null) {
    if (!DB.whoop_history) DB.whoop_history = []
    const today = localDate()
    const idx = DB.whoop_history.findIndex((r) => r.date === today)
    const histEntry = {
      date: today,
      recovery_score: whoopData.recovery_score,
      hrv_ms: whoopData.hrv_ms,
      rhr_bpm: whoopData.rhr_bpm,
      sleep_hours: whoopData.sleep_hours,
      sleep_efficiency: idx >= 0 ? DB.whoop_history[idx].sleep_efficiency ?? null : null,
      sleep_performance: idx >= 0 ? DB.whoop_history[idx].sleep_performance ?? null : null,
      strain: whoopData.strain,
      avg_hr: idx >= 0 ? DB.whoop_history[idx].avg_hr ?? null : null,
      max_hr: idx >= 0 ? DB.whoop_history[idx].max_hr ?? null : null,
      kilojoules: idx >= 0 ? DB.whoop_history[idx].kilojoules ?? null : null,
    }
    if (idx >= 0) DB.whoop_history[idx] = { ...DB.whoop_history[idx], ...histEntry }
    else DB.whoop_history.push(histEntry)
    DB.whoop_history.sort((a, b) => a.date.localeCompare(b.date))
  }

  save()

  const available = Object.entries(whoopData).filter(([k, v]) => v !== null && k !== 'synced_at').map(([k]) => k)
  if (whoopData.recovery_score != null) {
    logSystemEvent('❤️', 'Whoop sincronizado', `Recovery ${whoopData.recovery_score}% · HRV ${whoopData.hrv_ms ?? '—'}ms · Sueño ${whoopData.sleep_hours ?? '—'}h · FC reposo ${whoopData.rhr_bpm ?? '—'}bpm`)
  }
  res.json({ ok: true, data: whoopData, available_fields: available })
})

// Estado de la conexión Whoop (conectado / no conectado)
router.get('/athlete/whoop/status', auth, (req, res) => {
  const t = DB.whoop_tokens.find((e) => e.athlete_id === req.user.id)
  res.json({ connected: !!t, expires_at: t?.expires_at || null, updated_at: t?.updated_at || null })
})

// Biométricos Whoop más recientes con recovery_score — para mostrar en dashboard al cargar
router.get('/athlete/whoop/today', auth, (req, res) => {
  const syncs = (DB.device_syncs || [])
    .filter((s) => s.athlete_id === req.user.id && s.device === 'whoop' && s.data?.recovery_score != null)
    .sort((a, b) => b.synced_at.localeCompare(a.synced_at))
  const latest = syncs[0]
  if (!latest) return res.json({ ok: false, data: null })
  res.json({ ok: true, data: latest.data, synced_at: latest.synced_at })
})

router.get('/athlete/whoop/import-history', auth, async (req, res) => {
  const tokenEntry = DB.whoop_tokens.find((t) => t.athlete_id === req.user.id)
  if (!tokenEntry) return res.status(401).json({ error: 'no_token', message: 'Conecta Whoop primero.' })

  // Siempre refrescar el token antes
  let accessToken = tokenEntry.access_token
  try {
    const r = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
        refresh_token: tokenEntry.refresh_token,
      }),
    })
    const fresh = await r.json()
    if (fresh.access_token) {
      accessToken = fresh.access_token
      const idx = DB.whoop_tokens.findIndex((t) => t.athlete_id === req.user.id)
      DB.whoop_tokens[idx] = {
        ...tokenEntry,
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token || tokenEntry.refresh_token,
        expires_at: fresh.expires_in ? new Date(Date.now() + fresh.expires_in * 1000).toISOString() : null,
        updated_at: now(),
      }
      save()
    }
  } catch (_e) { /* continúa con token anterior */ }

  const h = { Authorization: `Bearer ${accessToken}` }

  // Pagina un endpoint Whoop hasta agotar los registros
  async function whoopPageAll(endpoint) {
    const records = []
    let nextToken = null
    let attempts = 0
    while (attempts < 50) {
      attempts++
      const qs = nextToken ? `?limit=25&nextToken=${encodeURIComponent(nextToken)}` : '?limit=25'
      const url = `https://api.prod.whoop.com/developer/v2/${endpoint}${qs}`
      try {
        const r = await fetch(url, { headers: h })
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
    byDate[date].hrv_ms = rec.score?.hrv_rmssd_milli != null ? Math.round(rec.score.hrv_rmssd_milli) : null
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
    ok: true,
    recoveries: recoveries.length,
    sleeps: sleeps.length,
    cycles: cycles.length,
    days: DB.whoop_history.length,
    oldest: DB.whoop_history[0]?.date || null,
    newest: DB.whoop_history[DB.whoop_history.length - 1]?.date || null,
  })
})

// Devuelve el historial Whoop almacenado
router.get('/athlete/whoop/history', auth, (req, res) => {
  const days = parseInt(req.query.days || '90')
  const data = (DB.whoop_history || []).slice(-days)
  res.json({ ok: true, total: (DB.whoop_history || []).length, data })
})

module.exports = router
